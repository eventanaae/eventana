/** One-time (owner missing-expense): Ziina payment fees, recorded MONTHLY under the
 *  "Payments/Bank fees" account (vendor Ziina). Fees are from Ziina's own Fee column
 *  (net of waived). Dated the last fee date of each month. Guarded. */
import { pool } from './pool.js';

const MONTHS: { m: string; fils: number; d: string }[] = [
  { m: '2025-07', fils: 5156, d: '2025-07-23' },
  { m: '2025-08', fils: 63563, d: '2025-08-15' },
  { m: '2025-09', fils: 35666, d: '2025-09-29' },
  { m: '2026-04', fils: 10085, d: '2026-04-24' },
  { m: '2026-05', fils: 29114, d: '2026-05-31' },
  { m: '2026-06', fils: 102971, d: '2026-06-29' },
  { m: '2026-07', fils: 139192, d: '2026-07-27' },
  { m: '2026-08', fils: 63594, d: '2026-08-28' },
  { m: '2026-09', fils: 136720, d: '2026-09-21' },
];

export async function recordMissing4FromEnv(): Promise<void> {
  if (String(process.env.RUN_MIGRATIONS_ON_BOOT ?? '').toLowerCase() !== 'true') return;
  const gk = 'record_missing4_v1';
  const guard = await pool.query(`SELECT 1 FROM app_kv WHERE k=$1`, [gk]).catch(() => ({ rowCount: 0 }));
  if (guard.rowCount) return;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`DELETE FROM expenses WHERE vendor = 'Ziina' AND category = 'Payments/Bank fees'`);
    let total = 0;
    for (const w of MONTHS) {
      await client.query(
        `INSERT INTO expenses (category, description, amount_fils, vendor, spent_on, payment_method, source)
         VALUES ('Payments/Bank fees', $1, $2, 'Ziina', $3::date, 'card', 'manual')`,
        [`Ziina fees — ${w.m}`, w.fils, w.d],
      );
      total += w.fils;
    }
    await client.query(`INSERT INTO app_kv (k,v) VALUES ($1, now()) ON CONFLICT (k) DO NOTHING`, [gk]);
    await client.query('COMMIT');
    console.log(`[missing4] added ${MONTHS.length} monthly Ziina fee rows = AED ${(total / 100).toFixed(2)}`);
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[missing4] failed, rolled back:', (e as Error).message);
  } finally {
    client.release();
  }
}
