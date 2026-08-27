/**
 * Shared money-out: refund an order through its payment provider and settle the
 * bookkeeping. Used by the manual admin refund route and by the automatic
 * refund that fires when a customer cancels their own booking.
 *
 * Mirrors the admin refund flow: lock the payment, call the provider, write the
 * new payment/order status from the provider's response (never optimistically),
 * mark any pending cancellation as processed, email the customer, reverse the
 * loyalty points, and — on a full refund — release holds and cancel the event.
 */
import { pool, withTransaction } from '../db/pool.js';
import { getProvider } from '../payments/index.js';
import { orderStatusFor, recordPaymentEvent } from './orders.js';
import { loadConfig } from './settings.js';
import { formatAed } from '@eventana/shared';

export interface RefundResult {
  ok: boolean;
  status?: string;
  refundedFils?: number;
  error?: string;
}

/**
 * Refund `amountFils` on `orderId`. Returns { ok:true } once the provider has
 * accepted the refund and the books are settled, or { ok:false, error } if the
 * order can't be refunded (no provider payment, already refunded, cash, etc.).
 * Safe to call once per cancellation; a second call is a no-op if nothing is
 * left to refund.
 */
export type RefundReasonCategory = 'customer_cancellation' | 'quality_issue' | 'missing_item' | 'other';

export async function refundOrderMoney(params: {
  orderId: string;
  amountFils: number;
  reason: string;
  /** Structured reason for tracking (customer choice vs. our service problems). */
  reasonCategory?: RefundReasonCategory;
  /** Whether the event itself is being cancelled. A refund is NOT a cancellation
   *  by default — a completed event can be refunded for a quality issue. */
  cancelEvent?: boolean;
  /** Who triggered it: a staff name, 'customer', or 'system'. */
  createdBy?: string;
  source?: string;
}): Promise<RefundResult> {
  const { orderId, amountFils, reason } = params;
  const reasonCategory: RefundReasonCategory = params.reasonCategory ?? 'other';
  const createdBy = params.createdBy ?? 'system';
  if (amountFils <= 0) return { ok: false, error: 'nothing_to_refund' };

  try {
    return await withTransaction(async (db) => {
      const { rows } = await db.query(
        `SELECT p.*, o.total_fils, o.event_id, o.customer_id
           FROM payments p JOIN orders o ON o.id = p.order_id
          WHERE p.order_id = $1 ORDER BY p.created_at DESC LIMIT 1
          FOR UPDATE OF p`,
        [orderId],
      );
      const payment = rows[0];
      if (!payment) return { ok: false, error: 'not_found' };
      if (!payment.provider_payment_id) return { ok: false, error: 'no_provider_payment' };
      if (payment.status !== 'paid' && payment.status !== 'captured' && payment.status !== 'partially_refunded') {
        return { ok: false, error: 'not_refundable' };
      }
      const alreadyRefunded = Number(payment.refunded_fils);
      const cap = Number(payment.amount_fils);
      const toRefund = Math.min(amountFils, cap - alreadyRefunded);
      if (toRefund <= 0) return { ok: false, error: 'nothing_to_refund' };

      // Money moves here, under the lock.
      const provider = getProvider(payment.provider);
      const verified = await provider.refund(payment.provider_payment_id, toRefund, reason);

      const refundedTotal = alreadyRefunded + toRefund;
      const nextStatus: 'refunded' | 'partially_refunded' =
        refundedTotal >= cap ? 'refunded' : 'partially_refunded';

      await db.query(
        `UPDATE payments
            SET status = $2, refunded_fils = $3,
                last_provider_status = COALESCE($4, last_provider_status),
                raw = COALESCE($5, raw), updated_at = now()
          WHERE id = $1`,
        [payment.id, nextStatus, refundedTotal, verified.providerStatus ?? null, verified.raw ? JSON.stringify(verified.raw) : null],
      );
      await db.query(`UPDATE orders SET status = $2, updated_at = now() WHERE id = $1`, [orderId, orderStatusFor(nextStatus)]);
      await recordPaymentEvent(db, {
        paymentId: payment.id,
        orderId,
        provider: payment.provider,
        oldStatus: payment.status,
        newStatus: nextStatus,
        source: 'system',
        providerStatus: verified.providerStatus,
        amountFils: payment.amount_fils,
        payload: verified.raw,
        note: `Auto-refund ${formatAed(toRefund)} — ${reason}`,
      });

      // Track every refund with its structured reason (customer choice vs. a
      // service problem of ours), and whether the event is being cancelled.
      await db.query(
        `INSERT INTO refunds (order_id, event_id, customer_id, amount_fils,
                              reason_category, reason_note, event_cancelled,
                              provider_reference, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [orderId, payment.event_id, payment.customer_id, toRefund, reasonCategory,
         reason, !!params.cancelEvent, verified.providerStatus ?? null, createdBy],
      );

      // Settle any recorded customer cancellation (if this refund is one).
      const cx = await db.query(
        `UPDATE cancellations
            SET refund_status = 'processed', processed_at = now(),
                refund_reference = COALESCE($2, refund_reference)
          WHERE order_id = $1 AND refund_status <> 'processed'
          RETURNING order_id`,
        [orderId, verified.providerStatus ?? null],
      );
      if (payment.event_id) {
        // The money is out — close any open "process refund" finance task.
        await db.query(
          `UPDATE event_tasks SET status = 'done'
            WHERE event_id = $1 AND department = 'finance' AND status <> 'done' AND title ILIKE '%refund%'`,
          [payment.event_id],
        );
        // Drop the earlier "pending" cancellation email so the customer isn't
        // told twice (only relevant when a cancellation email was queued).
        await db.query(
          `UPDATE notifications SET cancelled_at = now()
            WHERE event_id = $1 AND template = 'cancellation_refund' AND sent_at IS NULL AND cancelled_at IS NULL`,
          [payment.event_id],
        );
      }
      // ALWAYS confirm the refund by email — keyed by the order, so it fires for
      // a plain refund with no cancellation, and for orders with no event (shop).
      // The amount + reference travel in the payload so the sweep needs no join.
      await db.query(
        `INSERT INTO notifications (event_id, channel, template, scheduled_for, payload)
         VALUES ($1,'email','refund_processed', now(), $2)`,
        [payment.event_id ?? null, JSON.stringify({ orderId, amountFils: toRefund, reference: verified.providerStatus ?? null })],
      );

      // Reverse the loyalty points the booking earned, proportionally.
      const cfg = await loadConfig();
      const points = Math.floor((toRefund / 100) * cfg.rules.loyaltyPointsPerAed);
      if (points > 0) {
        await db.query(
          `INSERT INTO loyalty_transactions (customer_id, event_id, order_id, points, reason)
           VALUES ($1,$2,$3,$4,'Refund reversal')`,
          [payment.customer_id, payment.event_id, orderId, -points],
        );
        await db.query(`UPDATE customers SET loyalty_points = GREATEST(0, loyalty_points - $2) WHERE id = $1`, [payment.customer_id, points]);
      }

      // Cancelling the event is now a SEPARATE decision from refunding: a
      // completed party can be (partly) refunded for a quality issue without
      // being cancelled. Only tear the event down when the caller says so.
      if (params.cancelEvent) {
        await db.query(`UPDATE inventory_holds SET status = 'released' WHERE order_id = $1`, [orderId]);
        if (payment.event_id) {
          await db.query(
            `UPDATE notifications SET cancelled_at = now()
              WHERE event_id = $1 AND sent_at IS NULL AND cancelled_at IS NULL
                AND template NOT IN ('refund_processed')`,
            [payment.event_id],
          );
          await db.query(
            `UPDATE events SET phase = 'Cancelled', eta = NULL,
                    cancelled_at = COALESCE(cancelled_at, now()),
                    cancellation_reason = COALESCE(cancellation_reason, $2)
              WHERE id = $1`,
            [payment.event_id, `Fully refunded — ${reason}`],
          );
          await db.query(`UPDATE event_tasks SET status = 'done' WHERE event_id = $1 AND status <> 'done'`, [payment.event_id]);
        }
      }

      return { ok: true, status: nextStatus, refundedFils: refundedTotal };
    });
  } catch (err) {
    // Leave the cancellation 'pending' so the team can retry from the dashboard.
    await pool
      .query(`UPDATE cancellations SET refund_status = 'failed' WHERE order_id = $1 AND refund_status = 'pending'`, [orderId])
      .catch(() => {});
    console.error('[refund] auto-refund failed:', (err as Error).message);
    return { ok: false, error: 'provider_error' };
  }
}
