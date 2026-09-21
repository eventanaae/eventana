/** One-time: record Tabby's weekly settlement charge (commission 6.5% + AED 1.5/txn
 *  + 5% VAT) as one expense per Monday payout, under "Payment Fees" / vendor Tabby.
 *  Fees only (no refunded amounts, per owner). Family/friend transactions excluded.
 *  Computed from the Tabby payments export; verified against the settlement report.
 *  Guarded (runs once); clears any prior Tabby Payment-Fees rows first for safety. */
import { pool } from './pool.js';

const INV: { d: string; f: number; n: number }[] = [
  { d: '2023-08-07', f: 151954, n: 5 },
  { d: '2023-08-14', f: 44329, n: 2 },
  { d: '2023-08-21', f: 89506, n: 5 },
  { d: '2023-08-28', f: 68565, n: 2 },
  { d: '2023-09-11', f: 53536, n: 2 },
  { d: '2023-10-02', f: 108451, n: 4 },
  { d: '2023-10-09', f: 97690, n: 5 },
  { d: '2023-10-23', f: 17766, n: 1 },
  { d: '2023-10-30', f: 45019, n: 2 },
  { d: '2023-11-06', f: 44664, n: 2 },
  { d: '2023-11-13', f: 63781, n: 2 },
  { d: '2023-11-20', f: 70264, n: 2 },
  { d: '2023-11-27', f: 53229, n: 1 },
  { d: '2023-12-04', f: 40077, n: 1 },
  { d: '2023-12-18', f: 24728, n: 1 },
  { d: '2024-01-01', f: 34282, n: 1 },
  { d: '2024-01-08', f: 135751, n: 4 },
  { d: '2024-01-15', f: 86447, n: 3 },
  { d: '2024-01-22', f: 145982, n: 4 },
  { d: '2024-02-05', f: 193868, n: 7 },
  { d: '2024-02-26', f: 10054, n: 1 },
  { d: '2024-03-04', f: 88160, n: 3 },
  { d: '2024-03-18', f: 13125, n: 1 },
  { d: '2024-04-01', f: 43995, n: 2 },
  { d: '2024-04-08', f: 30181, n: 1 },
  { d: '2024-04-15', f: 135751, n: 4 },
  { d: '2024-04-22', f: 82352, n: 3 },
  { d: '2024-05-06', f: 151586, n: 5 },
  { d: '2024-05-20', f: 15172, n: 1 },
  { d: '2024-05-27', f: 13569, n: 1 },
  { d: '2024-06-03', f: 79813, n: 2 },
  { d: '2024-06-10', f: 35641, n: 1 },
  { d: '2024-06-17', f: 49783, n: 2 },
  { d: '2024-07-15', f: 144420, n: 5 },
  { d: '2024-07-22', f: 22673, n: 1 },
  { d: '2024-08-05', f: 140673, n: 5 },
  { d: '2024-08-19', f: 64456, n: 2 },
  { d: '2024-08-26', f: 36323, n: 1 },
  { d: '2024-09-02', f: 101790, n: 4 },
  { d: '2024-09-09', f: 39893, n: 2 },
  { d: '2024-09-16', f: 32386, n: 2 },
  { d: '2024-09-23', f: 86795, n: 3 },
  { d: '2024-09-30', f: 75042, n: 2 },
  { d: '2024-10-07', f: 106792, n: 3 },
  { d: '2024-10-28', f: 34282, n: 1 },
  { d: '2024-11-25', f: 38917, n: 1 },
  { d: '2024-12-02', f: 68893, n: 2 },
  { d: '2024-12-09', f: 26775, n: 1 },
  { d: '2024-12-16', f: 108567, n: 3 },
  { d: '2025-01-13', f: 88344, n: 2 },
  { d: '2025-01-20', f: 35641, n: 1 },
  { d: '2025-01-27', f: 62416, n: 2 },
  { d: '2025-02-03', f: 34282, n: 1 },
  { d: '2025-03-03', f: 41108, n: 1 },
  { d: '2025-03-10', f: 8859, n: 1 },
  { d: '2025-03-17', f: 131991, n: 4 },
  { d: '2025-03-24', f: 101311, n: 2 },
  { d: '2025-03-31', f: 27109, n: 1 },
  { d: '2025-04-07', f: 57979, n: 2 },
  { d: '2025-04-14', f: 97367, n: 3 },
  { d: '2025-04-21', f: 27451, n: 1 },
  { d: '2025-04-28', f: 27457, n: 1 },
  { d: '2025-05-05', f: 81001, n: 3 },
  { d: '2025-05-26', f: 43831, n: 1 },
  { d: '2025-06-16', f: 13125, n: 1 },
  { d: '2025-06-23', f: 66511, n: 2 },
  { d: '2025-06-30', f: 69916, n: 2 },
  { d: '2025-07-07', f: 87136, n: 3 },
  { d: '2025-07-14', f: 28816, n: 1 },
  { d: '2025-07-21', f: 29157, n: 1 },
  { d: '2025-08-04', f: 61733, n: 2 },
  { d: '2025-08-11', f: 29839, n: 1 },
  { d: '2025-08-25', f: 31546, n: 1 },
  { d: '2025-09-01', f: 30181, n: 1 },
  { d: '2025-09-08', f: 43489, n: 1 },
  { d: '2025-09-15', f: 64115, n: 2 },
  { d: '2025-09-22', f: 29157, n: 1 },
  { d: '2025-09-29', f: 159625, n: 4 },
  { d: '2025-10-06', f: 36323, n: 1 },
  { d: '2025-10-13', f: 67869, n: 2 },
  { d: '2025-10-20', f: 44718, n: 1 },
  { d: '2025-10-27', f: 27457, n: 1 },
  { d: '2025-11-03', f: 227823, n: 8 },
  { d: '2025-11-10', f: 89716, n: 2 },
  { d: '2025-11-24', f: 26632, n: 1 },
  { d: '2025-12-01', f: 68415, n: 2 },
  { d: '2025-12-08', f: 27792, n: 1 },
  { d: '2025-12-15', f: 35504, n: 1 },
  { d: '2025-12-29', f: 107946, n: 3 },
  { d: '2026-01-05', f: 10395, n: 1 },
  { d: '2026-01-12', f: 81321, n: 2 },
  { d: '2026-01-19', f: 130831, n: 4 },
  { d: '2026-02-02', f: 52854, n: 2 },
  { d: '2026-02-09', f: 35299, n: 1 },
  { d: '2026-02-16', f: 30522, n: 1 },
  { d: '2026-02-23', f: 47817, n: 2 },
  { d: '2026-03-02', f: 107598, n: 3 },
  { d: '2026-03-09', f: 28066, n: 3 },
  { d: '2026-03-30', f: 132872, n: 5 },
  { d: '2026-04-13', f: 99415, n: 3 },
  { d: '2026-04-20', f: 28816, n: 1 },
  { d: '2026-04-27', f: 111085, n: 3 },
  { d: '2026-05-04', f: 128421, n: 3 },
  { d: '2026-05-11', f: 33115, n: 1 },
  { d: '2026-05-25', f: 48076, n: 2 },
  { d: '2026-06-01', f: 38241, n: 1 },
  { d: '2026-06-08', f: 112607, n: 3 },
  { d: '2026-06-15', f: 34282, n: 1 },
  { d: '2026-06-29', f: 34282, n: 1 },
  { d: '2026-07-06', f: 36488, n: 2 },
  { d: '2026-07-13', f: 34282, n: 1 },
  { d: '2026-08-03', f: 72237, n: 2 },
  { d: '2026-08-10', f: 54560, n: 2 },
  { d: '2026-08-24', f: 20633, n: 1 },
  { d: '2026-09-28', f: 38528, n: 2 },
];

export async function recordTabbyFeesFromEnv(): Promise<void> {
  if (String(process.env.RUN_MIGRATIONS_ON_BOOT ?? '').toLowerCase() !== 'true') return;
  const gk = 'record_tabby_fees_v1';
  const guard = await pool.query(`SELECT 1 FROM app_kv WHERE k=$1`, [gk]).catch(() => ({ rowCount: 0 }));
  if (guard.rowCount) return;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Safety: clear any prior Tabby Payment-Fees rows so a re-key never doubles.
    await client.query(`DELETE FROM expenses WHERE vendor = 'Tabby' AND category = 'Payment Fees'`);
    let ins = 0, total = 0;
    for (const w of INV) {
      await client.query(
        `INSERT INTO expenses (category, description, amount_fils, vendor, spent_on, payment_method, source)
         VALUES ('Payment Fees', $1, $2, 'Tabby', $3::date, 'tabby', 'tabby')`,
        [`Tabby weekly settlement charge — ${w.n} txn(s)`, w.f, w.d],
      );
      ins++; total += w.f;
    }
    await client.query(`INSERT INTO app_kv (k,v) VALUES ($1, now()) ON CONFLICT (k) DO NOTHING`, [gk]);
    await client.query('COMMIT');
    console.log(`[record-tabby] inserted ${ins} weekly Tabby fee expenses = AED ${(total / 100).toFixed(2)}`);
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[record-tabby] failed, rolled back:', (e as Error).message);
  } finally {
    client.release();
  }
}
