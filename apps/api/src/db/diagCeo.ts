/**
 * On-demand CEO-numbers diagnostic. Gated by DIAG_CEO=1. Read-only.
 * Dumps, for the current Dubai month, the raw figures behind the dashboard so we
 * can see WHY expenses/sales look off: expenses by source, event counts,
 * receipts, and the QuickBooks coverage boundaries.
 */
import { pool } from './pool.js';

const P = (s: string) => console.log(`[diag-ceo] ${s}`);

export async function diagCeoFromEnv(): Promise<void> {
  if (String(process.env.DIAG_CEO ?? '').trim() !== '1') return;
  try {
    const dub = new Date(Date.now() + 4 * 3_600_000);
    const y = dub.getUTCFullYear(), m = dub.getUTCMonth();
    const from = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
    const to = new Date(Date.UTC(y, m + 1, 1)).toISOString().slice(0, 10);
    P(`current month window: ${from} .. ${to}`);

    const exp = await pool.query(
      `SELECT COALESCE(source,'manual') src, COUNT(*) n, COALESCE(SUM(amount_fils),0) fils
         FROM expenses WHERE spent_on >= $1 AND spent_on < $2 GROUP BY 1 ORDER BY 3 DESC`,
      [from, to],
    );
    P(`expenses THIS MONTH by source:`);
    for (const r of exp.rows) P(`  ${r.src}: ${r.n} rows, AED ${(Number(r.fils) / 100).toFixed(2)}`);

    const expCut = await pool.query(`SELECT MAX(spent_on) d, COUNT(*) n FROM expenses WHERE source='quickbooks'`);
    P(`QB expenses: ${expCut.rows[0].n} rows, max spent_on=${expCut.rows[0].d}`);

    const expTop = await pool.query(
      `SELECT btrim(category) cat, COALESCE(NULLIF(btrim(vendor),''),'(no supplier)') vend, SUM(amount_fils) fils
         FROM expenses WHERE spent_on >= $1 AND spent_on < $2 GROUP BY 1,2 ORDER BY 3 DESC LIMIT 8`,
      [from, to],
    );
    P(`top expense rows this month (category / supplier):`);
    for (const r of expTop.rows) P(`  ${r.cat} / ${r.vend}: AED ${(Number(r.fils) / 100).toFixed(2)}`);

    const ev = await pool.query(
      `SELECT COUNT(*) all_n,
              COUNT(*) FILTER (WHERE source IS DISTINCT FROM 'quickbooks_import') genuine_n,
              COUNT(*) FILTER (WHERE phase<>'Cancelled') active_n
         FROM events WHERE event_date >= $1 AND event_date < $2`,
      [from, to],
    );
    P(`events THIS MONTH: total=${ev.rows[0].all_n} active=${ev.rows[0].active_n} genuine(non-qbimport)=${ev.rows[0].genuine_n}`);

    const fr = await pool.query(
      `SELECT COALESCE(source,'?') src, COUNT(*) n, COALESCE(SUM(total_fils),0) fils
         FROM finance_receipts WHERE date >= $1 AND date < $2 GROUP BY 1 ORDER BY 2 DESC`,
      [from, to],
    );
    P(`finance_receipts THIS MONTH by source:`);
    for (const r of fr.rows) P(`  ${r.src}: ${r.n} rows, AED ${(Number(r.fils) / 100).toFixed(2)}`);
    const frCut = await pool.query(`SELECT MAX(date) d FROM finance_receipts WHERE source='quickbooks'`);
    const hoCut = await pool.query(`SELECT MAX(txn_date) d, COUNT(DISTINCT doc_number) inv FROM historical_orders`);
    P(`QB finance_receipts max date=${frCut.rows[0].d}; historical_orders max txn_date=${hoCut.rows[0].d}, invoices=${hoCut.rows[0].inv}`);
  } catch (err) {
    P(`failed: ${(err as Error).message}`);
  }
  P('DONE');
}
