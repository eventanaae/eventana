/**
 * The payment provider contract.
 *
 * Tabby, Tamara and Ziina differ in payload shape and status vocabulary
 * but not in architecture: create a session server-side, send the
 * customer to a hosted page, and confirm ONLY from a signed webhook that
 * the server re-verifies against the provider's own API.
 *
 * Everything above this interface — inventory holds, the state machine,
 * idempotency, confirmation, reconciliation — is provider-independent and
 * written once.
 */
import { timingSafeEqual } from 'node:crypto';
import type { PaymentStatus } from '@eventana/shared';
import type { ProviderConfig } from '../config.js';

export interface SessionCustomer {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  registeredSince: string | null;
  loyaltyLevel: number;
}

export interface SessionItem {
  title: string;
  quantity: number;
  unitPriceFils: number;
  referenceId: string | null;
  category: string;
}

export interface CreateSessionInput {
  orderId: string;
  amountFils: number;
  currency: 'AED';
  customer: SessionCustomer;
  items: SessionItem[];
  /** Delivery fee, sent as the shipping amount. */
  shippingFils: number;
  discountFils: number;
  /** Emirate + free-text address for the provider's risk checks. */
  city: string;
  address: string;
  lang: 'en' | 'ar';
  successUrl: string;
  cancelUrl: string;
  failureUrl: string;
  /** Past orders — thin history materially raises BNPL rejection rates. */
  orderHistory: Array<{
    purchasedAt: string;
    amountFils: number;
    status: string;
  }>;
}

export interface CreateSessionResult {
  /** The provider's own payment/checkout id. */
  providerPaymentId: string;
  /** Hosted checkout URL, or null when the customer was not approved. */
  checkoutUrl: string | null;
  /**
   * False when the provider declined this customer up front. The caller
   * hides the method and offers another — never an error screen (§7).
   */
  eligible: boolean;
  raw: unknown;
}

export interface RetrieveResult {
  providerPaymentId: string;
  providerStatus: string;
  status: PaymentStatus;
  amountFils: number;
  capturedFils: number;
  refundedFils: number;
  raw: unknown;
}

export interface WebhookParseResult {
  providerPaymentId: string;
  providerStatus: string;
  status: PaymentStatus;
}

export interface PaymentProvider {
  readonly name: 'tabby' | 'tamara' | 'ziina';
  readonly mode: ProviderConfig['mode'];
  /** Human label for the customer app's payment picker. */
  readonly label: string;
  readonly tagline: string;

  createSession(input: CreateSessionInput): Promise<CreateSessionResult>;
  retrievePayment(providerPaymentId: string): Promise<RetrieveResult>;
  refund(providerPaymentId: string, amountFils: number, reason: string): Promise<RetrieveResult>;
  capture?(providerPaymentId: string, amountFils: number): Promise<RetrieveResult>;

  /** Constant-time verification of an inbound webhook. */
  verifyWebhook(headers: Record<string, string | string[] | undefined>, rawBody: string): boolean;
  parseWebhook(body: unknown): WebhookParseResult | null;
}

/* ------------------------------------------------------------------ */
/* Helpers shared by the adapters                                      */
/* ------------------------------------------------------------------ */

/** Constant-time string comparison that tolerates differing lengths. */
export function safeEqual(a: string | undefined | null, b: string | undefined | null): boolean {
  if (!a || !b) return false;
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) {
    // Still burn a comparison so the branch does not leak length by timing.
    timingSafeEqual(left, left);
    return false;
  }
  return timingSafeEqual(left, right);
}

export function headerValue(
  headers: Record<string, string | string[] | undefined>,
  name: string,
): string | undefined {
  const raw = headers[name.toLowerCase()];
  return Array.isArray(raw) ? raw[0] : raw;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly provider: string,
    readonly statusCode?: number,
    readonly body?: unknown,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

/** Shared fetch wrapper: JSON in, JSON out, provider-tagged errors. */
export async function providerFetch(
  provider: string,
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body?: unknown;
    timeoutMs?: number;
  },
): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), init.timeoutMs ?? 20_000);
  try {
    const res = await fetch(url, {
      method: init.method,
      headers: { 'content-type': 'application/json', ...init.headers },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: controller.signal,
    });
    const text = await res.text();
    const json = text ? safeJson(text) : null;
    if (!res.ok) {
      throw new ProviderError(
        `${provider} ${init.method} ${url} failed with ${res.status}`,
        provider,
        res.status,
        json ?? text,
      );
    }
    return json;
  } catch (err) {
    if (err instanceof ProviderError) throw err;
    throw new ProviderError(
      `${provider} request failed: ${(err as Error).message}`,
      provider,
    );
  } finally {
    clearTimeout(timer);
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
