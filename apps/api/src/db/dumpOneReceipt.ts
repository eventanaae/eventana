/**
 * READ-ONLY one-shot: show one receipt in full vs its booking order (customer,
 * event date, line items, totals, cart). Gated SET_SHAN_LEADER='rcpt:<number>'.
 */
import { pool } from './pool.js';

export async function dumpOneReceiptFromEnv(): Promise<void> {
  const v = String(process.env.SET_SHAN_LEADER ?? '');
  if (!v.toLowerCase().startsWith('rcpt:')) return;
  const num = v.slice(5).trim();
  try {
    const { rows } = await pool.query(
      `SELECT fr.number, fr.customer_name, fr.date::text ev, fr.booked_on::text bk, fr.total_fils, fr.subtotal_fils, fr.discount_fils,
              fr.shipping_fils, fr.line_items, fr.source, fr.paid_with, fr.order_id, fr.event_id, fr.refunded_fils,
              to_char(fr.created_at AT TIME ZONE 'Asia/Dubai','YYYY-MM-DD HH24:MI') created,
              o.total_fils o_total, o.status o_status, o.source o_source, o.quote->'lines' o_lines,
              (SELECT string_agg(a.id || ' ' || a.kind || ' ' || a.status || ' AED ' || (a.total_fils/100.0)::text, '; ')
                 FROM orders a WHERE a.event_id = fr.event_id AND a.id <> fr.order_id) addons
         FROM finance_receipts fr LEFT JOIN orders o ON o.id = fr.order_id WHERE fr.number = $1`, [num]);
    for (const r of rows) console.log(`ONERCPT|${JSON.stringify(r)}`);
    if (!rows.length) console.log(`ONERCPT|not found ${num}`);
  } catch (err) { console.error('[onercpt] failed:', (err as Error).message); }
}
