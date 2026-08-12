/**
 * Ziina — card and wallet payments (Part 3 of the payment specification).
 *
 * Ziina captures on success rather than authorising first, so its
 * terminal success maps straight to `captured`. Everything else — the
 * hold, the webhook-only confirmation, the re-verification, the audit
 * trail — is identical to the other two providers.
 *
 * IMPLEMENTATION NOTE: verify field names and the webhook signature
 * scheme against Ziina's current API reference before go-live.
 */
import { createHmac } from 'node:crypto';
import type { PaymentStatus } from '@eventana/shared';
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

export function mapZiinaStatus(providerStatus: string): PaymentStatus {
  switch (providerStatus.toLowerCase()) {
    case 'requires_payment_instrument':
    case 'requires_user_action':
    case 'pending':
      return 'processing';
    case 'completed':
    case 'succeeded':
      return 'captured';
    case 'failed':
      return 'failed';
    case 'canceled':
    case 'cancelled':
    case 'expired':
      return 'cancelled';
    case 'refunded':
      return 'refunded';
    default:
      return 'needs_review';
  }
}

export class ZiinaProvider implements PaymentProvider {
  readonly name = 'ziina' as const;
  readonly label = 'Ziina';
  readonly tagline = 'Card & wallet';

  constructor(private readonly cfg: ProviderConfig) {}

  get mode() {
    return this.cfg.mode;
  }

  private auth() {
    return { authorization: `Bearer ${this.cfg.secretKey}` };
  }

  async createSession(input: CreateSessionInput): Promise<CreateSessionResult> {
    // Ziina takes the amount in the smallest currency unit — fils — which
    // is exactly how Eventana stores it, so no conversion is needed here.
    const res = await providerFetch('ziina', `${this.cfg.baseUrl}/payment_intent`, {
      method: 'POST',
      headers: this.auth(),
      body: {
        amount: input.amountFils,
        currency_code: input.currency,
        message: `Eventana booking ${input.orderId}`,
        success_url: input.successUrl,
        cancel_url: input.cancelUrl,
        failure_url: input.failureUrl,
        test: this.cfg.mode !== 'live',
        metadata: { order_id: input.orderId, customer_id: input.customer.id },
      },
    });

    const checkoutUrl = res?.redirect_url ?? null;
    return {
      providerPaymentId: String(res?.id ?? ''),
      checkoutUrl,
      eligible: Boolean(checkoutUrl),
      raw: res,
    };
  }

  async retrievePayment(providerPaymentId: string): Promise<RetrieveResult> {
    const res = await providerFetch(
      'ziina',
      `${this.cfg.baseUrl}/payment_intent/${encodeURIComponent(providerPaymentId)}`,
      { method: 'GET', headers: this.auth() },
    );
    const providerStatus = String(res?.status ?? 'unknown');
    const status = mapZiinaStatus(providerStatus);
    const amountFils = Number(res?.amount ?? 0);
    return {
      providerPaymentId,
      providerStatus,
      status,
      amountFils,
      capturedFils: status === 'captured' ? amountFils : 0,
      refundedFils: Number(res?.refunded_amount ?? 0),
      raw: res,
    };
  }

  async refund(
    providerPaymentId: string,
    amountFils: number,
    reason: string,
  ): Promise<RetrieveResult> {
    await providerFetch('ziina', `${this.cfg.baseUrl}/refund`, {
      method: 'POST',
      headers: this.auth(),
      body: { payment_intent_id: providerPaymentId, amount: amountFils, reason },
    });
    return this.retrievePayment(providerPaymentId);
  }

  /** HMAC-SHA256 of the raw body with the webhook secret. */
  verifyWebhook(
    headers: Record<string, string | string[] | undefined>,
    rawBody: string,
  ): boolean {
    const secret = this.cfg.webhookSecret;
    if (!secret) return false;
    const sent =
      headerValue(headers, 'ziina-signature') ??
      headerValue(headers, 'x-ziina-signature') ??
      headerValue(headers, 'ziina-webhook-signature') ??
      headerValue(headers, 'webhook-signature');
    if (!sent) return false;
    // Ziina signs with the merchant-supplied webhook secret (HMAC-SHA256 of
    // the raw body). The public docs don't pin the encoding, so accept hex or
    // base64 — both still require the shared secret, so neither weakens the
    // check.
    const hex = createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');
    const b64 = createHmac('sha256', secret).update(rawBody, 'utf8').digest('base64');
    return safeEqual(sent, hex) || safeEqual(sent, b64);
  }

  parseWebhook(body: any): WebhookParseResult | null {
    const payload = body?.data ?? body;
    const id = payload?.id ?? payload?.payment_intent_id;
    const providerStatus = payload?.status ?? body?.type;
    if (!id || !providerStatus) return null;
    return {
      providerPaymentId: String(id),
      providerStatus: String(providerStatus),
      status: mapZiinaStatus(String(providerStatus)),
    };
  }
}
