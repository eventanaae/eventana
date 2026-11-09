/**
 * READ-ONLY one-shot: every sales receipt whose BOOKING date (booked_on) falls on
 * 2026-11-07…11-10, with how/when it was created, so a suspicious spike of
 * "bookings" on one day can be traced to its source. Gated by
 * SET_SHAN_LEADER='bookedday'. Blank it after.
 */
import { pool } from './pool.js';

export async function dumpBookedDayFromEnv(): Promise<void> {
  if (String(process.env.SET_SHAN_LEADER ?? '').toLowerCase() !== 'bookedday') return;
  const clean = (v: unknown) => String(v ?? '').replace(/[\s|]+/g, ' ').trim();
  try {
    const { rows } = await pool.query(
      `SELECT fr.number, fr.booked_on::text bk, fr.date::text ev, COALESCE(fr.source,'') src, COALESCE(fr.paid_with,'') pw,
              to_char(fr.created_at AT TIME ZONE 'Asia/Dubai','YYYY-MM-DD HH24:MI') created,
              COALESCE(fr.customer_name,'') cust, fr.total_fils::bigint t, COALESCE(fr.order_id,'') oid, COALESCE(fr.event_id,'') eid,
              (SELECT to_char(o.created_at AT TIME ZONE 'Asia/Dubai','YYYY-MM-DD HH24:MI') FROM orders o WHERE o.id = fr.order_id) order_created,
              (SELECT o.status FROM orders o WHERE o.id = fr.order_id) order_status
         FROM finance_receipts fr
        WHERE fr.booked_on BETWEEN '2026-11-07' AND '2026-11-10'
        ORDER BY fr.booked_on, fr.created_at`,
    );
    for (const r of rows) {
      console.log(`BKDAY|${r.bk}|rcpt ${r.number}|${clean(r.cust)}|AED ${(Number(r.t) / 100).toFixed(2)}|event ${r.ev}|src ${r.src}|paid ${clean(r.pw)}|receipt created ${r.created}|order ${r.oid || '-'} created ${r.order_created ?? '-'} status ${r.order_status ?? '-'}|ev ${r.eid || '-'}`);
    }
    const s = await pool.query(
      `SELECT booked_on::text d, COUNT(*)::int n,
              COUNT(*) FILTER (WHERE (created_at AT TIME ZONE 'Asia/Dubai')::date = booked_on)::int same_day,
              COUNT(*) FILTER (WHERE order_id IS NOT NULL AND (SELECT (o.created_at AT TIME ZONE 'Asia/Dubai')::date FROM orders o WHERE o.id = order_id) < booked_on)::int older_order
         FROM finance_receipts WHERE booked_on BETWEEN '2026-11-01' AND '2026-11-10' GROUP BY 1 ORDER BY 1`,
    );
    for (const r of s.rows) console.log(`BKDAYSUM|${r.d}|${r.n} receipts|${r.same_day} created that day|${r.older_order} from an order created earlier`);
    console.log('BKDAY|END');
  } catch (err) {
    console.error('[bookedday] failed:', (err as Error).message);
  }
}
