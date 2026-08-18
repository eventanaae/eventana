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

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      'x-staff-token': getStaffToken(),
      'x-staff-name': 'Maryam',
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(body?.message ?? body?.error ?? `Request failed (${res.status})`);
  return body as T;
}

export const api = {
  today: () => request<any>('/api/admin/today'),
  events: (status?: string) =>
    request<any[]>(`/api/admin/events${status ? `?status=${status}` : ''}`),
  event: (id: string) => request<any>(`/api/admin/events/${id}`),
  setPhase: (id: string, phase: string, eta?: string) =>
    request<any>(`/api/admin/events/${id}/phase`, {
      method: 'POST',
      body: JSON.stringify({ phase, eta }),
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

  team: () => request<any[]>('/api/admin/team'),
  setTeamAccess: (id: string, accessLevel: string, rotateToken = false) =>
    request<any>(`/api/admin/team/${id}/access`, {
      method: 'PATCH',
      body: JSON.stringify({ accessLevel, rotateToken }),
    }),
  myEvents: () => request<any[]>('/api/admin/my-events'),

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

  kpis: (month?: string) => request<any>(`/api/admin/kpis${month ? `?month=${month}` : ''}`),

  finance: (month?: string) => request<any>(`/api/admin/finance${month ? `?month=${month}` : ''}`),
  expenses: (month?: string) => request<any>(`/api/admin/expenses${month ? `?month=${month}` : ''}`),
  addExpense: (body: Record<string, unknown>) =>
    request<any>('/api/admin/expenses', { method: 'POST', body: JSON.stringify(body) }),
  updateExpense: (id: number, body: Record<string, unknown>) =>
    request<any>(`/api/admin/expenses/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteExpense: (id: number) =>
    request<any>(`/api/admin/expenses/${id}`, { method: 'DELETE' }),
};
