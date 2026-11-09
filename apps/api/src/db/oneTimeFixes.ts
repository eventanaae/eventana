import { pool } from './pool.js';

/**
 * One-off, idempotent data corrections the owner approved. Safe to run on every
 * boot: each is tightly guarded so it only touches the exact rows it targets and
 * becomes a no-op once applied.
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
}

/**
 * Correct events whose celebration type is still the default "kids" while their
 * receipt says something specific (e.g. Baby Shower) — so the schedule/board
 * shows the right celebration. Only "upgrades" a defaulted/blank event type to
 * the receipt's real value; never overrides an event that already has a specific
 * type. Idempotent. (The receipt is the surface where the owner edits the type.)
 */
async function syncEventCelebrationFromReceipt(): Promise<void> {
  try {
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
 * can never collide with a migrated QuickBooks number. Idempotent (setval to the
 * current max every boot). After a QuickBooks CSV import this re-aligns too.
 */
async function alignFinanceSequences(): Promise<void> {
  try {
    await pool.query(
      `SELECT setval('finance_receipt_seq',
         GREATEST((SELECT COALESCE(MAX(number::bigint),0) FROM finance_receipts WHERE number ~ '^[0-9]+$'), 1), true)`,
    );
    await pool.query(
      `SELECT setval('finance_invoice_seq',
         GREATEST((SELECT COALESCE(MAX(number::bigint),0) FROM finance_invoices WHERE number ~ '^[0-9]+$'), 1), true)`,
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
