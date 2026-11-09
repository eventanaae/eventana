/**
 * Loads Stripe.js on demand (no npm dependency, no build change) and mounts
 * Stripe Embedded Checkout — the card / Apple Pay form renders INSIDE the app,
 * with no redirect to an external page. Confirmation still comes from the
 * server: on completion Stripe returns the page to our own /?order=… screen,
 * which polls until the server confirms the payment.
 */
let loading: Promise<any> | null = null;

function loadStripeJs(): Promise<any> {
  if ((window as any).Stripe) return Promise.resolve((window as any).Stripe);
  if (loading) return loading;
  const SRC = 'https://js.stripe.com/v3/';
  let settled = false;
  let timer: number | undefined;
  const mine: Promise<any> = new Promise((resolve, reject) => {
    // A failed load must not be cached: drop the promise and the dead <script>
    // tag so the next attempt (the "Try again" button) really re-downloads
    // Stripe.js instead of re-using the same rejected promise forever.
    const fail = (el: Element | null) => {
      if (settled) return;
      settled = true;
      if (timer) window.clearTimeout(timer);
      if (loading === mine) loading = null; // only clear OUR attempt
      try { el?.remove(); } catch { /* ignore */ }
      reject(new Error('Stripe.js failed to load'));
    };
    const existing = document.querySelector(`script[src="${SRC}"]`);
    const done = (el: Element | null) => {
      if ((window as any).Stripe) { settled = true; if (timer) window.clearTimeout(timer); resolve((window as any).Stripe); }
      else fail(el);
    };
    if (existing) {
      existing.addEventListener('load', () => done(existing));
      existing.addEventListener('error', () => fail(existing));
      if ((window as any).Stripe) resolve((window as any).Stripe);
      return;
    }
    const s = document.createElement('script');
    s.src = SRC;
    s.async = true;
    s.onload = () => done(s);
    s.onerror = () => fail(s);
    // A blocked/hanging request never fires onerror on some mobile browsers —
    // give up after 45s (slow 3G still finishes) so the customer gets an error +
    // retry, not a blank box. Cleared as soon as the script loads or errors.
    timer = window.setTimeout(() => { if (!(window as any).Stripe) fail(s); }, 45_000);
    document.head.appendChild(s);
  });
  loading = mine;
  return mine;
}

export interface StripeMountHandle {
  destroy: () => void;
}

/**
 * Mount Stripe Embedded Checkout into `el`. Returns a handle to tear it down.
 * `onError` is called if Stripe.js or the mount fails, so the caller can fall
 * back gracefully.
 */
export async function mountStripeCheckout(args: {
  el: HTMLElement;
  publishableKey: string;
  clientSecret: string;
  onError?: (message: string) => void;
}): Promise<StripeMountHandle> {
  try {
    const StripeCtor = await loadStripeJs();
    const stripe = StripeCtor(args.publishableKey);
    const checkout = await stripe.initEmbeddedCheckout({ clientSecret: args.clientSecret });
    checkout.mount(args.el);
    return {
      destroy: () => {
        try {
          checkout.destroy();
        } catch {
          /* already gone */
        }
      },
    };
  } catch (err) {
    args.onError?.((err as Error).message || 'Could not load the payment form.');
    return { destroy: () => {} };
  }
}
