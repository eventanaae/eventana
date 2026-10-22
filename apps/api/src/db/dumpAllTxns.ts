/**
 * READ-ONLY one-shot: dump EVERY recorded transaction — all sales
 * (finance_receipts) and all expenses — from the first recorded date to today,
 * for an all-time bank-statement-style PDF. The combined, date-sorted array is
 * JSON'd, base64'd and emitted in ~8KB chunks (TXNB64 lines) so the whole set
 * comes back in one log read; plus a META line. Gated by
 * SET_SHAN_LEADER='alltxndump' (reuses the one-shot key). Blank it after.
 */
import { pool } from './pool.js';

interface Txn { d: string; t: 'Sale' | 'Expense'; desc: string; inF: number; outF: number; src: string; ref: string; }

export async function dumpAllTxnsFromEnv(): Promise<void> {
  if (String(process.env.SET_SHAN_LEADER ?? '').toLowerCase() !== 'alltxndump') return;
  try {
    const sales = await pool.query<{ d: string; total_fils: number; customer_name: string; source: string; number: string; event_for: string | null }>(
      `SELECT to_char(date,'YYYY-MM-DD') AS d, total_fils::bigint AS total_fils,
              COALESCE(customer_name,'') AS customer_name, COALESCE(source,'dashboard') AS source,
              number, event_for
         FROM finance_receipts`,
    );
    const exp = await pool.query<{ d: string; amount_fils: number; category: string; description: string; vendor: string | null; source: string; id: string }>(
      `SELECT to_char(spent_on,'YYYY-MM-DD') AS d, amount_fils::bigint AS amount_fils,
              COALESCE(category,'other') AS category, COALESCE(description,'') AS description,
              vendor, COALESCE(source,'manual') AS source, id::text AS id
         FROM expenses`,
    );

    const txns: Txn[] = [];
    for (const s of sales.rows) {
      const who = String(s.customer_name || 'Customer').trim();
      const extra = s.event_for ? ` — ${String(s.event_for).trim()}` : '';
      txns.push({ d: s.d, t: 'Sale', desc: `${who}${extra}`, inF: Number(s.total_fils ?? 0), outF: 0, src: s.source, ref: `RCP-${s.number}` });
    }
    for (const e of exp.rows) {
      const v = e.vendor ? ` (${String(e.vendor).trim()})` : '';
      const d = String(e.description || e.category).trim();
      txns.push({ d: e.d, t: 'Expense', desc: `${e.category}: ${d}${v}`, inF: 0, outF: Number(e.amount_fils ?? 0), src: e.source, ref: `EXP-${e.id}` });
    }
    // Chronological for a running balance; stable tie-break by type then ref.
    txns.sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : (a.t < b.t ? -1 : a.t > b.t ? 1 : (a.ref < b.ref ? -1 : 1))));

    const totalIn = txns.reduce((s, x) => s + x.inF, 0);
    const totalOut = txns.reduce((s, x) => s + x.outF, 0);
    const minDate = txns.length ? txns[0].d : null;
    const maxDate = txns.length ? txns[txns.length - 1].d : null;
    console.log(`TXNMETA|${JSON.stringify({ count: txns.length, sales: sales.rows.length, expenses: exp.rows.length, totalIn, totalOut, net: totalIn - totalOut, minDate, maxDate })}`);

    const b64 = Buffer.from(JSON.stringify(txns), 'utf8').toString('base64');
    const CHUNK = 8000;
    const n = Math.ceil(b64.length / CHUNK);
    for (let i = 0; i < n; i++) console.log(`TXNB64|${i}|${n}|${b64.slice(i * CHUNK, (i + 1) * CHUNK)}`);
    console.log(`TXNDONE|${n}|${b64.length}`);
  } catch (err) {
    console.error('[alltxndump] failed:', (err as Error).message);
  }
}
