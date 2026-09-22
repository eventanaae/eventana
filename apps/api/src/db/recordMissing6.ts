/** One-time: real QuickBooks (Intuit) subscription charges from the owner's Intuit
 *  billing history (USD), converted to AED @3.6725, under vendor "Quick Book" /
 *  Dues and Subscriptions. Dates are MM/DD/YYYY from Intuit (monthly). Guarded.
 *  Batch 1 of the real charges (owner will send more). */
import { pool } from './pool.js';

const RATE = 3.6725;
// { date (YYYY-MM-DD), usd }
const CHARGES: { d: string; usd: number }[] = [
  { d: '2024-10-06', usd: 39.90 },
  { d: '2024-11-06', usd: 39.90 },
  { d: '2024-12-06', usd: 39.90 },
  { d: '2025-01-06', usd: 39.90 },
  { d: '2025-02-06', usd: 39.90 },
  { d: '2025-03-06', usd: 39.90 },
  { d: '2025-04-06', usd: 39.90 },
  { d: '2025-06-03', usd: 42.00 },
  { d: '2025-08-07', usd: 42.00 },
  { d: '2025-09-07', usd: 42.00 },
  { d: '2025-10-07', usd: 42.00 },
  { d: '2025-11-07', usd: 42.00 },
  { d: '2026-01-08', usd: 48.30 },
  { d: '2026-02-07', usd: 48.30 },
  { d: '2026-03-07', usd: 48.30 },
  { d: '2026-04-07', usd: 48.30 },
  { d: '2026-05-07', usd: 48.30 },
  { d: '2026-07-06', usd: 48.30 },
  { d: '2026-08-06', usd: 48.30 },
];

export async function recordMissing6FromEnv(): Promise<void> {
  if (String(process.env.RUN_MIGRATIONS_ON_BOOT ?? '').toLowerCase() !== 'true') return;
  const gk = 'record_missing6_v1';
  const guard = await pool.query(`SELECT 1 FROM app_kv WHERE k=$1`, [gk]).catch(() => ({ rowCount: 0 }));
  if (guard.rowCount) return;
  let total = 0;
  for (const c of CHARGES) {
    const fils = Math.round(c.usd * RATE * 100);
    await pool.query(
      `INSERT INTO expenses (category, description, amount_fils, vendor, spent_on, payment_method, source)
       VALUES ('Dues and Subscriptions', $1, $2, 'Quick Book', $3::date, 'card', 'manual')`,
      [`QuickBooks subscription — $${c.usd.toFixed(2)} → AED ${(fils / 100).toFixed(2)} @${RATE}`, fils, c.d],
    );
    total += fils;
  }
  console.log(`[missing6] added ${CHARGES.length} QuickBooks subscription charges = AED ${(total / 100).toFixed(2)}`);
  await pool.query(`INSERT INTO app_kv (k,v) VALUES ($1, now()) ON CONFLICT (k) DO NOTHING`, [gk]).catch(() => {});
}
