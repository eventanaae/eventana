/** READ-ONLY diagnostic: compare the current Cash-on-hand formula (opening balance +
 *  live-only rows, excluding source='quickbooks') against the owner's model
 *  (ALL money in − ALL money out, no opening balance, nothing excluded). Also dumps
 *  Payment Fees by vendor. Writes nothing. Guarded. */
import { pool } from './pool.js';

export async function financeModelCheckFromEnv(): Promise<void> {
  if (String(process.env.RUN_MIGRATIONS_ON_BOOT ?? '').toLowerCase() !== 'true') return;
  const tag = process.env.FIN_CHECK_TAG ?? 'v1';
  const gk = `fin_check_${tag}`;
  const guard = await pool.query(`SELECT 1 FROM app_kv WHERE k=$1`, [gk]).catch(() => ({ rowCount: 0 }));
  if (guard.rowCount) return;
  const aed = (f: number) => (Number(f) / 100).toLocaleString('en-US', { minimumFractionDigits: 2 });

  const q = await pool.query<any>(`SELECT
    (SELECT value FROM settings WHERE key='finance.cashOpeningFils') AS opening,
    (SELECT COALESCE(sum(total_fils),0)::bigint FROM finance_receipts) AS rcpt_all,
    (SELECT COALESCE(sum(total_fils),0)::bigint FROM finance_receipts WHERE source<>'quickbooks') AS rcpt_live,
    (SELECT COALESCE(sum(total_fils),0)::bigint FROM finance_receipts WHERE source='quickbooks') AS rcpt_qb,
    (SELECT COALESCE(sum(amount_paid_fils),0)::bigint FROM finance_invoices) AS inv_all,
    (SELECT COALESCE(sum(amount_paid_fils),0)::bigint FROM finance_invoices WHERE (source IS NULL OR source<>'quickbooks')) AS inv_live,
    (SELECT COALESCE(sum(amount_fils),0)::bigint FROM expenses) AS exp_all,
    (SELECT COALESCE(sum(amount_fils),0)::bigint FROM expenses WHERE source<>'quickbooks') AS exp_live,
    (SELECT COALESCE(sum(amount_fils),0)::bigint FROM expenses WHERE source='quickbooks') AS exp_qb,
    (SELECT COALESCE(sum(amount_fils),0)::bigint FROM refunds) AS ref`);
  const r = q.rows[0];
  const opening = Number(r.opening ?? 0);
  const currentCash = opening + Number(r.rcpt_live) + Number(r.inv_live) - Number(r.exp_live) - Number(r.ref);
  const ownerCash = Number(r.rcpt_all) + Number(r.inv_all) - Number(r.exp_all) - Number(r.ref); // opening = 0, nothing excluded
  const qbNet = Number(r.rcpt_qb) - Number(r.exp_qb);

  console.log(`[fin-check] opening balance = AED ${aed(opening)}`);
  console.log(`[fin-check] receipts: all ${aed(r.rcpt_all)} | live ${aed(r.rcpt_live)} | qb ${aed(r.rcpt_qb)}`);
  console.log(`[fin-check] invoices collected: all ${aed(r.inv_all)} | live ${aed(r.inv_live)}`);
  console.log(`[fin-check] expenses: all ${aed(r.exp_all)} | live ${aed(r.exp_live)} | qb ${aed(r.exp_qb)}`);
  console.log(`[fin-check] refunds = AED ${aed(r.ref)}`);
  console.log(`[fin-check] --- CURRENT formula (opening + live only): AED ${aed(currentCash)}`);
  console.log(`[fin-check] --- OWNER model (all in - all out, no opening): AED ${aed(ownerCash)}`);
  console.log(`[fin-check] qb net (rcpt_qb - exp_qb) = AED ${aed(qbNet)}  (vs opening ${aed(opening)})`);

  const pf = await pool.query<any>(`SELECT COALESCE(vendor,'—') v, COALESCE(source,'—') src, count(*)::int n, COALESCE(sum(amount_fils),0)::bigint s
     FROM expenses WHERE category='Payment Fees' GROUP BY vendor, source ORDER BY s DESC`);
  console.log(`[fin-check] Payment Fees — ${pf.rows.length} vendor/source groups:`);
  for (const x of pf.rows) console.log(`[fin-check]   ${x.v} · ${x.src} · ${x.n} rows · AED ${aed(x.s)}`);

  await pool.query(`INSERT INTO app_kv (k,v) VALUES ($1, now()) ON CONFLICT (k) DO NOTHING`, [gk]).catch(() => {});
}
