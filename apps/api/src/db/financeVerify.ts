/** READ-ONLY: verify the Cash-on-hand method is sound — check that no sale is
 *  counted twice (a doc number present in BOTH finance_receipts and finance_invoices),
 *  and print the exact in/out components. Writes nothing. Guarded. */
import { pool } from './pool.js';

export async function financeVerifyFromEnv(): Promise<void> {
  if (String(process.env.RUN_MIGRATIONS_ON_BOOT ?? '').toLowerCase() !== 'true') return;
  const tag = process.env.FIN_VERIFY_TAG ?? 'v1';
  const gk = `fin_verify_${tag}`;
  const guard = await pool.query(`SELECT 1 FROM app_kv WHERE k=$1`, [gk]).catch(() => ({ rowCount: 0 }));
  if (guard.rowCount) return;
  const aed = (f: number) => (Number(f) / 100).toLocaleString('en-US', { minimumFractionDigits: 2 });

  // Double-count check: same document number in receipts AND invoices.
  const dup = await pool.query<any>(
    `SELECT count(*)::int n, COALESCE(sum(r.total_fils),0)::bigint s
       FROM finance_receipts r JOIN finance_invoices i ON i.number = r.number`);
  console.log(`[fin-verify] receipts also present as invoices (should be 0): ${dup.rows[0].n} docs · AED ${aed(dup.rows[0].s)}`);

  // Receipts + expenses by source (are QB rows the bulk?).
  const rSrc = await pool.query<any>(`SELECT COALESCE(source,'—') s, count(*)::int n, COALESCE(sum(total_fils),0)::bigint v FROM finance_receipts GROUP BY source ORDER BY v DESC`);
  for (const r of rSrc.rows) console.log(`[fin-verify] receipts ${r.s}: ${r.n} docs · AED ${aed(r.v)}`);
  const eSrc = await pool.query<any>(`SELECT COALESCE(source,'—') s, count(*)::int n, COALESCE(sum(amount_fils),0)::bigint v FROM expenses GROUP BY source ORDER BY v DESC`);
  for (const r of eSrc.rows) console.log(`[fin-verify] expenses ${r.s}: ${r.n} rows · AED ${aed(r.v)}`);

  // Expenses by category — confirm Salaries (and everything) is counted as money out.
  const eCat = await pool.query<any>(`SELECT COALESCE(category,'—') c, count(*)::int n, COALESCE(sum(amount_fils),0)::bigint v FROM expenses GROUP BY category ORDER BY v DESC LIMIT 12`);
  console.log(`[fin-verify] top expense accounts (all counted against cash):`);
  for (const r of eCat.rows) console.log(`[fin-verify]   ${r.c}: ${r.n} rows · AED ${aed(r.v)}`);

  // Invoices: paid vs unpaid split.
  const inv = await pool.query<any>(`SELECT
     COALESCE(sum(amount_paid_fils),0)::bigint paid,
     COALESCE(sum(total_fils - amount_paid_fils),0)::bigint unpaid,
     count(*)::int n FROM finance_invoices`);
  console.log(`[fin-verify] invoices: ${inv.rows[0].n} docs · collected ${aed(inv.rows[0].paid)} · outstanding(A/R) ${aed(inv.rows[0].unpaid)}`);

  // Final cash under the new (all in - all out) formula.
  const c = await pool.query<any>(`SELECT
     (SELECT COALESCE(sum(total_fils),0)::bigint FROM finance_receipts) rc,
     (SELECT COALESCE(sum(amount_paid_fils),0)::bigint FROM finance_invoices) ip,
     (SELECT COALESCE(sum(amount_fils),0)::bigint FROM expenses) ex,
     (SELECT COALESCE(sum(amount_fils),0)::bigint FROM refunds) rf`);
  const r = c.rows[0];
  const cash = Number(r.rc) + Number(r.ip) - Number(r.ex) - Number(r.rf);
  console.log(`[fin-verify] CASH = receipts ${aed(r.rc)} + collected ${aed(r.ip)} - expenses ${aed(r.ex)} - refunds ${aed(r.rf)} = AED ${aed(cash)}`);

  await pool.query(`INSERT INTO app_kv (k,v) VALUES ($1, now()) ON CONFLICT (k) DO NOTHING`, [gk]).catch(() => {});
}
