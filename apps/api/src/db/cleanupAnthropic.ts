/** One-time: the bank inbox mis-read & duplicated the Anthropic/Claude receipts
 *  (invented amounts like 1,343.07 / 1,410.24, many copies, mostly 'ignored').
 *  Per the owner: remove EVERY Anthropic row (bank rows + any expenses they made)
 *  and record ONLY the real invoices from her billing screenshots, USD converted
 *  at our peg 3.6725. Guarded (runs once). */
import { pool } from './pool.js';

const RATE = 3.6725;
const usd = (d: number) => Math.round(d * RATE * 100); // fils

// The 7 authoritative invoices (claude.ai billing + Console credit grants).
const INVOICES: { date: string; fils: number; desc: string }[] = [
  { date: '2026-08-12', fils: usd(47.25), desc: 'Claude subscription — $47.25 → AED 173.53 @3.6725' },
  { date: '2026-08-12', fils: usd(47.25), desc: 'Claude subscription — $47.25 → AED 173.53 @3.6725' },
  { date: '2026-08-12', fils: 31029, desc: 'Claude subscription — AED 310.29' },
  { date: '2026-08-12', fils: 7400, desc: 'Claude subscription — AED 74.00' },
  { date: '2026-09-12', fils: 38400, desc: 'Claude subscription — AED 384.00' },
  { date: '2026-09-15', fils: usd(21), desc: 'Claude API credits — $21.00 → AED 77.12 @3.6725' },
  { date: '2026-09-15', fils: usd(21), desc: 'Claude API credits — $21.00 → AED 77.12 @3.6725' },
];

export async function cleanupAnthropicFromEnv(): Promise<void> {
  if (String(process.env.RUN_MIGRATIONS_ON_BOOT ?? '').toLowerCase() !== 'true') return;
  const gk = 'cleanup_anthropic_v1';
  const guard = await pool.query(`SELECT 1 FROM app_kv WHERE k=$1`, [gk]).catch(() => ({ rowCount: 0 }));
  if (guard.rowCount) return;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Expenses created by approving an Anthropic bank row (linked via expense_id).
    const delLinked = await client.query(
      `DELETE FROM expenses WHERE id IN (
         SELECT expense_id FROM bank_transactions
          WHERE (source='anthropic' OR merchant ILIKE '%anthropic%') AND expense_id IS NOT NULL)`);
    // Any stray Anthropic expense.
    const delStray = await client.query(`DELETE FROM expenses WHERE vendor ILIKE '%anthropic%'`);
    // All Anthropic bank rows (all statuses/duplicates).
    const delBank = await client.query(`DELETE FROM bank_transactions WHERE source='anthropic' OR merchant ILIKE '%anthropic%'`);

    let ins = 0, total = 0;
    for (const inv of INVOICES) {
      await client.query(
        `INSERT INTO expenses (category, description, amount_fils, vendor, spent_on, payment_method, source)
         VALUES ('Dues and Subscriptions', $1, $2, 'Anthropic', $3::date, 'card', 'manual')`,
        [inv.desc, inv.fils, inv.date],
      );
      ins++; total += inv.fils;
    }
    await client.query(`INSERT INTO app_kv (k,v) VALUES ($1, now()) ON CONFLICT (k) DO NOTHING`, [gk]);
    await client.query('COMMIT');
    console.log(`[cleanup-anthropic] deleted expenses linked=${delLinked.rowCount} stray=${delStray.rowCount}, bank rows=${delBank.rowCount}; inserted ${ins} real invoices = AED ${(total / 100).toFixed(2)}`);
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[cleanup-anthropic] failed, rolled back:', (e as Error).message);
  } finally {
    client.release();
  }
}
