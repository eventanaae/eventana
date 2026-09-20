/**
 * Owner: the Emirates NBD (Peugeot van) loan has 12 installments paid so far
 * (AED 3,889 each) but only 5 were in the books. Replace the Emirates NBD Peugeot
 * expenses with the full 12 from the bank's payment history. Account 'Assets'
 * (owner's classification). One-shot guarded.
 */
import { pool } from './pool.js';

const INSTALLMENTS: { n: number; date: string }[] = [
  { n: 1, date: '2025-09-24' }, { n: 2, date: '2025-10-24' }, { n: 3, date: '2025-11-25' },
  { n: 4, date: '2025-12-24' }, { n: 5, date: '2026-01-24' }, { n: 6, date: '2026-02-24' },
  { n: 7, date: '2026-04-01' }, { n: 8, date: '2026-04-24' }, { n: 9, date: '2026-05-24' },
  { n: 10, date: '2026-06-24' }, { n: 11, date: '2026-07-24' }, { n: 12, date: '2026-08-24' },
];
const AMOUNT_FILS = 388900; // AED 3,889.00

export async function vanInstallmentsFromEnv(): Promise<void> {
  if (String(process.env.RUN_MIGRATIONS_ON_BOOT ?? '').toLowerCase() !== 'true') return;
  const guard = await pool.query(`SELECT 1 FROM app_kv WHERE k = 'van_installments_v1'`).catch(() => ({ rowCount: 0 }));
  if (guard.rowCount) return;

  const del = await pool.query(`DELETE FROM expenses WHERE lower(btrim(vendor)) LIKE '%emirates nbd peugeot%'`);
  console.log(`[van] removed ${del.rowCount} old van rows`);
  let ins = 0;
  for (const it of INSTALLMENTS) {
    await pool.query(
      `INSERT INTO expenses (category, description, amount_fils, vendor, spent_on, payment_method, source)
       VALUES ('Assets', $1, $2, 'Emirates Nbd Peugeot', $3, 'bank_transfer', 'manual')`,
      [`Van Installment ${it.n}/36`, AMOUNT_FILS, it.date],
    );
    ins++;
  }
  console.log(`[van] inserted ${ins} installments · total AED ${(ins * AMOUNT_FILS) / 100}`);
  await pool.query(`INSERT INTO app_kv (k, v) VALUES ('van_installments_v1', now()) ON CONFLICT (k) DO NOTHING`).catch(() => {});
}
