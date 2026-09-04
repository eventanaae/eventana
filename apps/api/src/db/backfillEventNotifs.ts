/**
 * One-shot backfill of the standard customer notification set for UPCOMING
 * events that never got one — the QuickBooks-converted bookings that entered
 * the system without going through the normal checkout flow.
 *
 * Gated by BACKFILL_EVENT_NOTIFS=true and approved by the owner after she
 * reviewed the exact event list. It mirrors the scheduling that confirm.ts
 * writes on a real booking:
 *   booking_confirmation → now
 *   three_day_reminder   → event − 3 days   (skipped if already past)
 *   event_day            → event − 4 hours  (skipped if already past)
 *   feedback_request     → event + 1 day
 *
 * SAFETY:
 *  - Only future/today events (event_date >= current_date), never cancelled.
 *  - Only events that have NONE of these rows yet, so it never duplicates and
 *    is safe to leave the flag on across reboots (idempotent).
 *  - Past-dated reminders are NOT inserted, so nobody gets a "3-day reminder"
 *    for an event that is already today. The delivery sweep's own date guard
 *    is a second line of defence.
 *  - Rows are 'email' channel — the same rows the WhatsApp sweep reads, so a
 *    customer with no email still gets WhatsApp and vice-versa.
 */
import { pool } from './pool.js';

const L = (s: string) => console.log(`[backfill-notif] ${s}`);

export async function backfillEventNotificationsFromEnv(): Promise<void> {
  if (String(process.env.BACKFILL_EVENT_NOTIFS ?? '').toLowerCase() !== 'true') return;

  const { rows: events } = await pool.query<{
    id: string;
    order_id: string;
    event_date: string;
    start_time: string;
  }>(`
    SELECT e.id, e.order_id, to_char(e.event_date,'YYYY-MM-DD') AS event_date, e.start_time
      FROM events e
     WHERE e.event_date >= current_date
       AND e.cancelled_at IS NULL
       AND e.phase <> 'Cancelled'
       AND NOT EXISTS (
         SELECT 1 FROM notifications n
          WHERE n.event_id = e.id
            AND n.channel = 'email'
            AND n.template IN ('booking_confirmation','three_day_reminder','event_day','feedback_request')
       )
     ORDER BY e.event_date`);

  if (events.length === 0) {
    L('nothing to backfill (all upcoming events already have notifications)');
    return;
  }

  for (const e of events) {
    const startTime = String(e.start_time ?? '18:00').slice(0, 5);
    const eventStart = `${e.event_date}T${startTime}:00+04:00`;
    const payload = JSON.stringify({ eventId: e.id, orderId: e.order_id });

    // booking_confirmation — the first touch these bookings never got. Held to
    // the next 10:00 Dubai time so a real customer is never messaged in the
    // middle of the night; if it is already past 10:00 locally it goes now.
    await pool.query(
      `INSERT INTO notifications (event_id, channel, template, scheduled_for, payload)
       VALUES ($1,'email','booking_confirmation',
               GREATEST(now(),
                        (to_char(now() AT TIME ZONE 'Asia/Dubai','YYYY-MM-DD') || 'T10:00:00+04:00')::timestamptz),
               $2)`,
      [e.id, payload],
    );
    // feedback_request — always in the future for an upcoming event.
    await pool.query(
      `INSERT INTO notifications (event_id, channel, template, scheduled_for, payload)
       VALUES ($1,'email','feedback_request', ($3::timestamptz + interval '1 day'), $2)`,
      [e.id, payload, eventStart],
    );
    // three_day_reminder — only if it hasn't already passed.
    await pool.query(
      `INSERT INTO notifications (event_id, channel, template, scheduled_for, payload)
       SELECT $1,'email','three_day_reminder', ($3::timestamptz - interval '3 days'), $2::jsonb
        WHERE ($3::timestamptz - interval '3 days') > now()`,
      [e.id, payload, eventStart],
    );
    // event_day — only if it hasn't already passed.
    await pool.query(
      `INSERT INTO notifications (event_id, channel, template, scheduled_for, payload)
       SELECT $1,'email','event_day', ($3::timestamptz - interval '4 hours'), $2::jsonb
        WHERE ($3::timestamptz - interval '4 hours') > now()`,
      [e.id, payload, eventStart],
    );

    L(`${e.id} (${e.event_date} ${startTime}) scheduled`);
  }

  L(`DONE events=${events.length}`);
}
