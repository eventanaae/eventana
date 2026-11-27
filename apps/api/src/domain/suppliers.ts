/**
 * Sheikha ↔ suppliers on WhatsApp (owner approved 27 Nov).
 *
 * Opening a chat with a supplier needs Meta's approved template `supplier_inquiry`.
 * After that, supplier replies come in through the webhook. They are NOT answered
 * by the customer bot; they are forwarded to Marsha right away and logged, so
 * Sheikha and the team can follow up.
 */
import { config } from '../config.js';
import { pool } from '../db/pool.js';
import { sendWhatsAppTemplate, sendWhatsAppText, type InboundMessage } from '../integrations/whatsapp.js';
import { recordOutboundMessage } from './whatsappLeads.js';

export const SUPPLIER_TEMPLATE = 'supplier_inquiry';
const BODY = 'Hello, this is Eventana Events, a kids party company in the UAE. We are looking for {{1}}. Could you please share your price and how long it would take? Thank you!';
const EXAMPLE = 'finishing (smoothing, coating and painting) for some Styrofoam pieces we already made';

const digits = (p: string) => String(p ?? '').replace(/\D/g, '');
function e164(p: string): string | null {
  let d = digits(p);
  if (d.startsWith('00')) d = d.slice(2);
  if (d.startsWith('0') && d.length === 10) d = '971' + d.slice(1);
  else if (d.startsWith('5') && d.length === 9) d = '971' + d;
  return d.length >= 11 && d.length <= 15 ? d : null;
}

async function graph(path: string, method: 'GET' | 'POST' = 'GET', body?: unknown): Promise<any> {
  const res = await fetch(`https://graph.facebook.com/${config.meta.graphVersion}/${path}`, {
    method,
    signal: AbortSignal.timeout(20000),
    headers: { authorization: `Bearer ${config.whatsapp.accessToken}`, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${res.status} ${j?.error?.error_user_msg ?? j?.error?.message ?? ''}`.trim());
  return j;
}

/** Submit the template to Meta (idempotent: reports the status if it already exists). */
export async function ensureSupplierTemplate(): Promise<{ status: string; detail?: string }> {
  const waba = process.env.WHATSAPP_WABA_ID;
  if (!waba || !config.whatsapp.accessToken) return { status: 'not_configured' };
  const cur = await graph(`${waba}/message_templates?name=${SUPPLIER_TEMPLATE}&fields=name,status,category,rejected_reason`).catch(() => ({ data: [] }));
  const t = (cur.data ?? []).find((x: any) => x.name === SUPPLIER_TEMPLATE);
  if (t) return { status: String(t.status), detail: t.rejected_reason && t.rejected_reason !== 'NONE' ? String(t.rejected_reason) : undefined };
  try {
    const r = await graph(`${waba}/message_templates`, 'POST', {
      name: SUPPLIER_TEMPLATE, language: 'en', category: 'UTILITY',
      components: [{ type: 'BODY', text: BODY, example: { body_text: [[EXAMPLE]] } }],
    });
    return { status: String(r.status ?? 'PENDING') };
  } catch (e) {
    return { status: 'error', detail: (e as Error).message.slice(0, 300) };
  }
}

/** Open a chat with a supplier. Max 10 per day. */
export async function messageSupplier(phone: string, name: string, need: string): Promise<{ ok: boolean; error?: string }> {
  const to = e164(phone);
  if (!to) return { ok: false, error: 'bad_phone' };
  const n = String(need ?? '').replace(/\s*\n+\s*/g, ' ').trim().slice(0, 300);
  if (!n) return { ok: false, error: 'need_required' };
  const today = await pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM ai_suppliers WHERE last_sent_at > now() - interval '1 day'`);
  if ((today.rows[0]?.n ?? 0) >= 10) return { ok: false, error: 'daily_limit' };
  const r = await sendWhatsAppTemplate({ to, name: SUPPLIER_TEMPLATE, language: 'en', params: [n], fromStaff: true });
  if (!r.ok) return { ok: false, error: r.error };
  await pool.query(
    `INSERT INTO ai_suppliers (phone, name, need, last_sent_at) VALUES ($1,$2,$3,now())
     ON CONFLICT (phone) DO UPDATE SET name = EXCLUDED.name, need = EXCLUDED.need, last_sent_at = now()`,
    [to, String(name ?? '').slice(0, 120), n]);
  await recordOutboundMessage({ phone: to, body: BODY.replace('{{1}}', n), messageId: r.messageId ?? null, sentBy: 'agent' }).catch(() => {});
  return { ok: true };
}

/** True when this number is a supplier we contacted. */
export async function supplierName(phone: string): Promise<string | null> {
  const r = await pool.query<{ name: string }>(`SELECT name FROM ai_suppliers WHERE right(phone, 9) = right($1, 9) LIMIT 1`, [digits(phone)]).catch(() => ({ rows: [] as { name: string }[] }));
  return r.rows[0] ? (r.rows[0].name || 'A supplier') : null;
}

/** A supplier wrote back: forward it to Marsha straight away. Never throws. */
export async function forwardSupplierReply(msg: InboundMessage, name: string): Promise<void> {
  try {
    if (!msg.text.trim()) return;
    const body = `📩 ${name} (+${digits(msg.phone)}) replied:\n${msg.text.slice(0, 1200)}`;
    let r = await sendWhatsAppText({ to: '971564500777', body, fromStaff: true, allowCompanyPhone: true });
    if (!r.ok) r = await sendWhatsAppTemplate({ to: '971564500777', name: 'staff_notify', language: 'en', allowCompanyPhone: true, fromStaff: true,
      params: ['Marsha', `📩 ${name} replied`, msg.text.replace(/\s*\n+\s*/g, ' • ').slice(0, 900)] });
    if (r.ok) await recordOutboundMessage({ phone: '971564500777', body, messageId: r.messageId ?? null, sentBy: 'agent' }).catch(() => {});
  } catch (err) {
    console.error('[suppliers] forward failed:', (err as Error).message);
  }
}
