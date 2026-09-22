/** READ-ONLY: scope of QuickBooks receipts/invoices from 2024-06-10 to today (to be
 *  deleted) vs older (to keep). Shows count + total + by year. Writes nothing. */
import { pool } from './pool.js';

const CUT = '2024-06-10';

export async function qbReceiptsScopeFromEnv(): Promise<void> {
  if (String(process.env.RUN_MIGRATIONS_ON_BOOT ?? '').toLowerCase() !== 'true') return;
  const tag = process.env.QB_RCPT_SCOPE_TAG ?? 'v1';
  const gk = `qb_rcpt_scope_${tag}`;
  const guard = await pool.query(`SELECT 1 FROM app_kv WHERE k=$1`, [gk]).catch(() => ({ rowCount: 0 }));
  if (guard.rowCount) return;
  const aed = (f: number) => (Number(f) / 100).toLocaleString('en-US', { minimumFractionDigits: 2 });

  const del = await pool.query<any>(
    `SELECT count(*)::int n, COALESCE(sum(total_fils),0)::bigint v, to_char(min(date),'YYYY-MM-DD') mn, to_char(max(date),'YYYY-MM-DD') mx
       FROM finance_receipts WHERE source='quickbooks' AND date >= $1::date`, [CUT]);
  const keep = await pool.query<any>(
    `SELECT count(*)::int n, COALESCE(sum(total_fils),0)::bigint v FROM finance_receipts WHERE source='quickbooks' AND date < $1::date`, [CUT]);
  const inv = await pool.query<any>(
    `SELECT count(*)::int n, COALESCE(sum(total_fils),0)::bigint v FROM finance_invoices WHERE source='quickbooks' AND date >= $1::date`, [CUT]);
  const d = del.rows[0], k = keep.rows[0], i = inv.rows[0];
  console.log(`[qb-scope] TO DELETE — QB receipts >= ${CUT}: ${d.n} docs · AED ${aed(d.v)} · range ${d.mn ?? '—'} → ${d.mx ?? '—'}`);
  console.log(`[qb-scope] TO DELETE — QB invoices >= ${CUT}: ${i.n} docs · AED ${aed(i.v)}`);
  console.log(`[qb-scope] KEEP — QB receipts < ${CUT}: ${k.n} docs · AED ${aed(k.v)}`);

  const byYear = await pool.query<any>(
    `SELECT to_char(date,'YYYY') y, count(*)::int n, COALESCE(sum(total_fils),0)::bigint v
       FROM finance_receipts WHERE source='quickbooks' AND date >= $1::date GROUP BY 1 ORDER BY 1`, [CUT]);
  for (const r of byYear.rows) console.log(`[qb-scope]   delete ${r.y}: ${r.n} docs · AED ${aed(r.v)}`);

  await pool.query(`INSERT INTO app_kv (k,v) VALUES ($1, now()) ON CONFLICT (k) DO NOTHING`, [gk]).catch(() => {});
}
