/**
 * One-time data fix (owner request 2026-11-11), SET_SHAN_LEADER=fixlatifa.
 * Receipt 2125 / order EVT-ORD-000170 (Latifa): the customer cancelled the whole
 * party; Eventana kept AED 499 as the cancellation charge (card processing).
 *  • records the 499 charge on the receipt and on the latest refund row, so the
 *    receipt / email show Total paid · Cancellation charge · Refund;
 *  • makes sure nothing is still reserved for the cancelled party.
 * Strictly scoped (number + order + amounts must match) and claimed once.
 */
import { claimOneShot, pool } from './pool.js';

export async function fixLatifa2125(): Promise<void> {
  if (!(await claimOneShot('oneshot:fixlatifa2125:v1'))) return;
  try {
    const r = await pool.query(
      `UPDATE finance_receipts SET cancellation_charge_fils = 49900
        WHERE number = '2125' AND order_id = 'EVT-ORD-000170'
          AND total_fils = 1728850 AND refunded_fils = 1678950
        RETURNING id`);
    const f = await pool.query(
      `UPDATE refunds SET cancellation_charge_fils = 49900
        WHERE id = (SELECT max(id) FROM refunds WHERE order_id = 'EVT-ORD-000170')
        RETURNING id`);
    const h = await pool.query(
      `UPDATE inventory_holds SET status = 'released'
        WHERE (order_id = 'EVT-ORD-000170' OR event_id = 'EV-2026-0309') AND status IN ('held','reserved')
        RETURNING asset_code`);
    const ev = await pool.query(`SELECT phase, cancelled_at IS NOT NULL AS cx FROM events WHERE id = 'EV-2026-0309'`);
    console.log(`[fixlatifa] receipt rows=${r.rowCount} refund rows=${f.rowCount} holds released=${h.rowCount} (${h.rows.map((x: any) => x.asset_code).join(',') || 'none'}) event=${JSON.stringify(ev.rows[0] ?? null)}`);
  } catch (e) { console.error('[fixlatifa] failed:', (e as Error).message); }
}
