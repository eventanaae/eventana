/**
 * Stripe — card & wallet payments via Embedded Checkout.
 *
 * The customer never leaves the site: the server creates a Checkout Session
 * with `ui_mode=embedded` and hands the app a `client_secret`, which Stripe.js
 * mounts as an in-page payment form (Apple Pay / Google Pay / card). Confirmation
 * still comes only from a server re-verification of the session status, exactly
 * like every other provider — the webhook and the status poll both resolve
 * through the same path.
 *
 * Stripe's API is form-encoded (application/x-www-form-urlencoded), not JSON,
 * so this adapter has its own small fetch helper rather than the shared
 * providerFetch.
 */
import { createHmac } from 'node:crypto';
import type { PaymentStatus } from '@eventana/shared';
import type { ProviderConfig } from '../config.js';
import {
  ProviderError,
  headerValue,
  safeEqual,
  type CreateSessionInput,
  type CreateSessionResult,
  type PaymentProvider,
  type RetrieveResult,
  type WebhookParseResult,
} from './provider.js';

/** Flatten a nested object into Stripe's bracketed form-encoding. */
function formEncode(obj: Record<string, unknown>, prefix = ''): string[] {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(obj)) {
    if (value === undefined || value === null) continue;
    const k = prefix ? `${prefix}[${key}]` : key;
    if (typeof value === 'object') {
      parts.push(...formEncode(value as Record<string, unknown>, k));
    } else {
      parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(value))}`);
    }
  }
  return parts;
}

export function mapStripeSessionStatus(status: string, paymentStatus?: string): PaymentStatus {
  const s = (status || '').toLowerCase();
  const p = (paymentStatus || '').toLowerCase();
  if (s === 'complete') {
    return p === 'paid' || p === 'no_payment_required' ? 'captured' : 'processing';
  }
  if (s === 'open') return 'processing';
  if (s === 'expired') return 'cancelled';
  return 'needs_review';
}

export class StripeProvider implements PaymentProvider {
  readonly name = 'stripe' as const;
  readonly label = 'Card / Apple Pay';
  readonly tagline = 'Apple Pay · Google Pay · Card';

  constructor(private readonly cfg: ProviderConfig) {}

  get mode() {
    return this.cfg.mode;
  }

  private async api(
    path: string,
    init: { method: string; body?: Record<string, unknown> },
  ): Promise<any> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20_000);
    try {
      const res = await fetch(`${this.cfg.baseUrl}/v1/${path}`, {
        method: init.method,
        headers: {
          authorization: `Bearer ${this.cfg.secretKey}`,
          'content-type': 'application/x-www-form-urlencoded',
          // Pin a stable API version: the account default is very new and
          // renamed ui_mode 'embedded' -> 'embedded_page'. Pinning keeps
          // Embedded Checkout ('embedded' + Stripe.js initEmbeddedCheckout)
          // working exactly as implemented, regardless of the account default.
          'stripe-version': '2024-06-20',
        },
        body: init.body ? formEncode(init.body).join('&') : undefined,
        signal: controller.signal,
      });
      const text = await res.text();
      const json = text ? JSON.parse(text) : null;
      if (!res.ok) {
        throw new ProviderError(
          `stripe ${init.method} ${path} failed with ${res.status}`,
          'stripe',
          res.status,
          json ?? text,
        );
      }
      return json;
    } catch (err) {
      if (err instanceof ProviderError) throw err;
      throw new ProviderError(`stripe request failed: ${(err as Error).message}`, 'stripe');
    } finally {
      clearTimeout(timer);
    }
  }

  async createSession(input: CreateSessionInput): Promise<CreateSessionResult> {
    // One combined line for the order total. Stripe expects the amount in the
    // smallest currency unit — fils — which is exactly how Eventana stores it.
    const session = await this.api('checkout/sessions', {
      method: 'POST',
      body: {
        ui_mode: 'embedded',
        mode: 'payment',
        // On completion Stripe returns the parent page to our confirming
        // screen, which polls the server for the real status.
        return_url: input.successUrl,
        line_items: [
          {
            price_data: {
              currency: 'aed',
              product_data: { name: `Eventana order ${input.orderId}` },
              unit_amount: input.amountFils,
            },
            quantity: 1,
          },
        ],
        ...(input.customer.email ? { customer_email: input.customer.email } : {}),
        metadata: { order_id: input.orderId, customer_id: input.customer.id },
        payment_intent_data: { metadata: { order_id: input.orderId } },
      },
    });

    return {
      providerPaymentId: String(session?.id ?? ''),
      checkoutUrl: null,
      embeddedUrl: null,
      // The app mounts Stripe's in-page form with this secret.
      clientSecret: session?.client_secret ?? null,
      publishableKey: this.cfg.publicKey,
      eligible: Boolean(session?.client_secret),
      raw: session,
    };
  }

  async retrievePayment(sessionId: string): Promise<RetrieveResult> {
    const session = await this.api(
      `checkout/sessions/${encodeURIComponent(sessionId)}?expand[]=payment_intent`,
      { method: 'GET' },
    );
    const providerStatus = String(session?.status ?? 'unknown');
    const status = mapStripeSessionStatus(providerStatus, session?.payment_status);
    const amountFils = Number(session?.amount_total ?? 0);
    const pi = session?.payment_intent;
    const refundedFils =
      pi && typeof pi === 'object' ? Number((pi as any).amount_refunded ?? 0) : 0;
    return {
      providerPaymentId: sessionId,
      providerStatus: `${providerStatus}/${session?.payment_status ?? ''}`,
      status,
      amountFils,
      capturedFils: status === 'captured' ? amountFils : 0,
      refundedFils,
      raw: session,
    };
  }

  async refund(sessionId: string, amountFils: number, reason: string): Promise<RetrieveResult> {
    // The refund is issued against the session's payment intent.
    const session = await this.api(
      `checkout/sessions/${encodeURIComponent(sessionId)}?expand[]=payment_intent`,
      { method: 'GET' },
    );
    const pi = session?.payment_intent;
    const paymentIntentId = typeof pi === 'string' ? pi : pi?.id;
    if (!paymentIntentId) {
      throw new ProviderError('stripe: no payment intent to refund', 'stripe', 409);
    }
    await this.api('refunds', {
      method: 'POST',
      body: {
        payment_intent: paymentIntentId,
        amount: amountFils,
        reason: 'requested_by_customer',
        metadata: { note: reason.slice(0, 400) },
      },
    });
    return this.retrievePayment(sessionId);
  }

  /** Stripe signs `${t}.${rawBody}` with the endpoint's signing secret. */
  verifyWebhook(
    headers: Record<string, string | string[] | undefined>,
    rawBody: string,
  ): boolean {
    const secret = this.cfg.webhookSecret;
    if (!secret) return false;
    const header = headerValue(headers, 'stripe-signature');
    if (!header) return false;
    // Header form: "t=1690000000,v1=hexsig,v1=hexsig2".
    let timestamp = '';
    const sigs: string[] = [];
    for (const part of header.split(',')) {
      const [k, v] = part.split('=');
      if (k === 't') timestamp = v;
      else if (k === 'v1') sigs.push(v);
    }
    if (!timestamp || sigs.length === 0) return false;
    const expected = createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
    return sigs.some((s) => safeEqual(s, expected));
  }

  parseWebhook(body: any): WebhookParseResult | null {
    const type = String(body?.type ?? '');
    const obj = body?.data?.object;
    if (!obj) return null;
    // We care about checkout session lifecycle events; the object id is the
    // session id we stored as the provider payment id.
    if (type.startsWith('checkout.session.')) {
      const providerStatus = `${obj.status ?? ''}/${obj.payment_status ?? ''}`;
      return {
        providerPaymentId: String(obj.id),
        providerStatus,
        status: mapStripeSessionStatus(String(obj.status ?? ''), obj.payment_status),
      };
    }
    return null;
  }
}
