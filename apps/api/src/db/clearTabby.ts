/** One-time: the owner will re-enter Tabby expenses from scratch (current ones have
 *  errors). Delete EVERY Tabby row on the expense side — the captured bank rows and
 *  any expenses they created — but NOT sales/receipts paid via Tabby. Logs what it
 *  removes first, then deletes. Guarded (runs once). */
import { pool } from './pool.js';

export async function clearTabbyFromEnv(): Promise<void> {
  if (String(process.env.RUN_MIGRATIONS_ON_BOOT ?? '').toLowerCase() !== 'true') return;
  const gk = 'clear_tabby_v1';
  const guard = await pool.query(`SELECT 1 FROM app_kv WHERE k=$1`, [gk]).catch(() => ({ rowCount: 0 }));
  if (guard.rowCount) return;
  const aed = (f: number) => (Number(f) / 100).toFixed(2);

  // Snapshot before deleting (so there's a record of what was removed).
  const bankSnap = await pool.query<any>(
    `SELECT status, count(*)::int n, COALESCE(sum(amount_fils),0)::bigint s
       FROM bank_transactions WHERE source='tabby' OR merchant ILIKE '%tabby%' GROUP BY status`);
  for (const r of bankSnap.rows) console.log(`[clear-tabby] bank ${r.status}: ${r.n} rows · AED ${aed(r.s)}`);
  const expSnap = await pool.query<any>(
    `SELECT count(*)::int n, COALESCE(sum(amount_fils),0)::bigint s FROM expenses WHERE vendor ILIKE '%tabby%'`);
  console.log(`[clear-tabby] tabby expenses (by vendor): ${expSnap.rows[0].n} rows · AED ${aed(expSnap.rows[0].s)}`);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const delLinked = await client.query(
      `DELETE FROM expenses WHERE id IN (
         SELECT expense_id FROM bank_transactions
          WHERE (source='tabby' OR merchant ILIKE '%tabby%') AND expense_id IS NOT NULL)`);
    const delStray = await client.query(`DELETE FROM expenses WHERE vendor ILIKE '%tabby%'`);
    const delBank = await client.query(`DELETE FROM bank_transactions WHERE source='tabby' OR merchant ILIKE '%tabby%'`);
    await client.query(`INSERT INTO app_kv (k,v) VALUES ($1, now()) ON CONFLICT (k) DO NOTHING`, [gk]);
    await client.query('COMMIT');
    console.log(`[clear-tabby] DELETED expenses linked=${delLinked.rowCount} stray=${delStray.rowCount}, bank rows=${delBank.rowCount}. Sales/receipts left untouched.`);
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[clear-tabby] failed, rolled back:', (e as Error).message);
  } finally {
    client.release();
  }
}
