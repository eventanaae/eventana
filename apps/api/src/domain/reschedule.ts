/**
 * Customer self-service reschedule.
 *
 * A customer may move their event's date/time from the app, but only while it
 * is comfortably ahead (owner rule: more than 72 hours away) and only if the
 * booked assets are actually free in the new window. Theme changes and
 * cancellations are deliberately NOT self-service — those go through the team.
 *
 * The reserved inventory holds move with the event, checked against every
 * OTHER booking so a reschedule can never double-book an asset.
 */
import { eventEndHour, formatHour24, isCancelled, parseHour } from '@eventana/shared';
import { pool, withTransaction } from '../db/pool.js';
import { loadConfig } from './settings.js';
import { eventWindow, getAssets } from './inventory.js';
import { syncEventToCalendar } from '../integrations/googleCalendar.js';

/** Owner rule: reschedule allowed only when the event is more than this away. */
export const RESCHEDULE_MIN_HOURS = 72;

export class RescheduleError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
    this.name = 'RescheduleError';
  }
}

function eventStartMs(dateVal: unknown, startTime: string): number {
  const dateStr = new Date(dateVal as string).toISOString().slice(0, 10);
  return Date.parse(`${dateStr}T${startTime}:00+04:00`);
}

export async function rescheduleEvent(args: {
  eventId: string;
  customerId: string;
  newDate: string;
  newStartTime: string;
}): Promise<{ date: string; startTime: string; endTime: string }> {
  const cfg = await loadConfig(pool, { fresh: true });

  const result = await withTransaction(async (db) => {
    const { rows } = await db.query(
      `SELECT * FROM events WHERE id = $1 AND customer_id = $2 FOR UPDATE`,
      [args.eventId, args.customerId],
    );
    const ev = rows[0];
    if (!ev) throw new RescheduleError('Event not found.', 'not_found');
    if (isCancelled(ev.phase)) throw new RescheduleError('This event is cancelled.', 'cancelled');

    // The event must be more than 72h away *now*, and the new slot must be too.
    const now = Date.now();
    if (eventStartMs(ev.event_date, ev.start_time) - now < RESCHEDULE_MIN_HOURS * 3_600_000) {
      throw new RescheduleError(
        'Events can only be moved more than 72 hours before they start. Message your team for anything closer.',
        'too_late',
      );
    }
    const newStartMs = eventStartMs(args.newDate, args.newStartTime);
    if (!Number.isFinite(newStartMs) || newStartMs - now < RESCHEDULE_MIN_HOURS * 3_600_000) {
      throw new RescheduleError('Please choose a new date more than 72 hours from now.', 'too_soon');
    }

    // Preserve the event's original base length (4h, or 6h for a decor BYO).
    const origBase = parseHour(ev.base_end_time) - parseHour(ev.start_time) - (ev.extra_hours ?? 0);
    const baseHours = Number.isFinite(origBase) && origBase > 0 ? origBase : cfg.rules.standardEventHours;
    const endHour = eventEndHour(args.newStartTime, cfg.rules, ev.extra_hours, baseHours);
    if (endHour > cfg.rules.latestEndHour) {
      throw new RescheduleError('That start time would end too late — events must finish by midnight.', 'end_after_midnight');
    }

    // The assets this event holds, and whether they are free at the new time
    // (ignoring this event's own reservations).
    const { rows: holds } = await db.query<{ asset_code: string }>(
      `SELECT DISTINCT asset_code FROM inventory_holds WHERE event_id = $1 AND status = 'reserved'`,
      [args.eventId],
    );
    const assets = await getAssets(db, holds.map((h) => h.asset_code));

    for (const asset of assets) {
      const win = eventWindow(args.newDate, args.newStartTime, endHour, asset.buffer_before_minutes, asset.buffer_after_minutes);
      const { rows: c } = await db.query<{ used: number }>(
        `SELECT count(*)::int AS used FROM inventory_holds
          WHERE asset_code = $1
            AND status IN ('held','reserved')
            AND (expires_at IS NULL OR expires_at > now())
            AND event_id IS DISTINCT FROM $2
            AND starts_at < $4 AND ends_at > $3`,
        [asset.code, args.eventId, win.startsAt, win.endsAt],
      );
      if ((c[0]?.used ?? 0) >= asset.units) {
        throw new RescheduleError('Some of your items aren’t available at the new time. Please pick another slot.', 'unavailable');
      }
    }

    // Move the reservations, then the event.
    for (const asset of assets) {
      const win = eventWindow(args.newDate, args.newStartTime, endHour, asset.buffer_before_minutes, asset.buffer_after_minutes);
      await db.query(
        `UPDATE inventory_holds SET starts_at = $2, ends_at = $3
          WHERE event_id = $1 AND asset_code = $4 AND status = 'reserved'`,
        [args.eventId, win.startsAt, win.endsAt, asset.code],
      );
    }

    const endTime = formatHour24(endHour);
    await db.query(
      `UPDATE events SET event_date = $2, start_time = $3, base_end_time = $4 WHERE id = $1`,
      [args.eventId, args.newDate, args.newStartTime, endTime],
    );
    // Move the still-unsent reminder emails to the new date, so they never fire
    // against the old one.
    await db.query(
      `UPDATE notifications SET scheduled_for = $2::date - interval '3 days'
        WHERE event_id = $1 AND template = 'three_day_reminder' AND sent_at IS NULL AND cancelled_at IS NULL`,
      [args.eventId, args.newDate],
    );
    await db.query(
      `UPDATE notifications SET scheduled_for = $2::date
        WHERE event_id = $1 AND template = 'event_day' AND sent_at IS NULL AND cancelled_at IS NULL`,
      [args.eventId, args.newDate],
    );
    // Tell the assigned driver the delivery moved (new date/time → fresh row).
    await db.query(
      `INSERT INTO notifications (event_id, channel, template, scheduled_for, payload)
       VALUES ($1,'driver','driver_order_updated', now(), $2)`,
      [args.eventId, JSON.stringify({ eventId: args.eventId })],
    );
    await db.query(
      `INSERT INTO event_tasks (event_id, department, title)
       VALUES ($1,'operations',$2), ($1,'logistics',$3)`,
      [args.eventId, `Customer rescheduled to ${args.newDate} at ${args.newStartTime}`, 'Re-plan route and crew call time for the new date'],
    );

    return { date: args.newDate, startTime: args.newStartTime, endTime };
  });
  // Keep the shared team calendar in step with the new date (best-effort).
  void syncEventToCalendar(args.eventId);
  return result;
}
