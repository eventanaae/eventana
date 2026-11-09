/**
 * READ-ONLY one-shot: how much has gone through Eventana Ops since it went live
 * (12 Aug 2026), by ENTRY date — events by created_at, receipts by booked_on
 * (the agreed money date), orders by created_at — per month and per source, so
 * imported history (QuickBooks / Trello conversions) is visible separately.
 * Gated by SET_SHAN_LEADER='opsstats' (reuses the one-shot key). Blank it after.
 */
import { pool } from './pool.js';

const LIVE_FROM = '2026-08-12';

export async function opsStatsFromEnv(): Promise<void> {
  if (String(process.env.SET_SHAN_LEADER ?? '').toLowerCase() !== 'opsstats') return;
  try {
    const q = async (sql: string) => (await pool.query(sql, [LIVE_FROM])).rows;
    const events = await q(
      `SELECT to_char(created_at,'YYYY-MM') m, COALESCE(source,'-') src,
              count(*)::int n, count(*) FILTER (WHERE phase = 'Cancelled')::int cancelled
         FROM events WHERE created_at >= $1 GROUP BY 1,2 ORDER BY 1,2`);
    const receipts = await q(
      // Money by receipt_money_by_day (a merged add-on on the day it was paid);
      // n = receipts (base slices); the receipt's refunds net off its base slice.
      `SELECT to_char(m.slice_booked_on,'YYYY-MM') m, COALESCE(r.source,'-') src,
              (count(*) FILTER (WHERE m.slice = 'base'))::int n,
              (sum(m.amount_fils)
               - sum(CASE WHEN m.slice = 'base' THEN COALESCE(r.refunded_fils,0) ELSE 0 END))::bigint net_fils
         FROM receipt_money_by_day m JOIN finance_receipts r ON r.id = m.receipt_id
        WHERE m.slice_booked_on >= $1 GROUP BY 1,2 ORDER BY 1,2`);
    const orders = await q(
      `SELECT to_char(created_at,'YYYY-MM') m, status, count(*)::int n, sum(total_fils)::bigint fils
         FROM orders WHERE created_at >= $1 GROUP BY 1,2 ORDER BY 1,2`);
    const firstEvent = (await pool.query(`SELECT to_char(min(created_at),'YYYY-MM-DD') d FROM events`)).rows;
    console.log(`OPSSTATS|${JSON.stringify({ liveFrom: LIVE_FROM, firstEventCreated: firstEvent[0]?.d ?? null, events, receipts, orders })}`);
  } catch (err) {
    console.error('[opsstats] failed:', (err as Error).message);
  }
}
