import { randomUUID } from 'node:crypto';
import { pool } from '../src/db/pool.js';
import { startCheckout, type CheckoutRequest } from '../src/domain/checkout.js';
import { getProvider } from '../src/payments/index.js';
import { SimulatedProvider } from '../src/payments/simulated.js';
import { receiveWebhook } from '../src/domain/webhooks.js';

/** A complete, valid cart. Override any field per test. */
export function cart(overrides: Partial<CheckoutRequest['cart']> = {}): CheckoutRequest['cart'] {
  return {
    celebrationType: 'kids',
    packageId: null,
    services: [{ serviceId: 'backdropM', quantity: 1 }],
    themeId: 't32',
    customTheme: false,
    emirate: 'Dubai',
    startTime: '17:00',
    // Each test picks its own date so holds never collide across tests.
    eventDate: '2026-10-10',
    childrenCount: 25,
    address: { area: 'Jumeirah 1', street: 'Beach Rd', villa: 'Villa 12' },
    mapPin: { lat: 25.2048, lng: 55.2708 },
    ...overrides,
  };
}

/**
 * A date no other test in this run has used.
 *
 * Single-unit assets (the Bubbles House, the Ball Pool Slide) are shared
 * across the whole suite, so two tests booking the same date really do
 * conflict — correctly. Each test FILE gets its own module instance and
 * therefore its own counter, so the counter alone is not enough: the
 * base is randomised per file as well, giving every file a distinct
 * stretch of the calendar.
 */
const DAY_MS = 86_400_000;
const BASE = Date.UTC(2030, 0, 1) + Math.floor(Math.random() * 20_000) * DAY_MS;
let dateCounter = 0;

export function uniqueDate(): string {
  dateCounter += 1;
  return new Date(BASE + dateCounter * DAY_MS).toISOString().slice(0, 10);
}

export async function checkout(
  overrides: Partial<CheckoutRequest['cart']> = {},
  opts: { provider?: string; customerId?: string } = {},
) {
  return startCheckout({
    cart: cart({ eventDate: uniqueDate(), ...overrides }),
    customerId: opts.customerId ?? 'CUST-4471',
    provider: opts.provider ?? 'tabby',
  });
}

export function sim(name = 'tabby'): SimulatedProvider {
  const provider = getProvider(name);
  if (!(provider instanceof SimulatedProvider)) {
    throw new Error(`${name} is not in simulated mode; unset its secrets to run the test suite`);
  }
  return provider;
}

/** Extracts the simulated payment id from a checkout result. */
export function paymentIdOf(result: { checkoutUrl: string | null }): string {
  if (!result.checkoutUrl) throw new Error('no checkout url');
  return result.checkoutUrl.split('/').pop()!;
}

/** Delivers a correctly signed webhook, synchronously. */
export async function deliverWebhook(
  providerName: string,
  paymentId: string,
  opts: { signature?: string; body?: unknown } = {},
) {
  const provider = sim(providerName);
  const body = JSON.stringify(opts.body ?? provider.webhookBody(paymentId));
  return receiveWebhook({
    providerName,
    headers: { 'x-eventana-signature': opts.signature ?? provider.webhookSecret },
    rawBody: body,
    async: false,
  });
}

export async function orderRow(orderId: string) {
  const { rows } = await pool.query(`SELECT * FROM orders WHERE id = $1`, [orderId]);
  return rows[0];
}

export async function eventsForOrder(orderId: string) {
  const { rows } = await pool.query(`SELECT * FROM events WHERE order_id = $1`, [orderId]);
  return rows;
}

export async function holdsForOrder(orderId: string) {
  const { rows } = await pool.query(
    `SELECT * FROM inventory_holds WHERE order_id = $1 ORDER BY asset_code`,
    [orderId],
  );
  return rows;
}

export async function auditFor(orderId: string) {
  const { rows } = await pool.query(
    `SELECT * FROM payment_events WHERE order_id = $1 ORDER BY id`,
    [orderId],
  );
  return rows;
}

/** A second customer, so concurrency tests are not self-conflicting. */
export async function ensureCustomer(id: string, phone = `+9715${Math.floor(Math.random() * 1e8)}`) {
  await pool.query(
    `INSERT INTO customers (id, name, phone, email) VALUES ($1,$2,$3,$4)
     ON CONFLICT (id) DO NOTHING`,
    [id, `Test ${id}`, phone, `${randomUUID()}@example.com`],
  );
  return id;
}
