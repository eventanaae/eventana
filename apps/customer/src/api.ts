/**
 * API client.
 *
 * The app displays totals but never decides them: `quote` is for showing
 * a live figure, and `checkout` sends the CART, not a price. Whatever the
 * server recomputes is what gets charged.
 */
import type { CartInput, Quote } from '@eventana/shared';
import { currentCustomerId, currentFb, currentToken } from './account';
import { attributionPayload, trackCompleteRegistration } from './attribution';

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

/**
 * Anonymous visit ping for the website funnel. Sends a random per-browser id
 * (kept in localStorage, hashed server-side) once per session. Never throws —
 * analytics must not affect the page. No personal data, no cookies.
 */
export function trackVisit(): void {
  try {
    let vid = localStorage.getItem('ev_vid');
    if (!vid) {
      vid = (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`);
      localStorage.setItem('ev_vid', vid);
    }
    if (sessionStorage.getItem('ev_tracked')) return; // one ping per session
    sessionStorage.setItem('ev_tracked', '1');
    void fetch(`${BASE}/api/track`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ vid }),
      keepalive: true,
    }).catch(() => {});
  } catch { /* private mode / storage blocked — ignore */ }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
// The free-tier API sleeps after ~15 min idle and cold-starts on the next
// request (~50s). Retry through that window so the app reconnects on its own
// instead of showing "Can't reach Eventana". A thrown fetch reached nothing
// (safe to retry); a gateway 5xx is only retried for idempotent GETs.
const COLD_START_BACKOFF_MS = [2000, 4000, 6000, 8000, 10000, 12000];

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = currentToken();
  const idempotent = (init.method ?? 'GET').toUpperCase() === 'GET';
  const opts: RequestInit = {
    ...init,
    headers: {
      'content-type': 'application/json',
      // The signed token identifies the customer. (The old x-customer-id header
      // is gone: the server never read it for scoping, and sending it tripped
      // CORS preflight because it isn't in the API's allowed-headers list.)
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(init.headers ?? {}),
    },
  };
  let res: Response;
  let attempt = 0;
  for (;;) {
    try {
      res = await fetch(`${BASE}${path}`, opts);
      const gateway = res.status === 502 || res.status === 503 || res.status === 504;
      if (gateway && idempotent && attempt < COLD_START_BACKOFF_MS.length) {
        await sleep(COLD_START_BACKOFF_MS[attempt++]);
        continue;
      }
      break;
    } catch (err) {
      // Only retry idempotent (GET) requests — a thrown fetch on a POST may have
      // reached the server and been applied, so re-sending could double-book.
      if (idempotent && attempt < COLD_START_BACKOFF_MS.length) { await sleep(COLD_START_BACKOFF_MS[attempt++]); continue; }
      throw err;
    }
  }
  const text = await res.text();
  // A non-JSON body (proxy/WAF HTML error page) must not crash with a raw
  // SyntaxError — fall back to null and let the status drive the message.
  let body: any = null;
  if (text) { try { body = JSON.parse(text); } catch { body = null; } }
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
    coverImageUrl: string | null; gallery: string[];
    items: Array<{ name: string; detail: string; assets: string[] }>;
  }>;
  themes: Array<{
    id: string; name: string; tags: string[]; colors: string[]; gradient: string;
    coverImageUrl: string | null; gallery: string[]; popular: boolean; featured: boolean; celebrationType: string;
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

  socialProof: () =>
    request<{
      packages: Record<string, { avg: number; count: number }>;
      overall: { avg: number; count: number };
      testimonials: Array<{ stars: number; feedback: string; name: string }>;
    }>('/api/social-proof'),

  /**
   * The guest feedback link (?event=<id>&fb=<token>). No login: the signed
   * token itself authorises rating exactly this one event, so a customer who
   * booked without an account can still leave feedback.
   */
  guestFeedbackInfo: (event: string, token: string) =>
    request<{ eventId: string; eventDate: string | null; honour: string | null; rating: { stars: number; feedback: string | null } | null }>(
      `/api/public/feedback?event=${encodeURIComponent(event)}&t=${encodeURIComponent(token)}`,
    ),
  submitGuestFeedback: (event: string, token: string, stars: number, feedback?: string) =>
    request<{ ok: true; stars: number }>('/api/public/feedback', {
      method: 'POST',
      body: JSON.stringify({ event, t: token, stars, feedback }),
    }),

  weather: (lat: number, lng: number, date: string) =>
    request<{
      available: boolean; reason?: string; date?: string;
      tempMax?: number; tempMin?: number; precipMm?: number; windMax?: number;
      emoji?: string; label?: string; outdoorNote?: string;
    }>(`/api/weather?lat=${lat}&lng=${lng}&date=${date}`),

  quote: (cart: CartInput, offerToken?: string | null) =>
    request<QuoteResult>('/api/quote', { method: 'POST', body: JSON.stringify(offerToken ? { ...cart, offerToken } : cart) }),

  /** A manual-order offer link — the products the team pre-selected. */
  getOffer: (token: string) =>
    request<{
      status: 'open' | 'used';
      celebrationType: string;
      packageId: string | null;
      services: Array<{ serviceId: string; quantity: number }>;
      themeId: string | null;
      items: Array<{ label: string; quantity: number; amountDisplay: string }>;
      subtotalDisplay: string;
    }>(`/api/offer/${encodeURIComponent(token)}`),

  startTimes: () => request<Array<{ value: string; allowed: boolean }>>('/api/start-times'),

  checkout: (
    cart: unknown,
    provider: string,
    discounts?: { promoCode?: string | null; useCredit?: boolean; redeemPoints?: boolean },
    termsAccepted?: boolean,
    guest?: { name: string; phone: string; backupPhone: string; email: string },
    offerToken?: string | null,
  ) =>
    request<{
      orderId: string; orderToken: string; checkoutUrl: string | null; embeddedUrl?: string | null;
      clientSecret?: string | null; publishableKey?: string | null; eligible: boolean;
      totalFils: number; holdExpiresAt: string;
    }>('/api/checkout', {
      method: 'POST',
      body: JSON.stringify({
        cart, customerId: currentCustomerId(), provider, discounts, termsAccepted, guest,
        offerToken: offerToken || undefined,
        // Which ad brought them here, if any — the server reports the paid
        // booking back to Meta against it.
        attribution: attributionPayload(),
      }),
    }),

  /** Standalone shop checkout — custom printed & digital goods, no party. */
  shopCheckout: (body: {
    items: Array<{ serviceId: string; quantity: number }>;
    emirate: string | null;
    address?: { area?: string; street?: string; villa?: string; details?: string } | null;
    customization?: { refImages?: string[]; wantDraw?: boolean } | null;
    provider: string;
    termsAccepted: boolean;
    guest?: { name: string; phone: string; backupPhone: string; email: string };
  }) =>
    request<{
      orderId: string; orderToken: string; checkoutUrl: string | null; embeddedUrl?: string | null;
      clientSecret?: string | null; publishableKey?: string | null;
      eligible: boolean; totalFils: number; readyBy: string;
    }>('/api/shop/checkout', {
      method: 'POST',
      body: JSON.stringify({ ...body, attribution: attributionPayload() }),
    }),

  checkPromo: (code: string, subtotalFils: number) =>
    request<{ ok: boolean; code?: string; amountFils?: number; reason?: string }>(
      '/api/promo/check',
      { method: 'POST', body: JSON.stringify({ code, subtotalFils }) },
    ),

  register: async (body: { name: string; email: string; phone: string; backupPhone?: string; password: string; referralCode?: string; dateOfBirth?: string }) => {
    const res = await request<{ customerId: string; name: string; email: string; phone: string; token: string; referralCode: string; welcomeCreditFils: number }>(
      '/api/customers/register',
      { method: 'POST', body: JSON.stringify({ ...body, attribution: attributionPayload() }) },
    );
    // Middle-of-funnel conversion → Meta (pixel; the server mirrors it via CAPI).
    trackCompleteRegistration(res.customerId);
    return res;
  },

  me: () =>
    request<{ name: string; email: string; phone: string; backupPhone: string | null; dateOfBirth: string | null }>(
      '/api/customers/me',
    ),

  updateMe: (body: { name?: string; phone?: string; backupPhone?: string; dateOfBirth?: string }) =>
    request<{ ok: boolean }>('/api/customers/me', { method: 'PATCH', body: JSON.stringify(body) }),

  login: (body: { email: string; password: string }) =>
    request<{ customerId: string; name: string; email: string; phone: string; token: string; referralCode: string | null }>(
      '/api/customers/login',
      { method: 'POST', body: JSON.stringify(body) },
    ),

  forgotPassword: (email: string) =>
    request<{ ok: boolean }>('/api/customers/forgot', { method: 'POST', body: JSON.stringify({ email }) }),

  resetPassword: (token: string, password: string) =>
    request<{ customerId: string; name: string; email: string; phone: string; token: string }>(
      '/api/customers/reset',
      { method: 'POST', body: JSON.stringify({ token, password }) },
    ),

  order: (orderId: string, token?: string) =>
    request<{
      orderId: string; status: string; kind: string; paymentStatus: string; eventId: string | null;
      confirmed: boolean; totalDisplay: string; totalFils: number;
    }>(`/api/orders/${orderId}${token ? `?t=${encodeURIComponent(token)}` : ''}`),

  // Manual-order payment link (opened from a Manager-sent WhatsApp link).
  payLinkLoad: (orderId: string, t: string) =>
    request<any>(`/api/orders/${orderId}/paylink?t=${encodeURIComponent(t)}`),
  payLinkSave: (orderId: string, t: string, body: Record<string, unknown>) =>
    request<{ ok: boolean }>(`/api/orders/${orderId}/paylink?t=${encodeURIComponent(t)}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  payLinkPay: (orderId: string, t: string) =>
    request<{ clientSecret?: string | null; publishableKey?: string | null; eligible?: boolean; alreadyPaid?: boolean }>(
      `/api/orders/${orderId}/paylink/pay?t=${encodeURIComponent(t)}`,
      { method: 'POST' },
    ),

  events: () => request<any[]>('/api/events'),
  // When the booking was opened from the signed email link, pass its token so an
  // account-less viewer is authorised read-only (the server also accepts it for
  // a logged-in owner). A signed-in owner with no pending token loads normally.
  event: (eventId: string) => {
    const fb = currentFb();
    return request<any>(`/api/events/${eventId}${fb ? `?fb=${encodeURIComponent(fb)}` : ''}`);
  },

  /** Link a booking opened from the signed email link onto the signed-in
   *  account (uses the normal auth headers). Called right after login/register. */
  claimBooking: (eventId: string, fb: string) =>
    request<{ ok: true }>(`/api/events/${eventId}/claim`, {
      method: 'POST',
      body: JSON.stringify({ fb }),
    }),

  rebook: (eventId: string) => request<Record<string, unknown>>(`/api/events/${eventId}/rebook`),

  cancellationQuote: (eventId: string) =>
    request<any>(`/api/events/${eventId}/cancellation-quote`),

  cancelEvent: (eventId: string, reason?: string) =>
    request<any>(`/api/events/${eventId}/cancel`, {
      method: 'POST',
      body: JSON.stringify(reason ? { reason } : {}),
    }),

  reschedule: (eventId: string, date: string, startTime: string) =>
    request<{ ok: boolean; date: string; startTime: string; endTime: string }>(
      `/api/events/${eventId}/reschedule`,
      { method: 'POST', body: JSON.stringify({ date, startTime }) },
    ),

  rewards: () =>
    request<{
      points: number; redeemableFils: number; referralCode: string | null; creditFils: number;
      lifetimeEarned: number; tier: string;
      nextTier: string | null; pointsToNextTier: number; progressPct: number;
      vouchers: Array<{ code: string; percent: number; expiresAt: string | null }>;
      history: Array<{ points: number; reason: string; at: string | null }>;
    }>('/api/rewards'),

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

  setupPhoto: (eventId: string, itemKey: string, description: string, photoUrl?: string) =>
    request<any>(`/api/events/${eventId}/setup-photos`, {
      method: 'POST',
      body: JSON.stringify({ itemKey, description, photoUrl }),
    }),

  /** Sign + upload an event photo straight to Cloudinary; returns its URL. */
  uploadEventImage: async (eventId: string, file: File): Promise<string> => {
    const s = await request<any>(`/api/events/${eventId}/uploads/sign`, { method: 'POST', body: JSON.stringify({}) });
    const form = new FormData();
    form.append('file', file);
    form.append('api_key', s.apiKey);
    form.append('timestamp', String(s.timestamp));
    form.append('signature', s.signature);
    form.append('folder', s.folder);
    const res = await fetch(s.uploadUrl, { method: 'POST', body: form });
    const j = await res.json();
    if (!res.ok) throw new Error(j?.error?.message ?? 'Upload failed');
    return j.secure_url as string;
  },

  /** Upload a custom-theme reference image (pre-booking) → returns its URL. */
  uploadThemeRef: async (file: File): Promise<string> => {
    const s = await request<any>('/api/customers/uploads/sign', { method: 'POST', body: JSON.stringify({}) });
    const form = new FormData();
    form.append('file', file);
    form.append('api_key', s.apiKey);
    form.append('timestamp', String(s.timestamp));
    form.append('signature', s.signature);
    form.append('folder', s.folder);
    const res = await fetch(s.uploadUrl, { method: 'POST', body: form });
    const j = await res.json();
    if (!res.ok) throw new Error(j?.error?.message ?? 'Upload failed');
    return j.secure_url as string;
  },

  /** Fetch the signed Apple Wallet pass and return a blob URL to open it. */
  walletPass: async (eventId: string): Promise<string> => {
    const token = currentToken();
    const res = await fetch(`${BASE}/api/events/${eventId}/pass`, {
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
    });
    if (!res.ok) throw new Error('Pass not available yet.');
    return URL.createObjectURL(await res.blob());
  },

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

  plan: (body: { celebrationType: string; childrenCount: number; budgetFils?: number | null; age?: string }) =>
    request<{
      kind: string; celebrationType: string; packageId: string | null;
      services: Record<string, number>; themeId: string | null; themeName: string | null;
      estTotalFils: number; summary: string;
    }>('/api/plan', { method: 'POST', body: JSON.stringify(body) }),
};
