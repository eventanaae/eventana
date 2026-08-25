/**
 * Ad attribution — joining a paid order back to the ad that produced it.
 *
 * The app stores where a visitor came from on `orders.attribution`; this
 * reads it once the money is confirmed and reports the Purchase to Meta.
 * Kept out of webhooks.ts so the payment path stays about payments, and so
 * the reconciliation sweep can reuse the exact same call.
 */
import { pool } from '../db/pool.js';
import { sendPurchaseEvent, metaCapiEnabled, type Attribution } from '../integrations/metaCapi.js';
import { recordPaymentEvent } from './orders.js';

/**
 * Posts one Purchase for a paid order.
 *
 * Never throws: attribution reporting is bookkeeping for the ad account,
 * and nothing about a confirmed booking may depend on it. Outcomes land in
 * the payment_events audit log so a silent failure is still visible.
 */
export async function reportPurchaseToMeta(orderId: string): Promise<void> {
  if (!metaCapiEnabled()) return;

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

    // A tip is money for the crew, not revenue from an ad — reporting it as
    // a Purchase would teach Meta to optimise for the wrong thing.
    if (order.kind === 'tip') return;

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
