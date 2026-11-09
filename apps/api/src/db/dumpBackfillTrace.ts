/**
 * READ-ONLY one-shot: trace the 35 receipts (2124–2158) the sale backfill posted at
 * 2026-11-10 01:29 Dubai for old July/Aug app orders. For each order: status,
 * source, kind, updated_at, event, any earlier failure alert, and any OTHER receipt
 * that already covers the same customer + event date (= a duplicate).
 * Gated by SET_SHAN_LEADER='bftrace'. Blank it after.
 */
import { pool } from './pool.js';

export async function dumpBackfillTraceFromEnv(): Promise<void> {
  if (String(process.env.SET_SHAN_LEADER ?? '').toLowerCase() !== 'bftrace') return;
  const clean = (v: unknown) => String(v ?? '').replace(/[\s|]+/g, ' ').trim();
  try {
    const { rows } = await pool.query(
      `SELECT fr.number, fr.order_id, fr.customer_name cust, fr.date::text ev, fr.total_fils::bigint t,
              o.status, o.source, o.kind, o.event_id,
              to_char(o.updated_at AT TIME ZONE 'Asia/Dubai','YYYY-MM-DD HH24:MI') o_upd,
              (SELECT COUNT(*) FROM notifications n WHERE n.template='sale_post_failed' AND n.payload->>'orderId' = o.id) fails,
              (SELECT string_agg(x.number || ' ' || COALESCE(x.source,'') || ' ' || x.date::text || ' AED ' || (x.total_fils/100.0)::text, '; ')
                 FROM finance_receipts x
                WHERE x.id <> fr.id
                  AND (x.event_id = o.event_id
                       OR (lower(btrim(x.customer_name)) = lower(btrim(fr.customer_name)) AND abs(x.date - fr.date) <= 3))) other
         FROM finance_receipts fr JOIN orders o ON o.id = fr.order_id
        WHERE fr.number = ANY(SELECT g::text FROM generate_series(2124,2158) g)
        ORDER BY fr.number`,
    );
    let dup = 0;
    for (const r of rows) {
      if (r.other) dup++;
      console.log(`BFT|rcpt ${r.number}|${clean(r.cust)}|ev ${r.ev}|AED ${(Number(r.t) / 100).toFixed(2)}|order ${r.order_id} ${r.status}/${r.source ?? '-'}/${r.kind}|event ${r.event_id ?? '-'}|order updated ${r.o_upd}|fail alerts ${r.fails}|OTHER RECEIPT: ${clean(r.other) || 'none'}`);
    }
    console.log(`BFTSUM|${rows.length} backfilled receipts|${dup} also covered by another receipt (duplicate)`);
    const al = await pool.query(
      `SELECT to_char(created_at AT TIME ZONE 'Asia/Dubai','YYYY-MM-DD HH24:MI') c, COUNT(*)::int n FROM notifications
        WHERE template='sale_post_failed' GROUP BY 1 ORDER BY 1 DESC LIMIT 10`);
    for (const a of al.rows) console.log(`BFTALERT|${a.c}|${a.n}`);
  } catch (err) {
    console.error('[bftrace] failed:', (err as Error).message);
  }
}
