/** One-time (owner missing-expense): Instagram ad PAID payments (Failed ones skipped;
 *  Aug 25 already recorded in recordMissing2). Guarded. */
import { pool } from './pool.js';

const ADS: { d: string; fils: number }[] = [
  { d: '2026-09-21', fils: 27769 }, // AED 277.69 Paid
  { d: '2026-09-18', fils: 65934 }, // AED 659.34 Paid
  { d: '2026-09-03', fils: 65894 }, // AED 658.94 Paid
];

export async function recordMissing3FromEnv(): Promise<void> {
  if (String(process.env.RUN_MIGRATIONS_ON_BOOT ?? '').toLowerCase() !== 'true') return;
  const gk = 'record_missing3_v1';
  const guard = await pool.query(`SELECT 1 FROM app_kv WHERE k=$1`, [gk]).catch(() => ({ rowCount: 0 }));
  if (guard.rowCount) return;
  let total = 0;
  for (const a of ADS) {
    await pool.query(
      `INSERT INTO expenses (category, description, amount_fils, vendor, spent_on, payment_method, source)
       VALUES ('Advertising', 'Instagram ads', $1, 'Instagram', $2::date, 'card', 'manual')`,
      [a.fils, a.d],
    );
    total += a.fils;
  }
  console.log(`[missing3] added ${ADS.length} Instagram paid ad payments = AED ${(total / 100).toFixed(2)}`);
  await pool.query(`INSERT INTO app_kv (k,v) VALUES ($1, now()) ON CONFLICT (k) DO NOTHING`, [gk]).catch(() => {});
}
