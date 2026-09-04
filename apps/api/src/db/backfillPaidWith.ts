/**
 * Backfill the real payment method onto existing sales receipts that were saved
 * before the receipt captured the provider (they carry the generic 'Card').
 * Gated by BACKFILL_PAID_WITH=true. Read-mostly + idempotent: only touches
 * order-linked, non-QuickBooks receipts whose paid_with is still the generic
 * 'Card', setting it from that order's provider payment.
 */
import { pool } from './pool.js';

export async function backfillPaidWithFromEnv(): Promise<void> {
  if (process.env.BACKFILL_PAID_WITH !== 'true') return;
  try {
    const { rowCount } = await pool.query(`
      UPDATE finance_receipts r
         SET paid_with = CASE lower(p.provider)
               WHEN 'tabby'  THEN 'Tabby'
               WHEN 'tamara' THEN 'Tamara'
               WHEN 'stripe' THEN 'Stripe'
               WHEN 'ziina'  THEN 'Ziina'
               ELSE initcap(p.provider)
             END
        FROM (
          SELECT DISTINCT ON (order_id) order_id, provider
            FROM payments
           ORDER BY order_id,
                    (status IN ('paid','captured','succeeded','authorized')) DESC,
                    updated_at DESC
        ) p
       WHERE p.order_id = r.order_id
         AND r.order_id IS NOT NULL
         AND COALESCE(r.source,'') <> 'quickbooks'
         AND (r.paid_with IS NULL OR r.paid_with = 'Card')
    `);
    console.log(`[paid-with] backfilled ${rowCount ?? 0} receipt(s) with the real provider`);
  } catch (e) {
    console.error('[paid-with] failed:', (e as Error).message);
  }
}
