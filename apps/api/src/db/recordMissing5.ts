/** One-time: Stripe payment fees (pulled from Stripe API), recorded MONTHLY under
 *  "Payments/Bank fees" (vendor Stripe). Guarded. */
import { pool } from './pool.js';

const MONTHS: { m: string; fils: number; d: string }[] = [
  { m: '2026-08', fils: 23032, d: '2026-08-31' }, // AED 230.32
  { m: '2026-09', fils: 10763, d: '2026-09-21' }, // AED 107.63
];

export async function recordMissing5FromEnv(): Promise<void> {
  if (String(process.env.RUN_MIGRATIONS_ON_BOOT ?? '').toLowerCase() !== 'true') return;
  const gk = 'record_missing5_v1';
  const guard = await pool.query(`SELECT 1 FROM app_kv WHERE k=$1`, [gk]).catch(() => ({ rowCount: 0 }));
  if (guard.rowCount) return;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`DELETE FROM expenses WHERE vendor = 'Stripe' AND category = 'Payments/Bank fees'`);
    let total = 0;
    for (const w of MONTHS) {
      await client.query(
        `INSERT INTO expenses (category, description, amount_fils, vendor, spent_on, payment_method, source)
         VALUES ('Payments/Bank fees', $1, $2, 'Stripe', $3::date, 'card', 'manual')`,
        [`Stripe fees — ${w.m}`, w.fils, w.d],
      );
      total += w.fils;
    }
    await client.query(`INSERT INTO app_kv (k,v) VALUES ($1, now()) ON CONFLICT (k) DO NOTHING`, [gk]);
    await client.query('COMMIT');
    console.log(`[missing5] added ${MONTHS.length} monthly Stripe fee rows = AED ${(total / 100).toFixed(2)}`);
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[missing5] failed, rolled back:', (e as Error).message);
  } finally {
    client.release();
  }
}
