/**
 * Ad attribution — joining a paid order back to the ad that produced it.
 *
 * The app stores where a visitor came from on `orders.attribution`; this
 * reads it once the money is confirmed and reports the Purchase to Meta.
 * Kept out of webhooks.ts so the payment path stays about payments, and so
 * the reconciliation sweep can reuse the exact same call.
 */
import { pool } from '../db/pool.js';
import { sendPurchaseEvent, sendRegistrationEvent, metaCapiEnabled, type Attribution } from '../integrations/metaCapi.js';
import { recordPaymentEvent } from './orders.js';
import { linkOrderToLead } from './whatsappLeads.js';

/**
 * Reports a new customer account to Meta as CompleteRegistration — the middle
 * of the funnel, so the ad account can optimise for sign-ups, not only paid
 * bookings. Best-effort and never throws. `event_id` is de-duplicated with the
 * browser pixel's own CompleteRegistration.
 */
export async function reportRegistrationToMeta(
  customer: { id: string; name?: string | null; phone?: string | null; email?: string | null },
  attribution?: Attribution | null,
): Promise<void> {
  try {
    if (!metaCapiEnabled()) return;
    await sendRegistrationEvent({
      customerId: customer.id,
      customer: { name: customer.name, phone: customer.phone, email: customer.email },
      attribution: attribution ?? null,
    });
  } catch { /* analytics must never affect registration */ }
}

/**
 * Closes the loop on a paid order: marks the WhatsApp lead as booked, and
 * posts the Purchase to Meta.
 *
 * The lead link happens even when Meta CAPI is unconfigured — knowing which
 * enquiry turned into money is worth having on its own, and is what makes
 * "cost per booking" computable at all.
 *
 * Never throws: this is bookkeeping, and nothing about a confirmed booking
 * may depend on it. Outcomes land in the payment_events audit log so a
 * silent failure is still visible.
 */
export async function reportPurchaseToMeta(orderId: string): Promise<void> {
  try {
    const { rows } = await pool.query(
      `SELECT o.id, o.kind, o.total_fils, o.attribution,
              c.name AS customer_name, c.phone AS customer_phone, c.email AS customer_email
         FROM orders o
         JOIN customers c ON c.id = o.customer_id
        WHERE o.id = $1`,
      [orderId],
    );
    const order = rows[0];
    if (!order) return;

    // Close the loop on the WhatsApp side too: the enquiry that started on
    // an ad and the money that arrived here are the same person.
    if (order.customer_phone) {
      await linkOrderToLead(order.id, order.customer_phone).catch(() => {});
    }

    // A tip is money for the crew, not revenue from an ad — reporting it as
    // a Purchase would teach Meta to optimise for the wrong thing.
    if (order.kind === 'tip') return;
    if (!metaCapiEnabled()) return;

    const result = await sendPurchaseEvent({
      orderId: order.id,
      valueFils: Number(order.total_fils),
      currency: 'AED',
      kind: order.kind,
      customer: {
        name: order.customer_name,
        phone: order.customer_phone,
        email: order.customer_email,
      },
      attribution: (order.attribution ?? null) as Attribution | null,
    });

    await recordPaymentEvent(pool, {
      orderId: order.id,
      provider: 'meta_capi',
      newStatus: result.ok ? 'reported' : 'report_failed',
      source: 'system',
      note: result.ok
        ? `Purchase reported to Meta (${result.eventsReceived ?? 0} received)`
        : `Meta CAPI: ${result.error ?? 'unknown error'}`,
    });
  } catch (err) {
    // Last resort — never let this bubble into the payment path.
    await recordPaymentEvent(pool, {
      orderId,
      provider: 'meta_capi',
      newStatus: 'report_failed',
      source: 'system',
      note: `Meta CAPI threw: ${(err as Error).message.slice(0, 200)}`,
    }).catch(() => {});
  }
}
