/**
 * One-off rollout of the AED 600 win-back code as the replacement for the old
 * 20%-off next-booking voucher. Gated by WINBACK_ROLLOUT=true. Two steps, both
 * idempotent and SEND NOTHING (no customer email/WhatsApp goes out here):
 *   1. Deactivate the legacy NEXT20 percent vouchers so they stop showing on
 *      profiles and stop their 6-month reminders.
 *   2. Mint a win-back code for every existing customer who has a real booking,
 *      so their profile immediately shows the AED 600 reward instead.
 * The actual customer emails are a separate, owner-approved step.
 */
import { pool } from './pool.js';
import { issueWinbackCode } from '../domain/winback.js';

const P = (s: string) => console.log(`[winback-rollout] ${s}`);

export async function winbackRolloutFromEnv(): Promise<void> {
  if (String(process.env.WINBACK_ROLLOUT ?? '').toLowerCase() !== 'true') return;
  try {
    // 1) Retire the legacy 20% next-booking vouchers.
    const off = await pool.query(
      `UPDATE promo_codes SET active = FALSE
        WHERE active AND kind = 'percent' AND code LIKE 'NEXT%-%' AND campaign IS NULL`);
    P(`deactivated ${off.rowCount} legacy percent vouchers`);

    // 2) Mint a win-back code for every customer with at least one non-cancelled
    //    event who doesn't already have a live win-back code.
    const { rows } = await pool.query<{ id: string }>(
      `SELECT DISTINCT c.id
         FROM customers c
         JOIN events e ON e.customer_id = c.id AND e.phase <> 'Cancelled'
        WHERE NOT EXISTS (
          SELECT 1 FROM promo_codes p
           WHERE p.customer_id = c.id AND p.campaign = 'winback' AND p.active
             AND (p.expires_at IS NULL OR p.expires_at > now())
             AND (p.max_uses IS NULL OR p.uses < p.max_uses)
             AND NOT EXISTS (SELECT 1 FROM promo_redemptions r WHERE r.code = p.code))`);
    P(`customers needing a win-back code: ${rows.length}`);
    let issued = 0; let failed = 0;
    for (const r of rows) {
      const res = await issueWinbackCode(pool, r.id).catch(() => null);
      if (res && !res.reused) issued++; else if (!res) failed++;
    }
    P(`DONE — issued ${issued} new codes (${failed} failed)`);
  } catch (e) {
    P(`FAILED: ${(e as Error).message}`);
  }
}
