/** One-time: delete the "Quick Book" (QuickBooks subscription) expense rows dated
 *  2024-06-10 onward, keeping the older ones. Logs everything before/after. Guarded. */
import { pool } from './pool.js';

const CUT = '2024-06-10';

export async function deleteQuickBookSubFromEnv(): Promise<void> {
  if (String(process.env.RUN_MIGRATIONS_ON_BOOT ?? '').toLowerCase() !== 'true') return;
  const gk = 'delete_qb_sub_v1';
  const guard = await pool.query(`SELECT 1 FROM app_kv WHERE k=$1`, [gk]).catch(() => ({ rowCount: 0 }));
  if (guard.rowCount) return;
  const aed = (f: number) => (Number(f) / 100).toFixed(2);
  const MATCH = `%quick%book%`;

  const all = await pool.query<any>(
    `SELECT id, to_char(spent_on,'YYYY-MM-DD') d, amount_fils, COALESCE(category,'—') c
       FROM expenses WHERE vendor ILIKE $1 ORDER BY spent_on`, [MATCH]);
  console.log(`[del-qbsub] "Quick Book" rows total: ${all.rows.length}`);
  for (const r of all.rows) console.log(`[del-qbsub]   ${r.d} | AED ${aed(r.amount_fils)} | ${r.c} | id=${r.id}${r.d >= CUT ? '  ← DELETE' : '  (keep)'}`);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const del = await client.query(
      `DELETE FROM expenses WHERE vendor ILIKE $1 AND spent_on >= $2::date RETURNING amount_fils`, [MATCH, CUT]);
    const delSum = del.rows.reduce((s: number, r: any) => s + Number(r.amount_fils), 0);
    await client.query(`INSERT INTO app_kv (k,v) VALUES ($1, now()) ON CONFLICT (k) DO NOTHING`, [gk]);
    await client.query('COMMIT');
    console.log(`[del-qbsub] DELETED ${del.rowCount} rows (>= ${CUT}) = AED ${aed(delSum)}`);
    const kept = await pool.query<any>(`SELECT count(*)::int n, COALESCE(sum(amount_fils),0)::bigint v FROM expenses WHERE vendor ILIKE $1`, [MATCH]);
    console.log(`[del-qbsub] kept ${kept.rows[0].n} rows = AED ${aed(Number(kept.rows[0].v))}`);
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[del-qbsub] failed, rolled back:', (e as Error).message);
  } finally {
    client.release();
  }
}
