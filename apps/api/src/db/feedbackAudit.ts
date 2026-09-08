/**
 * READ-ONLY: report the feedback rollout — how many feedback_request messages
 * were emailed / WhatsApped, split past vs future, plus the live gate flags.
 * Answers "did feedback reach the selected customers, and is it live for
 * past + future events?" Gated by FEEDBACK_AUDIT=true.
 */
import { pool } from './pool.js';
import { config } from '../config.js';

export async function feedbackAuditFromEnv(): Promise<void> {
  if (String(process.env.FEEDBACK_AUDIT ?? '').toLowerCase() !== 'true') return;
  const P = (s: string) => console.log(`[feedback-audit] ${s}`);
  try {
    // Live gates.
    P(`gates: WHATSAPP_CUSTOMER_NOTIFY=${config.whatsapp.customerNotify} · FEEDBACK_REMINDERS=${process.env.FEEDBACK_REMINDERS ?? '(unset)'}`);

    // Overall feedback_request rollout.
    const o = (await pool.query(
      `SELECT
         count(*) AS total,
         count(*) FILTER (WHERE sent_at IS NOT NULL) AS email_sent,
         count(*) FILTER (WHERE whatsapp_sent_at IS NOT NULL) AS wa_processed,
         count(*) FILTER (WHERE sent_at IS NULL AND cancelled_at IS NULL) AS email_pending,
         count(*) FILTER (WHERE whatsapp_sent_at IS NULL AND cancelled_at IS NULL) AS wa_pending,
         count(*) FILTER (WHERE cancelled_at IS NOT NULL) AS cancelled
       FROM notifications WHERE template = 'feedback_request'`,
    )).rows[0];
    P(`feedback_request rows: total=${o.total} · email_sent=${o.email_sent} · wa_processed=${o.wa_processed} · email_pending=${o.email_pending} · wa_pending=${o.wa_pending} · cancelled=${o.cancelled}`);

    // Past vs future (by the event date the feedback belongs to).
    const pf = (await pool.query(
      `SELECT
         count(*) FILTER (WHERE e.event_date < current_date) AS past,
         count(*) FILTER (WHERE e.event_date >= current_date) AS future,
         count(DISTINCT e.customer_id) AS customers
       FROM notifications n JOIN events e ON e.id = n.event_id
       WHERE n.template = 'feedback_request'`,
    )).rows[0];
    P(`by event date: past=${pf.past} · today/future=${pf.future} · distinct customers=${pf.customers}`);

    // How many past unrated parties still exist in the 90-day feedback window
    // (these are the ones the reminder sweep keeps chasing).
    const win = (await pool.query(
      `SELECT count(*) AS n FROM events e
        WHERE e.phase <> 'Cancelled'
          AND e.event_date < current_date AND e.event_date >= current_date - interval '90 days'
          AND NOT EXISTS (SELECT 1 FROM event_ratings r WHERE r.event_id = e.id)`,
    )).rows[0];
    P(`past unrated parties inside the 90-day window: ${win.n}`);

    // Delivered-to-customer sample of the most recent feedback sends.
    const recent = (await pool.query(
      `SELECT c.name, to_char(e.event_date,'YYYY-MM-DD') AS d,
              (n.sent_at IS NOT NULL) AS emailed, (n.whatsapp_sent_at IS NOT NULL) AS wa
         FROM notifications n JOIN events e ON e.id = n.event_id JOIN customers c ON c.id = e.customer_id
        WHERE n.template = 'feedback_request'
        ORDER BY COALESCE(n.sent_at, n.scheduled_for) DESC NULLS LAST LIMIT 8`,
    )).rows;
    for (const r of recent) P(`  ${r.d} · ${r.name}: email=${r.emailed} wa=${r.wa}`);
    P('DONE');
  } catch (e) {
    P(`error: ${(e as Error).message.slice(0, 200)}`);
  }
}
