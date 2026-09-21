/** Debug: list the van-loan (Emirates NBD Peugeot / AED 3,889) rows across sources,
 *  and any other duplicated live expenses (same vendor+amount+date, count>1), so we
 *  can see exactly what's double-counted before removing anything. Guarded. */
import { pool } from './pool.js';

export async function dupAuditFromEnv(): Promise<void> {
  if (String(process.env.RUN_MIGRATIONS_ON_BOOT ?? '').toLowerCase() !== 'true') return;
  const tag = process.env.DUP_AUDIT_TAG ?? 'v1';
  const gk = `dup_audit_${tag}`;
  const guard = await pool.query(`SELECT 1 FROM app_kv WHERE k=$1`, [gk]).catch(() => ({ rowCount: 0 }));
  if (guard.rowCount) return;
  const aed = (f: number) => (f / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  // 1) Every van-loan row (by amount or vendor), any source.
  const van = await pool.query<any>(
    `SELECT id, source, to_char(spent_on,'YYYY-MM-DD') sp, to_char(created_at,'MM-DD HH24:MI') cr,
            COALESCE(description,'—') d, COALESCE(vendor,'—') v, amount_fils
       FROM expenses
      WHERE amount_fils = 388900 OR vendor ILIKE '%peugeot%'
      ORDER BY spent_on, source, created_at`);
  console.log(`[dup-audit] van-loan rows: ${van.rows.length}`);
  for (const r of van.rows) console.log(`[dup-audit] van | id=${r.id} | ${r.source} | spent=${r.sp} | made=${r.cr} | AED ${aed(Number(r.amount_fils))} | ${r.v} | ${r.d}`);

  // 2) Van installments duplicated across sources: same spent_on with >1 row.
  const vanDup = await pool.query<any>(
    `SELECT to_char(spent_on,'YYYY-MM-DD') sp, count(*)::int n, string_agg(DISTINCT source, ',') srcs
       FROM expenses WHERE amount_fils = 388900 GROUP BY spent_on HAVING count(*) > 1 ORDER BY 1`);
  for (const r of vanDup.rows) console.log(`[dup-audit] van DUP: ${r.sp} × ${r.n} rows (sources: ${r.srcs})`);

  // 3) Any other duplicated live expense (non-QB): same vendor+amount+date more than once.
  const dups = await pool.query<any>(
    `SELECT COALESCE(vendor,'—') v, amount_fils, to_char(spent_on,'YYYY-MM-DD') sp,
            count(*)::int n, string_agg(DISTINCT COALESCE(source,'(null)'), ',') srcs, sum(amount_fils)::bigint waste
       FROM expenses WHERE source <> 'quickbooks'
      GROUP BY vendor, amount_fils, spent_on HAVING count(*) > 1
      ORDER BY (count(*)-1) * amount_fils DESC LIMIT 40`);
  let overcount = 0;
  console.log(`[dup-audit] duplicate live-expense groups: ${dups.rows.length}`);
  for (const r of dups.rows) {
    const over = (r.n - 1) * Number(r.amount_fils);
    overcount += over;
    console.log(`[dup-audit] DUP | ${r.v} | AED ${aed(Number(r.amount_fils))} | ${r.sp} | ×${r.n} (${r.srcs}) | over-counted AED ${aed(over)}`);
  }
  console.log(`[dup-audit] TOTAL over-counted across duplicate groups: AED ${aed(overcount)}`);

  await pool.query(`INSERT INTO app_kv (k,v) VALUES ($1, now()) ON CONFLICT (k) DO NOTHING`, [gk]).catch(() => {});
}
