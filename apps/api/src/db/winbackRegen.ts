/**
 * Regenerate win-back codes into the short (first-name) format. The initial
 * rollout minted some codes from the FULL name (e.g. AISHAALIAL600-…), which the
 * owner found too long. Since issueWinbackCode reuses an existing code, we can't
 * just re-issue — we delete the old, unsent, unredeemed win-back codes and mint
 * fresh short ones. Only touches codes that were never emailed (last_reminded_at
 * IS NULL) and never redeemed, so nothing a customer might already hold changes.
 * Gated by WINBACK_REGEN=true.
 */
import { pool } from './pool.js';

const P = (s: string) => console.log(`[winback-regen] ${s}`);

export async function winbackRegenFromEnv(): Promise<void> {
  if (String(process.env.WINBACK_REGEN ?? '').toLowerCase() !== 'true') return;
  const { issueWinbackCode } = await import('../domain/winback.js');
  try {
    // Customers whose win-back code is unsent + unredeemed → safe to rebuild.
    const { rows } = await pool.query<{ customer_id: string }>(
      `SELECT DISTINCT p.customer_id
         FROM promo_codes p
        WHERE p.campaign = 'winback' AND p.customer_id IS NOT NULL
          AND p.last_reminded_at IS NULL
          AND NOT EXISTS (SELECT 1 FROM promo_redemptions r WHERE r.code = p.code)`);
    P(`codes to regenerate: ${rows.length}`);

    // Delete the old unsent/unredeemed win-back codes.
    const del = await pool.query(
      `DELETE FROM promo_codes p
        WHERE p.campaign = 'winback' AND p.last_reminded_at IS NULL
          AND NOT EXISTS (SELECT 1 FROM promo_redemptions r WHERE r.code = p.code)`);
    P(`deleted ${del.rowCount} old codes`);

    let issued = 0;
    for (const r of rows) {
      const res = await issueWinbackCode(pool, r.customer_id).catch(() => null);
      if (res) { issued++; P(`  ${r.customer_id} → ${res.code}`); }
    }
    P(`DONE — issued ${issued} short codes`);
  } catch (e) {
    P(`FAILED: ${(e as Error).message}`);
  }
}
