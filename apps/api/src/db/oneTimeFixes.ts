import { claimOneShot, pool } from './pool.js';

/**
 * One-off, idempotent data corrections the owner approved. Safe to run on every
 * boot: data rewrites are one-time (app_kv markers), so they never revert a
 * later manual edit.
 */
export async function runOneTimeFixes(): Promise<void> {
  // dedupeAutoReceipts() removed (owner, 2026-11-10): it silently deleted the
  // duplicates the sale backfill kept re-posting, which hid the real bug. The
  // backfill no longer re-posts imported bookings and every imported booking is
  // now linked to its receipt, so there is nothing for it to clean.
  await fixSeededEventTimes();
  await alignGoodStars();
  await reclassifyQuickBooksInvoices();
  await alignFinanceSequences();
  await syncEventCelebrationFromReceipt();
  await backfillAddonMoneyDays();
}

/**
 * Owner rule (final, Nov 2026): every dirham is reported on the day it entered
 * the system. Add-ons paid before confirm.ts started writing receipt_addon_money
 * were merged into their event's receipt with no record of their own day, so
 * reports put that money on the ORIGINAL booking day. Give each such add-on its
 * slice, on the Dubai day it was paid.
 *
 * Only add-ons whose money really was merged: a paid / (partially) refunded
 * add-on order with no receipt of its own, whose services were applied to the
 * event (event_services rows — applyAddonOrder ran), and whose event receipt
 * (found the same way confirm.ts finds it) existed by then AND carries at least
 * one of the add-on's line labels. Paid day = the first paid/captured payment
 * transition, else the payment row's last paid/captured update, else the order's
 * creation. ON CONFLICT DO NOTHING, so a re-run (or a row confirm.ts already
 * wrote) is never duplicated; the app_kv marker is written only after success.
 */
async function backfillAddonMoneyDays(): Promise<void> {
  const KEY = 'addon_money_days_v1';
  try {
    const done = await pool.query(`SELECT 1 FROM app_kv WHERE k = $1`, [KEY]);
    if (done.rowCount) return;
    const { rowCount } = await pool.query(ADDON_MONEY_BACKFILL_SQL);
    await pool.query(`INSERT INTO app_kv (k) VALUES ($1) ON CONFLICT (k) DO NOTHING`, [KEY]);
    console.log(`[fix] add-on money days: ${rowCount ?? 0} merged add-on(s) moved to the day they were paid`);
  } catch (err) {
    console.error('[fix] backfillAddonMoneyDays failed:', err);
  }
}

export const ADDON_MONEY_BACKFILL_SQL = `
  INSERT INTO receipt_addon_money (receipt_id, order_id, booked_on, amount_fils)
  SELECT rc.id, o.id, (paid.at AT TIME ZONE 'Asia/Dubai')::date, o.total_fils
    FROM orders o
    CROSS JOIN LATERAL (
      SELECT COALESCE(
        (SELECT min(pe.created_at) FROM payment_events pe
          WHERE pe.order_id = o.id AND pe.new_status IN ('paid','captured')
            AND pe.old_status IS DISTINCT FROM pe.new_status),
        (SELECT min(p.updated_at) FROM payments p
          WHERE p.order_id = o.id AND p.status IN ('paid','captured')),
        o.created_at) AS at
    ) paid
    JOIN LATERAL (
      SELECT r.id FROM finance_receipts r
       WHERE (r.event_id = o.event_id
              OR r.order_id = (SELECT e.order_id FROM events e WHERE e.id = o.event_id))
         AND r.created_at <= paid.at + interval '1 day'
         AND EXISTS (
           SELECT 1
             FROM jsonb_array_elements(CASE WHEN jsonb_typeof(r.line_items) = 'array' THEN r.line_items ELSE '[]'::jsonb END) li,
                  jsonb_array_elements(CASE WHEN jsonb_typeof(o.quote->'lines') = 'array' THEN o.quote->'lines' ELSE '[]'::jsonb END) ql
            WHERE li->>'name' = ql->>'label')
       ORDER BY (r.event_id = o.event_id) DESC, r.id
       LIMIT 1
    ) rc ON true
   WHERE o.kind = 'addon' AND o.event_id IS NOT NULL
     AND o.status IN ('paid','partially_refunded','refunded')
     AND NOT EXISTS (SELECT 1 FROM finance_receipts own WHERE own.order_id = o.id)
     AND EXISTS (SELECT 1 FROM event_services es WHERE es.order_id = o.id)
  ON CONFLICT (order_id) DO NOTHING`;

/**
 * Correct events whose celebration type is still the default "kids" while their
 * receipt says something specific (e.g. Baby Shower) — so the schedule/board
 * shows the right celebration. Only "upgrades" a defaulted/blank event type to
 * the receipt's real value; never overrides an event that already has a specific
 * type. Idempotent. (The receipt is the surface where the owner edits the type.)
 */
async function syncEventCelebrationFromReceipt(): Promise<void> {
  try {
    // One-time (app_kv marker, written first): on every boot it would re-apply
    // the receipt type over an event the owner deliberately set back to "kids".
    if (!(await claimOneShot('fix_sync_event_celebration_v1'))) return;
    const { rowCount } = await pool.query(
      `UPDATE events e
          SET celebration_type = fr.celebration_type
         FROM finance_receipts fr
        WHERE fr.event_id = e.id
          AND fr.celebration_type IS NOT NULL AND fr.celebration_type <> ''
          AND (e.celebration_type = 'kids' OR e.celebration_type IS NULL)
          AND e.celebration_type IS DISTINCT FROM fr.celebration_type`,
    );
    if (rowCount) console.log(`[fix] synced celebration type from receipt onto ${rowCount} event(s)`);
  } catch (err) {
    console.error('[fix] syncEventCelebrationFromReceipt failed:', err);
  }
}

/**
 * Move the QuickBooks 'Invoice'-type documents out of Sales receipts and into the
 * Invoices section (unpaid → Accounts Receivable). Owner-approved; idempotent.
 * Runs before alignFinanceSequences so the sequences settle on the final max.
 */
async function reclassifyQuickBooksInvoices(): Promise<void> {
  try {
    // Ran on EVERY boot and overwrote the owner's invoice edits (totals, items,
    // names) from history. Now runs once, guarded by an app_kv marker.
    const done = await pool.query(`SELECT 1 FROM app_kv WHERE k = 'invoices_reclassified_v1'`);
    if (done.rowCount) return;
    await pool.query(`INSERT INTO app_kv (k) VALUES ('invoices_reclassified_v1') ON CONFLICT (k) DO NOTHING`);
    const { reconcileInvoicesFromHistory } = await import('../domain/finance.js');
    const r = await reconcileInvoicesFromHistory();
    if (r.invoices) console.log(`[fix] reclassified ${r.invoices} QuickBooks invoice(s); removed ${r.removedReceipts} mis-filed receipt(s)`);
  } catch (err) {
    console.error('[fix] reclassifyQuickBooksInvoices failed:', err);
  }
}

/**
 * Point the invoice & sales-receipt number sequences at the real max already in
 * each table, so a newly-created document always takes the NEXT free number and
 * can never collide with a migrated QuickBooks number. Idempotent, and never
 * moves a sequence BACKWARDS (GREATEST with its current last_value): if the
 * highest-numbered document was deleted, its number is not handed out again.
 * After a QuickBooks CSV import this re-aligns too.
 */
async function alignFinanceSequences(): Promise<void> {
  try {
    await pool.query(
      `SELECT setval('finance_receipt_seq',
         GREATEST((SELECT COALESCE(MAX(number::bigint),0) FROM finance_receipts WHERE number ~ '^[0-9]+$'), 1,
                  (SELECT last_value FROM finance_receipt_seq)), true)`,
    );
    await pool.query(
      `SELECT setval('finance_invoice_seq',
         GREATEST((SELECT COALESCE(MAX(number::bigint),0) FROM finance_invoices WHERE number ~ '^[0-9]+$'), 1,
                  (SELECT last_value FROM finance_invoice_seq)), true)`,
    );
  } catch (err) {
    console.error('[fix] alignFinanceSequences failed:', err);
  }
}

/**
 * The owner set "good feedback" to 5★ only — once. This USED to bump
 * incentive_rules.goodStars back to 5 on every boot, which silently reverted any
 * later change the owner made in the dashboard. The one-time alignment has long
 * since happened, so it is now a pure one-shot that is treated as already done:
 * it records its app_kv marker and never writes the setting again.
 */
async function alignGoodStars(): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO app_kv (k) VALUES ('align_good_stars_v1') ON CONFLICT (k) DO NOTHING`,
    );
  } catch (err) {
    console.error('[fix] alignGoodStars marker failed:', err);
  }
}

/**
 * Remove the duplicate sales receipts the auto-poster created on top of the
 * QuickBooks-migrated ones: same customer, same date, same amount. We delete
 * ONLY the app-generated copy (source='app', not linked to an event) and keep
 * the QuickBooks original (linked to its event). Owner-approved.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function dedupeAutoReceipts(): Promise<void> {
  try {
    const { rowCount } = await pool.query(
      `DELETE FROM finance_receipts a
        WHERE a.source = 'app' AND a.event_id IS NULL
          AND EXISTS (
            SELECT 1 FROM finance_receipts b
             WHERE b.id <> a.id
               AND b.source = 'quickbooks'
               AND lower(btrim(b.customer_name)) = lower(btrim(a.customer_name))
               AND b.date = a.date
               AND b.total_fils = a.total_fils)`,
    );
    if (rowCount) console.log(`[fix] removed ${rowCount} duplicate auto-posted receipt(s)`);
  } catch (err) {
    console.error('[fix] dedupeAutoReceipts failed:', err);
  }
}

/**
 * The seeded bookings all carried a placeholder 17:00–21:00; the customers
 * actually chose 18:00–22:00. Correct the specific upcoming events and shift
 * their reserved inventory holds by the same +1 hour so availability stays
 * consistent. Guarded to the known event ids AND to start_time='17:00', so it
 * runs once and never touches a genuine future booking.
 *
 * EXCLUDED: EV-2026-0203 (Ghaya Al Muhairy) genuinely chose 5:00–9:00 PM
 * (17:00–21:00), confirmed by the owner — it must NOT be bumped to 18:00. This
 * boot fix was silently reverting her correct 5 PM back to 6 PM on every deploy.
 */
async function fixSeededEventTimes(): Promise<void> {
  const ids = ['EV-2026-0204', 'EV-2026-0196', 'EV-2026-0201', 'EV-2026-0202', 'EV-2026-0197', 'EV-2026-0198', 'EV-2026-0199', 'EV-2026-0200'];
  try {
    // One-time (app_kv marker, written first): re-running on every boot reverted
    // any of these events the owner later set back to 17:00–21:00.
    if (!(await claimOneShot('fix_seeded_event_times_v1'))) return;
    const { rows } = await pool.query(
      `UPDATE events SET start_time = '18:00', base_end_time = '22:00'
        WHERE id = ANY($1) AND start_time = '17:00' AND base_end_time = '21:00'
          AND phase <> 'Cancelled'
        RETURNING id`,
      [ids],
    );
    if (rows.length) {
      await pool.query(
        `UPDATE inventory_holds SET starts_at = starts_at + interval '1 hour', ends_at = ends_at + interval '1 hour'
          WHERE event_id = ANY($1) AND status = 'reserved'`,
        [rows.map((r) => r.id)],
      );
      console.log(`[fix] moved ${rows.length} event(s) to 18:00–22:00 and shifted their holds`);
    }
  } catch (err) {
    console.error('[fix] fixSeededEventTimes failed:', err);
  }
}
