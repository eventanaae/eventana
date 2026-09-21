/** One-time: the Emirates NBD Peugeot van loan was double-entered (24 rows: a manual
 *  set + an auto set), over-counting AED 46,668 against Cash on hand. The owner sent
 *  the authoritative payment history, so we delete EVERY existing van-loan row and
 *  re-insert the 12 real installments with the correct dates. Guarded (runs once).
 *
 *  Dates from the bank's Payment history (installment 3 = 25 Nov, 7 = 01 Apr). */
import { pool } from './pool.js';

const AMOUNT = 388900; // AED 3,889.00
const INSTALLMENTS: { n: number; date: string }[] = [
  { n: 1, date: '2025-09-24' },
  { n: 2, date: '2025-10-24' },
  { n: 3, date: '2025-11-25' },
  { n: 4, date: '2025-12-24' },
  { n: 5, date: '2026-01-24' },
  { n: 6, date: '2026-02-24' },
  { n: 7, date: '2026-04-01' },
  { n: 8, date: '2026-04-24' },
  { n: 9, date: '2026-05-24' },
  { n: 10, date: '2026-06-24' },
  { n: 11, date: '2026-07-24' },
  { n: 12, date: '2026-08-24' },
];

export async function rebuildVanLoanFromEnv(): Promise<void> {
  if (String(process.env.RUN_MIGRATIONS_ON_BOOT ?? '').toLowerCase() !== 'true') return;
  const gk = 'rebuild_van_loan_v1';
  const guard = await pool.query(`SELECT 1 FROM app_kv WHERE k=$1`, [gk]).catch(() => ({ rowCount: 0 }));
  if (guard.rowCount) return;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Remove EVERY existing van-loan row (both the manual and auto duplicate sets).
    const del = await client.query(
      `DELETE FROM expenses WHERE amount_fils = $1 AND (vendor ILIKE '%peugeot%' OR description ILIKE 'Van Installment %')`,
      [AMOUNT],
    );
    // Re-insert the 12 authoritative installments (source 'auto' = the recurring set;
    // the sweep now dedupes by description so it won't re-add these).
    let ins = 0;
    for (const it of INSTALLMENTS) {
      await client.query(
        `INSERT INTO expenses (category, description, amount_fils, vendor, spent_on, payment_method, source)
         VALUES ('Assets', $1, $2, 'Emirates Nbd Peugeot', $3::date, 'bank_transfer', 'auto')`,
        [`Van Installment ${it.n}/36`, AMOUNT, it.date],
      );
      ins++;
    }
    await client.query(`INSERT INTO app_kv (k,v) VALUES ($1, now()) ON CONFLICT (k) DO NOTHING`, [gk]);
    await client.query('COMMIT');
    console.log(`[rebuild-van] deleted ${del.rowCount} old van rows, inserted ${ins} clean installments (AED ${(AMOUNT * ins / 100).toLocaleString('en-US')})`);
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[rebuild-van] failed, rolled back:', (e as Error).message);
  } finally {
    client.release();
  }
}
