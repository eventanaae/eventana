/**
 * The /api/checkout route itself (not just startCheckout): what the app sends
 * must survive the request schema. "I'll pin the location later" (locationTbd)
 * used to be stripped by zod, so every such booking was refused for a missing
 * map pin with a bare "This booking cannot be completed yet."
 */
import { afterAll, describe, expect, it } from 'vitest';
import { closePool } from '../src/db/pool.js';
import { issueCustomerToken } from '../src/domain/customerAuth.js';
import { cart, uniqueDate } from './helpers.js';

afterAll(async () => {
  await closePool();
});

async function app() {
  const { publicRoutes } = await import('../src/routes/public.js');
  const Fastify = (await import('fastify')).default;
  const a = Fastify();
  await a.register(publicRoutes);
  return a;
}

async function post(a: Awaited<ReturnType<typeof app>>, c: Record<string, unknown>) {
  return a.inject({
    method: 'POST',
    url: '/api/checkout',
    headers: { authorization: `Bearer ${issueCustomerToken('CUST-4471')}` },
    payload: { cart: c, provider: 'tabby', termsAccepted: true },
  });
}

describe('POST /api/checkout', () => {
  it('books with no map pin when the customer will pin the location later', async () => {
    const a = await app();
    const res = await post(a, { ...cart({ eventDate: uniqueDate() }), mapPin: null, locationTbd: true });
    expect(res.statusCode).toBe(200);
    expect(res.json().orderId).toBeTruthy();
  });

  it('names the reason when the map pin is missing', async () => {
    const a = await app();
    const res = await post(a, { ...cart({ eventDate: uniqueDate() }), mapPin: null });
    expect(res.statusCode).toBe(422);
    const body = res.json();
    expect(body.error).toBe('not_bookable');
    expect(body.message).toMatch(/map pin/i);
    expect(body.details.problems[0].code).toBe('missing_map_pin');
  });
});
