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
    // Skip if this template is already queued or sent (not cancelled) for the event.
    const r = await db.query(
      `INSERT INTO notifications (event_id, channel, template, scheduled_for, payload)
       SELECT $1, 'email', $2, ${schedExpr}, ${payloadPos}::jsonb
        WHERE NOT EXISTS (
          SELECT 1 FROM notifications n
           WHERE n.event_id = $1 AND n.template = $2 AND n.cancelled_at IS NULL)
       RETURNING id`,
      params,
    );
    if (r.rowCount) scheduled.push(t.template);
  }
  return { scheduled, skipped: scheduled.length ? '' : 'all already scheduled' };
}
