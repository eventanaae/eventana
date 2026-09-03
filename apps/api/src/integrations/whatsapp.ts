/**
 * WhatsApp Cloud API — receiving and sending on Eventana's business number.
 *
 * A thin adapter over Meta's Graph API, no SDK, in the same shape as the
 * email and Meta CAPI adapters: absent credentials make every call a
 * graceful no-op rather than an error.
 *
 * Two safety properties this file exists to guarantee:
 *
 *   1. Nothing is ever sent unless WHATSAPP_AGENT_MODE says so. The default
 *      is 'off' — the agent reads and records, and stays silent. Turning it
 *      on is a deliberate act, because every message here reaches a real
 *      customer of a real business.
 *
 *   2. Inbound payloads are verified against the app secret before they are
 *      believed. Anyone can POST to a public webhook; only Meta can sign it.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { config } from '../config.js';

export type AgentMode = 'off' | 'greet' | 'full';

export function whatsappEnabled(): boolean {
  return Boolean(config.whatsapp.phoneNumberId && config.whatsapp.accessToken);
}

/**
 * Customer-facing transactional WhatsApp (confirmation, reminders, live status,
 * feedback) only flows when the API is connected AND the owner has flipped the
 * master switch on. Both must be true — shipping the pipeline never messages a
 * real customer on its own.
 */
export function whatsappCustomerNotifyEnabled(): boolean {
  return whatsappEnabled() && config.whatsapp.customerNotify === true;
}

/** 'off' unless explicitly configured — never inferred from anything else. */
export function agentMode(): AgentMode {
  const raw = (config.whatsapp.agentMode ?? 'off').toLowerCase();
  return raw === 'greet' || raw === 'full' ? raw : 'off';
}

/**
 * Verifies Meta's `X-Hub-Signature-256` over the RAW body.
 *
 * Returns false when no app secret is configured: an unverifiable webhook is
 * treated as untrusted, not as trusted-by-default.
 */
export function verifyWebhookSignature(signatureHeader: string | undefined, rawBody: string): boolean {
  const secret = config.whatsapp.appSecret;
  if (!secret || !signatureHeader) return false;
  const expected = 'sha256=' + createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');
  const a = Buffer.from(signatureHeader);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/* ------------------------------------------------------------------ */
/* Inbound                                                             */
/* ------------------------------------------------------------------ */

export interface InboundMessage {
  /** Sender's number, digits only with country code. */
  phone: string;
  /** WhatsApp profile name, when Meta includes it. */
  name: string | null;
  /** Meta's message id — the idempotency key for a replayed delivery. */
  messageId: string;
  text: string;
  timestamp: Date;
  /**
   * Present only when this conversation began from a click-to-WhatsApp ad.
   * `ctwaClid` is what lets a booking be traced back to the exact ad.
   */
  ctwaClid: string | null;
  sourceAdId: string | null;
  sourceHeadline: string | null;
}

/**
 * Pulls the messages out of a Cloud API webhook payload.
 *
 * Meta nests them three levels deep and mixes in delivery/read receipts,
 * which carry no message body — those are skipped rather than stored as
 * empty leads.
 */
export function parseInbound(body: unknown): InboundMessage[] {
  const out: InboundMessage[] = [];
  const entries = (body as { entry?: unknown[] })?.entry;
  if (!Array.isArray(entries)) return out;

  for (const entry of entries) {
    const changes = (entry as { changes?: unknown[] })?.changes;
    if (!Array.isArray(changes)) continue;

    for (const change of changes) {
      const value = (change as { value?: Record<string, unknown> })?.value;
      if (!value) continue;

      const messages = Array.isArray(value.messages) ? value.messages : [];
      const contacts = Array.isArray(value.contacts) ? value.contacts : [];

      for (const raw of messages) {
        const m = raw as Record<string, any>;
        // Only real text for now. Images and voice notes still create the
        // lead, with an empty body, so the enquiry is never lost.
        const text: string =
          m.text?.body ??
          m.button?.text ??
          m.interactive?.button_reply?.title ??
          m.interactive?.list_reply?.title ??
          '';

        const phone = String(m.from ?? '').replace(/\D+/g, '');
        if (!phone || !m.id) continue;

        const contact = contacts.find(
          (c: any) => String(c?.wa_id ?? '').replace(/\D+/g, '') === phone,
        ) as Record<string, any> | undefined;

        const referral = m.referral as Record<string, any> | undefined;

        out.push({
          phone,
          name: contact?.profile?.name ?? null,
          messageId: String(m.id),
          text: String(text),
          timestamp: m.timestamp ? new Date(Number(m.timestamp) * 1000) : new Date(),
          ctwaClid: referral?.ctwa_clid ?? null,
          sourceAdId: referral?.source_id ? String(referral.source_id) : null,
          sourceHeadline: referral?.headline ? String(referral.headline) : null,
        });
      }
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Outbound                                                            */
/* ------------------------------------------------------------------ */

export interface SendResult {
  ok: boolean;
  messageId?: string;
  error?: string;
}

/**
 * Sends a plain text reply.
 *
 * Refuses when the agent is off, so a stray call site can never start
 * messaging customers by accident — the mode check lives here rather than
 * only at the caller for exactly that reason.
 */
export async function sendWhatsAppText(args: {
  to: string;
  body: string;
  /** Set true for a staff-initiated send, which the mode gate doesn't block. */
  fromStaff?: boolean;
}): Promise<SendResult> {
  if (!whatsappEnabled()) return { ok: false, error: 'whatsapp_disabled' };
  if (!args.fromStaff && agentMode() === 'off') return { ok: false, error: 'agent_off' };

  const url =
    `https://graph.facebook.com/${config.meta.graphVersion}` +
    `/${config.whatsapp.phoneNumberId}/messages`;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${config.whatsapp.accessToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: args.to,
        type: 'text',
        text: { preview_url: false, body: args.body.slice(0, 4000) },
      }),
    });
    if (!res.ok) {
      return { ok: false, error: `${res.status}: ${(await res.text()).slice(0, 300)}` };
    }
    const json = (await res.json()) as { messages?: Array<{ id?: string }> };
    return { ok: true, messageId: json.messages?.[0]?.id };
  } catch (err) {
    return { ok: false, error: (err as Error).message.slice(0, 300) };
  }
}

/**
 * Sends an approved WhatsApp message TEMPLATE — the only way to reach a customer
 * proactively (outside the 24-hour service window). `params` fill the body's
 * {{1}}, {{2}}… in order; each must be a non-empty single line (Meta rejects
 * empty or multi-line parameters).
 */
export async function sendWhatsAppTemplate(args: {
  to: string;
  name: string;
  language?: string;
  params?: string[];
  fromStaff?: boolean;
}): Promise<SendResult> {
  if (!whatsappEnabled()) return { ok: false, error: 'whatsapp_disabled' };
  if (!args.fromStaff && agentMode() === 'off') return { ok: false, error: 'agent_off' };

  const url =
    `https://graph.facebook.com/${config.meta.graphVersion}` +
    `/${config.whatsapp.phoneNumberId}/messages`;

  const components = args.params && args.params.length
    ? [{ type: 'body', parameters: args.params.map((t) => ({ type: 'text', text: String(t).replace(/\s{4,}/g, '   ').slice(0, 900) })) }]
    : [];

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${config.whatsapp.accessToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: args.to,
        type: 'template',
        template: {
          name: args.name,
          language: { code: args.language ?? 'en' },
          ...(components.length ? { components } : {}),
        },
      }),
    });
    if (!res.ok) {
      return { ok: false, error: `${res.status}: ${(await res.text()).slice(0, 300)}` };
    }
    const json = (await res.json()) as { messages?: Array<{ id?: string }> };
    return { ok: true, messageId: json.messages?.[0]?.id };
  } catch (err) {
    return { ok: false, error: (err as Error).message.slice(0, 300) };
  }
}
