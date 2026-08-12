/**
 * Tabby — Buy Now, Pay Later.
 *
 * Implements "Eventana — Payment Integration Specification, Part 1 of 3".
 *
 * IMPLEMENTATION NOTE (carried over from the spec, and it matters):
 * endpoint paths, payload field names and status spellings below reflect
 * Tabby's published integration model as of 12 August 2026. Verify each
 * field against the current official API reference and your Postman
 * collection before going live — providers revise payload details. The
 * architecture, the state machine, the idempotency rules and the failure
 * handling do not change when they do.
 */
import { providerAmount, type PaymentStatus } from '@eventana/shared';
import type { ProviderConfig } from '../config.js';
import {
  headerValue,
  providerFetch,
  safeEqual,
  type CreateSessionInput,
  type CreateSessionResult,
  type PaymentProvider,
  type RetrieveResult,
  type WebhookParseResult,
} from './provider.js';

/** Tabby status -> Eventana payment status (spec §3). */
export function mapTabbyStatus(providerStatus: string): PaymentStatus {
  switch (providerStatus.toUpperCase()) {
    case 'CREATED':
      return 'processing';
    case 'AUTHORIZED':
      // Sufficient to confirm the booking. CLOSED is the finance signal.
      return 'paid';
    case 'CLOSED':
      return 'captured';
    case 'REJECTED':
      return 'failed';
    case 'EXPIRED':
      return 'cancelled';
    case 'REFUNDED':
      return 'refunded';
    default:
      // An unrecognised status must never silently confirm a booking.
      return 'needs_review';
  }
}

function toFils(amount: unknown): number {
  const n = typeof amount === 'string' ? Number(amount) : typeof amount === 'number' ? amount : 0;
  return Math.round((Number.isFinite(n) ? n : 0) * 100);
}

export class TabbyProvider implements PaymentProvider {
  readonly name = 'tabby' as const;
  readonly label = 'tabby';
  readonly tagline = '4 interest-free payments';

  constructor(private readonly cfg: ProviderConfig) {}

  get mode() {
    return this.cfg.mode;
  }

  private auth() {
    return { authorization: `Bearer ${this.cfg.secretKey}` };
  }

  async createSession(input: CreateSessionInput): Promise<CreateSessionResult> {
    const body = {
      payment: {
        amount: providerAmount(input.amountFils),
        currency: input.currency,
        buyer: {
          phone: input.customer.phone,
          email: input.customer.email ?? '',
          name: input.customer.name,
        },
        buyer_history: {
          registered_since: input.customer.registeredSince,
          loyalty_level: input.customer.loyaltyLevel,
          wishlist_count: 0,
          is_social_networks_connected: false,
        },
        order: {
          reference_id: input.orderId,
          items: input.items.map((i) => ({
            title: i.title,
            quantity: i.quantity,
            unit_price: providerAmount(i.unitPriceFils),
            category: i.category,
            reference_id: i.referenceId,
          })),
          shipping_amount: providerAmount(input.shippingFils),
          discount_amount: providerAmount(input.discountFils),
          tax_amount: '0.00',
        },
        order_history: input.orderHistory.map((o) => ({
          purchased_at: o.purchasedAt,
          amount: providerAmount(o.amountFils),
          status: o.status,
        })),
        shipping_address: {
          city: input.city,
          address: input.address,
          zip: '00000',
        },
        meta: { order_id: input.orderId, customer: input.customer.id },
      },
      lang: input.lang,
      merchant_code: this.cfg.merchantCode,
      merchant_urls: {
        success: input.successUrl,
        cancel: input.cancelUrl,
        failure: input.failureUrl,
      },
    };

    const res = await providerFetch('tabby', `${this.cfg.baseUrl}/v2/checkout`, {
      method: 'POST',
      headers: this.auth(),
      body,
    });

    // A `created` status means the customer passed Tabby's assessment.
    // Anything else means hide Tabby and offer another method (§7).
    const status = String(res?.status ?? '').toLowerCase();
    const eligible = status === 'created';

    // The hosted checkout URL sits under the available installment
    // product's web_url.
    const checkoutUrl =
      res?.configuration?.available_products?.installments?.[0]?.web_url ??
      res?.web_url ??
      null;

    return {
      providerPaymentId: String(res?.payment?.id ?? res?.id ?? ''),
      checkoutUrl: eligible ? checkoutUrl : null,
      eligible,
      raw: res,
    };
  }

  async retrievePayment(providerPaymentId: string): Promise<RetrieveResult> {
    const res = await providerFetch(
      'tabby',
      `${this.cfg.baseUrl}/v2/payments/${encodeURIComponent(providerPaymentId)}`,
      { method: 'GET', headers: this.auth() },
    );
    const providerStatus = String(res?.status ?? 'UNKNOWN');
    const captured = Array.isArray(res?.captures)
      ? res.captures.reduce((sum: number, c: any) => sum + toFils(c?.amount), 0)
      : 0;
    const refunded = Array.isArray(res?.refunds)
      ? res.refunds.reduce((sum: number, r: any) => sum + toFils(r?.amount), 0)
      : 0;

    return {
      providerPaymentId,
      providerStatus,
      status: mapTabbyStatus(providerStatus),
      amountFils: toFils(res?.amount),
      capturedFils: captured,
      refundedFils: refunded,
      raw: res,
    };
  }

  async capture(providerPaymentId: string, amountFils: number): Promise<RetrieveResult> {
    await providerFetch(
      'tabby',
      `${this.cfg.baseUrl}/v2/payments/${encodeURIComponent(providerPaymentId)}/captures`,
      {
        method: 'POST',
        headers: this.auth(),
        body: {
          amount: providerAmount(amountFils),
          // Required by the current API: an idempotency key so a retried
          // capture of the same amount can never double-charge.
          reference_id: `${providerPaymentId}-cap-${amountFils}`,
        },
      },
    );
    return this.retrievePayment(providerPaymentId);
  }

  async refund(
    providerPaymentId: string,
    amountFils: number,
    reason: string,
  ): Promise<RetrieveResult> {
    await providerFetch(
      'tabby',
      `${this.cfg.baseUrl}/v2/payments/${encodeURIComponent(providerPaymentId)}/refunds`,
      {
        method: 'POST',
        headers: this.auth(),
        body: {
          amount: providerAmount(amountFils),
          reason,
          // Required idempotency key (current Tabby API reference).
          reference_id: `${providerPaymentId}-ref-${amountFils}`,
        },
      },
    );
    return this.retrievePayment(providerPaymentId);
  }

  /**
   * Tabby echoes back the exact header value Eventana registered. Compare
   * it in constant time and reject anything that does not match (§6.1).
   */
  verifyWebhook(headers: Record<string, string | string[] | undefined>): boolean {
    const sent = headerValue(headers, 'x-eventana-signature');
    return safeEqual(sent, this.cfg.webhookSecret);
  }

  parseWebhook(body: any): WebhookParseResult | null {
    const id = body?.id ?? body?.payment?.id;
    const providerStatus = body?.status ?? body?.payment?.status;
    if (!id || !providerStatus) return null;
    return {
      providerPaymentId: String(id),
      providerStatus: String(providerStatus),
      status: mapTabbyStatus(String(providerStatus)),
    };
  }

  /** One-time registration, run from `npm run register:webhooks`. */
  async registerWebhook(url: string, isTest: boolean): Promise<unknown> {
    return providerFetch('tabby', `${this.cfg.baseUrl}/v1/webhooks`, {
      method: 'POST',
      headers: { ...this.auth(), 'x-merchant-code': this.cfg.merchantCode ?? '' },
      body: {
        url,
        is_test: isTest,
        header: { title: 'X-Eventana-Signature', value: this.cfg.webhookSecret },
      },
    });
  }
}
