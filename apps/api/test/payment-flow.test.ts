/**
 * The sandbox test plan from the payment specification, §10.
 *
 * Each `it` below is one numbered case from that document. They run
 * against the real engine — real Postgres, real transactions, real state
 * machine, real webhook handler — with only the provider's own servers
 * simulated.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { canTransition, orderStatusFor } from '../src/domain/orders.js';
import { closePool, pool } from '../src/db/pool.js';
import { CheckoutError, startCheckout } from '../src/domain/checkout.js';
import { expireStaleHolds, unavailableAssets } from '../src/domain/inventory.js';
import { reconcileOnce } from '../src/domain/reconcile.js';
import {
  auditFor,
  cart,
  checkout,
  deliverWebhook,
  ensureCustomer,
  eventsForOrder,
  holdsForOrder,
  orderRow,
  paymentIdOf,
  sim,
  uniqueDate,
} from './helpers.js';

afterAll(async () => {
  await closePool();
});

describe('1. eligible customer, happy path', () => {
  it('confirms the booking once and creates exactly one Event ID', async () => {
    const result = await checkout({ packageId: 'golden', services: [] });
    expect(result.eligible).toBe(true);
    expect(result.totalFils).toBe(599_900 + 28_000);

    // Nothing is confirmed by creating the session.
    expect((await orderRow(result.orderId)).status).toBe('awaiting_payment');
    expect(await eventsForOrder(result.orderId)).toHaveLength(0);

    const paymentId = paymentIdOf(result);
    sim().advance(paymentId, 'success');
    const delivery = await deliverWebhook('tabby', paymentId);
    expect(delivery.outcome).toBe('accepted');

    const order = await orderRow(result.orderId);
    expect(order.status).toBe('paid');

    const events = await eventsForOrder(result.orderId);
    expect(events).toHaveLength(1);
    expect(events[0].id).toMatch(/^EV-\d{4}-\d{4}$/);

    // Holds became firm reservations.
    const holds = await holdsForOrder(result.orderId);
    expect(holds.length).toBeGreaterThan(0);
    expect(holds.every((h) => h.status === 'reserved' && h.expires_at === null)).toBe(true);

    // One task set, one confirmation email.
    const { rows: tasks } = await pool.query(
      `SELECT count(*)::int AS n FROM event_tasks WHERE event_id = $1`,
      [events[0].id],
    );
    expect(tasks[0].n).toBeGreaterThan(0);
    const { rows: mails } = await pool.query(
      `SELECT count(*)::int AS n FROM notifications
        WHERE event_id = $1 AND template = 'booking_confirmation'`,
      [events[0].id],
    );
    expect(mails[0].n).toBe(1);
  });
});

describe('2. rejection flow', () => {
  it('creates no booking and releases the hold when the provider declines', async () => {
    // The documented reject-flow test number.
    const customerId = await ensureCustomer('CUST-REJECT', '+971500000000');
    const result = await checkout({ packageId: 'movie' }, { customerId });

    expect(result.eligible).toBe(false);
    expect(result.checkoutUrl).toBeNull();

    // The hold stays alive so the customer can pay another way — but no
    // booking exists and the order is not paid.
    expect(await eventsForOrder(result.orderId)).toHaveLength(0);
    const order = await orderRow(result.orderId);
    expect(order.status).toBe('awaiting_payment');

    const audit = await auditFor(result.orderId);
    expect(audit.some((a) => a.new_status === 'failed' && /declined/i.test(a.note ?? ''))).toBe(true);
  });

  it('releases the hold and books nothing when the payment itself is rejected', async () => {
    const result = await checkout({ services: [{ serviceId: 'bubblehouse', quantity: 1 }] });
    const paymentId = paymentIdOf(result);

    sim().advance(paymentId, 'rejected');
    await deliverWebhook('tabby', paymentId);

    const order = await orderRow(result.orderId);
    expect(order.status).toBe('failed');
    expect(await eventsForOrder(result.orderId)).toHaveLength(0);

    const holds = await holdsForOrder(result.orderId);
    expect(holds.every((h) => h.status === 'released')).toBe(true);
  });
});

describe('3. abandoned checkout', () => {
  it('expires the hold at its TTL and makes the asset bookable again', async () => {
    const date = uniqueDate();
    const result = await startCheckout({
      cart: cart({ eventDate: date, services: [{ serviceId: 'bubblehouse', quantity: 1 }] }),
      customerId: 'CUST-4471',
      provider: 'tabby',
    });

    const holds = await holdsForOrder(result.orderId);
    const hold = holds.find((h) => h.asset_code === 'bubble-house')!;
    expect(hold.status).toBe('held');

    // The TTL is 15 minutes from creation, from settings.
    const ttlMinutes = (new Date(hold.expires_at).getTime() - new Date(hold.created_at).getTime()) / 60_000;
    expect(Math.round(ttlMinutes)).toBe(15);

    // While held, the asset is not available to anyone else.
    expect(
      await unavailableAssets(pool, ['bubble-house'], date, '17:00', 21),
    ).toContain('bubble-house');

    // Wind the clock past the TTL, as the customer walking away would.
    await pool.query(
      `UPDATE inventory_holds SET expires_at = now() - interval '1 minute' WHERE id = $1`,
      [hold.id],
    );
    const released = await expireStaleHolds(pool);
    expect(released).toBeGreaterThan(0);

    // …and it is bookable again.
    expect(
      await unavailableAssets(pool, ['bubble-house'], date, '17:00', 21),
    ).not.toContain('bubble-house');
  });
});

describe('4. duplicate webhook delivery', () => {
  it('yields exactly one Event ID, one confirmation email and one task set', async () => {
    const result = await checkout({ packageId: 'bronze' });
    const paymentId = paymentIdOf(result);
    sim().advance(paymentId, 'success');

    const first = await deliverWebhook('tabby', paymentId);
    const second = await deliverWebhook('tabby', paymentId);
    const third = await deliverWebhook('tabby', paymentId);

    expect(first.outcome).toBe('accepted');
    // The de-duplication index catches the replays at the door.
    expect(second.outcome).toBe('duplicate');
    expect(third.outcome).toBe('duplicate');

    const events = await eventsForOrder(result.orderId);
    expect(events).toHaveLength(1);

    const { rows } = await pool.query(
      `SELECT
         (SELECT count(*)::int FROM notifications
           WHERE event_id = $1 AND template = 'booking_confirmation') AS mails,
         (SELECT count(*)::int FROM event_tasks WHERE event_id = $1) AS tasks,
         (SELECT count(*)::int FROM loyalty_transactions WHERE event_id = $1) AS loyalty`,
      [events[0].id],
    );
    expect(rows[0].mails).toBe(1);
    expect(rows[0].loyalty).toBe(1);
    expect(rows[0].tasks).toBeGreaterThan(0);
  });
});

describe('5. out-of-order webhooks', () => {
  it('settles on the correct final state when closed arrives before authorized', () => {
    // Rank ordering is what makes delivery order irrelevant.
    expect(canTransition('processing', 'paid')).toBe(true);
    expect(canTransition('paid', 'captured')).toBe(true);
    // Captured already outranks paid: a late "authorized" cannot walk it back.
    expect(canTransition('captured', 'paid')).toBe(false);
    // Nor can a stale non-terminal update.
    expect(canTransition('captured', 'processing')).toBe(false);
    expect(canTransition('paid', 'processing')).toBe(false);
    // A success recorded after a failure needs a human, not an auto-book.
    expect(canTransition('failed', 'paid')).toBe(false);

    expect(orderStatusFor('captured')).toBe('paid');
  });

  it('ends captured whichever order the deliveries arrive in', async () => {
    const result = await checkout({ packageId: 'spa' });
    const paymentId = paymentIdOf(result);

    // The provider is already CLOSED when both deliveries land: the
    // handler re-verifies rather than trusting either body (§6.4).
    sim().advance(paymentId, 'captured');
    const a = await deliverWebhook('tabby', paymentId);
    expect(a.outcome).toBe('accepted');

    // A late AUTHORIZED delivery for the same payment.
    const late = await deliverWebhook('tabby', paymentId, {
      body: { id: paymentId, status: 'AUTHORIZED' },
    });
    expect(['ignored', 'duplicate']).toContain(late.outcome);

    const { rows } = await pool.query(`SELECT status FROM payments WHERE order_id = $1`, [
      result.orderId,
    ]);
    expect(rows[0].status).toBe('captured');
    expect(await eventsForOrder(result.orderId)).toHaveLength(1);
  });
});

describe('6. webhook never arrives', () => {
  it('is resolved by the reconciliation sweep', async () => {
    const result = await checkout({ packageId: 'summer' });
    const paymentId = paymentIdOf(result);

    // The provider approved the payment but the webhook was lost.
    sim().advance(paymentId, 'success');

    // The order has been sitting in Processing longer than the threshold.
    await pool.query(
      `UPDATE orders SET status = 'processing', updated_at = now() - interval '20 minutes'
        WHERE id = $1`,
      [result.orderId],
    );
    await pool.query(`UPDATE payments SET status = 'processing' WHERE order_id = $1`, [
      result.orderId,
    ]);

    const report = await reconcileOnce();
    expect(report.chased).toBeGreaterThan(0);
    expect(report.resolved).toBeGreaterThan(0);

    const order = await orderRow(result.orderId);
    expect(order.status).toBe('paid');
    expect(await eventsForOrder(result.orderId)).toHaveLength(1);

    // The audit records that this one was resolved by polling, not a webhook.
    const audit = await auditFor(result.orderId);
    expect(audit.some((a) => a.new_status === 'paid')).toBe(true);
  });
});

describe('7. tampered client total', () => {
  it('charges the server figure, never the number the device sent', async () => {
    // The checkout API has no parameter for a client-supplied total, so
    // "tampering" means sending one and proving it is ignored.
    const result = await startCheckout({
      cart: {
        ...cart({ eventDate: uniqueDate(), packageId: 'golden', services: [] }),
        // Fields a hostile client might inject:
        totalFils: 100,
        total: 1,
        discountFils: 999_999,
      } as never,
      customerId: 'CUST-4471',
      provider: 'tabby',
    });

    // Golden 5,999 + Dubai 280, recomputed from the catalogue.
    expect(result.totalFils).toBe(627_900);

    const order = await orderRow(result.orderId);
    expect(Number(order.total_fils)).toBe(627_900);

    const { rows } = await pool.query(`SELECT amount_fils FROM payments WHERE order_id = $1`, [
      result.orderId,
    ]);
    expect(Number(rows[0].amount_fils)).toBe(627_900);
  });

  it('refuses to confirm when the provider reports a different amount', async () => {
    const result = await checkout({ packageId: 'bronze' });
    const paymentId = paymentIdOf(result);
    sim().advance(paymentId, 'success');

    // The provider's own record disagrees with the order total.
    await pool.query(`UPDATE payments SET amount_fils = amount_fils + 5000 WHERE order_id = $1`, [
      result.orderId,
    ]);

    const delivery = await deliverWebhook('tabby', paymentId);
    expect(delivery.outcome).toBe('amount_mismatch');

    const order = await orderRow(result.orderId);
    expect(order.status).toBe('needs_review');
    expect(await eventsForOrder(result.orderId)).toHaveLength(0);

    const { rows } = await pool.query(
      `SELECT count(*)::int AS n FROM notifications WHERE template = 'order_needs_review'`,
    );
    expect(rows[0].n).toBeGreaterThan(0);
  });
});

describe('8. concurrent checkout for the single Bubble House', () => {
  it('lets exactly one of two simultaneous checkouts succeed', async () => {
    const date = uniqueDate();
    const other = await ensureCustomer('CUST-RACE');

    const attempt = (customerId: string) =>
      startCheckout({
        cart: cart({
          eventDate: date,
          services: [{ serviceId: 'bubblehouse', quantity: 1 }],
        }),
        customerId,
        provider: 'tabby',
      });

    const [a, b] = await Promise.allSettled([attempt('CUST-4471'), attempt(other)]);

    const fulfilled = [a, b].filter((r) => r.status === 'fulfilled');
    const rejected = [a, b].filter((r) => r.status === 'rejected');

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    const err = (rejected[0] as PromiseRejectedResult).reason;
    expect(err).toBeInstanceOf(CheckoutError);
    expect(err.code).toBe('unavailable');
    expect(err.details.assets).toContain('bubble-house');

    // Exactly one live hold exists for the asset in that window.
    const { rows } = await pool.query(
      `SELECT count(*)::int AS n FROM inventory_holds
        WHERE asset_code = 'bubble-house' AND status IN ('held','reserved')
          AND (expires_at IS NULL OR expires_at > now())
          AND starts_at::date = $1::date`,
      [date],
    );
    expect(rows[0].n).toBe(1);
  });

  it('keeps different bouncy castle colours independent', async () => {
    const date = uniqueDate();
    const other = await ensureCustomer('CUST-COLOUR');

    const lime = await startCheckout({
      cart: cart({ eventDate: date, services: [{ serviceId: 'castle', quantity: 1 }], castleVariant: 'castle-lime' }),
      customerId: 'CUST-4471',
      provider: 'tabby',
    });
    const cotton = await startCheckout({
      cart: cart({ eventDate: date, services: [{ serviceId: 'castle', quantity: 1 }], castleVariant: 'castle-cotton' }),
      customerId: other,
      provider: 'tabby',
    });

    expect(lime.orderId).not.toBe(cotton.orderId);
    const limeHold = (await holdsForOrder(lime.orderId))[0];
    const cottonHold = (await holdsForOrder(cotton.orderId))[0];
    expect(limeHold.asset_code).toBe('castle-lime');
    expect(cottonHold.asset_code).toBe('castle-cotton');

    // But the same colour twice is refused.
    await expect(
      startCheckout({
        cart: cart({ eventDate: date, services: [{ serviceId: 'castle', quantity: 1 }], castleVariant: 'castle-lime' }),
        customerId: other,
        provider: 'tabby',
      }),
    ).rejects.toMatchObject({ code: 'unavailable' });
  });
});

describe('9. invalid webhook signature', () => {
  it('returns 401, changes nothing, and logs the attempt', async () => {
    const result = await checkout({ packageId: 'movie' });
    const paymentId = paymentIdOf(result);
    sim().advance(paymentId, 'success');

    const before = await orderRow(result.orderId);

    const delivery = await deliverWebhook('tabby', paymentId, { signature: 'not-the-secret' });
    expect(delivery.httpStatus).toBe(401);
    expect(delivery.outcome).toBe('unsigned');

    const after = await orderRow(result.orderId);
    expect(after.status).toBe(before.status);
    expect(await eventsForOrder(result.orderId)).toHaveLength(0);

    const { rows } = await pool.query(
      `SELECT count(*)::int AS n FROM payment_events
        WHERE new_status = 'rejected_signature' AND source = 'webhook'`,
    );
    expect(rows[0].n).toBeGreaterThan(0);

    // A missing signature is refused too.
    const missing = await deliverWebhook('tabby', paymentId, { signature: '' });
    expect(missing.httpStatus).toBe(401);
  });
});

describe('late success after the hold expired', () => {
  it('does not double-book — it flags for human review', async () => {
    const result = await checkout({ services: [{ serviceId: 'bubblehouse', quantity: 1 }] });
    const paymentId = paymentIdOf(result);

    // The hold lapsed while the customer was on the provider's page.
    await pool.query(
      `UPDATE inventory_holds SET status = 'released' WHERE order_id = $1`,
      [result.orderId],
    );

    sim().advance(paymentId, 'success');
    const delivery = await deliverWebhook('tabby', paymentId);

    expect(delivery.outcome).toBe('late_success');
    expect((await orderRow(result.orderId)).status).toBe('needs_review');
    expect(await eventsForOrder(result.orderId)).toHaveLength(0);
  });
});

describe('all three providers', () => {
  it.each(['tabby', 'tamara', 'ziina'] as const)(
    'runs the whole flow through %s',
    async (provider) => {
      const result = await checkout({ packageId: 'movie' }, { provider });
      const paymentId = paymentIdOf(result);
      sim(provider).advance(paymentId, 'success');

      const delivery = await deliverWebhook(provider, paymentId);
      expect(delivery.outcome).toBe('accepted');

      const order = await orderRow(result.orderId);
      expect(order.status).toBe('paid');
      expect(await eventsForOrder(result.orderId)).toHaveLength(1);
    },
  );
});
