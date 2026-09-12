/**
 * The WhatsApp agent.
 *
 * What it is allowed to do: greet a first-time enquiry, answer catalogue
 * questions using the SAME rule-based assistant the app uses, and ask for
 * the party date so the lead is worth something.
 *
 * What it will never do: quote a price it made up, agree a discount, accept
 * a booking, or promise availability. Money and commitments belong to a
 * human — `answerAssistant` already escalates those, and anything it flags
 * is handed straight to the team instead of being answered.
 *
 * It also never speaks unless WHATSAPP_AGENT_MODE says so:
 *   off   — read and record only (the default)
 *   greet — reply once to a brand-new enquiry, then stay quiet
 *   full  — keep answering catalogue questions
 */
import { answerAssistant } from './assistant.js';
import { agentMode, sendWhatsAppText, type InboundMessage } from '../integrations/whatsapp.js';
import { recordOutboundMessage, type RecordResult } from './whatsappLeads.js';
import { generateText, anthropicEnabled } from '../integrations/anthropic.js';
import { loadConfig } from './settings.js';
import { config } from '../config.js';
import { pool } from '../db/pool.js';
import { formatAed } from '@eventana/shared';

/** Arabic unless the customer clearly wrote to us in English. */
function isArabic(text: string): boolean {
  return /[؀-ۿ]/.test(text ?? '');
}

const GREETING_AR =
  'هلا وغلا في إيفنتانا 🎈\n' +
  'وصلتنا رسالتك وفريقنا بيرد عليك قريب.\n\n' +
  'عشان نجهّز لك عرض مناسب، عطينا:\n' +
  '• تاريخ الحفلة\n' +
  '• الإمارة\n' +
  '• عدد الأطفال تقريباً';

const GREETING_EN =
  'Welcome to Eventana 🎈\n' +
  'We’ve got your message and our team will reply shortly.\n\n' +
  'To prepare the right offer, could you send us:\n' +
  '• the party date\n' +
  '• the emirate\n' +
  '• roughly how many children';

const DATE_SAVED_AR = (date: string) =>
  `تمام، سجّلنا التاريخ ${date} ✅\nفريقنا بيتواصل معك لتأكيد التفاصيل والتوفر.`;

const DATE_SAVED_EN = (date: string) =>
  `Noted — ${date} is saved ✅\nOur team will confirm the details and availability with you.`;

const HANDOFF_AR = 'خليني أحوّلك لفريقنا، بيردون عليك من هنا مباشرة 🙌';
const HANDOFF_EN = 'Let me pass you to our team — they’ll reply right here 🙌';

export interface AgentOutcome {
  replied: boolean;
  /** Set when a human needs to take over (price disputes, refunds, complaints). */
  handoff: boolean;
  body?: string;
}

/** Compact, live catalogue facts for the AI — never lets it invent a price. */
async function catalogueFacts(): Promise<string> {
  const cfg = await loadConfig();
  const money = (f: number) => `AED ${formatAed(f)}`;
  const pkgs = [...cfg.packages.values()]
    .map((p) => `- ${p.name}: ${money(p.priceFils)}, ${p.capacity}, ${p.durationHours}h`)
    .join('\n');
  const zones = cfg.zones
    .map((z) => `${z.emirate}: ${z.feeFils == null ? 'on request' : money(z.feeFils)}`)
    .join('; ');
  return [
    'PACKAGES (exact live prices — quote ONLY prices from this list):',
    pkgs || '(ask the team)',
    `DELIVERY by emirate: ${zones || '(ask the team)'}`,
    `Standard party length: ${cfg.rules.standardEventHours}h; a custom Build-Your-Own with an inflatable/decor runs 6h.`,
  ].join('\n');
}

/**
 * A warm, on-brand WhatsApp answer written by Claude from the LIVE catalogue.
 * Returns null when the Claude key isn't configured or the call fails, so the
 * caller falls back to the deterministic rule-based reply.
 */
async function aiAnswer(question: string, ar: boolean): Promise<string | null> {
  if (!anthropicEnabled()) return null;
  const facts = await catalogueFacts();
  const appUrl = String(config.publicAppUrl).replace(/\/$/, '');
  const system = [
    'You are the WhatsApp assistant for Eventana Events — a warm, upscale kids-party & celebrations company in the UAE, Arabic-first, run by women.',
    'Voice: warm, friendly, feminine, like a real person on the team — never a corporate bot. Keep it WhatsApp-short: 2–4 sentences, one or two soft emoji at most.',
    ar ? 'Reply in warm Gulf/Emirati Arabic (khaleeji).' : 'Reply in warm, natural English.',
    'Answer ONLY from the FACTS below. NEVER invent a price, package, discount, or availability. If it is not in the facts, say the team will confirm it.',
    `Gently invite them to browse and book on the app: ${appUrl}`,
    'You do NOT approve refunds, discounts, price changes, or confirm bookings — a human handles those.',
    'Output ONLY the reply text — no preamble, no quotes.',
    '',
    facts,
  ].join('\n');
  const out = await generateText({ system, prompt: question.slice(0, 1500), maxTokens: 350 });
  return out?.trim() || null;
}

/**
 * Wire the WhatsApp hand-off to the OWNER — previously the customer got a polite
 * "our team will reply" but nobody was told. Now a dashboard ops-alert is raised
 * and Marsha gets a push, so a real person actually picks it up.
 */
async function escalateToOwner(msg: InboundMessage, reason: string): Promise<void> {
  const name = (msg.name || '').trim();
  const snippet = (msg.text || '').trim().slice(0, 160);
  // One open alert per customer per 6h — a customer firing several sensitive
  // messages shouldn't bury the bell, and shouldn't re-push.
  const ins = await pool
    .query(
      `INSERT INTO notifications (event_id, channel, template, scheduled_for, payload)
       SELECT NULL, 'ops_alert', 'whatsapp_handoff', now(), $1
        WHERE NOT EXISTS (
          SELECT 1 FROM notifications
           WHERE template = 'whatsapp_handoff' AND cancelled_at IS NULL
             AND (payload->>'phone') = $2
             AND created_at > now() - interval '6 hours')
       RETURNING id`,
      [JSON.stringify({ phone: msg.phone, name, reason, text: snippet }), msg.phone],
    )
    .catch(() => ({ rowCount: 0 }));
  if (!ins.rowCount) return; // an alert already stands for this customer
  try {
    const { rows } = await pool.query<{ id: string }>(
      `SELECT id FROM team_members WHERE lower(name) = 'marsha' AND active LIMIT 1`,
    );
    if (rows[0]) {
      const { pushToOwner } = await import('../integrations/push.js');
      await pushToOwner(
        'staff',
        rows[0].id,
        '💬 A customer needs your reply',
        `${name || msg.phone} on WhatsApp — ${reason}. Open Leads to reply.`,
      ).catch(() => {});
    }
  } catch { /* push is best-effort */ }
}

/**
 * Decides the reply for one inbound message, and sends it.
 *
 * Returns without sending whenever the mode forbids it, so the caller can
 * log the decision without needing to know the rules.
 */
export async function respondToLead(
  msg: InboundMessage,
  result: RecordResult,
): Promise<AgentOutcome> {
  const mode = agentMode();
  if (mode === 'off') return { replied: false, handoff: false };

  const ar = isArabic(msg.text) || !msg.text;

  // A brand-new enquiry always gets the greeting first — it is the fastest
  // reply the business can give, and reply speed is what converts.
  if (result.isNew) {
    return send(msg.phone, ar ? GREETING_AR : GREETING_EN);
  }

  if (mode === 'greet') return { replied: false, handoff: false };

  // The date landing is worth acknowledging: it tells the customer we heard
  // the one detail everything else depends on.
  if (result.capturedDate && result.lead.eventDate) {
    return send(msg.phone, ar ? DATE_SAVED_AR(result.lead.eventDate) : DATE_SAVED_EN(result.lead.eventDate));
  }

  // A confirmation is a commitment — never handled by the agent. Tell the
  // customer a human is coming AND actually alert the team.
  if (result.confirmed) {
    const out = await send(msg.phone, ar ? HANDOFF_AR : HANDOFF_EN);
    await escalateToOwner(msg, 'booking confirmation');
    return { ...out, handoff: true };
  }

  if (!msg.text.trim()) return { replied: false, handoff: false };

  // The rule-based assistant is the escalation gate: refunds / discounts / price
  // disputes / complaints must reach a human, never the bot.
  const answer = await answerAssistant(msg.text);
  if (answer.escalated) {
    const out = await send(msg.phone, ar ? HANDOFF_AR : HANDOFF_EN);
    await escalateToOwner(msg, ar ? 'طلب حسّاس (خصم/استرداد/سعر)' : 'sensitive request (refund/discount/price)');
    return { ...out, handoff: true };
  }

  // Not sensitive: answer with Claude off the live catalogue when the key is
  // configured, otherwise the deterministic rule-based reply.
  const ai = await aiAnswer(msg.text, ar);
  return send(msg.phone, ai ?? answer.reply);
}

async function send(phone: string, body: string): Promise<AgentOutcome> {
  const res = await sendWhatsAppText({ to: phone, body });
  if (!res.ok) return { replied: false, handoff: false };
  await recordOutboundMessage({ phone, body, messageId: res.messageId ?? null, sentBy: 'agent' });
  return { replied: true, handoff: false, body };
}
