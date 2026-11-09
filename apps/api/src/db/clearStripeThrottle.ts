/** One-time: clear the Stripe-fee-sync throttle so the new approval-gated behavior
 *  runs on the next sweep instead of waiting out the 12h window. Guarded. */
import { pool } from './pool.js';

export async function clearStripeThrottleFromEnv(): Promise<void> {
  if (String(process.env.RUN_MIGRATIONS_ON_BOOT ?? '').toLowerCase() !== 'true') return;
  const gk = 'clear_stripe_throttle_v1';
  const guard = await pool.query(`SELECT 1 FROM app_kv WHERE k=$1`, [gk]).catch((e: unknown) => {
    // A failed marker read must not look like "never ran": stop instead of re-running.
    console.error('[boot] one-shot marker check failed — skipping (not re-running):', (e as Error)?.message);
    return { rowCount: 1 };
  });
  if (guard.rowCount) return;
  await pool.query(`DELETE FROM app_kv WHERE k = 'stripe_fee_sync_at'`).catch(() => {});
  console.log('[clear-stripe-throttle] reset — Stripe fee sync will run next sweep');
  await pool.query(`INSERT INTO app_kv (k,v) VALUES ($1, now()) ON CONFLICT (k) DO NOTHING`, [gk]).catch(() => {});
}
