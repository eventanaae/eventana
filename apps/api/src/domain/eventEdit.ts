/**
 * Staff-side edit of a booked event's operational details: start/end time,
 * emirate (location), guest-of-honour (baby) name and theme. Unlike the
 * customer self-service reschedule this has NO 72-hour limit and adds no
 * "customer rescheduled" tasks — it's the team correcting/updating a booking.
 *
 * When the time changes the reserved inventory holds move with it, checked
 * against every OTHER booking so an edit can never double-book an asset.
 */
import { parseHour } from '@eventana/shared';
import { withTransaction } from '../db/pool.js';
import { eventWindow, getAssets } from './inventory.js';

export class EventEditError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
    this.name = 'EventEditError';
  }
}

export type EventPatch = {
  startTime?: string;        // "HH:MM" (24h)
  endTime?: string;          // "HH:MM" (24h)
  emirate?: string;
  eventFor?: string | null;  // guest-of-honour / baby name (lives in the order cart)
  themeId?: string | null;   // catalogue theme id (also mirrored to the cart)
  customThemeName?: string;  // a free-typed theme when none in the catalogue fit
  locationNote?: string | null; // free-text address / Google Maps link
  mapLat?: number | null;    // exact pin (parsed from the maps link)
  mapLng?: number | null;
  phone?: string | null;        // customer's primary contact number
  backupPhone?: string | null;  // customer's second contact number
};

export async function staffUpdateEvent(eventId: string, patch: EventPatch): Promise<{ ok: true }> {
  return withTransaction(async (db) => {
    const { rows } = await db.query(`SELECT * FROM events WHERE id = $1 FOR UPDATE`, [eventId]);
    const ev = rows[0];
    if (!ev) throw new EventEditError('Event not found.', 'not_found');

    // ── Time change → move the event window and its reserved holds ──────────
    if (patch.startTime || patch.endTime) {
      const newStart = patch.startTime ?? ev.start_time;
      const newEnd = patch.endTime ?? ev.base_end_time;
      const endHour = parseHour(newEnd);
      if (!Number.isFinite(parseHour(newStart)) || !Number.isFinite(endHour) || endHour <= parseHour(newStart)) {
        throw new EventEditError('End time must be after the start time.', 'bad_time');
      }
      const dateStr = new Date(ev.event_date as string).toISOString().slice(0, 10);

      const { rows: holds } = await db.query<{ asset_code: string }>(
        `SELECT DISTINCT asset_code FROM inventory_holds WHERE event_id = $1 AND status = 'reserved'`,
        [eventId],
      );
      const assets = await getAssets(db, holds.map((h) => h.asset_code));

      // Availability at the new time, ignoring this event's own reservations.
      for (const asset of assets) {
        const win = eventWindow(dateStr, newStart, endHour, asset.buffer_before_minutes, asset.buffer_after_minutes);
        const { rows: c } = await db.query<{ used: number }>(
          `SELECT count(*)::int AS used FROM inventory_holds
            WHERE asset_code = $1
              AND status IN ('held','reserved')
              AND (expires_at IS NULL OR expires_at > now())
              AND event_id IS DISTINCT FROM $2
              AND starts_at < $4 AND ends_at > $3`,
          [asset.code, eventId, win.startsAt, win.endsAt],
        );
        if ((c[0]?.used ?? 0) >= asset.units) {
          throw new EventEditError(`"${asset.code}" isn't available at the new time.`, 'unavailable');
        }
      }
      for (const asset of assets) {
        const win = eventWindow(dateStr, newStart, endHour, asset.buffer_before_minutes, asset.buffer_after_minutes);
        await db.query(
          `UPDATE inventory_holds SET starts_at = $2, ends_at = $3
            WHERE event_id = $1 AND asset_code = $4 AND status = 'reserved'`,
          [eventId, win.startsAt, win.endsAt, asset.code],
        );
      }
      await db.query(`UPDATE events SET start_time = $2, base_end_time = $3 WHERE id = $1`, [eventId, newStart, newEnd]);
    }

    // ── Customer contact numbers (live on the customer record) ──────────────
    if (patch.phone !== undefined || patch.backupPhone !== undefined) {
      if (patch.phone !== undefined) {
        // Primary phone is NOT NULL on the customer — never blank it.
        const p = (patch.phone ?? '').trim();
        if (p) await db.query(`UPDATE customers SET phone = $2 WHERE id = $1`, [ev.customer_id, p]);
      }
      if (patch.backupPhone !== undefined) {
        await db.query(`UPDATE customers SET backup_phone = $2 WHERE id = $1`,
          [ev.customer_id, (patch.backupPhone ?? '').trim() || null]);
      }
    }

    // ── Location ────────────────────────────────────────────────────────────
    if (patch.emirate !== undefined && patch.emirate) {
      await db.query(`UPDATE events SET emirate = $2 WHERE id = $1`, [eventId, patch.emirate]);
    }
    // Free-text address / Google Maps link the team can set (esp. converted
    // bookings with no captured pin), plus the exact pin parsed from that link.
    if (patch.locationNote !== undefined) {
      await db.query(`UPDATE events SET location_note = $2 WHERE id = $1`, [eventId, patch.locationNote || null]);
    }
    if (patch.mapLat !== undefined && patch.mapLng !== undefined) {
      await db.query(`UPDATE events SET map_lat = $2, map_lng = $3 WHERE id = $1`,
        [eventId, patch.mapLat ?? 0, patch.mapLng ?? 0]);
    }

    const customTheme = (patch.customThemeName ?? '').trim();
    // ── Theme (mirror to the event row) ─────────────────────────────────────
    if (customTheme) {
      // A free-typed theme: mark the event custom and drop the catalogue link.
      await db.query(`UPDATE events SET theme_id = NULL, custom_theme = TRUE WHERE id = $1`, [eventId]);
    } else if (patch.themeId !== undefined && patch.themeId) {
      await db.query(`UPDATE events SET theme_id = $2, custom_theme = FALSE WHERE id = $1`, [eventId, patch.themeId]);
    }

    // ── Guest-of-honour name + theme live in the order cart ─────────────────
    if (patch.eventFor !== undefined || (patch.themeId !== undefined && patch.themeId) || customTheme) {
      const { rows: o } = await db.query(`SELECT cart FROM orders WHERE id = $1`, [ev.order_id]);
      const cart = { ...((o[0]?.cart ?? {}) as Record<string, unknown>) };
      if (patch.eventFor !== undefined) cart.eventFor = patch.eventFor;
      if (customTheme) { cart.customTheme = customTheme; delete cart.themeId; }
      else if (patch.themeId !== undefined && patch.themeId) { cart.themeId = patch.themeId; delete cart.customTheme; }
      await db.query(`UPDATE orders SET cart = $2 WHERE id = $1`, [ev.order_id, cart]);
    }

    // A time or location change affects the delivery — tell the assigned driver.
    const locationChanged = (patch.emirate !== undefined && patch.emirate) || patch.locationNote !== undefined
      || (patch.mapLat !== undefined && patch.mapLng !== undefined);
    if (patch.startTime || patch.endTime || locationChanged) {
      await db.query(
        `INSERT INTO notifications (event_id, channel, template, scheduled_for, payload)
         VALUES ($1,'driver','driver_order_updated', now(), $2)`,
        [eventId, JSON.stringify({ eventId })],
      );
    }

    return { ok: true };
  });
}
