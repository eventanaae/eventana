/**
 * The agreed customer notification lifecycle for a booking, in ONE place so the
 * app checkout, dashboard/manual bookings and one-off resends all schedule the
 * exact same set:
 *   • booking_confirmation — now
 *   • three_day_reminder   — 3 days before the event
 *   • event_day            — 4 hours before the event
 *   • feedback_request     — 1 day after the event
 *
 * SAFE: it only schedules for an event that has a real (non-TBD) date and a
 * customer with a valid email, and it never double-schedules a template that is
 * already queued/sent for the event. Nothing is sent here — the reconcile loop's
 * delivery step sends what is due (and BCCs Marsha on every email).
 */
import type { Db } from '../db/pool.js';
import { pool } from '../db/pool.js';

const TEMPLATES: Array<{ template: string; offset: string }> = [
  { template: 'booking_confirmation', offset: 'now' },
  { template: 'three_day_reminder', offset: "- interval '3 days'" },
  { template: 'event_day', offset: "- interval '4 hours'" },
  { template: 'feedback_request', offset: "+ interval '1 day'" },
];

export interface LifecycleResult { scheduled: string[]; skipped: string; }

/**
 * Re-align an event's still-pending customer reminder emails to its CURRENT
 * date + start time — call after ANY change that moves the event (a reschedule,
 * or a receipt edit that changes the event date/time), so a reminder never fires
 * on a stale schedule. Uses the SAME offsets as enqueueBookingLifecycle:
 * three_day_reminder (start − 3 days), event_day (start − 4 hours),
 * feedback_request (start + 1 day). No-op for a TBD/dateless event. Already-sent
 * or cancelled rows are left untouched. A re-aligned moment that now lands in the
 * PAST (e.g. a receipt edit moving the event to within 3 days, so "3 days to go"
 * would already be due) is CANCELLED rather than left to fire late — the same
 * "future only" rule enqueueBookingLifecycle applies when first scheduling.
 */
export async function reAlignPendingNotifications(eventId: string, db: Db = pool): Promise<void> {
  const { rows } = await db.query(
    `SELECT to_char(event_date,'YYYY-MM-DD') AS d, start_time, date_tbd FROM events WHERE id = $1`,
    [eventId],
  );
  const ev = rows[0];
  if (!ev || ev.date_tbd || !ev.d) return;
  const start = `${ev.d}T${ev.start_time ?? '18:00'}:00+04:00`;
  const offsets: Array<[string, string]> = [
    ['three_day_reminder', "- interval '3 days'"],
    ['event_day', "- interval '4 hours'"],
    ['feedback_request', "+ interval '1 day'"],
  ];
  for (const [tpl, off] of offsets) {
    await db.query(
      `UPDATE notifications
          SET scheduled_for = $2::timestamptz ${off},
              cancelled_at = CASE WHEN ($2::timestamptz ${off}) <= now() THEN now() ELSE cancelled_at END
        WHERE event_id = $1 AND template = $3 AND sent_at IS NULL AND cancelled_at IS NULL`,
      [eventId, start, tpl],
    ).catch(() => {});
  }
}

export async function enqueueBookingLifecycle(eventId: string, db: Db = pool): Promise<LifecycleResult> {
  const { rows } = await db.query(`
    SELECT to_char(e.event_date,'YYYY-MM-DD') AS d, e.start_time, e.date_tbd,
           c.email
      FROM events e JOIN customers c ON c.id = e.customer_id
     WHERE e.id = $1 AND e.phase <> 'Cancelled'`, [eventId]);
  const ev = rows[0];
  if (!ev) return { scheduled: [], skipped: 'event not found/cancelled' };
  if (ev.date_tbd || !ev.d) return { scheduled: [], skipped: 'date is TBD' };
  if (!ev.email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(ev.email)) return { scheduled: [], skipped: 'no valid email' };

  const eventStart = `${ev.d}T${ev.start_time ?? '18:00'}:00+04:00`;
  const payload = JSON.stringify({ eventId });
  const scheduled: string[] = [];
  for (const t of TEMPLATES) {
    const isNow = t.offset === 'now';
    // Only bind the params each branch actually uses, so an unused $3 can never
    // leave Postgres unable to infer its type.
    const schedExpr = isNow ? 'now()' : `$3::timestamptz ${t.offset}`;
    const payloadPos = isNow ? '$3' : '$4';
    const params = isNow ? [eventId, t.template, payload] : [eventId, t.template, eventStart, payload];
    // Never schedule a reminder whose moment has already passed (e.g. a booking
    // made on/near the event day — the customer must not get a late "3 days to
    // go"). booking_confirmation (now) always goes.
    const notPast = isNow ? '' : ` AND (${schedExpr}) > now()`;
    // Skip if this template is already queued or sent (not cancelled) for the event.
    const r = await db.query(
      `INSERT INTO notifications (event_id, channel, template, scheduled_for, payload)
       SELECT $1, 'email', $2, ${schedExpr}, ${payloadPos}::jsonb
        WHERE NOT EXISTS (
          SELECT 1 FROM notifications n
           WHERE n.event_id = $1 AND n.template = $2 AND n.cancelled_at IS NULL)${notPast}
       RETURNING id`,
      params,
    );
    if (r.rowCount) scheduled.push(t.template);
  }

  // NB: the email feedback_request row above already drives BOTH the email and
  // the WhatsApp feedback nudge (deliverPendingNotifications sends WhatsApp off
  // the same channel='email' row and stamps whatsapp_sent_at separately). A
  // separate channel='whatsapp' row would be an orphan that no sweep consumes,
  // so it is intentionally NOT inserted here.
  return { scheduled, skipped: scheduled.length ? '' : 'all already scheduled' };
}
