/**
 * Owner-approved cleanup (2026-09-09). Gated by CLEANUP_APPLY=true; safe + mostly
 * reversible:
 *  1. Soft-cancel the owner's/staff internal TEST unpaid orders (status →
 *     'cancelled', an UPDATE — reversible), so they stop showing as orders. Only
 *     touches unpaid orders whose customer name is an internal/test one; real
 *     customers' abandoned carts are left untouched.
 *  2. Delete the one EMPTY duplicate customer (0 events / 0 orders) — verified
 *     empty at runtime before deleting, so no data is lost.
 * Turn the flag off after it runs.
 */
import { pool } from './pool.js';

const EMPTY_DUP_ID = 'CUST-54E1561B'; // Shaima duplicate (0ev/0ord), same phone+email as CUST-C2491402

export async function cleanupApplyFromEnv(): Promise<void> {
  if (String(process.env.CLEANUP_APPLY ?? '').toLowerCase() !== 'true') return;
  const L = (s: string) => console.log(`[cleanup-apply] ${s}`);
  try {
    // 1. Soft-cancel internal/test unpaid orders (owner/staff test bookings).
    const cancelled = await pool.query(
      `UPDATE orders SET status = 'cancelled', updated_at = now()
        WHERE status IN ('awaiting_payment', 'failed')
          AND customer_id IN (
            SELECT id FROM customers
             WHERE name ILIKE '%test%' OR name ILIKE '%sheem%'
                OR name ILIKE '%shaima%' OR name ILIKE '%gloria%')
        RETURNING id`,
    );
    L(`soft-cancelled ${cancelled.rowCount} internal/test unpaid order(s): ${cancelled.rows.map((r: any) => r.id).join(', ') || '(none)'}`);

    // 2. Delete the empty duplicate customer — re-verify it is truly empty first.
    const ev = Number((await pool.query(`SELECT count(*) n FROM events WHERE customer_id = $1`, [EMPTY_DUP_ID])).rows[0].n);
    const od = Number((await pool.query(`SELECT count(*) n FROM orders WHERE customer_id = $1`, [EMPTY_DUP_ID])).rows[0].n);
    if (ev === 0 && od === 0) {
      const del = await pool.query(`DELETE FROM customers WHERE id = $1 RETURNING id`, [EMPTY_DUP_ID]);
      L(`deleted empty duplicate customer ${EMPTY_DUP_ID}: ${del.rowCount} row`);
    } else {
      L(`SKIPPED deleting ${EMPTY_DUP_ID} — not empty (events=${ev}, orders=${od})`);
    }
    L('DONE');
  } catch (e) {
    L(`error: ${(e as Error).message.slice(0, 200)}`);
  }
}
