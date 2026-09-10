/**
 * Owner-approved, targeted re-send of the booking confirmation WhatsApp — in
 * ENGLISH — to a single customer whose event was created from a receipt with the
 * wrong (placeholder) time and later corrected by the team. Identified by the
 * guest of honour "مهيره" and the K-Pop theme.
 *
 * TWO PHASES, gated by RESEND_MAHIRA:
 *   RESEND_MAHIRA=find  → read-only: find + LOG every matching booking (name,
 *                         phone, corrected time, ref, total). Sends NOTHING.
 *   RESEND_MAHIRA=send  → require EXACTLY ONE match with a valid phone + a real
 *                         (non-placeholder) time, then send the English
 *                         booking_confirmation template. Aborts + logs why
 *                         otherwise. Never guesses.
 */
import { pool } from './pool.js';
import { formatAed } from '@eventana/shared';
import { toValidCustomerPhone } from '../domain/maintenance.js';
import { sendWhatsAppTemplate } from '../integrations/whatsapp.js';
import { whatsappEnabled } from '../integrations/whatsapp.js';

const P = (s: string) => console.log(`[resend-mahira] ${s}`);

/** 24h "HH:MM" → "2:00 PM". Mirrors notify.ts time12. */
function time12(hhmm: string | null | undefined): string {
  if (!hhmm) return '';
  const [h, m] = String(hhmm).split(':').map(Number);
  if (Number.isNaN(h)) return String(hhmm);
  const suffix = h >= 12 && h < 24 ? 'PM' : 'AM';
  const hr = ((h + 11) % 12) + 1;
  return `${hr}:${String(m || 0).padStart(2, '0')} ${suffix}`;
}

/** YYYY-MM-DD → "Thursday, 10 September 2026" in Dubai time. Mirrors notify.ts. */
function longDate(iso: string | null | undefined): string {
  if (!iso || !/^\d{4}-\d{2}-\d{2}/.test(String(iso))) return String(iso ?? '');
  const d = new Date(`${String(iso).slice(0, 10)}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleDateString('en-GB', {
    timeZone: 'Asia/Dubai', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });
}

interface Row {
  event_id: string;
  event_date: string | null;
  start_time: string | null;
  base_end_time: string | null;
  emirate: string | null;
  customer_name: string | null;
  phone: string | null;
  email: string | null;
  receipt_no: string | null;
  total_fils: number | null;
  event_for: string | null;
  theme: string | null;
  cart_event_for: string | null;
}

export async function resendMahiraFromEnv(): Promise<void> {
  const mode = String(process.env.RESEND_MAHIRA ?? '').toLowerCase();
  if (mode !== 'find' && mode !== 'send') return;

  try {
    const { rows } = await pool.query<Row>(
      `SELECT e.id AS event_id, to_char(e.event_date,'YYYY-MM-DD') AS event_date,
              e.start_time, e.base_end_time, e.emirate,
              c.name AS customer_name, c.phone, c.email,
              r.number AS receipt_no, r.total_fils, r.event_for, r.theme,
              o.cart->>'eventFor' AS cart_event_for
         FROM events e
         JOIN customers c ON c.id = e.customer_id
         LEFT JOIN orders o ON o.id = e.order_id
         LEFT JOIN finance_receipts r ON r.event_id = e.id
        WHERE r.event_for   ILIKE '%مهير%' OR o.cart->>'eventFor' ILIKE '%مهير%'
           OR r.event_for   ILIKE '%mahir%' OR o.cart->>'eventFor' ILIKE '%mahir%'
           OR r.event_for   ILIKE '%muhair%' OR r.event_for ILIKE '%mheir%'
           OR r.theme       ILIKE '%k-pop%' OR r.theme ILIKE '%kpop%' OR r.theme ILIKE '%k pop%'
           OR r.theme       ILIKE '%كي بوب%' OR r.theme ILIKE '%كيبوب%'
        ORDER BY e.event_date DESC NULLS LAST`,
    );

    P(`matches: ${rows.length}`);
    for (const g of rows) {
      const time = [time12(g.start_time), time12(g.base_end_time)].filter(Boolean).join(' – ');
      const e164 = toValidCustomerPhone(g.phone);
      P(`• ${g.event_id} | "${g.customer_name}" | guest="${g.event_for ?? g.cart_event_for ?? ''}" `
        + `theme="${g.theme ?? ''}" | date=${g.event_date} time=${g.start_time}-${g.base_end_time} (${time}) `
        + `| ref=EV-${g.receipt_no} total=${formatAed(Number(g.total_fils ?? 0))} `
        + `| phone="${g.phone}" →E164=${e164 ?? 'INVALID'} | email=${g.email ?? ''}`);
    }

    if (mode === 'find') { P('FIND-ONLY — nothing sent.'); return; }

    // ── SEND PHASE ──────────────────────────────────────────────────────────
    if (!whatsappEnabled()) { P('ABORT — WhatsApp disabled'); return; }
    if (rows.length !== 1) { P(`ABORT — expected exactly 1 match, found ${rows.length}. Not sending.`); return; }
    const g = rows[0];

    const problems: string[] = [];
    const e164 = toValidCustomerPhone(g.phone);
    const to = e164 ? String(e164).replace(/\D+/g, '') : '';
    if (!to || to.length < 11 || to.length > 15) problems.push(`bad phone "${g.phone}"`);
    if (!g.start_time || !g.base_end_time) problems.push('missing time');
    if (g.start_time === '17:00' && g.base_end_time === '21:00') problems.push('time still the 17:00–21:00 placeholder (not corrected yet)');
    if (!g.event_date) problems.push('no event date');
    if (problems.length) { P(`ABORT — NOT sending. Problems: ${problems.join('; ')}`); return; }

    const first = (g.customer_name || 'there').split(' ')[0];
    const guest = (g.event_for || g.cart_event_for || 'your little star').trim();
    const time = [time12(g.start_time), time12(g.base_end_time)].filter(Boolean).join(' – ');
    const params = [
      first,
      guest,
      longDate(g.event_date),
      time || 'the booked time',
      g.emirate || 'UAE',
      g.receipt_no ? `EV-${g.receipt_no}` : g.event_id,
      formatAed(Number(g.total_fils ?? 0)),
    ];
    P(`SENDING English booking_confirmation to ${to} — params: ${JSON.stringify(params)}`);
    const res = await sendWhatsAppTemplate({ to, name: 'booking_confirmation', language: 'en', params, fromStaff: true });
    P(res.ok ? `✅ SENT (messageId=${res.messageId})` : `❌ SEND FAILED: ${res.error}`);
  } catch (err) {
    console.error('[resend-mahira] failed:', (err as Error).message);
  }
}
