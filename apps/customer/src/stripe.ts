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
  loading = new Promise((resolve, reject) => {
    const existing = document.querySelector('script[src="https://js.stripe.com/v3/"]');
    const done = () => {
      if ((window as any).Stripe) resolve((window as any).Stripe);
      else reject(new Error('Stripe.js failed to load'));
    };
    if (existing) {
      existing.addEventListener('load', done);
      existing.addEventListener('error', () => reject(new Error('Stripe.js failed to load')));
      if ((window as any).Stripe) resolve((window as any).Stripe);
      return;
    }
    const s = document.createElement('script');
    s.src = 'https://js.stripe.com/v3/';
    s.async = true;
    s.onload = done;
    s.onerror = () => reject(new Error('Stripe.js failed to load'));
    document.head.appendChild(s);
  });
  return loading;
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
