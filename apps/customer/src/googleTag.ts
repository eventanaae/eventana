/**
 * Google measurement — GA4 and the Google Ads conversion tag.
 *
 * Google Ads cannot bid toward bookings it never hears about. Today it hears
 * about nothing: the site has no Google tag at all, so a Search campaign could
 * only ever optimise for clicks. This module is the missing half.
 *
 * What it reports:
 *  - `page_view`, automatically, once the tag loads (GA4 only).
 *  - `begin_checkout` when the customer leaves for the payment provider. This
 *    is the audience worth retargeting — reached checkout, did not pay.
 *  - `purchase` + the Ads conversion action, but ONLY once Eventana's own
 *    server says the money is confirmed. The provider return URL proves
 *    nothing, so the Payment screen fires this after its poll flips to
 *    `confirmed` (see Payment.tsx). A refresh of that screen must not count
 *    twice, so each order id is remembered.
 *
 * Everything is a no-op unless the ids are set at build time, exactly like the
 * Meta pixel in `attribution.ts`:
 *  - VITE_GA4_ID                     e.g. G-XXXXXXXXXX
 *  - VITE_GOOGLE_ADS_ID              e.g. AW-123456789
 *  - VITE_GOOGLE_ADS_PURCHASE_LABEL  the conversion action's label
 *
 * Note the deliberate split of duties with Meta: Meta's Purchase is posted
 * server-side from the payment webhook (domain/attribution.ts) because it can
 * be signed with hashed identity. Google's equivalent — offline conversion
 * import keyed on the stored `gclid` — needs a Google Ads developer token that
 * Eventana does not have yet, so the browser tag is the interim path and the
 * gclid is banked on the order in the meantime.
 */

type GtagFn = (...args: unknown[]) => void;

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: GtagFn;
  }
}

const REPORTED_KEY = 'eventana.gads.reported';

function envId(name: 'VITE_GA4_ID' | 'VITE_GOOGLE_ADS_ID' | 'VITE_GOOGLE_ADS_PURCHASE_LABEL'): string | null {
  const raw = String((import.meta.env as Record<string, unknown>)[name] ?? '').trim();
  return raw || null;
}

function ga4Id(): string | null {
  return envId('VITE_GA4_ID');
}

function adsId(): string | null {
  return envId('VITE_GOOGLE_ADS_ID');
}

/** The full `AW-123/AbC_def` send_to target, or null when either half is missing. */
function purchaseTarget(): string | null {
  const id = adsId();
  const label = envId('VITE_GOOGLE_ADS_PURCHASE_LABEL');
  return id && label ? `${id}/${label}` : null;
}

/**
 * Loads gtag.js for whichever ids are configured.
 *
 * One script serves both products; `config` is called once per id. Called
 * before React paints so the page view lands even on a bounce.
 */
export function initGoogleTag(): void {
  const ga4 = ga4Id();
  const ads = adsId();
  if (!ga4 && !ads) return;
  if (window.gtag) return;

  window.dataLayer = window.dataLayer ?? [];
  // gtag.js reads the raw `arguments` object off dataLayer, not an array — so
  // this has to stay a plain function and push `arguments` verbatim. Writing
  // it as a rest-parameter arrow silently breaks every event.
  function gtag(): void {
    window.dataLayer!.push(arguments);
  }
  window.gtag = gtag;

  const script = document.createElement('script');
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(ga4 ?? ads!)}`;
  document.head.appendChild(script);

  gtag('js', new Date());
  if (ga4) gtag('config', ga4, { currency: 'AED' });
  // The Ads tag must not send its own page_view; a Search click is measured by
  // the conversion, and a second page hit only muddies GA4's session counting.
  if (ads) gtag('config', ads, { send_page_view: false });
}

/** Fires when the customer sends themselves to the payment provider. */
export function trackGoogleBeginCheckout(valueFils: number): void {
  try {
    window.gtag?.('event', 'begin_checkout', {
      currency: 'AED',
      value: Number((valueFils / 100).toFixed(2)),
    });
  } catch {
    /* analytics must never break the payment hand-off */
  }
}

/** True the first time an order id is seen; false on every later call. */
function claimOrder(orderId: string): boolean {
  try {
    const raw = localStorage.getItem(REPORTED_KEY);
    const seen: string[] = raw ? JSON.parse(raw) : [];
    if (seen.includes(orderId)) return false;
    // A short tail is enough — this only has to survive a page refresh.
    localStorage.setItem(REPORTED_KEY, JSON.stringify([...seen, orderId].slice(-30)));
    return true;
  } catch {
    // No storage: report once per page load rather than not at all. A double
    // count is a smaller error than a conversion Google never learns about.
    return true;
  }
}

/**
 * Reports a confirmed, paid booking to GA4 and to Google Ads.
 *
 * `kind` distinguishes a booking from a shop order or a tip. A tip is money
 * for the crew, not revenue from an ad — reporting it as a conversion would
 * teach Google to bid for the wrong thing, so it is dropped here exactly as
 * the Meta side drops it server-side.
 */
export function trackGooglePurchase(orderId: string, valueFils: number, kind: string): void {
  try {
    if (kind === 'tip') return;
    if (!window.gtag) return;
    if (!claimOrder(orderId)) return;

    const value = Number((valueFils / 100).toFixed(2));
    if (ga4Id()) {
      window.gtag('event', 'purchase', {
        transaction_id: orderId,
        currency: 'AED',
        value,
        items: [{ item_id: kind, item_name: kind, price: value, quantity: 1 }],
      });
    }
    const target = purchaseTarget();
    if (target) {
      window.gtag('event', 'conversion', {
        send_to: target,
        transaction_id: orderId,
        currency: 'AED',
        value,
      });
    }
  } catch {
    /* never let reporting break the confirmation screen */
  }
}
