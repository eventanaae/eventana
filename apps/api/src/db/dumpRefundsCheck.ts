/**
 * READ-ONLY one-shot: every refund recorded since Ops went live, and whether it
 * shows on the customer's receipt (finance_receipts.refunded_fils) and whether the
 * refund email went out. One line per refund + totals.
 * Gated by SET_SHAN_LEADER='refundchk'. Blank it after.
 */
import { pool } from './pool.js';

export async function dumpRefundsCheckFromEnv(): Promise<void> {
  if (String(process.env.SET_SHAN_LEADER ?? '').toLowerCase() !== 'refundchk') return;
  try {
    const clean = (v: unknown) => String(v ?? '').replace(/[\s|]+/g, ' ').trim();
    const { rows } = await pool.query(
      `WITH per_order AS (
         SELECT order_id, SUM(amount_fils)::bigint AS ref_sum FROM refunds GROUP BY order_id
       ), rc AS (
         SELECT r.order_id,
                (SELECT string_agg(fr.number, ',') FROM finance_receipts fr
                  WHERE fr.order_id = r.order_id OR fr.event_id IN (SELECT id FROM events WHERE order_id = r.order_id)) AS rcpt_nums,
                (SELECT COALESCE(SUM(fr.refunded_fils),0)::bigint FROM finance_receipts fr
                  WHERE fr.order_id = r.order_id OR fr.event_id IN (SELECT id FROM events WHERE order_id = r.order_id)) AS rcpt_refunded
           FROM per_order r
       )
       SELECT rf.id::text id, to_char(rf.created_at AT TIME ZONE 'Asia/Dubai','YYYY-MM-DD') d, rf.order_id, rf.event_id,
              rf.amount_fils::bigint f, rf.reason_category cat, rf.reason_note note, rf.event_cancelled canc,
              rf.created_by by, rf.item_label item, COALESCE(c.name,'') cust,
              po.ref_sum, rc.rcpt_nums, rc.rcpt_refunded,
              (SELECT bool_or(n.sent_at IS NOT NULL) FROM notifications n
                WHERE n.template IN ('refund_processed','cancellation_refund') AND (n.payload->>'orderId' = rf.order_id OR n.event_id = rf.event_id)) AS emailed
         FROM refunds rf
         LEFT JOIN customers c ON c.id = rf.customer_id
         LEFT JOIN per_order po ON po.order_id = rf.order_id
         LEFT JOIN rc ON rc.order_id = rf.order_id
        ORDER BY rf.created_at`,
    );
    let refl = 0, partial = 0, none = 0, noRcpt = 0;
    const seen = new Set<string>();
    for (const r of rows) {
      const state = !r.rcpt_nums ? 'NO RECEIPT LINKED'
        : Number(r.rcpt_refunded) >= Number(r.ref_sum) ? 'ON RECEIPT'
        : Number(r.rcpt_refunded) > 0 ? 'PARTLY ON RECEIPT' : 'NOT ON RECEIPT';
      if (!seen.has(r.order_id)) {
        seen.add(r.order_id);
        if (state === 'ON RECEIPT') refl++; else if (state === 'PARTLY ON RECEIPT') partial++; else if (state === 'NOT ON RECEIPT') none++; else noRcpt++;
      }
      console.log(`RFCHK|${r.id}|${r.d}|${clean(r.cust)}|order ${r.order_id}|ev ${r.event_id ?? '-'}|AED ${(Number(r.f) / 100).toFixed(2)}|${r.cat}|cancelled ${r.canc ? 'yes' : 'no'}|by ${clean(r.by)}|item ${clean(r.item) || '-'}|${clean(r.note).slice(0, 80)}|rcpt ${r.rcpt_nums ?? '-'}|order refunds ${(Number(r.ref_sum) / 100).toFixed(2)} vs receipt ${(Number(r.rcpt_refunded ?? 0) / 100).toFixed(2)}|${state}|email ${r.emailed ? 'sent' : r.emailed === false ? 'queued/not sent' : 'none'}`);
    }
    const tot = rows.reduce((s, r) => s + Number(r.f), 0);
    console.log(`RFCHKSUM|refunds ${rows.length}|orders ${seen.size}|total AED ${(tot / 100).toFixed(2)}|orders on receipt ${refl}|partly ${partial}|not on receipt ${none}|no receipt linked ${noRcpt}|first ${rows[0]?.d ?? '-'}|last ${rows[rows.length - 1]?.d ?? '-'}`);
  } catch (err) {
    console.error('[refundchk] failed:', (err as Error).message);
  }
}
