/**
 * Recover the Maryam Alblooshi booking (receipt #1724, Sat 5 Sep 2026) that was
 * deleted by mistake. Rebuilds the event + order + sales receipt (EV-1724) + the
 * 5★ rating and re-links them to her existing customer row. Gated by
 * RESTORE_EV1724=true. Idempotent: does nothing if receipt #1724 already exists.
 * Details are from the customer app screenshots: Sat 5 Sep, 3:00 PM–10:00 PM,
 * Dubai, AED 0 (paid in full), Event Completed, rated 5★.
 */
import { pool } from './pool.js';
import { nextOrderId, nextEventId } from '../domain/orders.js';

const P = (s: string) => console.log(`[restore-1724] ${s}`);

export async function restoreEv1724FromEnv(): Promise<void> {
  if (String(process.env.RESTORE_EV1724 ?? '').toLowerCase() !== 'true') return;
  try {
    const customerId = 'CUST-476085A5';
    const c = await pool.query<{ id: string; name: string }>(`SELECT id, name FROM customers WHERE id = $1`, [customerId]);
    if (!c.rowCount) { P(`customer ${customerId} not found — abort (nothing changed)`); return; }
    const name = c.rows[0].name || 'Maryam Alblooshi';

    const existing = await pool.query(`SELECT event_id FROM finance_receipts WHERE number = '1724'`);
    if (existing.rowCount) { P(`receipt #1724 already exists (event=${existing.rows[0].event_id}) — nothing to do`); return; }

    const orderId = await nextOrderId(pool);
    await pool.query(
      `INSERT INTO orders (id, kind, customer_id, status, total_fils, cart, quote, source)
       VALUES ($1,'booking',$2,'paid',0,$3,'{}'::jsonb,'restored')`,
      [orderId, customerId, JSON.stringify({ restored: true, eventDate: '2026-09-05', emirate: 'Dubai' })],
    );

    const eventId = await nextEventId(pool);
    await pool.query(
      `INSERT INTO events
         (id, order_id, customer_id, celebration_type, custom_theme, event_date, start_time,
          base_end_time, extra_hours, children_count, emirate, address, map_lat, map_lng, phase)
       VALUES ($1,$2,$3,'kids',false,'2026-09-05','15:00','22:00',0,0,'Dubai','{}'::jsonb,0,0,'Event Completed')`,
      [eventId, orderId, customerId],
    );

    await pool.query(
      `INSERT INTO finance_receipts
         (number, customer_id, customer_name, date, line_items, subtotal_fils, discount_fils,
          shipping_fils, total_fils, paid_with, event_id, source)
       VALUES ('1724', NULL, $2, '2026-09-05', '[]'::jsonb, 0, 0, 0, 0, 'Debit', $1, 'dashboard')`,
      [eventId, name],
    );

    await pool.query(
      `INSERT INTO event_ratings (event_id, customer_id, stars, feedback) VALUES ($1,$2,5,NULL)
       ON CONFLICT (event_id) DO NOTHING`,
      [eventId, customerId],
    );

    P(`RESTORED: event=${eventId} · order=${orderId} · receipt=EV-1724 · 5★ · for ${name}`);
    P('DONE — verify details (package/theme/guest name/amount) with the owner and adjust if needed.');
  } catch (err) {
    console.error('[restore-1724] failed:', (err as Error).message);
  }
}
