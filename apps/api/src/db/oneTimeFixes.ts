import { pool } from './pool.js';

/**
 * One-off, idempotent data corrections the owner approved. Safe to run on every
 * boot: each is tightly guarded so it only touches the exact rows it targets and
 * becomes a no-op once applied.
 */
export async function runOneTimeFixes(): Promise<void> {
  await dedupeAutoReceipts();
  await fixSeededEventTimes();
}

/**
 * Remove the duplicate sales receipts the auto-poster created on top of the
 * QuickBooks-migrated ones: same customer, same date, same amount. We delete
 * ONLY the app-generated copy (source='app', not linked to an event) and keep
 * the QuickBooks original (linked to its event). Owner-approved.
 */
async function dedupeAutoReceipts(): Promise<void> {
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
 */
async function fixSeededEventTimes(): Promise<void> {
  const ids = ['EV-2026-0204', 'EV-2026-0196', 'EV-2026-0201', 'EV-2026-0203', 'EV-2026-0202', 'EV-2026-0197', 'EV-2026-0198', 'EV-2026-0199', 'EV-2026-0200'];
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
