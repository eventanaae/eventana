/**
 * The signed-in customer account.
 *
 * Browsing needs no account; one is only required to confirm a booking.
 * Stored on the device so the customer stays signed in across sessions.
 * When no account exists, the API falls back to the demo customer so the
 * catalogue and quoting keep working while browsing.
 */
export interface Account {
  customerId: string;
  name: string;
  email: string;
  phone: string;
}

const KEY = 'eventana.account';
const DEMO_CUSTOMER_ID = 'CUST-4471';

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

/** The id used to identify the customer to the API. */
export function currentCustomerId(): string {
  return loadAccount()?.customerId ?? DEMO_CUSTOMER_ID;
}
