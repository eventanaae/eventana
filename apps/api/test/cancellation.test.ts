/**
 * Cancelled-event rules.
 *
 * Once an event is cancelled it is frozen for the customer: live tracking
 * stops, and no post-booking purchase or self-service location change is
 * accepted. These assert the API half; the app hides the controls, but
 * the refusal lives here so a stale client cannot get around it.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { isCancelled } from '@eventana/shared';
import { closePool, pool } from '../src/db/pool.js';
import { CheckoutError, startAddonCheckout } from '../src/domain/checkout.js';
import { checkout, deliverWebhook, eventsForOrder, paymentIdOf, sim } from './helpers.js';

afterAll(async () => {
  await closePool();
});

/** Books an event for real, then cancels it the way the dashboard does. */
async function bookThenCancel(reason = 'Customer requested cancellation') {
  const result = await checkout({ packageId: 'golden', services: [] });
  const paymentId = paymentIdOf(result);
  sim().advance(paymentId, 'success');
  await deliverWebhook('tabby', paymentId);

  const [event] = await eventsForOrder(result.orderId);
  expect(event).toBeTruthy();

  await pool.query(
    `UPDATE events SET phase = 'Cancelled', eta = NULL, cancelled_at = now(), cancellation_reason = $2
      WHERE id = $1`,
    [event.id, reason],
  );
  await pool.query(
    `UPDATE inventory_holds SET status = 'released' WHERE event_id = $1`,
    [event.id],
  );
  return { orderId: result.orderId, eventId: event.id as string };
}

describe('the cancelled phase', () => {
  it('is recognised by one shared predicate', () => {
    expect(isCancelled('Cancelled')).toBe(true);
    expect(isCancelled('Booking Confirmed')).toBe(false);
    expect(isCancelled('Event Completed')).toBe(false);
    expect(isCancelled(null)).toBe(false);
  });
});

describe('a cancelled event', () => {
  it('suppresses live tracking and offers nothing to buy', async () => {
    const { eventId } = await bookThenCancel();

    // Prove the ETA is suppressed even when one is still stored.
    await pool.query(`UPDATE events SET eta = '4:35 PM' WHERE id = $1`, [eventId]);

    const { eventRoutes } = await import('../src/routes/events.js');
    const Fastify = (await import('fastify')).default;
    const app = Fastify();
    await app.register(eventRoutes);

    const res = await app.inject({
      method: 'GET',
      url: `/api/events/${eventId}`,
      headers: { 'x-customer-id': 'CUST-4471' },
    });
    const body = res.json();

    expect(body.cancelled).toBe(true);
    expect(body.phase).toBe('Cancelled');
    expect(body.eta).toBeNull();
    expect(body.addOns.maxExtraHours).toBe(0);
    expect(body.addOns.socks).toBeNull();
    expect(body.addOns.extraServings).toEqual([]);

    await app.close();
  });

  it('refuses an additional hour, socks and extra servings', async () => {
    const { eventId } = await bookThenCancel();

    await expect(
      startAddonCheckout({
        eventId,
        customerId: 'CUST-4471',
        provider: 'tabby',
        request: { additionalHours: 1, socksPairs: 0, extraServings: {} },
      }),
    ).rejects.toMatchObject({ code: 'event_cancelled' });

    await expect(
      startAddonCheckout({
        eventId,
        customerId: 'CUST-4471',
        provider: 'tabby',
        request: { additionalHours: 0, socksPairs: 25, extraServings: {} },
      }),
    ).rejects.toBeInstanceOf(CheckoutError);

    await expect(
      startAddonCheckout({
        eventId,
        customerId: 'CUST-4471',
        provider: 'tabby',
        request: { additionalHours: 0, socksPairs: 0, extraServings: { popcorn: 2 } },
      }),
    ).rejects.toMatchObject({ code: 'event_cancelled' });

    // Nothing was charged and no add-on order exists.
    const { rows } = await pool.query(
      `SELECT count(*)::int AS n FROM orders WHERE event_id = $1 AND kind = 'addon'`,
      [eventId],
    );
    expect(rows[0].n).toBe(0);
  });

  it('refuses self-service location and placement changes', async () => {
    const { eventId } = await bookThenCancel();

    const { eventRoutes } = await import('../src/routes/events.js');
    const Fastify = (await import('fastify')).default;
    const app = Fastify();
    await app.register(eventRoutes);

    const quoteRes = await app.inject({
      method: 'POST',
      url: `/api/events/${eventId}/addons/quote`,
      headers: { 'x-customer-id': 'CUST-4471' },
      payload: { additionalHours: 1, socksPairs: 0, extraServings: {} },
    });
    expect(quoteRes.statusCode).toBe(409);
    expect(quoteRes.json().error).toBe('event_cancelled');

    const photoRes = await app.inject({
      method: 'POST',
      url: `/api/events/${eventId}/setup-photos`,
      headers: { 'x-customer-id': 'CUST-4471' },
      payload: { itemKey: 'backdrop', description: 'move it to the garden' },
    });
    expect(photoRes.statusCode).toBe(409);
    expect(photoRes.json().error).toBe('event_cancelled');

    await app.close();
  });

  it('still lets a live event buy the same things', async () => {
    // The guard must be specific to cancellation, not a blanket block.
    const result = await checkout({ packageId: 'golden', services: [] });
    const paymentId = paymentIdOf(result);
    sim().advance(paymentId, 'success');
    await deliverWebhook('tabby', paymentId);
    const [event] = await eventsForOrder(result.orderId);

    const addon = await startAddonCheckout({
      eventId: event.id,
      customerId: 'CUST-4471',
      provider: 'tabby',
      request: { additionalHours: 1, socksPairs: 25, extraServings: {} },
    });
    expect(addon.orderId).toBeTruthy();
    expect(addon.totalFils).toBe(80_000 + 25 * 1_200);
  });
});
