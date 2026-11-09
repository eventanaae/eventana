/**
 * The signed-in customer account.
 *
 * Browsing needs no account; one is only required to confirm a booking.
 * Stored on the device so the customer stays signed in across sessions. The
 * account carries a signed session token; the catalogue and live quoting are
 * public and need no token, so browsing works fully while signed out.
 */
export interface Account {
  customerId: string;
  name: string;
  email: string;
  phone: string;
  /** Signed session token — proves who the customer is to the API. */
  token?: string;
}

const KEY = 'eventana.account';

export function loadAccount(): Account | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const a = JSON.parse(raw) as Account;
    return a && a.customerId ? a : null;
  } catch {
    return null;
  }
}

export function saveAccount(a: Account): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(a));
  } catch {
    /* storage unavailable — kept in memory for this session */
  }
}

export function clearAccount(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

/** Fired on `window` by signOut() so the app can scrub its in-memory draft. */
export const SIGNED_OUT_EVENT = 'eventana:signed-out';

/** The party draft minus anything that identifies a person or a home: the
 *  address, map pin, guest-of-honour name, custom-theme brief (child's name /
 *  age) and uploaded photos. The cart selections are kept. */
export function scrubDraftPersonalData<T extends Record<string, unknown>>(d: T): T {
  return {
    ...d,
    address: { area: '', street: '', villa: '', details: '' },
    mapPin: null,
    locationTbd: false,
    eventFor: '',
    themeBrief: null,
    // no brief left → it can't stay a (paid) custom theme with nothing to design from
    customTheme: false,
    referenceImages: [],
    customization: { refImages: [], wantDraw: false },
  };
}

/**
 * Sign out on this device AND remove the personal details the app kept in
 * browser storage: the account (name/email/phone/token), the on-device profile
 * (name + birthday — kept as "skipped" so the welcome questions don't re-appear),
 * the typed checkout contact details, a pending booking claim, and the address /
 * guest details inside the saved party draft. A shared family tablet must not
 * keep showing the previous person's details after "Log out".
 */
export function signOut(): void {
  clearAccount();
  clearPendingClaim();
  try { localStorage.setItem('eventana.profile', JSON.stringify({ name: '', birthday: '', skipped: true })); } catch { /* ignore */ }
  try {
    sessionStorage.removeItem('ev_co_reg');
    sessionStorage.removeItem('ev_co_step');
  } catch { /* ignore */ }
  try {
    const raw = localStorage.getItem('eventana.draft');
    if (raw) localStorage.setItem('eventana.draft', JSON.stringify(scrubDraftPersonalData(JSON.parse(raw))));
  } catch { /* ignore */ }
  try { window.dispatchEvent(new Event(SIGNED_OUT_EVENT)); } catch { /* ignore */ }
}

/** The id used to identify the customer to the API (empty when signed out). */
export function currentCustomerId(): string {
  return loadAccount()?.customerId ?? '';
}

/** The signed session token sent with every request, if signed in. */
export function currentToken(): string {
  return loadAccount()?.token ?? '';
}

/**
 * A booking opened from the signed email link (?event=<id>&fb=<token>) by a
 * customer WITHOUT an account. We keep the event id + its signed token here so
 * the event GET can authorise read-only access, and — once the customer logs in
 * or registers — the booking can be claimed onto their new account. Kept in
 * sessionStorage so it survives the reload that follows a successful sign-in but
 * doesn't linger once the tab is closed.
 */
export interface PendingClaim {
  eventId: string;
  fb: string;
}

const PENDING_KEY = 'eventana.pendingClaim';

export function loadPendingClaim(): PendingClaim | null {
  try {
    const raw = sessionStorage.getItem(PENDING_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as PendingClaim;
    return p && p.eventId && p.fb ? p : null;
  } catch {
    return null;
  }
}

export function setPendingClaim(p: PendingClaim): void {
  try { sessionStorage.setItem(PENDING_KEY, JSON.stringify(p)); } catch { /* storage blocked */ }
}

export function clearPendingClaim(): void {
  try { sessionStorage.removeItem(PENDING_KEY); } catch { /* ignore */ }
}

/** The signed token for the booking currently being viewed via an email link
 *  (empty when there is none). Sent with the event GET so an account-less
 *  viewer is authorised read-only. */
export function currentFb(): string {
  return loadPendingClaim()?.fb ?? '';
}
