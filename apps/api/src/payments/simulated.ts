/**
 * The simulated provider.
 *
 * When a provider's secrets are absent, Eventana still needs the whole
 * booking engine to be runnable and testable: holds, the state machine,
 * webhook signature checking, idempotency, re-verification, confirmation
 * and reconciliation. This class stands in for the provider's servers and
 * nothing else — every layer above it is the real code path, so the
 * behaviour proved in simulation is the behaviour that ships.
 *
 * It is deliberately NOT a "mock payment": it never marks anything paid
 * by itself. A simulated checkout still has to deliver a signed webhook,
 * and the engine still re-verifies that webhook against the (simulated)
 * retrieve-payment endpoint before confirming.
 *
 * `assertProductionReady()` refuses to boot production with any provider
 * in this mode.
 */
import { createHmac, randomUUID } from 'node:crypto';
import type { PaymentStatus } from '@eventana/shared';
import type { ProviderConfig } from '../config.js';
import { config } from '../config.js';
import {
  headerValue,
  safeEqual,
  type CreateSessionInput,
  type CreateSessionResult,
  type PaymentProvider,
  type RetrieveResult,
  type WebhookParseResult,
} from './provider.js';

interface SimRecord {
  id: string;
  orderId: string;
  amountFils: number;
  providerStatus: string;
  capturedFils: number;
  refundedFils: number;
}

/** Shared across providers so the simulator page can look any payment up. */
const store = new Map<string, SimRecord>();

export function simulatedStore() {
  return store;
}

/** The status vocabulary each simulated provider speaks. */
const VOCAB = {
  tabby: { pending: 'CREATED', success: 'AUTHORIZED', captured: 'CLOSED', rejected: 'REJECTED', expired: 'EXPIRED', refunded: 'REFUNDED' },
  tamara: { pending: 'new', success: 'approved', captured: 'fully_captured', rejected: 'declined', expired: 'expired', refunded: 'fully_refunded' },
  ziina: { pending: 'pending', success: 'completed', captured: 'completed', rejected: 'failed', expired: 'canceled', refunded: 'refunded' },
} as const;

export class SimulatedProvider implements PaymentProvider {
  readonly mode = 'simulated' as const;

  constructor(
    readonly name: 'tabby' | 'tamara' | 'ziina',
    readonly label: string,
    readonly tagline: string,
    private readonly map: (s: string) => PaymentStatus,
    private readonly cfg: ProviderConfig,
  ) {}

  private get vocab() {
    return VOCAB[this.name];
  }

  /** Dev webhook secret — stable per provider so tests can sign requests. */
  get webhookSecret(): string {
    return this.cfg.webhookSecret ?? `simulated-${this.name}-secret`;
  }

  async createSession(input: CreateSessionInput): Promise<CreateSessionResult> {
    // The simulator's reject-flow number: any phone ending in six zeros
    // is declined up front, standing in for the provider's documented
    // rejection test numbers so case 2 of the test plan is exercisable.
    if (/000000$/.test(input.customer.phone.replace(/\D/g, ''))) {
      return {
        providerPaymentId: `sim_${randomUUID()}`,
        checkoutUrl: null,
        eligible: false,
        raw: { simulated: true, reason: 'reject-flow test number' },
      };
    }

    const id = `sim_${this.name}_${randomUUID()}`;
    store.set(id, {
      id,
      orderId: input.orderId,
      amountFils: input.amountFils,
      providerStatus: this.vocab.pending,
      capturedFils: 0,
      refundedFils: 0,
    });

    return {
      providerPaymentId: id,
      // A local page standing in for the provider's hosted checkout.
      checkoutUrl: `${config.publicApiUrl}/simulator/${this.name}/${id}`,
      eligible: true,
      raw: { simulated: true, orderId: input.orderId },
    };
  }

  async retrievePayment(providerPaymentId: string): Promise<RetrieveResult> {
    const rec = store.get(providerPaymentId);
    if (!rec) {
      return {
        providerPaymentId,
        providerStatus: 'UNKNOWN',
        status: 'needs_review',
        amountFils: 0,
        capturedFils: 0,
        refundedFils: 0,
        raw: { simulated: true, found: false },
      };
    }
    return {
      providerPaymentId,
      providerStatus: rec.providerStatus,
      status: this.map(rec.providerStatus),
      amountFils: rec.amountFils,
      capturedFils: rec.capturedFils,
      refundedFils: rec.refundedFils,
      raw: { simulated: true, ...rec },
    };
  }

  async capture(providerPaymentId: string, amountFils: number): Promise<RetrieveResult> {
    const rec = store.get(providerPaymentId);
    if (rec) {
      rec.providerStatus = this.vocab.captured;
      rec.capturedFils = amountFils;
    }
    return this.retrievePayment(providerPaymentId);
  }

  async refund(providerPaymentId: string, amountFils: number): Promise<RetrieveResult> {
    const rec = store.get(providerPaymentId);
    if (rec) {
      rec.refundedFils += amountFils;
      rec.providerStatus =
        rec.refundedFils >= rec.amountFils ? this.vocab.refunded : rec.providerStatus;
    }
    return this.retrievePayment(providerPaymentId);
  }

  verifyWebhook(
    headers: Record<string, string | string[] | undefined>,
    rawBody: string,
  ): boolean {
    // Same shape of check as the real adapters: a signature the caller
    // could only produce with the shared secret.
    const sent =
      headerValue(headers, 'x-eventana-signature') ??
      headerValue(headers, 'x-simulated-signature');
    if (!sent) return false;
    if (safeEqual(sent, this.webhookSecret)) return true;
    const hmac = createHmac('sha256', this.webhookSecret).update(rawBody, 'utf8').digest('hex');
    return safeEqual(sent, hmac);
  }

  parseWebhook(body: any): WebhookParseResult | null {
    const id = body?.id ?? body?.payment?.id ?? body?.order_id;
    const providerStatus = body?.status ?? body?.order_status;
    if (!id || !providerStatus) return null;
    return {
      providerPaymentId: String(id),
      providerStatus: String(providerStatus),
      status: this.map(String(providerStatus)),
    };
  }

  /* --- controls used by the simulator page and the test suite ------ */

  /** Moves a simulated payment forward, as the provider's servers would. */
  advance(providerPaymentId: string, to: 'success' | 'captured' | 'rejected' | 'expired'): SimRecord | null {
    const rec = store.get(providerPaymentId);
    if (!rec) return null;
    rec.providerStatus = this.vocab[to];
    if (to === 'captured') rec.capturedFils = rec.amountFils;
    return rec;
  }

  /** The webhook body the provider would POST for a record's status. */
  webhookBody(providerPaymentId: string): Record<string, unknown> | null {
    const rec = store.get(providerPaymentId);
    if (!rec) return null;
    return this.name === 'tamara'
      ? { order_id: rec.id, order_status: rec.providerStatus }
      : { id: rec.id, status: rec.providerStatus, amount: (rec.amountFils / 100).toFixed(2) };
  }
}
