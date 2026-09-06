/**
 * Fully delete ONE event and everything attached to it (owner-requested cleanup
 * of a test booking). Gated by DELETE_EVENT=<eventId>. Deletes child rows first
 * (notifications, staffing, services, tasks, prep, designs, ratings, tips, holds,
 * messages), then the linked receipt/invoice, the event, its order + payments,
 * and finally the test customer if it has no other events.
 */
import { pool } from './pool.js';

const P = (s: string) => console.log(`[del-event] ${s}`);

export async function cleanupTestEventFromEnv(): Promise<void> {
  const eventId = String(process.env.DELETE_EVENT ?? '').trim();
  if (!eventId) return;
  try {
    const info = await pool.query(
      `SELECT e.order_id, e.customer_id, c.name FROM events e
         LEFT JOIN customers c ON c.id = e.customer_id WHERE e.id = $1`, [eventId]);
    if (!info.rowCount) { P(`${eventId} not found`); return; }
    const { order_id, customer_id, name } = info.rows[0];
    P(`deleting ${eventId} (order=${order_id}, customer=${customer_id} "${name}")`);

    {
      // NB: each delete is its OWN statement (no shared transaction) — a missing
      // table would otherwise abort the whole transaction and roll everything back.
      const del = async (sql: string, params: any[], label: string) => {
        try { const r = await pool.query(sql, params); if (r.rowCount) P(`  ${label}: ${r.rowCount}`); }
        catch (e) { P(`  ${label}: skip (${(e as Error).message.slice(0, 50)})`); }
      };
      // Loyalty points: reverse whatever this event/order earned the customer,
      // then remove the ledger rows — so the deleted test order leaves no points
      // behind on their balance.
      try {
        const lp = await pool.query<{ net: number }>(
          `SELECT COALESCE(SUM(points),0)::int AS net FROM loyalty_transactions
            WHERE event_id = $1 OR ($2::text IS NOT NULL AND order_id = $2)`,
          [eventId, order_id ?? null],
        );
        const net = Number(lp.rows[0]?.net ?? 0);
        if (net && customer_id) {
          await pool.query(
            `UPDATE customers SET loyalty_points = GREATEST(0, loyalty_points - $2) WHERE id = $1`,
            [customer_id, net],
          );
          P(`  loyalty_points: reversed ${net}`);
        }
      } catch (e) { P(`  loyalty_points: skip (${(e as Error).message.slice(0, 50)})`); }
      await del(`DELETE FROM loyalty_transactions WHERE event_id=$1 OR ($2::text IS NOT NULL AND order_id=$2)`, [eventId, order_id ?? null], 'loyalty_transactions');
      // Child rows keyed by event_id.
      await del(`DELETE FROM prep_task_staff WHERE task_id IN (SELECT id FROM prep_tasks WHERE event_id=$1)`, [eventId], 'prep_task_staff');
      await del(`DELETE FROM prep_tasks WHERE event_id=$1`, [eventId], 'prep_tasks');
      await del(`DELETE FROM event_tasks WHERE event_id=$1`, [eventId], 'event_tasks');
      await del(`DELETE FROM event_staff WHERE event_id=$1`, [eventId], 'event_staff');
      await del(`DELETE FROM event_team WHERE event_id=$1`, [eventId], 'event_team');
      await del(`DELETE FROM event_services WHERE event_id=$1`, [eventId], 'event_services');
      await del(`DELETE FROM designs WHERE event_id=$1`, [eventId], 'designs');
      await del(`DELETE FROM event_ratings WHERE event_id=$1`, [eventId], 'event_ratings');
      await del(`DELETE FROM tips WHERE event_id=$1`, [eventId], 'tips');
      await del(`DELETE FROM inventory_holds WHERE event_id=$1`, [eventId], 'inventory_holds');
      await del(`DELETE FROM event_messages WHERE event_id=$1`, [eventId], 'event_messages');
      await del(`DELETE FROM setup_photos WHERE event_id=$1`, [eventId], 'setup_photos');
      await del(`DELETE FROM notifications WHERE event_id=$1`, [eventId], 'notifications');
      // Finance docs.
      await del(`DELETE FROM finance_receipts WHERE event_id=$1`, [eventId], 'finance_receipts');
      await del(`UPDATE finance_invoices SET event_id=NULL WHERE event_id=$1`, [eventId], 'finance_invoices(unlink)');
      // The event itself.
      await del(`DELETE FROM events WHERE id=$1`, [eventId], 'events');
      // Its order + payments.
      if (order_id) {
        await del(`DELETE FROM payments WHERE order_id=$1`, [order_id], 'payments');
        await del(`DELETE FROM finance_receipts WHERE order_id=$1`, [order_id], 'finance_receipts(by order)');
        await del(`DELETE FROM orders WHERE id=$1`, [order_id], 'orders');
      }
      // The test customer, only if nothing else references them.
      if (customer_id) {
        const other = await pool.query(`SELECT 1 FROM events WHERE customer_id=$1 LIMIT 1`, [customer_id]);
        if (!other.rowCount) await del(`DELETE FROM customers WHERE id=$1`, [customer_id], 'customers');
        else P(`  customers: kept (has other events)`);
      }
    }
    P('DONE');
  } catch (err) {
    console.error('[del-event] failed:', (err as Error).message);
  }
}
