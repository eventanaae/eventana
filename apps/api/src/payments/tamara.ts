/**
 * Tamara — Buy Now, Pay Later (Part 2 of the payment specification).
 *
 * Same architecture as Tabby: server-created session, hosted checkout,
 * webhook-only confirmation, re-verified against Tamara's API before a
 * booking is confirmed.
 *
 * IMPLEMENTATION NOTE: field names and status spellings reflect Tamara's
 * published model at the date of writing. Verify against the current
 * official API reference before go-live.
 */
import { createHmac } from 'node:crypto';
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

export function mapTamaraStatus(providerStatus: string): PaymentStatus {
  switch (providerStatus.toLowerCase()) {
    case 'new':
    case 'pending':
      return 'processing';
    case 'approved':
    case 'authorised':
    case 'authorized':
      return 'paid';
    case 'captured':
    case 'fully_captured':
      return 'captured';
    case 'declined':
      return 'failed';
    case 'expired':
    case 'canceled':
    case 'cancelled':
      return 'cancelled';
    case 'refunded':
    case 'fully_refunded':
      return 'refunded';
    case 'partially_refunded':
      return 'partially_refunded';
    default:
      return 'needs_review';
  }
}

/** Tamara sends amounts as { amount, currency } with decimal strings. */
function toFils(amount: any): number {
  const raw = typeof amount === 'object' && amount !== null ? amount.amount : amount;
  const n = typeof raw === 'string' ? Number(raw) : typeof raw === 'number' ? raw : 0;
  return Math.round((Number.isFinite(n) ? n : 0) * 100);
}

function money(fils: number) {
  return { amount: providerAmount(fils), currency: 'AED' };
}

export class TamaraProvider implements PaymentProvider {
  readonly name = 'tamara' as const;
  readonly label = 'tamara';
  readonly tagline = 'Split in 4, no interest';

  constructor(private readonly cfg: ProviderConfig) {}

  get mode() {
    return this.cfg.mode;
  }

  private auth() {
    return { authorization: `Bearer ${this.cfg.secretKey}` };
  }

  async createSession(input: CreateSessionInput): Promise<CreateSessionResult> {
    const body = {
      order_reference_id: input.orderId,
      total_amount: money(input.amountFils),
      shipping_amount: money(input.shippingFils),
      tax_amount: money(0),
      discount: input.discountFils
        ? { name: 'Build Your Own discount', amount: money(input.discountFils) }
        : undefined,
      country_code: 'AE',
      description: 'Eventana celebration booking',
      payment_type: 'PAY_BY_INSTALMENTS',
      instalments: 4,
      locale: input.lang === 'ar' ? 'ar_AE' : 'en_US',
      items: input.items.map((i) => ({
        reference_id: i.referenceId ?? i.title,
        type: 'Physical',
        name: i.title,
        sku: i.referenceId ?? i.title,
        quantity: i.quantity,
        unit_price: money(i.unitPriceFils),
        total_amount: money(i.unitPriceFils * i.quantity),
      })),
      consumer: {
        email: input.customer.email ?? '',
        first_name: input.customer.name.split(' ')[0] ?? input.customer.name,
        last_name: input.customer.name.split(' ').slice(1).join(' ') || '-',
        phone_number: input.customer.phone,
      },
      shipping_address: {
        first_name: input.customer.name.split(' ')[0] ?? input.customer.name,
        last_name: input.customer.name.split(' ').slice(1).join(' ') || '-',
        line1: input.address,
        city: input.city,
        country_code: 'AE',
        phone_number: input.customer.phone,
      },
      merchant_url: {
        success: input.successUrl,
        failure: input.failureUrl,
        cancel: input.cancelUrl,
        notification: input.successUrl.replace('/pay/return', '/webhooks/tamara'),
      },
    };

    const res = await providerFetch('tamara', `${this.cfg.baseUrl}/checkout`, {
      method: 'POST',
      headers: this.auth(),
      body,
    });

    const checkoutUrl = res?.checkout_url ?? null;
    return {
      providerPaymentId: String(res?.order_id ?? res?.checkout_id ?? ''),
      checkoutUrl,
      eligible: Boolean(checkoutUrl),
      raw: res,
    };
  }

  async retrievePayment(providerPaymentId: string): Promise<RetrieveResult> {
    const res = await providerFetch(
      'tamara',
      `${this.cfg.baseUrl}/orders/${encodeURIComponent(providerPaymentId)}`,
      { method: 'GET', headers: this.auth() },
    );
    const providerStatus = String(res?.status ?? 'unknown');
    return {
      providerPaymentId,
      providerStatus,
      status: mapTamaraStatus(providerStatus),
      amountFils: toFils(res?.total_amount),
      capturedFils: toFils(res?.captured_amount),
      refundedFils: toFils(res?.refunded_amount),
      raw: res,
    };
  }

  async capture(providerPaymentId: string, amountFils: number): Promise<RetrieveResult> {
    await providerFetch(
      'tamara',
      `${this.cfg.baseUrl}/payments/capture`,
      {
        method: 'POST',
        headers: this.auth(),
        body: { order_id: providerPaymentId, total_amount: money(amountFils) },
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
      'tamara',
      `${this.cfg.baseUrl}/payments/simplified-refund/${encodeURIComponent(providerPaymentId)}`,
      {
        method: 'POST',
        headers: this.auth(),
        body: { total_amount: money(amountFils), comment: reason },
      },
    );
    return this.retrievePayment(providerPaymentId);
  }

  /**
   * Tamara signs notifications with a JWT in the `tamara_token` header,
   * signed HS256 with the notification token. Verify the signature — not
   * just the presence of a header.
   */
  verifyWebhook(headers: Record<string, string | string[] | undefined>): boolean {
    // Tamara delivers the JWT differently across integrations: a
    // `tamara_token` / `tamaraToken` header, or the standard
    // `Authorization: Bearer <jwt>`. Accept any location — the HS256
    // signature check below is what actually gates authenticity.
    const authz = headerValue(headers, 'authorization');
    const token =
      headerValue(headers, 'tamara_token') ??
      headerValue(headers, 'tamaratoken') ??
      (authz ? authz.replace(/^Bearer\s+/i, '') : undefined);
    const secret = this.cfg.webhookSecret;
    if (!token || !secret) return false;

    const parts = token.split('.');
    if (parts.length !== 3) return false;
    const [header, payload, signature] = parts;

    const expected = createHmac('sha256', secret)
      .update(`${header}.${payload}`)
      .digest('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    return safeEqual(signature, expected);
  }

  parseWebhook(body: any): WebhookParseResult | null {
    const id = body?.order_id ?? body?.data?.order_id;
    const providerStatus = body?.order_status ?? body?.status ?? body?.event_type;
    if (!id || !providerStatus) return null;
    return {
      providerPaymentId: String(id),
      providerStatus: String(providerStatus),
      status: mapTamaraStatus(String(providerStatus)),
    };
  }
}
