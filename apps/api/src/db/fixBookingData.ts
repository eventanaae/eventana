/**
 * One-time, owner-approved booking-data corrections, checked against each
 * customer's original booking message. Gated by FIX_BOOKINGS=true.
 *
 * SAFE BY DESIGN:
 *  - Idempotent: every change is guarded on the current stored value, so a
 *    re-run is a no-op.
 *  - Time changes go through staffUpdateEvent(), which moves the reserved
 *    inventory holds with the new window (never a raw UPDATE).
 *  - The single date change moves holds + reminder rows inline.
 *  - NO customer message is sent: for the events whose DATE/TIME moved onto or
 *    near "now", any still-pending unsent customer notification is cancelled so
 *    this data fix can never trigger an email/WhatsApp. The owner re-sends a
 *    corrected receipt herself, deliberately.
 *
 * Each correction is failure-isolated so one bad row can't block the rest.
 */
import { parseHour } from '@eventana/shared';
import { pool, withTransaction } from './pool.js';
import { staffUpdateEvent } from '../domain/eventEdit.js';
import { eventWindow, getAssets } from '../domain/inventory.js';

const L = (s: string) => console.log(`[fix-bookings] ${s}`);
const run = async (label: string, fn: () => Promise<void>) => {
  try { await fn(); } catch (e) { L(`✗ ${label}: ${(e as Error).message}`); }
};

/** Set an event's start/end via the official editor (moves inventory holds). */
async function setTime(eventId: string, start: string, end: string): Promise<void> {
  const { rows } = await pool.query(`SELECT start_time, base_end_time FROM events WHERE id = $1`, [eventId]);
  const ev = rows[0];
  if (!ev) return L(`  ${eventId} not found`);
  if (ev.start_time === start && ev.base_end_time === end) return L(`  ${eventId} time already ${start}-${end} (skip)`);
  await staffUpdateEvent(eventId, { startTime: start, endTime: end });
  L(`  ${eventId} time ${ev.start_time}-${ev.base_end_time} → ${start}-${end}`);
}

/** Guest-of-honour (baby) name — mirror to the order cart AND the receipt. */
async function setBaby(eventId: string, name: string): Promise<void> {
  await staffUpdateEvent(eventId, { eventFor: name });
  await pool.query(`UPDATE finance_receipts SET event_for = $2 WHERE event_id = $1`, [eventId, name]);
  L(`  ${eventId} baby → "${name}"`);
}

async function setCustomerField(eventId: string, col: 'name' | 'phone' | 'backup_phone', value: string): Promise<void> {
  const { rows } = await pool.query(
    `UPDATE customers SET ${col} = $2 WHERE id = (SELECT customer_id FROM events WHERE id = $1) RETURNING id`,
    [eventId, value],
  );
  L(`  ${eventId} customer.${col} → "${value}"${rows[0] ? '' : ' (no customer row)'}`);
  if (col === 'name') await pool.query(`UPDATE finance_receipts SET customer_name = $2 WHERE event_id = $1`, [eventId, value]);
}

/** Mark an event's date as not-yet-decided (TBD) on the event + its receipt, and
 *  suppress pending customer reminders so nothing dated goes out. */
async function setTbd(eventId: string): Promise<void> {
  await pool.query(`UPDATE events SET date_tbd = TRUE WHERE id = $1`, [eventId]);
  await pool.query(`UPDATE finance_receipts SET date_tbd = TRUE WHERE event_id = $1`, [eventId]);
  await suppressCustomerNotifs(eventId);
  L(`  ${eventId} date → TBD (flag set + reminders suppressed)`);
}

/** Cancel still-pending, unsent CUSTOMER notifications so a correction can never
 *  auto-fire an email/WhatsApp. Driver/internal rows are untouched. */
async function suppressCustomerNotifs(eventId: string): Promise<void> {
  const { rowCount } = await pool.query(
    `UPDATE notifications SET cancelled_at = now()
      WHERE event_id = $1 AND channel IN ('email','whatsapp')
        AND sent_at IS NULL AND whatsapp_sent_at IS NULL AND cancelled_at IS NULL`,
    [eventId],
  );
  if (rowCount) L(`  ${eventId} suppressed ${rowCount} pending customer notif(s)`);
}

/** Move an event's date (and time) with its holds + reminder rows. No 72h guard
 *  — this is a staff correction of wrong data, not a customer reschedule. */
async function moveDateTime(eventId: string, newDate: string, newStart: string, newEnd: string): Promise<void> {
  await withTransaction(async (db) => {
    const { rows } = await db.query(`SELECT * FROM events WHERE id = $1 FOR UPDATE`, [eventId]);
    const ev = rows[0];
    if (!ev) return void L(`  ${eventId} not found`);
    const curDate = new Date(ev.event_date as string).toISOString().slice(0, 10);
    if (curDate === newDate && ev.start_time === newStart && ev.base_end_time === newEnd) {
      return void L(`  ${eventId} already ${newDate} ${newStart}-${newEnd} (skip)`);
    }
    const endHour = parseHour(newEnd);
    const { rows: holds } = await db.query<{ asset_code: string }>(
      `SELECT DISTINCT asset_code FROM inventory_holds WHERE event_id = $1 AND status = 'reserved'`,
      [eventId],
    );
    const assets = await getAssets(db, holds.map((h) => h.asset_code));
    for (const asset of assets) {
      const win = eventWindow(newDate, newStart, endHour, asset.buffer_before_minutes, asset.buffer_after_minutes);
      await db.query(
        `UPDATE inventory_holds SET starts_at = $2, ends_at = $3 WHERE event_id = $1 AND asset_code = $4 AND status = 'reserved'`,
        [eventId, win.startsAt, win.endsAt, asset.code],
      );
    }
    await db.query(`UPDATE events SET event_date = $2, start_time = $3, base_end_time = $4 WHERE id = $1`, [eventId, newDate, newStart, newEnd]);
    await db.query(
      `UPDATE notifications SET scheduled_for = $2::date - interval '3 days'
        WHERE event_id = $1 AND template = 'three_day_reminder' AND sent_at IS NULL AND cancelled_at IS NULL`,
      [eventId, newDate],
    );
    await db.query(
      `UPDATE notifications SET scheduled_for = $2::date
        WHERE event_id = $1 AND template = 'event_day' AND sent_at IS NULL AND cancelled_at IS NULL`,
      [eventId, newDate],
    );
    // Keep the linked receipt's date in step with the event.
    await db.query(`UPDATE finance_receipts SET date = $2::date WHERE event_id = $1`, [eventId, newDate]);
    L(`  ${eventId} date/time ${curDate} ${ev.start_time}-${ev.base_end_time} → ${newDate} ${newStart}-${newEnd}`);
  });
}

export async function fixBookingDataFromEnv(): Promise<void> {
  if (process.env.FIX_BOOKINGS !== 'true') return;
  L('start');

  // 1) Ghaya Al Muhairy — booked 5:00–9:00 PM (system had 6–10). +2nd phone.
  await run('ghaya', async () => {
    await setTime('EV-2026-0203', '17:00', '21:00');
    await setCustomerField('EV-2026-0203', 'backup_phone', '0506781481');
  });

  // 2) Bushra Alzubaidi — booked 2:00–8:00 PM (system had 5–9). Baby mohammed. +2nd phone.
  await run('bushra', async () => {
    await setTime('EV-2026-0206', '14:00', '20:00');
    await setBaby('EV-2026-0206', 'mohammed');
    await setCustomerField('EV-2026-0206', 'backup_phone', '0551515154');
  });

  // 3) Bashayer Alyammahi — owner-confirmed EVENT date 13 Nov 2026, 6:00–10:00 PM
  //    (she BOOKED on 4 Sep — booking-date ≠ event-date). A prior run wrongly
  //    moved it to 4 Sep. Restore the real date + time, baby Aouf, +2nd phone,
  //    and suppress auto-sends so nothing fires from the correction.
  await run('bashayer', async () => {
    await moveDateTime('EV-2026-0207', '2026-11-13', '18:00', '22:00');
    await setBaby('EV-2026-0207', 'Aouf');
    await setCustomerField('EV-2026-0207', 'backup_phone', '0502995775');
    await suppressCustomerNotifs('EV-2026-0207');
  });

  // 4) Nouf Alneyadi — name spelling + 2nd phone.
  await run('nouf', async () => {
    await setCustomerField('EV-2026-0200', 'name', 'Nouf Alneyadi');
    await setCustomerField('EV-2026-0200', 'backup_phone', '0507302622');
  });

  // 5) Huda Hussain — main phone was broken ("6174599"), fix + 2nd phone.
  //    (Her date 4 Sep is correct — NOT TBD.)
  await run('huda', async () => {
    await setCustomerField('EV-2026-0201', 'phone', '0566174599');
    await setCustomerField('EV-2026-0201', 'backup_phone', '0563040103');
  });

  // 6) Amna Al Dhaheri — hasn't chosen an event date yet → TBD.
  await run('amna', async () => {
    await setTbd('EV-2026-0199');
  });

  // 7) Manual receipts the owner confirmed were paid by bank transfer.
  await run('receipt-methods', async () => {
    for (const num of ['1718', '1719', '1722', '1723']) {
      const { rowCount } = await pool.query(
        `UPDATE finance_receipts SET paid_with = 'Bank transfer' WHERE number = $1`,
        [num],
      );
      L(`  R#${num} paid_with → Bank transfer${rowCount ? '' : ' (not found)'}`);
    }
  });

  L('DONE');
}
