/** Debug: explain Cash on hand. Prints the 5 components, the source breakdown of
 *  live expenses, and anything added in the last 3 days (expenses + refunds) so we
 *  can see what moved the balance. Guarded; read via logs then remove. */
import { pool } from './pool.js';

export async function cashAuditFromEnv(): Promise<void> {
  if (String(process.env.RUN_MIGRATIONS_ON_BOOT ?? '').toLowerCase() !== 'true') return;
  const tag = process.env.CASH_AUDIT_TAG ?? 'v1';
  const gk = `cash_audit_${tag}`;
  const guard = await pool.query(`SELECT 1 FROM app_kv WHERE k=$1`, [gk]).catch(() => ({ rowCount: 0 }));
  if (guard.rowCount) return;

  const comp = await pool.query<any>(`SELECT
     (SELECT value FROM settings WHERE key='finance.cashOpeningFils') AS opening,
     (SELECT COALESCE(sum(total_fils),0)::bigint FROM finance_receipts WHERE source <> 'quickbooks') AS live_receipts,
     (SELECT COALESCE(sum(amount_paid_fils),0)::bigint FROM finance_invoices WHERE (source IS NULL OR source<>'quickbooks')) AS collected_inv,
     (SELECT COALESCE(sum(amount_fils),0)::bigint FROM expenses WHERE source <> 'quickbooks') AS live_expenses,
     (SELECT COALESCE(sum(amount_fils),0)::bigint FROM refunds) AS refunds`);
  const c = comp.rows[0];
  const open = Number(c.opening ?? 0), rec = Number(c.live_receipts), inv = Number(c.collected_inv), exp = Number(c.live_expenses), ref = Number(c.refunds);
  const cash = open + rec + inv - exp - ref;
  const aed = (f: number) => (f / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  console.log(`[cash-audit] opening=${aed(open)} + receipts=${aed(rec)} + collected=${aed(inv)} - expenses=${aed(exp)} - refunds=${aed(ref)} = CASH ${aed(cash)}`);

  const bySrc = await pool.query<any>(`SELECT COALESCE(source,'(null)') src, count(*)::int n, COALESCE(sum(amount_fils),0)::bigint s FROM expenses GROUP BY 1 ORDER BY s DESC`);
  for (const r of bySrc.rows) console.log(`[cash-audit] expenses by source: ${r.src} · ${r.n} rows · AED ${aed(Number(r.s))}${r.src !== 'quickbooks' ? '  ← counts against cash' : ''}`);

  const recentExp = await pool.query<any>(`SELECT COALESCE(source,'(null)') src, count(*)::int n, COALESCE(sum(amount_fils),0)::bigint s
     FROM expenses WHERE source <> 'quickbooks' AND created_at >= now() - interval '3 days' GROUP BY 1 ORDER BY s DESC`);
  if (!recentExp.rows.length) console.log('[cash-audit] no live expenses added in last 3 days');
  for (const r of recentExp.rows) console.log(`[cash-audit] NEW live expense (3d): ${r.src} · ${r.n} rows · AED ${aed(Number(r.s))}`);

  const recentRef = await pool.query<any>(`SELECT count(*)::int n, COALESCE(sum(amount_fils),0)::bigint s FROM refunds WHERE created_at >= now() - interval '3 days'`);
  console.log(`[cash-audit] refunds added (3d): ${recentRef.rows[0].n} rows · AED ${aed(Number(recentRef.rows[0].s))}`);

  const topRecent = await pool.query<any>(`SELECT to_char(created_at,'MM-DD HH24:MI') at, source, amount_fils, COALESCE(vendor,'—') vendor, COALESCE(category,'—') cat
     FROM expenses WHERE source <> 'quickbooks' AND created_at >= now() - interval '3 days' ORDER BY amount_fils DESC LIMIT 15`);
  for (const r of topRecent.rows) console.log(`[cash-audit] recent expense: ${r.at} | ${r.source} | AED ${aed(Number(r.amount_fils))} | ${r.vendor} | ${r.cat}`);

  await pool.query(`INSERT INTO app_kv (k,v) VALUES ($1, now()) ON CONFLICT (k) DO NOTHING`, [gk]).catch(() => {});
}
