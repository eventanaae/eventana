/**
 * Owner-approved, one-off CORRECTED receipt re-send to a single customer
 * (Ghaya Al Muhairy, EV-2026-0203). Gated by RESEND_GHAYA=true.
 *
 * SAFETY: this VERIFIES the live data against the values the owner confirmed
 * BEFORE sending — event date 2026-09-12 and start time 17:00 (5:00 PM). If ANY
 * check fails it ABORTS and sends nothing, logging exactly why. Marsha is copied
 * automatically (config.email.monitorBcc / EMAIL_MONITOR_BCC) like every email.
 */
import { pool } from './pool.js';
import { emailEnabled, sendEmail } from '../integrations/email.js';
import { renderFinanceDocEmail } from '../domain/notify.js';

const P = (s: string) => console.log(`[resend-ghaya] ${s}`);

const EVENT_ID = 'EV-2026-0203';
const EXPECT_DATE = '2026-09-12';
const EXPECT_START = '17:00';

export async function resendGhayaFromEnv(): Promise<void> {
  if (process.env.RESEND_GHAYA !== 'true') return;
  if (!emailEnabled()) { P('email disabled — abort'); return; }
  try {
    const { rows } = await pool.query(`
      SELECT to_char(e.event_date,'YYYY-MM-DD') AS event_date, e.start_time, e.base_end_time, e.date_tbd,
             c.name AS customer_name, c.email AS customer_email,
             r.id AS receipt_id, r.number AS receipt_no, to_char(r.date,'YYYY-MM-DD') AS receipt_date,
             r.event_time, r.event_for, r.theme, r.age, r.paid_with, r.message,
             r.line_items, r.total_fils, r.discount_fils, r.shipping_fils, r.date_tbd AS receipt_tbd
        FROM events e
        JOIN customers c ON c.id = e.customer_id
        LEFT JOIN finance_receipts r ON r.event_id = e.id
       WHERE e.id = $1`, [EVENT_ID]);
    const g = rows[0];
    if (!g) { P(`ABORT — event ${EVENT_ID} not found`); return; }

    P(`snapshot: date=${g.event_date} time=${g.start_time}-${g.base_end_time} name="${g.customer_name}" `
      + `baby="${g.event_for}" theme="${g.theme}" email=${g.customer_email} ref=EV-${g.receipt_no} `
      + `receiptDate=${g.receipt_date} receiptTime=${g.event_time} paid=${g.paid_with}`);

    // ── Verify EVERYTHING before sending ──────────────────────────────────
    const problems: string[] = [];
    if (g.event_date !== EXPECT_DATE) problems.push(`event_date=${g.event_date} (want ${EXPECT_DATE})`);
    if (g.start_time !== EXPECT_START) problems.push(`start_time=${g.start_time} (want ${EXPECT_START})`);
    if (!g.receipt_id) problems.push('no linked sales receipt');
    if (g.receipt_id && g.receipt_date !== EXPECT_DATE) problems.push(`receipt_date=${g.receipt_date} (want ${EXPECT_DATE})`);
    if (g.event_time && g.event_time !== EXPECT_START) problems.push(`receipt event_time=${g.event_time} (want ${EXPECT_START})`);
    if (g.date_tbd || g.receipt_tbd) problems.push('marked TBD');
    if (!g.customer_email || !/@/.test(String(g.customer_email))) problems.push(`bad email "${g.customer_email}"`);
    if (!g.customer_name) problems.push('no customer name');
    if (problems.length) { P(`ABORT — NOT sending. Problems: ${problems.join('; ')}`); return; }

    // ── Build + send the corrected receipt (Marsha BCC'd automatically) ──
    const doc = {
      number: String(g.receipt_no),
      customer_name: g.customer_name,
      date: g.receipt_date,
      lineItems: Array.isArray(g.line_items) ? g.line_items : [],
      discount_fils: Number(g.discount_fils ?? 0),
      shipping_fils: Number(g.shipping_fils ?? 0),
      total_fils: Number(g.total_fils ?? 0),
      message: g.message ?? null,
      event_for: g.event_for ?? null,
      theme: g.theme ?? null,
      age: g.age ?? null,
      event_time: g.event_time ?? EXPECT_START,
      date_tbd: false,
      paid_with: g.paid_with ?? null,
    };
    const { subject, html } = renderFinanceDocEmail(doc, 'receipt');
    const res = await sendEmail({ to: String(g.customer_email), subject, html });
    P(res.ok
      ? `SENT corrected receipt to ${g.customer_email} (12 Sep, 5:00 PM) — Marsha BCC'd. subject="${subject}"`
      : `SEND FAILED: ${JSON.stringify(res)}`);
  } catch (err) {
    console.error('[resend-ghaya] failed:', (err as Error).message);
  }
}
