/**
 * Orders, payment records and the payment state machine.
 *
 * The invariant enforced here: an order's status only ever advances to
 * `paid` from a provider-confirmed payment transition. Nothing in the
 * customer-facing API can set it.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { PoolClient } from 'pg';
import type { OrderStatus, PaymentStatus, ProviderName, Quote } from '@eventana/shared';
import { pool, type Db } from '../db/pool.js';
import { config } from '../config.js';

/**
 * An unguessable, stateless token for reading an order's public status. Order
 * ids are a visible sequence, so the status endpoint requires this HMAC (in the
 * provider return URL) to stop anyone enumerating other people's orders.
 */
export function orderViewToken(orderId: string): string {
  return createHmac('sha256', config.staffToken).update(`order-view:${orderId}`).digest('base64url').slice(0, 16);
}

/** Constant-time check of a supplied order-view token. */
export function orderViewTokenValid(orderId: string, token: string | undefined): boolean {
  if (!token) return false;
  const expected = orderViewToken(orderId);
  const a = Buffer.from(expected);
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function nextOrderId(db: Db): Promise<string> {
  const { rows } = await db.query<{ n: number }>(`SELECT nextval('order_ref_seq')::int AS n`);
  return `EVT-ORD-${String(rows[0].n).padStart(6, '0')}`;
}

export async function nextEventId(db: Db, year = new Date().getUTCFullYear()): Promise<string> {
  const { rows } = await db.query<{ n: number }>(`SELECT nextval('event_ref_seq')::int AS n`);
  return `EV-${year}-${String(rows[0].n).padStart(4, '0')}`;
}

/* ------------------------------------------------------------------ */
/* Payment state machine                                               */
/* ------------------------------------------------------------------ */

/**
 * Terminal statuses. Once a payment reaches one of these, a webhook
 * carrying a NON-terminal status is ignored — providers can and do
 * deliver out of order (spec §6.3).
 */
const TERMINAL: PaymentStatus[] = [
  'paid',
  'captured',
  'failed',
  'cancelled',
  'refunded',
  'partially_refunded',
];

/** Ranks a status so a later, weaker update cannot walk the state back. */
const RANK: Record<PaymentStatus, number> = {
  created: 0,
  processing: 1,
  needs_review: 2,
  failed: 3,
  cancelled: 3,
  paid: 4,
  captured: 5,
  partially_refunded: 6,
  refunded: 6,
};

export function isTerminal(status: PaymentStatus): boolean {
  return TERMINAL.includes(status);
}

/**
 * Whether `next` may be applied on top of `current`.
 *
 * `closed` arriving before `authorized` (test plan case 5) is handled by
 * rank: captured outranks paid, so the pair settles on captured whichever
 * order they land in, and a stale `processing` after either is dropped.
 */
export function canTransition(current: PaymentStatus, next: PaymentStatus): boolean {
  if (current === next) return false;
  // A confirmed payment can still move to a refund state; it can never go
  // back to processing or fail.
  if (isTerminal(current) && !isTerminal(next)) return false;
  if ((current === 'failed' || current === 'cancelled') && (next === 'paid' || next === 'captured')) {
    // A success after a recorded failure is real (a retry on the same
    // provider payment id) but must be seen by a human before it books.
    return false;
  }
  return RANK[next] > RANK[current] || (isTerminal(next) && next !== current && RANK[next] >= RANK[current]);
}

/** The order status implied by a payment status. */
export function orderStatusFor(payment: PaymentStatus): OrderStatus {
  switch (payment) {
    case 'created':
      return 'awaiting_payment';
    case 'processing':
      return 'processing';
    case 'paid':
    case 'captured':
      return 'paid';
    case 'failed':
      return 'failed';
    case 'cancelled':
      return 'cancelled';
    case 'refunded':
      return 'refunded';
    case 'partially_refunded':
      return 'partially_refunded';
    case 'needs_review':
      return 'needs_review';
  }
}

/* ------------------------------------------------------------------ */
/* Writes                                                              */
/* ------------------------------------------------------------------ */

export interface CreateOrderInput {
  id: string;
  kind: 'booking' | 'addon' | 'tip' | 'shop' | 'invoice_pay';
  customerId: string;
  eventId?: string | null;
  totalFils: number;
  cart: unknown;
  quote: Quote | unknown;
  idempotencyKey?: string | null;
  /** Ad-click parameters the app captured on landing. Null when absent. */
  attribution?: unknown;
  /** 'app' (default/NULL) or 'manual' (Manager-created WhatsApp order). */
  source?: string | null;
}

export async function createOrder(db: PoolClient, input: CreateOrderInput) {
  const { rows } = await db.query(
    `INSERT INTO orders (id, kind, customer_id, event_id, status, total_fils, cart, quote, idempotency_key, attribution, source)
     VALUES ($1,$2,$3,$4,'awaiting_payment',$5,$6,$7,$8,$9,$10)
     RETURNING *`,
    [
      input.id,
      input.kind,
      input.customerId,
      input.eventId ?? null,
      input.totalFils,
      JSON.stringify(input.cart),
      JSON.stringify(input.quote),
      input.idempotencyKey ?? null,
      input.attribution ? JSON.stringify(input.attribution) : null,
      input.source ?? null,
    ],
  );
  return rows[0];
}

export async function createPayment(
  db: Db,
  input: {
    id: string;
    orderId: string;
    provider: ProviderName;
    amountFils: number;
    providerPaymentId?: string | null;
    checkoutUrl?: string | null;
    raw?: unknown;
  },
) {
  const { rows } = await db.query(
    `INSERT INTO payments (id, order_id, provider, provider_payment_id, status, amount_fils, checkout_url, raw)
     VALUES ($1,$2,$3,$4,'created',$5,$6,$7)
     RETURNING *`,
    [
      input.id,
      input.orderId,
      input.provider,
      input.providerPaymentId ?? null,
      input.amountFils,
      input.checkoutUrl ?? null,
      input.raw ? JSON.stringify(input.raw) : null,
    ],
  );
  return rows[0];
}

/** Appends to the audit log. Never updates; never deletes. */
export async function recordPaymentEvent(
  db: Db,
  input: {
    paymentId?: string | null;
    orderId?: string | null;
    provider: string;
    oldStatus?: string | null;
    newStatus: string;
    source: 'webhook' | 'poll' | 'api' | 'admin' | 'system';
    providerStatus?: string | null;
    amountFils?: number | null;
    payload?: unknown;
    note?: string | null;
  },
): Promise<void> {
  await db.query(
    `INSERT INTO payment_events
       (payment_id, order_id, provider, old_status, new_status, source, provider_status, amount_fils, payload, note)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [
      input.paymentId ?? null,
      input.orderId ?? null,
      input.provider,
      input.oldStatus ?? null,
      input.newStatus,
      input.source,
      input.providerStatus ?? null,
      input.amountFils ?? null,
      input.payload ? JSON.stringify(input.payload) : null,
      input.note ?? null,
    ],
  );
}

export async function getOrder(db: Db, orderId: string) {
  const { rows } = await db.query(`SELECT * FROM orders WHERE id = $1`, [orderId]);
  return rows[0] ?? null;
}

export async function getPaymentByProviderRef(
  db: Db,
  provider: string,
  providerPaymentId: string,
) {
  const { rows } = await db.query(
    `SELECT * FROM payments WHERE provider = $1 AND provider_payment_id = $2`,
    [provider, providerPaymentId],
  );
  return rows[0] ?? null;
}

export async function getPaymentForOrder(db: Db, orderId: string) {
  const { rows } = await db.query(
    `SELECT * FROM payments WHERE order_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [orderId],
  );
  return rows[0] ?? null;
}

/**
 * Applies a new payment status, writing the audit row and moving the
 * order with it. Returns whether the transition was applied — callers use
 * `false` to skip the (expensive, side-effect-heavy) confirmation work on
 * a duplicate webhook.
 */
export async function applyPaymentStatus(
  db: PoolClient,
  args: {
    paymentId: string;
    nextStatus: PaymentStatus;
    source: 'webhook' | 'poll' | 'api' | 'admin' | 'system';
    providerStatus?: string | null;
    payload?: unknown;
    capturedFils?: number;
    refundedFils?: number;
    note?: string;
  },
): Promise<{ applied: boolean; payment: any }> {
  // Lock the payment row: two webhook deliveries racing for the same
  // payment serialise here, so exactly one performs the transition.
  const { rows } = await db.query(
    `SELECT * FROM payments WHERE id = $1 FOR UPDATE`,
    [args.paymentId],
  );
  const payment = rows[0];
  if (!payment) throw new Error(`Unknown payment ${args.paymentId}`);

  const current = payment.status as PaymentStatus;
  if (!canTransition(current, args.nextStatus)) {
    await recordPaymentEvent(db, {
      paymentId: payment.id,
      orderId: payment.order_id,
      provider: payment.provider,
      oldStatus: current,
      newStatus: current,
      source: args.source,
      providerStatus: args.providerStatus,
      payload: args.payload,
      note: `Ignored ${args.nextStatus} — not a legal transition from ${current}`,
    });
    return { applied: false, payment };
  }

  const { rows: updated } = await db.query(
    `UPDATE payments
        SET status = $2,
            last_provider_status = COALESCE($3, last_provider_status),
            captured_fils = COALESCE($4, captured_fils),
            refunded_fils = COALESCE($5, refunded_fils),
            raw = COALESCE($6, raw),
            updated_at = now()
      WHERE id = $1
      RETURNING *`,
    [
      payment.id,
      args.nextStatus,
      args.providerStatus ?? null,
      args.capturedFils ?? null,
      args.refundedFils ?? null,
      args.payload ? JSON.stringify(args.payload) : null,
    ],
  );

  await db.query(
    `UPDATE orders SET status = $2, updated_at = now() WHERE id = $1`,
    [payment.order_id, orderStatusFor(args.nextStatus)],
  );

  await recordPaymentEvent(db, {
    paymentId: payment.id,
    orderId: payment.order_id,
    provider: payment.provider,
    oldStatus: current,
    newStatus: args.nextStatus,
    source: args.source,
    providerStatus: args.providerStatus,
    amountFils: payment.amount_fils,
    payload: args.payload,
    note: args.note,
  });

  return { applied: true, payment: updated[0] };
}

/** Flags an order for a human. Used on amount mismatch and late success. */
export async function flagForReview(
  db: Db,
  orderId: string,
  reason: string,
  provider = 'system',
): Promise<void> {
  await db.query(`UPDATE orders SET status = 'needs_review', updated_at = now() WHERE id = $1`, [
    orderId,
  ]);
  await recordPaymentEvent(db, {
    orderId,
    provider,
    newStatus: 'needs_review',
    source: 'system',
    note: reason,
  });
  await db.query(
    `INSERT INTO notifications (event_id, channel, template, scheduled_for, payload)
     VALUES (NULL, 'ops_alert', 'order_needs_review', now(), $1)`,
    [JSON.stringify({ orderId, reason })],
  );
}

export { pool };
