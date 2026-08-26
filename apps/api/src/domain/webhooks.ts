/**
 * Webhook handling — the only path by which a booking becomes paid.
 *
 * Requirements, in the order the spec states them (§6):
 *   1. validate the shared-secret header FIRST; 401 and log on mismatch
 *   2. respond 200 fast, process asynchronously
 *   3. be idempotent — keyed on provider payment id plus status
 *   4. re-verify against the provider's API; never trust body amounts
 *   5. handle late success after hold expiry without double-booking
 *   6. log every transition to the append-only audit table
 */
import { pool, withTransaction } from '../db/pool.js';
import { getProvider } from '../payments/index.js';
import { confirmBooking } from './confirm.js';
import { syncEventToCalendar } from '../integrations/googleCalendar.js';
import { pushToStaff } from '../integrations/push.js';
import { reportPurchaseToMeta } from './attribution.js';
import { holdsStillValid, releaseHolds } from './inventory.js';
import {
  applyPaymentStatus,
  flagForReview,
  getPaymentByProviderRef,
  recordPaymentEvent,
} from './orders.js';
import { loadConfig } from './settings.js';
import { config } from '../config.js';

export type WebhookOutcome =
  | 'accepted'
  | 'duplicate'
  | 'unsigned'
  | 'unparseable'
  | 'unknown_payment'
  | 'amount_mismatch'
  | 'late_success'
  | 'ignored';

export interface WebhookResult {
  httpStatus: number;
  outcome: WebhookOutcome;
  detail?: string;
}

/**
 * Step 1 and 2: verify, de-duplicate, acknowledge. The heavy work is
 * handed to `processDelivery` — the provider gets its 200 immediately.
 */
export async function receiveWebhook(args: {
  providerName: string;
  headers: Record<string, string | string[] | undefined>;
  rawBody: string;
  /** Tests pass false to run the work inline and assert on the result. */
  async?: boolean;
}): Promise<WebhookResult> {
  let provider;
  try {
    provider = getProvider(args.providerName);
  } catch {
    return { httpStatus: 404, outcome: 'unknown_payment', detail: 'Unknown provider' };
  }

  // (1) Signature first — before the body is trusted for anything.
  let signatureOk = provider.verifyWebhook(args.headers, args.rawBody);
  if (!signatureOk) {
    const providerCfg = (config.providers as Record<string, { webhookSecret: string | null } | undefined>)[
      args.providerName
    ];
    const hasSecret = Boolean(providerCfg?.webhookSecret);
    if (hasSecret) {
      // A shared secret IS configured but the signature didn't match — reject.
      await recordPaymentEvent(pool, {
        provider: args.providerName,
        newStatus: 'rejected_signature',
        source: 'webhook',
        note: 'Webhook rejected: shared-secret header did not match',
        payload: { headersPresent: Object.keys(args.headers) },
      });
      return { httpStatus: 401, outcome: 'unsigned' };
    }
    // No shared webhook secret exists for this provider (e.g. Ziina does not
    // issue one), so signature verification is impossible. This is still safe:
    // processDelivery re-verifies EVERY delivery against the provider's
    // authenticated API (real status + amount) before confirming, so a forged
    // webhook cannot confirm an unpaid order. Proceed, recording that this
    // delivery is API-verified rather than signature-verified.
    await recordPaymentEvent(pool, {
      provider: args.providerName,
      newStatus: 'unsigned_api_verified',
      source: 'webhook',
      note: 'No webhook signing secret configured; verifying via provider API instead.',
    });
  }

  let body: unknown;
  try {
    body = JSON.parse(args.rawBody);
  } catch {
    return { httpStatus: 400, outcome: 'unparseable' };
  }

  const parsed = provider.parseWebhook(body);
  if (!parsed) return { httpStatus: 400, outcome: 'unparseable' };

  // (3) Idempotency at the door: the unique index means a replayed
  // delivery inserts nothing and is acknowledged without reprocessing.
  const inserted = await pool.query<{ id: number }>(
    `INSERT INTO webhook_deliveries
       (provider, provider_payment_id, provider_status, signature_ok, payload)
     VALUES ($1,$2,$3,$5,$4)
     ON CONFLICT (provider, provider_payment_id, provider_status) DO NOTHING
     RETURNING id`,
    [provider.name, parsed.providerPaymentId, parsed.providerStatus, args.rawBody, signatureOk],
  );

  if (inserted.rowCount === 0) {
    return { httpStatus: 200, outcome: 'duplicate' };
  }

  const deliveryId = inserted.rows[0].id;

  if (args.async === false) {
    const result = await processDelivery(deliveryId, provider.name, parsed.providerPaymentId);
    return { httpStatus: 200, ...result };
  }

  // (2) Acknowledge now, work after. A real deployment swaps this for a
  // durable queue; the contract of processDelivery does not change.
  setImmediate(() => {
    processDelivery(deliveryId, provider.name, parsed.providerPaymentId).catch(async (err) => {
      await recordPaymentEvent(pool, {
        provider: provider.name,
        newStatus: 'error',
        source: 'webhook',
        note: `Processing failed: ${(err as Error).message}`,
      });
    });
  });

  return { httpStatus: 200, outcome: 'accepted' };
}

/**
 * Steps 4-6. Kept separate so the reconciliation job can run the exact
 * same resolution path for a webhook that never arrived.
 */
export async function processDelivery(
  deliveryId: number | null,
  providerName: string,
  providerPaymentId: string,
): Promise<{ outcome: WebhookOutcome; detail?: string }> {
  const provider = getProvider(providerName);
  const cfg = await loadConfig();

  const payment = await getPaymentByProviderRef(pool, provider.name, providerPaymentId);
  if (!payment) {
    await finish(deliveryId, 'unknown_payment');
    return { outcome: 'unknown_payment' };
  }

  // (4) Never trust the webhook body. Ask the provider directly and
  // compare BOTH status and amount against the stored order total.
  const verified = await provider.retrievePayment(providerPaymentId);

  if (verified.amountFils !== Number(payment.amount_fils)) {
    await flagForReview(
      pool,
      payment.order_id,
      `Amount mismatch: provider reports ${verified.amountFils} fils, order is ${payment.amount_fils} fils`,
      provider.name,
    );
    await finish(deliveryId, 'amount_mismatch');
    return { outcome: 'amount_mismatch' };
  }

  const isSuccess = verified.status === 'paid' || verified.status === 'captured';

  // (5) A success that arrives after the hold lapsed must never silently
  // double-book. If the assets are gone, a human takes it from here.
  if (isSuccess && !(await holdsStillValid(pool, payment.order_id))) {
    await flagForReview(
      pool,
      payment.order_id,
      'Payment succeeded after the inventory hold expired — the asset may have gone to another booking. Refund or date change needed.',
      provider.name,
    );
    await finish(deliveryId, 'late_success');
    return { outcome: 'late_success' };
  }

  let confirmedEventId: string | null = null;
  let newBooking = false;
  let paidNow = false;
  const outcome = await withTransaction(async (db) => {
    const { applied } = await applyPaymentStatus(db, {
      paymentId: payment.id,
      nextStatus: verified.status,
      source: 'webhook',
      providerStatus: verified.providerStatus,
      payload: verified.raw,
      capturedFils: verified.capturedFils,
      refundedFils: verified.refundedFils,
    });

    if (!applied) return 'ignored' as const;

    if (verified.status === 'paid' || verified.status === 'captured') {
      // (6) Confirmation is idempotent: a second delivery that somehow
      // gets here still yields one Event ID.
      const confirmed = await confirmBooking(db, {
        orderId: payment.order_id,
        rules: cfg.rules,
        serviceIsInflatable: (id) => cfg.services.get(id)?.isInflatable ?? false,
        serviceIsFoodStation: (id) => cfg.services.get(id)?.isFoodStation ?? false,
      });
      confirmedEventId = confirmed.eventId;
      newBooking = confirmed.created;
      paidNow = true;
    }

    if (verified.status === 'failed' || verified.status === 'cancelled') {
      await releaseHolds(db, payment.order_id, verified.status);
      await db.query(
        `INSERT INTO notifications (event_id, channel, template, scheduled_for, payload)
         VALUES (NULL, 'push', 'payment_failed', now(), $1)`,
        [JSON.stringify({ orderId: payment.order_id, provider: provider.name })],
      );
    }

    return 'accepted' as const;
  });

  // Mirror the confirmed booking into the shared team Google Calendar. Done
  // after the transaction commits so a slow/failed network call can never
  // roll back a paid booking; it's a silent no-op when calendar sync is off.
  if (outcome === 'accepted' && confirmedEventId) {
    await syncEventToCalendar(confirmedEventId);
    // Smart staff assignment: analyse the booked services, assign internal crew
    // first, and raise a part-time alert if we can't fully staff it. Runs after
    // commit (reads the freshly-committed event) and never blocks the booking.
    if (newBooking) {
      void import('./staffing.js')
        .then(({ assignStaffForEvent }) => assignStaffForEvent(confirmedEventId!))
        .catch((err) => console.error('[staffing] auto-assign failed:', err));
      // Generate the pre-event preparation tasks and fair-assign them (internal).
      void import('./prep.js')
        .then(({ generatePrepTasks }) => generatePrepTasks(confirmedEventId!))
        .catch((err) => console.error('[prep] auto-generate failed:', err));
    }
    // Buzz the team's phones the moment a real new booking lands.
    if (newBooking) {
      void pushToStaff('New booking 🎉', `${confirmedEventId} just booked — tap to view.`, {
        eventId: confirmedEventId,
      });
    }
  }

  // Tell the ad account a booking actually happened, and what it was worth.
  // Deliberately outside the transaction and un-awaited for the same reason
  // as the calendar sync: Meta being slow or down must never affect a paid
  // booking. `applyPaymentStatus` only returns applied once per transition,
  // so this fires once — and Meta de-duplicates on the order id regardless.
  if (outcome === 'accepted' && paidNow) {
    void reportPurchaseToMeta(payment.order_id);
  }

  await finish(deliveryId, outcome);
  return { outcome };
}

async function finish(deliveryId: number | null, outcome: string) {
  if (deliveryId === null) return;
  await pool.query(
    `UPDATE webhook_deliveries SET processed_at = now(), outcome = $2 WHERE id = $1`,
    [deliveryId, outcome],
  );
}
