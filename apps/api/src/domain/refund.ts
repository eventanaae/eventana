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

/** On a CANCELLATION refund, RETURN to the customer the loyalty points and store
 *  credit they SPENT on the booking, pro-rated by the fraction of the order being
 *  refunded (ratio = thisRefund / orderTotal). The owner's policy is "same ratio":
 *  an 80% refund returns 80% of what they spent. The EARNED-points reversal is a
 *  separate step the caller already does. No-op for a non-cancellation refund
 *  (e.g. a quality refund on an attended party) or when nothing was spent. */
async function returnSpentTenders(
  db: any, orderId: string, eventId: string | null, customerId: string | null, ratio: number,
): Promise<void> {
  if (!customerId || ratio <= 0) return;
  const r = Math.min(1, ratio);
  const spent = Number((await db.query(
    `SELECT COALESCE(-SUM(points),0)::bigint s FROM loyalty_transactions
      WHERE order_id = $1 AND points < 0 AND reason = 'Points redeemed at checkout'`, [orderId],
  )).rows[0].s);
  const cartRow = (await db.query(`SELECT cart FROM orders WHERE id = $1`, [orderId])).rows[0];
  const creditUsed = Number((cartRow?.cart as any)?.appliedDiscounts?.creditFils ?? 0);
  const restorePoints = Math.floor(spent * r);
  const restoreCredit = Math.floor(creditUsed * r);
  if (restorePoints > 0) {
    await db.query(
      `INSERT INTO loyalty_transactions (customer_id, event_id, order_id, points, reason)
       VALUES ($1,$2,$3,$4,'Points returned — booking cancelled')`,
      [customerId, eventId, orderId, restorePoints],
    );
    await db.query(`UPDATE customers SET loyalty_points = loyalty_points + $2 WHERE id = $1`, [customerId, restorePoints]);
  }
  if (restoreCredit > 0) {
    await db.query(`UPDATE customers SET referral_credit_fils = referral_credit_fils + $2 WHERE id = $1`, [customerId, restoreCredit]);
  }
}

export async function refundOrderMoney(params: {
  orderId: string;
  amountFils: number;
  reason: string;
  /** Structured reason for tracking (customer choice vs. our service problems). */
  reasonCategory?: RefundReasonCategory;
  /** Whether the event itself is being cancelled. A refund is NOT a cancellation
   *  by default — a completed event can be refunded for a quality issue. */
  cancelEvent?: boolean;
  /** The specific ordered item this refund is for (owner picked it), so the
   *  receipt can show that line as refunded. Omitted for a free-amount refund. */
  itemLabel?: string | null;
  /** Who triggered it: a staff name, 'customer', or 'system'. */
  createdBy?: string;
  source?: string;
  /** Record-only: the team returns the money to the customer by hand (bank
   *  transfer), so NEVER reverse at the payment provider — just record the refund,
   *  reflect it on the receipt, email the customer and reverse points. Used by the
   *  manual Refund button for every payment method (card, Tabby, cash alike). */
  recordOnly?: boolean;
}): Promise<RefundResult> {
  const { orderId, amountFils, reason } = params;
  const reasonCategory: RefundReasonCategory = params.reasonCategory ?? 'other';
  const itemLabel = (params.itemLabel ?? '').trim() || null;
  const createdBy = params.createdBy ?? 'system';
  if (amountFils <= 0) return { ok: false, error: 'nothing_to_refund' };

  try {
    return await withTransaction(async (db) => {
      const { rows } = await db.query(
        `SELECT p.*, o.total_fils, o.event_id, o.customer_id
           FROM payments p JOIN orders o ON o.id = p.order_id
          WHERE p.order_id = $1
          ORDER BY (p.status IN ('paid','captured','partially_refunded')) DESC, p.created_at DESC
          LIMIT 1
          FOR UPDATE OF p`,
        [orderId],
      );
      const payment = rows[0];
      if (params.recordOnly || !payment) {
        // Either the team refunds by hand for every booking (recordOnly), or there
        // is no provider payment on this order (cash, manual/offer, or an imported
        // historical booking). We never reverse money at a provider, but the owner
        // still needs to RECORD the refund (she compensates another way): track it,
        // reflect it on the receipt, email the customer, and reverse loyalty points.
        const ord = (await db.query<{ total_fils: number; event_id: string | null; customer_id: string | null }>(
          `SELECT total_fils, event_id, customer_id FROM orders WHERE id = $1 FOR UPDATE`,
          [orderId],
        )).rows[0];
        if (!ord) return { ok: false, error: 'not_found' };
        const cap = Number(ord.total_fils);
        const already = Number((await db.query<{ s: string }>(
          `SELECT COALESCE(SUM(amount_fils),0)::bigint AS s FROM refunds WHERE order_id = $1`, [orderId],
        )).rows[0].s);
        const toRefund = Math.min(amountFils, Math.max(0, cap - already));
        if (toRefund <= 0) return { ok: false, error: 'nothing_to_refund' };

        // Idempotency: a double-click / retry that lands an identical refund in
        // the same breath is a safe no-op — never record or email it twice.
        const dupM = (await db.query<{ id: string }>(
          `SELECT id FROM refunds WHERE order_id=$1 AND amount_fils=$2 AND COALESCE(item_label,'')=COALESCE($3,'') AND created_at > now() - interval '60 seconds' LIMIT 1`,
          [orderId, toRefund, itemLabel],
        )).rows[0];
        if (dupM) {
          const status: 'refunded' | 'partially_refunded' = (already + toRefund) >= cap ? 'refunded' : 'partially_refunded';
          return { ok: true, status, refundedFils: already + toRefund };
        }

        await db.query(
          `INSERT INTO refunds (order_id, event_id, customer_id, amount_fils,
                                reason_category, reason_note, event_cancelled,
                                provider_reference, created_by, item_label)
           VALUES ($1,$2,$3,$4,$5,$6,$7,'manual',$8,$9)`,
          [orderId, ord.event_id, ord.customer_id, toRefund, reasonCategory, reason, !!params.cancelEvent, createdBy, itemLabel],
        );
        const status: 'refunded' | 'partially_refunded' = (already + toRefund) >= cap ? 'refunded' : 'partially_refunded';
        await db.query(`UPDATE orders SET status = $2, updated_at = now() WHERE id = $1`, [orderId, orderStatusFor(status)]).catch(() => {});

        // Side-effects (receipt reflection, email, points, optional cancel) in a
        // savepoint so a failure here can never undo the recorded refund above.
        await db.query('SAVEPOINT manual_refund_side');
        try {
          await db.query(
            `UPDATE finance_receipts
                SET refunded_fils = refunded_fils + $2,
                    refunded_items = refunded_items || $3::jsonb
              WHERE order_id = $1`,
            [orderId, toRefund, JSON.stringify([{ label: itemLabel, amountFils: toRefund, reasonCategory, at: new Date().toISOString() }])],
          );
          // Drop any still-unsent earlier refund email for this order so two
          // refunds before the sweep don't email twice — the new row carries the
          // cumulative receipt figures, so the latest single email is correct.
          await db.query(
            `UPDATE notifications SET cancelled_at = now() WHERE template='refund_processed' AND sent_at IS NULL AND cancelled_at IS NULL AND payload->>'orderId' = $1`,
            [orderId],
          );
          await db.query(
            `INSERT INTO notifications (event_id, channel, template, scheduled_for, payload)
             VALUES ($1,'email','refund_processed', now(), $2)`,
            [ord.event_id ?? null, JSON.stringify({ orderId, amountFils: toRefund, reference: 'manual', reasonCategory, itemLabel })],
          );
          const cfgM = await loadConfig();
          const pointsM = Math.floor((toRefund / 100) * cfgM.rules.loyaltyPointsPerAed);
          if (pointsM > 0 && ord.customer_id) {
            await db.query(`INSERT INTO loyalty_transactions (customer_id, event_id, order_id, points, reason) VALUES ($1,$2,$3,$4,'Refund reversal')`, [ord.customer_id, ord.event_id, orderId, -pointsM]);
            await db.query(`UPDATE customers SET loyalty_points = GREATEST(0, loyalty_points - $2) WHERE id = $1`, [ord.customer_id, pointsM]);
          }
          // Settle any open cancellation so a "use policy amount" refund doesn't
          // leave it pending forever (mirrors the provider branch).
          await db.query(
            `UPDATE cancellations SET refund_status='processed', processed_at=now(), refund_reference = COALESCE(refund_reference,'manual') WHERE order_id=$1 AND refund_status <> 'processed'`,
            [orderId],
          );
          if (params.cancelEvent) {
            // Return the points / store credit spent on this booking (pro-rated).
            await returnSpentTenders(db, orderId, ord.event_id ?? null, ord.customer_id ?? null, cap > 0 ? toRefund / cap : 0);
          }
          if (params.cancelEvent && ord.event_id) {
            await db.query(`UPDATE inventory_holds SET status = 'released' WHERE order_id = $1`, [orderId]).catch(() => {});
            await db.query(`UPDATE events SET phase = 'Cancelled', updated_at = now() WHERE id = $1`, [ord.event_id]).catch(() => {});
            // A cancelled event must stop emailing the customer — drop its pending
            // notifications (mirrors the provider branch's teardown).
            await db.query(
              `UPDATE notifications SET cancelled_at = now() WHERE event_id = $1 AND sent_at IS NULL AND cancelled_at IS NULL AND template NOT IN ('refund_processed')`,
              [ord.event_id],
            ).catch(() => {});
          }
        } catch {
          await db.query('ROLLBACK TO SAVEPOINT manual_refund_side');
        }
        return { ok: true, status, refundedFils: already + toRefund };
      }
      if (!payment.provider_payment_id) return { ok: false, error: 'no_provider_payment' };
      if (payment.status !== 'paid' && payment.status !== 'captured' && payment.status !== 'partially_refunded') {
        return { ok: false, error: 'not_refundable' };
      }
      const cap = Number(payment.amount_fils);
      const provider = getProvider(payment.provider);

      // Reconcile against the PROVIDER's own refunded total before moving money.
      // If a previous attempt refunded at the provider but our books rolled back
      // (e.g. a commit failed), the provider already shows it — so we neither
      // double-refund on a dashboard retry nor trust a stale DB figure. This also
      // fixes equal-value partial refunds that a provider idempotency key would
      // otherwise silently swallow while our books counted both.
      const pre = await provider.retrievePayment(payment.provider_payment_id).catch(() => null);
      const dbRefunded = Number(payment.refunded_fils);
      const alreadyRefunded = Math.max(dbRefunded, Number(pre?.refundedFils ?? 0));
      const toRefund = Math.min(amountFils, cap - alreadyRefunded);

      if (toRefund <= 0) {
        // Nothing left to move. If the provider is ahead of our books (a prior
        // attempt's money moved but the commit failed), reconcile the books to
        // the provider truth WITHOUT moving money or writing a duplicate refunds
        // row — so a retry is a safe no-op, never a second refund.
        if (alreadyRefunded > dbRefunded) {
          const status: 'refunded' | 'partially_refunded' = alreadyRefunded >= cap ? 'refunded' : 'partially_refunded';
          await db.query(`UPDATE payments SET status = $2, refunded_fils = $3, updated_at = now() WHERE id = $1`, [payment.id, status, alreadyRefunded]);
          await db.query(`UPDATE orders SET status = $2, updated_at = now() WHERE id = $1`, [orderId, orderStatusFor(status)]);
          return { ok: true, status, refundedFils: alreadyRefunded };
        }
        return { ok: false, error: 'nothing_to_refund' };
      }

      // Idempotency: a double-click / retry that lands an identical refund in the
      // same breath is a safe no-op — never move money, record, or email twice.
      const dup = (await db.query<{ id: string }>(
        `SELECT id FROM refunds WHERE order_id=$1 AND amount_fils=$2 AND COALESCE(item_label,'')=COALESCE($3,'') AND created_at > now() - interval '60 seconds' LIMIT 1`,
        [orderId, toRefund, itemLabel],
      )).rows[0];
      if (dup) {
        const status: 'refunded' | 'partially_refunded' = (alreadyRefunded + toRefund) >= cap ? 'refunded' : 'partially_refunded';
        return { ok: true, status, refundedFils: alreadyRefunded + toRefund };
      }

      // Money moves here, under the lock.
      const verified = await provider.refund(payment.provider_payment_id, toRefund, reason);

      // Prefer the provider's authoritative post-refund total; never record less
      // than what we know moved.
      const refundedTotal = Math.max(alreadyRefunded + toRefund, Number(verified.refundedFils ?? 0));
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
                              provider_reference, created_by, item_label)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [orderId, payment.event_id, payment.customer_id, toRefund, reasonCategory,
         reason, !!params.cancelEvent, verified.providerStatus ?? null, createdBy, itemLabel],
      );

      // Everything below is a best-effort SIDE-EFFECT: the receipt reflection,
      // cancellation settle, finance task, notifications, loyalty reversal, and —
      // only if asked — the event teardown. The money already moved and is
      // recorded in `payments` + `refunds` above. Wrap it ALL in one SAVEPOINT so
      // any failure here rolls back only these extras and can NEVER revert the
      // refund itself — otherwise a rollback would let a dashboard retry refund
      // the customer a SECOND time.
      await db.query('SAVEPOINT refund_side_effects');
      try {
        // Reflect the refund on the order's sales receipt (returned item + new net).
        await db.query(
          `UPDATE finance_receipts
              SET refunded_fils = refunded_fils + $2,
                  refunded_items = refunded_items || $3::jsonb
            WHERE order_id = $1`,
          [orderId, toRefund, JSON.stringify([{ label: itemLabel, amountFils: toRefund, reasonCategory, at: new Date().toISOString() }])],
        );

      // Settle any recorded customer cancellation (if this refund is one).
      await db.query(
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
      // One order-keyed email row. The customer WhatsApp sweep sends off the SAME
      // row (stamping whatsapp_sent_at), deciding apology vs plain by reason.
      // Drop any still-unsent earlier refund email for this order so two refunds
      // before the sweep don't email twice — the new row carries the cumulative
      // receipt figures, so the latest single email is correct.
      await db.query(
        `UPDATE notifications SET cancelled_at = now() WHERE template='refund_processed' AND sent_at IS NULL AND cancelled_at IS NULL AND payload->>'orderId' = $1`,
        [orderId],
      );
      await db.query(
        `INSERT INTO notifications (event_id, channel, template, scheduled_for, payload)
         VALUES ($1,'email','refund_processed', now(), $2)`,
        [payment.event_id ?? null, JSON.stringify({ orderId, amountFils: toRefund, reference: verified.providerStatus ?? null, reasonCategory, itemLabel })],
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
        // Return the points / store credit spent on this booking (pro-rated).
        await returnSpentTenders(db, orderId, payment.event_id ?? null, payment.customer_id ?? null, cap > 0 ? toRefund / cap : 0);
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
        await db.query('RELEASE SAVEPOINT refund_side_effects');
      } catch (sideErr) {
        // The refund + its ledger record are already committed above; only these
        // extras rolled back. Never rethrow — that would revert the refund.
        await db.query('ROLLBACK TO SAVEPOINT refund_side_effects').catch(() => {});
        console.error('[refund] side-effects failed (the refund itself is recorded & safe):', (sideErr as Error).message);
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
