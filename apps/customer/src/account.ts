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

/** The id used to identify the customer to the API (empty when signed out). */
export function currentCustomerId(): string {
  return loadAccount()?.customerId ?? '';
}

/** The signed session token sent with every request, if signed in. */
export function currentToken(): string {
  return loadAccount()?.token ?? '';
}
