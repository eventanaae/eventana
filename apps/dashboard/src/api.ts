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
  // Security cutover (2026-08-27): the dashboard NO LONGER carries a baked
  // owner token. Access requires a real login — a session token stored here by
  // email/password sign-in (or, as an emergency backdoor, a token pasted under
  // "Advanced"). No credential ships in the public bundle any more.
  try {
    return localStorage.getItem(STAFF_TOKEN_KEY) || '';
  } catch {
    return '';
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

// ── Owner "view as" (preview) ────────────────────────────────────────────────
// The owner can preview a team member's dashboard. We stash the owner's own
// session, swap in the member's, and restore it on exit — all client-side.
const OWNER_BACKUP_KEY = 'eventana.ownerBackupToken';
const PREVIEW_META_KEY = 'eventana.previewAs';

// NOTE: these live in localStorage (not sessionStorage) on purpose. Mobile
// Safari drops sessionStorage on reload/tab-switch, which used to strand the
// owner inside a previewed account with no "Exit preview" bar. localStorage
// survives reloads, so the bar always comes back and exit always restores.
export function isPreviewing(): { name: string; role: string } | null {
  try {
    const raw = localStorage.getItem(PREVIEW_META_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}
export function startPreview(token: string, name: string, role: string): void {
  try {
    localStorage.setItem(OWNER_BACKUP_KEY, getStaffToken());
    localStorage.setItem(PREVIEW_META_KEY, JSON.stringify({ name, role }));
    setStaffToken(token);
    window.location.reload();
  } catch { /* ignore */ }
}
export function exitPreview(): void {
  try {
    const owner = localStorage.getItem(OWNER_BACKUP_KEY);
    localStorage.removeItem(OWNER_BACKUP_KEY);
    localStorage.removeItem(PREVIEW_META_KEY);
    if (owner) setStaffToken(owner); else clearStaffToken();
    window.location.reload();
  } catch { /* ignore */ }
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
    // A 403 means this role simply can't see this data — the UI already hides the
    // relevant controls, so surfacing "Managers only" as a red toast just confuses
    // staff. Swallow the toast for permission errors (the caller still gets the throw).
    if (res.status !== 403) onApiError?.(message);
    throw new Error(message);
  }
  return body as T;
}

export const api = {
  // ── Staff email/password auth (public endpoints) ──
  staffLogin: (email: string, password: string) => request<{ token: string; name: string; role: string }>('/api/staff/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
  staffForgot: (email: string) => request<{ ok: boolean }>('/api/staff/forgot', { method: 'POST', body: JSON.stringify({ email }) }),
  staffSetPassword: (token: string, password: string) => request<{ ok: boolean; email: string | null; name: string }>('/api/staff/set-password', { method: 'POST', body: JSON.stringify({ token, password }) }),
  teamProfile: (id: string, body: { name?: string; birthday?: string | null; phone?: string | null; color?: string }) => request<any>(`/api/admin/team/${id}/profile`, { method: 'PATCH', body: JSON.stringify(body) }),
  myProfile: () => request<any>('/api/admin/my-profile'),
  updateMyProfile: (body: { birthday?: string | null; passportName?: string; passportNumber?: string; emiratesId?: string }) => request<any>('/api/admin/my-profile', { method: 'PATCH', body: JSON.stringify(body) }),
  setPerformance: (id: string, body: { jobTitle?: string; feedback?: string }) => request<any>(`/api/admin/team/${id}/performance`, { method: 'PATCH', body: JSON.stringify(body) }),
  // Owner: manage staff logins
  teamInvite: (name: string, email: string, accessLevel: string) => request<any>('/api/admin/team/invite', { method: 'POST', body: JSON.stringify({ name, email, accessLevel }) }),
  teamSetupLink: (id: string) => request<any>(`/api/admin/team/${id}/setup-link`, { method: 'POST' }),
  teamSetActive: (id: string, active: boolean) => request<any>(`/api/admin/team/${id}/active`, { method: 'PATCH', body: JSON.stringify({ active }) }),
  impersonate: (id: string) => request<{ token: string; name: string; role: string }>(`/api/admin/team/${id}/impersonate`, { method: 'POST' }),

  today: () => request<any>('/api/admin/today'),
  overview: (period?: string) => request<any>(`/api/admin/overview${period ? `?period=${period}` : ''}`),
  assignStaff: (eventId: string) => request<any>(`/api/admin/staffing/assign/${eventId}`, { method: 'POST' }),
  staffingPlan: (eventId: string) => request<any[]>(`/api/admin/staffing/${eventId}`),
  assignAllStaff: () => request<any>('/api/admin/staffing/assign-all', { method: 'POST' }),
  staffingCrew: () => request<any[]>('/api/admin/staffing-crew'),
  // Pre-event preparation (internal only)
  prepPlan: (eventId: string) => request<any>(`/api/admin/prep/${eventId}`),
  prepGenerate: (eventId: string) => request<any>(`/api/admin/prep/${eventId}/generate`, { method: 'POST' }),
  prepGenerateAll: () => request<any>('/api/admin/prep/generate-all', { method: 'POST' }),
  prepBoard: () => request<any[]>('/api/admin/prep-board'),
  prepEvents: () => request<any[]>('/api/admin/prep-events'),
  prepMine: () => request<any[]>('/api/admin/prep-mine'),
  prepComplete: (taskId: string, photoUrl?: string) =>
    request<any>(`/api/admin/prep/task/${taskId}/complete`, { method: 'POST', body: JSON.stringify({ photoUrl }) }),
  prepSetStatus: (taskId: string, status: string, note?: string) =>
    request<any>(`/api/admin/prep/task/${taskId}/status`, { method: 'POST', body: JSON.stringify({ status, note }) }),
  prepToggleChecklist: (taskId: string, index: number, done: boolean) =>
    request<any>(`/api/admin/prep/task/${taskId}/checklist`, { method: 'POST', body: JSON.stringify({ index, done }) }),
  prepSetAssignees: (taskId: string, memberIds: string[]) =>
    request<any>(`/api/admin/prep/task/${taskId}/assignees`, { method: 'POST', body: JSON.stringify({ memberIds }) }),
  staffingRequirements: (eventId: string) => request<any[]>(`/api/admin/staffing/${eventId}/requirements`),
  setStaffingRequirement: (eventId: string, role: string, count: number) =>
    request<any[]>(`/api/admin/staffing/${eventId}/requirements`, { method: 'POST', body: JSON.stringify({ role, count }) }),
  confirmPartTime: (slotId: string, name: string) =>
    request<any[]>(`/api/admin/staffing/slot/${slotId}/confirm`, { method: 'POST', body: JSON.stringify({ name }) }),
  overrideSlot: (slotId: string, assigneeId: string) =>
    request<any[]>(`/api/admin/staffing/slot/${slotId}/assign`, { method: 'POST', body: JSON.stringify({ assigneeId }) }),
  shopOrders: () => request<any[]>('/api/admin/shop-orders'),
  shopOrder: (id: string) => request<any>(`/api/admin/shop-orders/${id}`),
  shopUploadDesign: (id: string, imageUrl: string) => request<any>(`/api/admin/shop-orders/${id}/design`, { method: 'POST', body: JSON.stringify({ imageUrl }) }),
  shopSendDesign: (id: string) => request<any>(`/api/admin/shop-orders/${id}/send`, { method: 'POST' }),
  whatsappLeads: (status?: string) =>
    request<any>(`/api/admin/whatsapp/leads${status && status !== 'all' ? `?status=${status}` : ''}`),
  whatsappFunnel: () => request<any>('/api/admin/whatsapp/funnel'),
  importWhatsappLeads: (leads: unknown[]) =>
    request<{ received: number; imported: number; skipped: number }>('/api/admin/whatsapp/leads/import', {
      method: 'POST',
      body: JSON.stringify({ leads }),
    }),
  events: (status?: string) =>
    request<any[]>(`/api/admin/events${status ? `?status=${status}` : ''}`),
  event: (id: string) => request<any>(`/api/admin/events/${id}`),
  // Unpaid manual orders with the booking details kept inside cart, for back-filling
  // theme / celebration type / guest-of-honour we already know from WhatsApp.
  pendingOrderDetails: () => request<any>('/api/admin/orders/pending-details'),
  patchOrderDetails: (
    id: string,
    body: { celebrationType?: string; themeId?: string | null; eventFor?: string },
  ) => request<any>(`/api/admin/orders/${id}/details`, { method: 'PATCH', body: JSON.stringify(body) }),
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
  reportAsset: (code: string, kind: 'broken' | 'damaged' | 'maintenance' | 'other', note?: string) =>
    request<{ ok: boolean; id: number }>(`/api/admin/inventory/${code}/report`, { method: 'POST', body: JSON.stringify({ kind, note }) }),
  assetIssues: (status?: string) => request<any[]>(`/api/admin/asset-issues${status ? `?status=${status}` : ''}`),
  resolveAssetIssue: (id: number, status: 'open' | 'in_progress' | 'resolved') =>
    request<any>(`/api/admin/asset-issues/${id}`, { method: 'PATCH', body: JSON.stringify({ status }) }),

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
  refund: (orderId: string, amountFils: number, opts: { reasonCategory: 'customer_cancellation' | 'quality_issue' | 'missing_item' | 'other'; reason?: string; cancelEvent?: boolean }) =>
    request<any>(`/api/admin/orders/${orderId}/refund`, {
      method: 'POST',
      body: JSON.stringify({ amountFils, reasonCategory: opts.reasonCategory, reason: opts.reason, cancelEvent: !!opts.cancelEvent }),
    }),
  refundsReport: () => request<any>('/api/admin/refunds'),
  customers: (q?: string) => request<any[]>(`/api/admin/customers${q ? `?q=${encodeURIComponent(q)}` : ''}`),
  customer: (id: number) => request<any>(`/api/admin/customers/${id}`),
  updateCustomer: (id: number, body: { fullName?: string; email?: string; phone?: string; backupPhone?: string; emirate?: string }) =>
    request<any>(`/api/admin/customers/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  reconcile: () => request<any>('/api/admin/reconcile', { method: 'POST' }),
  notifications: () => request<any[]>('/api/admin/notifications'),
  notificationFeed: () => request<{ items: any[] }>('/api/admin/notification-feed'),
  achievements: () => request<{ rows: any[]; totalDisplay: string; totalFils: number }>('/api/admin/achievements'),
  alerts: () => request<any>('/api/admin/alerts'),
  customerFeedback: (limit?: number) => request<{ rows: any[]; count: number }>(`/api/admin/customer-feedback${limit ? `?limit=${limit}` : ''}`),

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

  catalogue: () => request<any>('/api/catalogue'),
  quotePreview: (cart: Record<string, unknown>) =>
    request<any>('/api/quote', { method: 'POST', body: JSON.stringify(cart) }),
  manualOrder: (body: { customer: Record<string, unknown>; cart: Record<string, unknown> }) =>
    request<{ orderId: string; payUrl: string; totalFils: number; totalDisplay: string }>(
      '/api/admin/orders/manual',
      { method: 'POST', body: JSON.stringify(body) },
    ),
  /** Product-only manual-order link: the customer completes their own checkout. */
  createOffer: (body: {
    celebrationType: string;
    packageId?: string | null;
    services: Array<{ serviceId: string; quantity: number }>;
    themeId?: string | null;
    customItems?: Array<{ name: string; priceFils: number; qty: number }>;
    discountFils?: number;
    deliveryFils?: number | null;
    customThemeFils?: number;
    refImages?: string[];
  }) =>
    request<{
      token: string; link: string;
      items: Array<{ label: string; quantity: number; amountDisplay: string }>;
      productsDisplay: string; discountDisplay: string; deliveryDisplay: string; deliveryAuto: boolean;
      totalFils: number; totalDisplay: string;
    }>('/api/admin/orders/offer', { method: 'POST', body: JSON.stringify(body) }),
  /** Add-on pay link for an existing booking — attaches to the same event on payment. */
  addonLink: (body: {
    eventId: string;
    celebrationType?: string;
    packageId?: string | null;
    services: Array<{ serviceId: string; quantity: number }>;
    customItems?: Array<{ name: string; priceFils: number; qty: number }>;
    discountFils?: number;
    deliveryFils?: number | null;
    customThemeFils?: number;
    refImages?: string[];
  }) =>
    request<{ orderId: string; payUrl: string; totalFils: number; totalDisplay: string }>(
      '/api/admin/orders/addon-link',
      { method: 'POST', body: JSON.stringify(body) },
    ),
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

  // ── Finance module ──
  finCustomers: (q?: string) => request<any[]>(`/api/admin/finance/customers${q ? `?q=${encodeURIComponent(q)}` : ''}`),
  finAddCustomer: (body: Record<string, unknown>) => request<any>('/api/admin/finance/customers', { method: 'POST', body: JSON.stringify(body) }),
  // Edit an event's operational details (manager/owner). Time change safely
  // shifts the reserved inventory holds.
  eventUpdateDetails: (eventId: string, patch: { startTime?: string; endTime?: string; emirate?: string; eventFor?: string | null; themeId?: string | null }) =>
    request(`/api/admin/events/${eventId}/details`, { method: 'PATCH', body: JSON.stringify(patch) }),
  themesList: () => request<{ rows: Array<{ id: string; name: string; celebration_type: string }> }>('/api/admin/themes-list'),
  // QuickBooks Online connection (owner).
  qbStatus: () => request<{ configured: boolean; connected: boolean; realmId?: string; environment?: string; companyName?: string }>('/api/admin/quickbooks/status'),
  qbConnect: () => request<{ url: string }>('/api/admin/quickbooks/connect'),
  qbDisconnect: () => request('/api/admin/quickbooks/disconnect', { method: 'POST' }),
  qbSyncExpenses: () => request<{ started: boolean; already: boolean }>('/api/admin/quickbooks/sync-expenses', { method: 'POST' }),
  qbSyncStatus: () => request<{ running: boolean; message: string; error: string | null; result: { imported: number; withReceipt: number; total: number } | null }>('/api/admin/quickbooks/sync-status'),
  qbPreview: () => request<{ purchases: number; attachments: number; sample: { date: string | null; vendor: string | null; amount: number; account: string | null }[] }>('/api/admin/quickbooks/preview'),
  // The real customer catalogue — packages & services with live prices.
  catalog: () => request<{ packages: any[]; services: any[] }>('/api/admin/catalog'),
  packageUpdate: (id: string, patch: { priceFils?: number; name?: string; active?: boolean }) => request(`/api/admin/packages/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  serviceUpdate: (id: string, patch: { priceFils?: number; active?: boolean }) => request(`/api/admin/services/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  // Products (custom finance items) — manage price + description.
  products: () => request<{ rows: Array<{ id: number; name: string; priceFils: number; priceDisplay: string; description: string | null }> }>('/api/admin/products'),
  productUpdate: (id: number, patch: { name?: string; priceFils?: number; description?: string | null }) => request(`/api/admin/products/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  productDelete: (id: number) => request(`/api/admin/products/${id}`, { method: 'DELETE' }),
  // Suppliers directory.
  suppliers: () => request<{ rows: any[] }>('/api/admin/suppliers'),
  supplierCreate: (body: { name: string; contact?: string; phone?: string; email?: string; supplies?: string; note?: string }) => request('/api/admin/suppliers', { method: 'POST', body: JSON.stringify(body) }),
  supplierUpdate: (id: number, patch: any) => request(`/api/admin/suppliers/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  supplierDelete: (id: number) => request(`/api/admin/suppliers/${id}`, { method: 'DELETE' }),
  finItems: () => request<Array<{ name: string; priceFils: number; kind: string; description?: string | null }>>('/api/admin/finance/items'),
  finCreateItem: (name: string, priceFils: number, description?: string) => request<{ id: number; name: string; priceFils: number; description?: string | null }>('/api/admin/finance/items', { method: 'POST', body: JSON.stringify({ name, priceFils, description }) }),
  finInvoices: () => request<any>('/api/admin/finance/invoices'),
  finCreateInvoice: (body: Record<string, unknown>) => request<any>('/api/admin/finance/invoices', { method: 'POST', body: JSON.stringify(body) }),
  finSetInvoiceStatus: (id: number, status: string) => request<any>(`/api/admin/finance/invoices/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }),
  finUpdateInvoice: (id: number, body: Record<string, unknown>) => request<any>(`/api/admin/finance/invoices/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  finDeleteInvoice: (id: number) => request<any>(`/api/admin/finance/invoices/${id}`, { method: 'DELETE' }),
  finEmailInvoice: (id: number) => request<{ sent: boolean; to?: string; reason?: string }>(`/api/admin/finance/invoices/${id}/email`, { method: 'POST' }),
  finUpdateReceipt: (id: number, body: Record<string, unknown>) => request<any>(`/api/admin/finance/receipts/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  finEmailReceipt: (id: number) => request<{ sent: boolean; to?: string; reason?: string }>(`/api/admin/finance/receipts/${id}/email`, { method: 'POST' }),
  finReceipts: () => request<any>('/api/admin/finance/receipts'),
  finCreateReceipt: (body: Record<string, unknown>) => request<any>('/api/admin/finance/receipts', { method: 'POST', body: JSON.stringify(body) }),
  finDeleteReceipt: (id: number) => request<any>(`/api/admin/finance/receipts/${id}`, { method: 'DELETE' }),
  finAccounting: () => request<any>('/api/admin/finance/accounting'),
  finConvertUpcoming: () =>
    request<{ created: string[]; considered: number }>('/api/admin/finance/convert-upcoming', { method: 'POST' }),
  finImportHistory: () => request<{ receipts: number; groups: number }>('/api/admin/finance/import-history', { method: 'POST' }),
  finNormalizeEmirates: () => request<{ tables: Record<string, number>; canonical: string[] }>('/api/admin/finance/normalize-emirates', { method: 'POST' }),
  finBackfillSales: () => request<{ posted: number }>('/api/admin/finance/backfill-sales', { method: 'POST' }),
  finAttribute: (map: Record<string, string>) => request<{ updated: number }>('/api/admin/finance/attribute', { method: 'POST', body: JSON.stringify({ map }) }),

  financials: () => request<any>('/api/admin/financials'),
  saveFinancials: (body: {
    period: string;
    incomeFils: number;
    cogsFils?: number;
    expensesFils: number;
    incomeBreakdown?: Array<{ label: string; fils: number }>;
    expenseBreakdown?: Array<{ label: string; fils: number }>;
    note?: string;
  }) => request<any>('/api/admin/financials', { method: 'POST', body: JSON.stringify(body) }),
  deleteFinancials: (period: string) =>
    request<any>(`/api/admin/financials/${encodeURIComponent(period)}`, { method: 'DELETE' }),

  importRows: (kind: 'customers' | 'orders', rows: any[]) =>
    request<{ inserted: number }>('/api/admin/import/rows', { method: 'POST', body: JSON.stringify({ kind, rows }) }),
  saveExpensesByYear: (byYear: Record<string, number>) =>
    request<{ saved: number }>('/api/admin/import/expenses', { method: 'POST', body: JSON.stringify({ byYear }) }),
  pnlByYear: () =>
    request<Array<{ year: number; revenueFils: number; revenueDisplay: string; expensesFils: number; expensesDisplay: string; profitFils: number; profitDisplay: string; marginPct: number; hasExpenses: boolean }>>(
      '/api/admin/import/pnl-by-year',
    ),
  revenueByYear: () =>
    request<Array<{ year: number; invoices: number; lines: number; revenueFils: number; revenueDisplay: string; discountFils: number; discountDisplay: string }>>(
      '/api/admin/import/revenue-by-year',
    ),
  importProducts: () =>
    request<Array<{ product: string; lines: number; total_fils: number; totalDisplay: string }>>('/api/admin/import/products'),
  mergeProducts: (map: Record<string, string>) =>
    request<{ updated: number }>('/api/admin/import/products/merge', { method: 'POST', body: JSON.stringify({ map }) }),
  importTicket: () => request<{ ticket: string; expiresInMs: number }>('/api/admin/import/ticket', { method: 'POST' }),
  importStatus: () =>
    request<{ customers: { n: number; with_email: number; emirates: number }; orders: { n: number; with_date: number; total_fils: number } }>(
      '/api/admin/import/status',
    ),
  // Owner-only reconciliation report (fixed read-only diagnostics).
  auditReport: (section: string) => request<any>(`/api/admin/reports/audit?section=${encodeURIComponent(section)}`),
  auditLog: (action?: string) => request<{ rows: any[] }>(`/api/admin/audit-log${action ? `?action=${encodeURIComponent(action)}` : ''}`),
  normalizePhones: () => request<any>('/api/admin/reports/normalize-phones', { method: 'POST' }),
  markUnknownPayment: () => request<any>('/api/admin/reports/mark-unknown-payment', { method: 'POST' }),
  backfillRefundEmails: (dry?: boolean) => request<any>(`/api/admin/reports/backfill-refund-emails${dry ? '?dry=1' : ''}`, { method: 'POST' }),
};

/** The API origin, so a migration collector can POST straight to /api/import. */
export function apiOrigin(): string {
  return BASE;
}

// Expose the authenticated client for one-off ops tasks from the browser console
// (e.g. back-filling booking details). The staff token stays inside request();
// nothing here reads or returns it.
(window as unknown as { eventanaApi?: typeof api }).eventanaApi = api;
