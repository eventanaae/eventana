/**
 * API client.
 *
 * The app displays totals but never decides them: `quote` is for showing
 * a live figure, and `checkout` sends the CART, not a price. Whatever the
 * server recomputes is what gets charged.
 */
import type { CartInput, Quote } from '@eventana/shared';
import { currentCustomerId } from './account';

/**
 * Render blueprints can only inject another service's HOST, not a full
 * URL, so accept either and add the scheme when it is missing.
 */
function apiBase(): string {
  const raw = String(
    import.meta.env.VITE_API_URL ?? import.meta.env.VITE_API_HOST ?? '',
  ).trim().replace(/\/+$/, '');
  if (!raw) return 'http://localhost:4000';
  return /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
}

const BASE = apiBase();

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      'x-customer-id': currentCustomerId(),
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const err = new Error(body?.message ?? body?.error ?? `Request failed (${res.status})`);
    Object.assign(err, { status: res.status, body });
    throw err;
  }
  return body as T;
}

export interface Catalogue {
  celebrationTypes: Array<{ id: string; label: string; sub: string; gradient: string; route: 'explore' | 'build' }>;
  categories: Array<{ id: string; name: string; note: string; celebrationTypes: string[]; sortOrder: number }>;
  services: Array<{
    id: string; name: string; categoryId: string; priceFils: number;
    shortDescription: string; detail: string | null;
    pricing: { kind: string; minChildren?: number; minQuantity?: number };
    isInflatable: boolean; isFoodStation: boolean; needsAdminReview: boolean;
    celebrationTypes: string[]; badge: string | null; gradient: string;
    extraServingFils: number | null; requiresAssets: string[];
  }>;
  packages: Array<{
    id: string; name: string; priceFils: number; capacity: string; durationHours: number;
    tag: string; gradient: string; hasCastleChoice: boolean;
    items: Array<{ name: string; detail: string; assets: string[] }>;
  }>;
  themes: Array<{
    id: string; name: string; tags: string[]; colors: string[]; gradient: string;
    coverImageUrl: string | null; popular: boolean; featured: boolean; celebrationType: string;
  }>;
  themeTags: string[];
  castleVariants: Array<{ code: string; name: string; swatch: string }>;
  deliveryZones: Array<{ zoneName: string; emirate: string; feeFils: number | null; available: boolean; specialConditions: string | null }>;
  rules: Record<string, number | boolean>;
  startTimes: string[];
  notices: Record<string, string>;
  missingServiceNotes: Record<string, string>;
  paymentMethods: Array<{ name: string; label: string; tagline: string; mode: string }>;
  mapsKey: string | null;
}

export interface QuoteResult extends Quote {
  unavailable: string[];
  totalDisplay: string;
}

export const api = {
  catalogue: () => request<Catalogue>('/api/catalogue'),

  quote: (cart: CartInput) =>
    request<QuoteResult>('/api/quote', { method: 'POST', body: JSON.stringify(cart) }),

  startTimes: () => request<Array<{ value: string; allowed: boolean }>>('/api/start-times'),

  checkout: (cart: unknown, provider: string) =>
    request<{
      orderId: string; checkoutUrl: string | null; eligible: boolean;
      totalFils: number; holdExpiresAt: string;
    }>('/api/checkout', {
      method: 'POST',
      body: JSON.stringify({ cart, customerId: currentCustomerId(), provider }),
    }),

  register: (body: { name: string; email: string; phone: string; password: string }) =>
    request<{ customerId: string; name: string; email: string; phone: string }>(
      '/api/customers/register',
      { method: 'POST', body: JSON.stringify(body) },
    ),

  login: (body: { email: string; password: string }) =>
    request<{ customerId: string; name: string; email: string; phone: string }>(
      '/api/customers/login',
      { method: 'POST', body: JSON.stringify(body) },
    ),

  order: (orderId: string) =>
    request<{
      orderId: string; status: string; kind: string; paymentStatus: string; eventId: string | null;
      confirmed: boolean; totalDisplay: string;
    }>(`/api/orders/${orderId}`),

  events: () => request<any[]>('/api/events'),
  event: (eventId: string) => request<any>(`/api/events/${eventId}`),

  addonQuote: (eventId: string, body: unknown) =>
    request<any>(`/api/events/${eventId}/addons/quote`, { method: 'POST', body: JSON.stringify(body) }),

  addonCheckout: (eventId: string, body: unknown) =>
    request<{ orderId: string; checkoutUrl: string | null }>(
      `/api/events/${eventId}/addons/checkout`,
      { method: 'POST', body: JSON.stringify(body) },
    ),

  sendMessage: (eventId: string, body: string) =>
    request<any>(`/api/events/${eventId}/messages`, { method: 'POST', body: JSON.stringify({ body }) }),

  designDecision: (eventId: string, version: number, decision: 'approve' | 'request_changes', note?: string) =>
    request<any>(`/api/events/${eventId}/designs/${version}/decision`, {
      method: 'POST',
      body: JSON.stringify({ decision, note }),
    }),

  setupPhoto: (eventId: string, itemKey: string, description: string) =>
    request<any>(`/api/events/${eventId}/setup-photos`, {
      method: 'POST',
      body: JSON.stringify({ itemKey, description }),
    }),

  rateEvent: (eventId: string, stars: number, feedback?: string) =>
    request<{ stars: number; feedback: string | null }>(`/api/events/${eventId}/rating`, {
      method: 'POST',
      body: JSON.stringify({ stars, feedback }),
    }),

  tipCheckout: (eventId: string, amountFils: number, memberId: string | null) =>
    request<{ orderId: string; checkoutUrl: string | null }>(
      `/api/events/${eventId}/tip/checkout`,
      { method: 'POST', body: JSON.stringify({ amountFils, memberId, provider: 'ziina' }) },
    ),

  assistant: (question: string, celebrationType: string) =>
    request<{ reply: string; escalated: boolean; references: Array<{ kind: string; id: string; name: string }> }>(
      '/api/assistant',
      { method: 'POST', body: JSON.stringify({ question, celebrationType }) },
    ),
};
