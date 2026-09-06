/**
 * The one-off win-back campaign to existing customers who already have a win-back
 * code (i.e. past-booking customers — the rollout gave them one). Gated by
 * WINBACK_CAMPAIGN:
 *   list → DRY RUN: count who would be emailed + show a sample. No sends.
 *   send → send the win-back email to each and stamp last_reminded_at (so the
 *          fortnightly reminder sweep takes over). Skips opted-out / already-sent.
 * WINBACK_CAMPAIGN_LIMIT caps how many are sent per run (default 200) so a large
 * audience can be sent in controlled batches. Owner-approved: only run `send`
 * after the owner has seen the `list` recipients and said go.
 *
 * NOTE: QuickBooks-only customers (historical_customers) are intentionally NOT
 * included here — they have no live customers row by design. Reaching them is a
 * separate decision (shared code vs. inviting them to create accounts).
 */
import { pool } from './pool.js';

const P = (s: string) => console.log(`[winback-campaign] ${s}`);

export async function winbackCampaignFromEnv(): Promise<void> {
  const mode = String(process.env.WINBACK_CAMPAIGN ?? '').toLowerCase();
  if (mode !== 'list' && mode !== 'send') return;
  const limit = Math.max(1, Math.min(1000, Number(process.env.WINBACK_CAMPAIGN_LIMIT ?? 200) || 200));

  // Eligible = a live, unused win-back code whose customer has an email, hasn't
  // opted out, and hasn't been sent the campaign yet (last_reminded_at IS NULL).
  const where = `
     FROM promo_codes p
     JOIN customers c ON c.id = p.customer_id
    WHERE p.campaign = 'winback' AND p.active
      AND c.email IS NOT NULL AND c.email <> '' AND c.email_opt_out = FALSE
      AND (p.expires_at IS NULL OR p.expires_at > now())
      AND (p.max_uses IS NULL OR p.uses < p.max_uses)
      AND NOT EXISTS (SELECT 1 FROM promo_redemptions r WHERE r.code = p.code)
      AND p.last_reminded_at IS NULL`;

  try {
    const total = await pool.query<{ n: string }>(`SELECT count(*)::text AS n ${where}`);
    P(`eligible recipients (have code, email, not opted out, not yet sent): ${total.rows[0].n}`);

    if (mode === 'list') {
      const sample = await pool.query<{ name: string; email: string; code: string }>(
        `SELECT c.name, c.email, p.code ${where} ORDER BY c.name LIMIT 20`);
      P(`sample (first ${sample.rowCount}):`);
      for (const r of sample.rows) P(`  ${r.name} <${r.email}> → ${r.code}`);
      P('DRY RUN — nothing sent. Run WINBACK_CAMPAIGN=send to actually email them.');
      return;
    }

    const { sendWinbackEmail } = await import('../domain/notify.js');
    const { rows } = await pool.query<{ id: string; name: string; email: string; code: string; expires_at: Date | null }>(
      `SELECT c.id, c.name, c.email, p.code, p.expires_at ${where} ORDER BY c.name LIMIT ${limit}`);
    P(`sending to ${rows.length} (limit ${limit})…`);
    let sent = 0; let failed = 0;
    for (const r of rows) {
      const ok = await sendWinbackEmail({
        firstName: (r.name || '').split(' ')[0],
        email: r.email,
        code: r.code,
        expiresAt: r.expires_at,
        customerId: r.id,
      }).catch(() => false);
      if (ok) {
        // Stamp only on success, so a failed send (e.g. a rate-limit blip) is
        // simply retried on the next run instead of being lost.
        await pool.query(`UPDATE promo_codes SET last_reminded_at = now() WHERE code = $1`, [r.code]);
        sent++;
      } else {
        failed++;
      }
      await new Promise((res) => setTimeout(res, 120)); // gentle on the email provider
    }
    P(`DONE — sent ${sent}, failed ${failed}. Re-run WINBACK_CAMPAIGN=send to catch any remaining/failed.`);
  } catch (e) {
    P(`FAILED: ${(e as Error).message}`);
  }
}
