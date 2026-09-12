/**
 * One-time guard against the refund-WhatsApp back-fire: when the refund WhatsApp
 * sweep was first enabled it would have picked up EVERY historical
 * refund_processed email row (whatsapp_sent_at was never set before) and blasted
 * a WhatsApp for each. Stamp all pre-feature rows (those with no reasonCategory
 * in the payload — added only by the new refund flow) as WhatsApp-handled so
 * none can send. Runs unconditionally on boot; idempotent (a cheap no-op once
 * there are no unstamped pre-feature rows left).
 */
import { pool } from './pool.js';

export async function refundWaGuardOnBoot(): Promise<void> {
  try {
    // Report the scale first: how many historical (pre-feature) refunds exist,
    // and how many of those already had a WhatsApp attempt stamped (the back-fire
    // — sent OR skipped for a bad number) before this guard ran.
    const stat = await pool.query<{ total: string; already_wa: string }>(
      `SELECT count(*)::text total,
              count(*) FILTER (WHERE whatsapp_sent_at IS NOT NULL)::text already_wa
         FROM notifications
        WHERE channel = 'email' AND template = 'refund_processed'
          AND (payload->>'reasonCategory') IS NULL`,
    );
    const total = Number(stat.rows[0]?.total ?? 0);
    const alreadyWa = Number(stat.rows[0]?.already_wa ?? 0);
    console.log(`[refund-wa-guard] historical refund rows: ${total} total; ${alreadyWa} already had a WhatsApp attempt (back-fire); ${total - alreadyWa} still unsent`);

    const res = await pool.query(
      `UPDATE notifications
          SET whatsapp_sent_at = now()
        WHERE channel = 'email' AND template = 'refund_processed'
          AND whatsapp_sent_at IS NULL
          AND (payload->>'reasonCategory') IS NULL`,
    );
    const n = res.rowCount ?? 0;
    if (n > 0) console.log(`[refund-wa-guard] neutralised ${n} pre-feature refund_processed row(s) — no further historical WhatsApp will be sent`);
  } catch (err) {
    console.error('[refund-wa-guard] failed:', (err as Error).message);
  }
}
