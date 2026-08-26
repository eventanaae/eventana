/**
 * Dashboard API client. Every call carries the staff token; the API
 * rejects the whole /api/admin surface without it.
 */
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
 * Staff access token. Entered by the staff member on this device (so it is
 * never baked into a distributed app binary), with a build-time fallback for
 * the web deployment. A stepping stone to real staff SSO.
 */
const STAFF_TOKEN_KEY = 'eventana.staffToken';

export function getStaffToken(): string {
  try {
    return localStorage.getItem(STAFF_TOKEN_KEY) || (import.meta.env.VITE_STAFF_TOKEN ?? '');
  } catch {
    return import.meta.env.VITE_STAFF_TOKEN ?? '';
  }
}
export function setStaffToken(t: string): void {
  try {
    localStorage.setItem(STAFF_TOKEN_KEY, t.trim());
  } catch {
    /* storage unavailable — kept for this session only */
  }
}
export function clearStaffToken(): void {
  try {
    localStorage.removeItem(STAFF_TOKEN_KEY);
  } catch {
    /* ignore */
  }
}
export function hasStaffToken(): boolean {
  return getStaffToken().length > 0;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
// The free-tier API sleeps after ~15 min idle and cold-starts on the next
// request (~50s), during which it may refuse the connection or return a 502.
// Retry through that window so the dashboard reconnects on its own instead of
// showing "Can't reach the Eventana engine". A thrown fetch means nothing
// reached the server (safe to retry anything); a gateway 5xx is only retried
// for idempotent GETs.
const COLD_START_BACKOFF_MS = [2000, 4000, 6000, 8000, 10000, 12000];

// A single place the UI can hook to surface any failed request, so a broken
// load or a failed action is never silent (spinner-forever / no-op button).
let onApiError: ((message: string) => void) | null = null;
export function setApiErrorHandler(fn: ((message: string) => void) | null): void {
  onApiError = fn;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const idempotent = (init.method ?? 'GET').toUpperCase() === 'GET';
  const opts: RequestInit = {
    ...init,
    headers: {
      'content-type': 'application/json',
      'x-staff-token': getStaffToken(),
      'x-staff-name': 'Maryam',
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
      // Only retry idempotent (GET) requests — re-sending a POST could double-apply.
      if (idempotent && attempt < COLD_START_BACKOFF_MS.length) { await sleep(COLD_START_BACKOFF_MS[attempt++]); continue; }
      onApiError?.('Network error — please check your connection and try again.');
      throw err;
    }
  }
  const text = await res.text();
  let body: any = null;
  if (text) { try { body = JSON.parse(text); } catch { body = null; } }
  if (!res.ok) {
    const message = body?.message ?? body?.error ?? `Request failed (${res.status})`;
    onApiError?.(message);
    throw new Error(message);
  }
  return body as T;
}

export const api = {
  today: () => request<any>('/api/admin/today'),
  shopOrders: () => request<any[]>('/api/admin/shop-orders'),
  whatsappLeads: (status?: string) =>
    request<any>(`/api/admin/whatsapp/leads${status && status !== 'all' ? `?status=${status}` : ''}`),
  whatsappFunnel: () => request<any>('/api/admin/whatsapp/funnel'),
  events: (status?: string) =>
    request<any[]>(`/api/admin/events${status ? `?status=${status}` : ''}`),
  event: (id: string) => request<any>(`/api/admin/events/${id}`),
  uploadDesign: (id: string, imageUrl: string) =>
    request<any>(`/api/admin/events/${id}/design`, { method: 'POST', body: JSON.stringify({ imageUrl }) }),

  setPhase: (id: string, phase: string, eta?: string) =>
    request<any>(`/api/admin/events/${id}/phase`, {
      method: 'POST',
      body: JSON.stringify({ phase, eta }),
    }),
  sendSampleEmails: (email: string) =>
    request<{ sent: number; total: number; failed: string[] }>('/api/admin/notifications/test', {
      method: 'POST',
      body: JSON.stringify({ email }),
    }),
  previewResendConfirmations: () =>
    request<{ dryRun: true; count: number; recipients: Array<{ id: string; kind: string; name: string | null; email: string | null }> }>(
      '/api/admin/notifications/resend-confirmations',
      { method: 'POST', body: JSON.stringify({ dryRun: true }) },
    ),
  resendConfirmations: () =>
    request<{ sent: number; total: number; failed: string[] }>('/api/admin/notifications/resend-confirmations', {
      method: 'POST',
      body: JSON.stringify({ confirm: true }),
    }),
  reply: (id: string, body: string) =>
    request<any>(`/api/admin/events/${id}/messages`, {
      method: 'POST',
      body: JSON.stringify({ body }),
    }),
  cancelEvent: (id: string, reason: string) =>
    request<any>(`/api/admin/events/${id}/cancel`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    }),
  reinstateEvent: (id: string) =>
    request<any>(`/api/admin/events/${id}/reinstate`, { method: 'POST' }),
  setChat: (id: string, open: boolean) =>
    request<any>(`/api/admin/events/${id}/chat`, { method: 'POST', body: JSON.stringify({ open }) }),

  tasks: () => request<any[]>('/api/admin/tasks'),
  setTask: (id: number, status: string, blockedReason?: string) =>
    request<any>(`/api/admin/tasks/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status, blockedReason }),
    }),

  inventory: () => request<any[]>('/api/admin/inventory'),
  setAsset: (code: string, patch: Record<string, unknown>) =>
    request<any>(`/api/admin/inventory/${code}`, { method: 'PATCH', body: JSON.stringify(patch) }),

  consumables: () => request<any[]>('/api/admin/consumables'),
  saveConsumable: (body: Record<string, unknown>) =>
    request<any>('/api/admin/consumables', { method: 'POST', body: JSON.stringify(body) }),
  adjustConsumable: (id: string, delta: number, reason?: string) =>
    request<any>(`/api/admin/consumables/${id}/adjust`, {
      method: 'POST',
      body: JSON.stringify({ delta, reason }),
    }),

  missingItems: () => request<any[]>('/api/admin/missing-items'),
  reportMissing: (body: Record<string, unknown>) =>
    request<any>('/api/admin/missing-items', { method: 'POST', body: JSON.stringify(body) }),
  setMissingStatus: (id: number, status: string) =>
    request<any>(`/api/admin/missing-items/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    }),

  me: () => request<{ id?: string; name: string; role: string }>('/api/admin/me'),
  latestBooking: () => request<any>('/api/admin/bookings/latest'),

  team: () => request<any[]>('/api/admin/team'),
  setTeamAccess: (id: string, accessLevel: string, rotateToken = false) =>
    request<any>(`/api/admin/team/${id}/access`, {
      method: 'PATCH',
      body: JSON.stringify({ accessLevel, rotateToken }),
    }),
  myEvents: () => request<any[]>('/api/admin/my-events'),
  setTeamProfile: (id: string, patch: Record<string, unknown>) =>
    request<any>(`/api/admin/team/${id}/profile`, { method: 'PATCH', body: JSON.stringify(patch) }),

  teamSchedule: (month?: string) =>
    request<any>(`/api/admin/team-schedule${month ? `?month=${month}` : ''}`),
  addDayOff: (body: Record<string, unknown>) =>
    request<any>('/api/admin/days-off', { method: 'POST', body: JSON.stringify(body) }),
  setDayOffStatus: (id: number, status: string) =>
    request<any>(`/api/admin/days-off/${id}`, { method: 'PATCH', body: JSON.stringify({ status }) }),
  deleteDayOff: (id: number) => request<any>(`/api/admin/days-off/${id}`, { method: 'DELETE' }),

  settings: () => request<any>('/api/admin/settings'),
  saveRules: (patch: Record<string, unknown>) =>
    request<any>('/api/admin/settings/rules', { method: 'PATCH', body: JSON.stringify(patch) }),
  saveZone: (emirate: string, patch: Record<string, unknown>) =>
    request<any>(`/api/admin/delivery-zones/${encodeURIComponent(emirate)}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),

  needsReview: () => request<any[]>('/api/admin/needs-review'),
  audit: (orderId: string) => request<any[]>(`/api/admin/orders/${orderId}/audit`),
  refund: (orderId: string, amountFils: number, reason: string) =>
    request<any>(`/api/admin/orders/${orderId}/refund`, {
      method: 'POST',
      body: JSON.stringify({ amountFils, reason }),
    }),
  reconcile: () => request<any>('/api/admin/reconcile', { method: 'POST' }),
  notifications: () => request<any[]>('/api/admin/notifications'),
  alerts: () => request<any>('/api/admin/alerts'),

  /** Sign + upload an image straight to Cloudinary; returns its secure URL. */
  uploadImage: async (file: File, folder: 'receipts' | 'themes' | 'designs' | 'setup-photos'): Promise<string> => {
    const s = await request<any>('/api/admin/uploads/sign', { method: 'POST', body: JSON.stringify({ folder }) });
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

  marketing: () => request<any>('/api/admin/marketing'),
  createCampaign: (body: Record<string, unknown>) =>
    request<any>('/api/admin/marketing/campaigns', { method: 'POST', body: JSON.stringify(body) }),
  sendCampaign: (id: number) =>
    request<any>(`/api/admin/marketing/campaigns/${id}/send`, { method: 'POST' }),
  submitCampaign: (id: number) =>
    request<any>(`/api/admin/marketing/campaigns/${id}/submit`, { method: 'POST' }),
  approveCampaign: (id: number) =>
    request<any>(`/api/admin/marketing/campaigns/${id}/approve`, { method: 'POST' }),
  rejectCampaign: (id: number, reason: string) =>
    request<any>(`/api/admin/marketing/campaigns/${id}/reject`, { method: 'POST', body: JSON.stringify({ reason }) }),
  deleteCampaign: (id: number) =>
    request<any>(`/api/admin/marketing/campaigns/${id}`, { method: 'DELETE' }),
  testCampaign: (body: Record<string, unknown>) =>
    request<any>('/api/admin/marketing/test', { method: 'POST', body: JSON.stringify(body) }),

  kpis: (month?: string) => request<any>(`/api/admin/kpis${month ? `?month=${month}` : ''}`),

  ceo: (params: { from?: string; to?: string; emirate?: string; eventType?: string; packageId?: string } = {}) => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v) qs.set(k, String(v));
    const s = qs.toString();
    return request<any>(`/api/admin/ceo${s ? `?${s}` : ''}`);
  },
  finance: (month?: string) => request<any>(`/api/admin/finance${month ? `?month=${month}` : ''}`),
  emailFinanceReport: (month?: string) =>
    request<any>(`/api/admin/finance/report${month ? `?month=${month}` : ''}`, { method: 'POST' }),
  expenses: (month?: string) => request<any>(`/api/admin/expenses${month ? `?month=${month}` : ''}`),
  addExpense: (body: Record<string, unknown>) =>
    request<any>('/api/admin/expenses', { method: 'POST', body: JSON.stringify(body) }),
  updateExpense: (id: number, body: Record<string, unknown>) =>
    request<any>(`/api/admin/expenses/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteExpense: (id: number) =>
    request<any>(`/api/admin/expenses/${id}`, { method: 'DELETE' }),
};
