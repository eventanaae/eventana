/**
 * Ad attribution — joining a paid order back to the ad that produced it.
 *
 * The app stores where a visitor came from on `orders.attribution`; this
 * reads it once the money is confirmed and reports the Purchase to Meta.
 * Kept out of webhooks.ts so the payment path stays about payments, and so
 * the reconciliation sweep can reuse the exact same call.
 */
import { pool } from '../db/pool.js';
import { sendPurchaseEvent, sendRegistrationEvent, sendMetaEvent, metaCapiEnabled, type Attribution } from '../integrations/metaCapi.js';
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

/**
 * Reports a sale entered in the Ops dashboard (a WhatsApp booking) to Meta as
 * a Purchase, so the ad account learns which people actually book — almost
 * every Eventana sale is closed on WhatsApp, never through the website.
 *
 * Owner rules: every booking comes from Meta ads EXCEPT the Eventana Exclusive
 * Package (Carnival/Carnaval Offer, 3499/3500 Offer, Marwa Rateb) and the
 * owner's own 2900/2999 WhatsApp offers — those are never reported.
 * App/website orders (order_id set) are already reported by reportPurchaseToMeta.
 *
 * Only a SHA-256 hash of the phone/name leaves the server (see metaCapi.ts).
 * Best-effort, never throws; a no-op until META_PIXEL_ID + token are set.
 */
const NON_META_LINE = /(exclusive|carn[ai]v[ae]l|349[89]|3500|marwa|مروة|2900|2999)/i;

export async function reportReceiptToMeta(receiptId: string | number): Promise<void> {
  try {
    if (!metaCapiEnabled()) return;
    const { rows } = await pool.query(
      `SELECT r.id, r.number, r.total_fils, r.refunded_fils, r.order_id, r.source, r.line_items,
              r.customer_name, r.created_at, hc.phone, hc.email
         FROM finance_receipts r
         LEFT JOIN historical_customers hc ON hc.id = r.customer_id
        WHERE r.id = $1`,
      [receiptId],
    );
    const r = rows[0];
    if (!r) return;
    if (r.order_id) return; // app order: reported on payment confirmation
    if (r.source === 'quickbooks') return; // historical import, not a live sale
    const items: any[] = Array.isArray(r.line_items) ? r.line_items : [];
    if (items.some((li) => NON_META_LINE.test(String(li?.name ?? '')))) return;
    const value = Number(r.total_fils) - Number(r.refunded_fils ?? 0);
    if (!(value > 0)) return;
    if (!r.phone && !r.email) return; // nothing Meta could match on

    const result = await sendMetaEvent({
      eventName: 'Purchase',
      eventId: `receipt-${r.number}`,
      valueFils: value,
      currency: 'AED',
      occurredAt: new Date(r.created_at),
      customer: { name: r.customer_name, phone: r.phone, email: r.email },
      actionSource: 'chat',
      kind: 'whatsapp_booking',
    });
    console.log(`[meta-capi] receipt ${r.number}: ${result.ok ? `reported (${result.eventsReceived ?? 0})` : `failed ${result.error ?? ''}`}`);
  } catch (err) {
    console.error('[meta-capi] receipt report threw:', (err as Error).message.slice(0, 200));
  }
}
