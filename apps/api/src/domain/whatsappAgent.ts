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

  // A confirmation is a commitment — never handled by the agent.
  if (result.confirmed) {
    const out = await send(msg.phone, ar ? HANDOFF_AR : HANDOFF_EN);
    return { ...out, handoff: true };
  }

  if (!msg.text.trim()) return { replied: false, handoff: false };

  const answer = await answerAssistant(msg.text);
  if (answer.escalated) {
    const out = await send(msg.phone, ar ? HANDOFF_AR : HANDOFF_EN);
    return { ...out, handoff: true };
  }

  return send(msg.phone, answer.reply);
}

async function send(phone: string, body: string): Promise<AgentOutcome> {
  const res = await sendWhatsAppText({ to: phone, body });
  if (!res.ok) return { replied: false, handoff: false };
  await recordOutboundMessage({ phone, body, messageId: res.messageId ?? null, sentBy: 'agent' });
  return { replied: true, handoff: false, body };
}
