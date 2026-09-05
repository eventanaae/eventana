/**
 * Read-only: dump the full customer-notification history for one event so we can
 * say EXACTLY what was emailed/WhatsApp'd to the customer and when (booking
 * confirmation included), plus the current verified booking data. Gated by
 * BOOKING_HISTORY=<eventId>. Sends nothing, changes nothing.
 */
import { pool } from './pool.js';

const P = (s: string) => console.log(`[booking-history] ${s}`);

export async function bookingHistoryFromEnv(): Promise<void> {
  const eventId = String(process.env.BOOKING_HISTORY ?? '').trim();
  if (!eventId) return;
  try {
    const ev = await pool.query(`
      SELECT to_char(e.event_date,'YYYY-MM-DD') AS event_date, e.start_time, e.base_end_time, e.date_tbd,
             c.name AS customer, c.email, c.phone,
             r.number AS receipt_no, to_char(r.date,'YYYY-MM-DD') AS receipt_date, r.event_time,
             o.cart->>'eventDate' AS cart_date, to_char(o.created_at,'YYYY-MM-DD HH24:MI') AS order_created
        FROM events e
        JOIN customers c ON c.id = e.customer_id
        LEFT JOIN orders o ON o.id = e.order_id
        LEFT JOIN finance_receipts r ON r.event_id = e.id
       WHERE e.id = $1`, [eventId]);
    const g = ev.rows[0];
    if (!g) { P(`${eventId} not found`); return; }
    P(`${eventId} NOW: event_date=${g.event_date} time=${g.start_time}-${g.base_end_time} tbd=${g.date_tbd} `
      + `"${g.customer}" <${g.email ?? '—'}> ph=${g.phone ?? '—'} ref=EV-${g.receipt_no ?? '—'} `
      + `receiptDate=${g.receipt_date ?? '—'} cartDate=${g.cart_date ?? '—'} orderCreated=${g.order_created ?? '—'}`);

    const notes = await pool.query(`
      SELECT template, channel,
             to_char(created_at,'YYYY-MM-DD HH24:MI') AS created,
             to_char(scheduled_for,'YYYY-MM-DD HH24:MI') AS scheduled,
             to_char(sent_at,'YYYY-MM-DD HH24:MI') AS sent,
             to_char(whatsapp_sent_at,'YYYY-MM-DD HH24:MI') AS wa_sent,
             to_char(cancelled_at,'YYYY-MM-DD HH24:MI') AS cancelled
        FROM notifications
       WHERE event_id = $1
       ORDER BY created_at`, [eventId]);
    P(`notification rows: ${notes.rowCount}`);
    for (const n of notes.rows) {
      const state = n.sent ? `SENT ${n.sent}` : n.wa_sent ? `WA-SENT ${n.wa_sent}` : n.cancelled ? `CANCELLED ${n.cancelled}` : 'PENDING';
      P(`  · ${n.template} [${n.channel}] created=${n.created} sched=${n.scheduled ?? '—'} → ${state}`);
    }
    P('DONE');
  } catch (err) {
    console.error('[booking-history] failed:', (err as Error).message);
  }
}
