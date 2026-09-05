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
    // Keep the order cart's date/time snapshot in step too, so the cart never
    // drifts from the event (the integrity audit flags any such mismatch).
    await db.query(
      `UPDATE orders o SET cart = jsonb_set(jsonb_set(cart, '{eventDate}', to_jsonb($2::text)), '{startTime}', to_jsonb($3::text))
        FROM events e WHERE e.id = $1 AND e.order_id = o.id AND cart ? 'eventDate'`,
      [eventId, newDate, newStart],
    );
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

  // 8) Aysha Ahmed invoice #1362 — real state: paid AED 3,000 of 4,000, balance
  //    1,000; owner-approved daily email reminder ON, with a pay link generated.
  await run('aysha-invoice', async () => {
    await pool.query(`DELETE FROM invoice_payments WHERE invoice_id = (SELECT id FROM finance_invoices WHERE number = '1362')`);
    const r = await pool.query(
      `UPDATE finance_invoices SET amount_paid_fils = 300000, status = 'partial', paid_at = NULL, remind_daily = TRUE WHERE number = '1362' RETURNING id`,
    );
    const id = r.rows[0]?.id;
    L(`  Aysha #1362 → paid 3,000 / balance 1,000, reminder ON (${r.rowCount ?? 0} row)`);
    // Link the invoice to Aysha's existing customer record (her phone/email from
    // QuickBooks) — the import stored only the name, not the customer link.
    await pool.query(`
      UPDATE finance_invoices i SET customer_id = m.id
        FROM (SELECT DISTINCT ON (lower(btrim(full_name))) lower(btrim(full_name)) AS k, id
                FROM historical_customers
               ORDER BY lower(btrim(full_name)),
                        (email IS NOT NULL AND btrim(email) <> '') DESC,
                        (phone IS NOT NULL AND btrim(phone) <> '') DESC, id) m
       WHERE i.number = '1362' AND lower(btrim(i.customer_name)) = m.k`);
    // Contact on file (so we know the reminder can actually reach her).
    const c = await pool.query(
      `SELECT hc.email, hc.phone FROM finance_invoices i LEFT JOIN historical_customers hc ON hc.id = i.customer_id WHERE i.number = '1362'`,
    );
    L(`  Aysha contact: email=${c.rows[0]?.email ?? '—'} phone=${c.rows[0]?.phone ?? '—'}`);
    if (id) {
      try {
        const { createInvoicePayLink } = await import('../domain/checkout.js');
        const link = await createInvoicePayLink(Number(id));
        L(`  Aysha pay link: ${link ? link.payUrl : 'not generated (no balance/phone)'}`);
      } catch (e) { L(`  Aysha pay link failed: ${(e as Error).message}`); }
    }
  });

  // 7) Payment methods: Eventana takes only Tabby / Tamara / Debit (no cash;
  //    Debit covers card/Stripe/Ziina/bank transfer). Normalise every recent
  //    (non-QuickBooks) receipt whose method isn't Tabby/Tamara to 'Debit'.
  await run('receipt-methods', async () => {
    const { rowCount } = await pool.query(
      `UPDATE finance_receipts SET paid_with = 'Debit'
        WHERE COALESCE(source,'') <> 'quickbooks'
          AND (paid_with IS NULL OR paid_with NOT IN ('Tabby','Tamara','Debit'))`,
    );
    L(`  normalised ${rowCount ?? 0} receipt(s) to 'Debit'`);
  });

  // Read-only: upcoming events whose phone is missing or a placeholder, so the
  // owner can supply the real number(s).
  await run('phone-gaps', async () => {
    const { rows } = await pool.query(`
      SELECT e.id, to_char(e.event_date,'YYYY-MM-DD') AS d, c.name, c.phone, c.backup_phone
        FROM events e JOIN customers c ON c.id = e.customer_id
       WHERE e.phase <> 'Cancelled' AND e.event_date >= current_date
         AND (c.phone IS NULL OR btrim(c.phone) = '' OR c.phone ~ '^[0+]+$' OR length(regexp_replace(c.phone,'\\D','','g')) < 7)
       ORDER BY e.event_date`);
    L(`  events with a missing/placeholder phone: ${rows.length}`);
    for (const r of rows) L(`  ⚠ ${r.id} ${r.d} "${r.name}" phone="${r.phone ?? '—'}"`);
  });

  L('DONE');
}
