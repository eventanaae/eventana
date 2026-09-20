/**
 * One-time fix for the "time shows wrong" bug: past staff time-edits updated
 * events.start_time but left the order cart's startTime snapshot stale, and some
 * customer views read the cart. Re-sync every cart's startTime (HH:MM) to its
 * event's real start_time where they drifted. Guarded.
 */
import { pool } from './pool.js';

export async function resyncCartTimesFromEnv(): Promise<void> {
  if (String(process.env.RUN_MIGRATIONS_ON_BOOT ?? '').toLowerCase() !== 'true') return;
  const guard = await pool.query(`SELECT 1 FROM app_kv WHERE k = 'resync_cart_times_v1'`).catch(() => ({ rowCount: 0 }));
  if (guard.rowCount) return;
  const res = await pool.query(
    `UPDATE orders o
        SET cart = jsonb_set(o.cart, '{startTime}', to_jsonb(left(e.start_time, 5)))
       FROM events e
      WHERE e.order_id = o.id
        AND o.cart ? 'startTime'
        AND left(COALESCE(o.cart->>'startTime',''), 5) IS DISTINCT FROM left(e.start_time, 5)`,
  );
  console.log(`[cart-resync] fixed ${res.rowCount} order carts with a stale start time`);
  await pool.query(`INSERT INTO app_kv (k, v) VALUES ('resync_cart_times_v1', now()) ON CONFLICT (k) DO NOTHING`).catch(() => {});
}
