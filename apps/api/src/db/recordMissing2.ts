/** One-time (owner missing-expense): Instagram ad spend. Guarded. */
import { pool } from './pool.js';

export async function recordMissing2FromEnv(): Promise<void> {
  if (String(process.env.RUN_MIGRATIONS_ON_BOOT ?? '').toLowerCase() !== 'true') return;
  const gk = 'record_missing2_v1';
  const guard = await pool.query(`SELECT 1 FROM app_kv WHERE k=$1`, [gk]).catch(() => ({ rowCount: 0 }));
  if (guard.rowCount) return;
  await pool.query(
    `INSERT INTO expenses (category, description, amount_fils, vendor, spent_on, payment_method, source)
     VALUES ('Advertising', 'Instagram ads', 65973, 'Instagram', '2026-08-25'::date, 'card', 'manual')`,
  );
  console.log(`[missing2] added Instagram ads AED 659.73 @ 2026-08-25 (Advertising)`);
  await pool.query(`INSERT INTO app_kv (k,v) VALUES ($1, now()) ON CONFLICT (k) DO NOTHING`, [gk]).catch(() => {});
}
