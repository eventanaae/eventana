/**
 * Ad attribution — remembering which ad brought this visitor.
 *
 * Two jobs, both invisible to the customer:
 *
 *  1. Capture the ad click ids (`fbclid` for Meta, `gclid`/`gbraid`/`wbraid`
 *     for Google) and `utm_*` off the landing URL and keep them for the
 *     length of the click window, so a booking made three days later is
 *     still credited to the ad that started it. Checkout sends them along
 *     and the server reports the Purchase back to Meta.
 *
 *  2. Load the Meta pixel, which is what makes website audiences possible —
 *     "visited the site", "started checkout but didn't pay" — none of which
 *     exist today.
 *
 * The pixel half is inert unless VITE_META_PIXEL_ID is set, so nothing here
 * changes the app until the id is in. The Google half lives in `googleTag.ts`;
 * only the click-id capture is shared, because a click id is worth keeping
 * whether or not any tag is configured.
 */

const STORE_KEY = 'eventana.attribution';
/** Meta attributes a click for 90 days; there is no point keeping more. */
const MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;

export interface StoredAttribution {
  fbc?: string | null;
  /** Google Ads click id — the join key for an imported offline conversion. */
  gclid?: string | null;
  /** iOS/app click ids Google sends instead of gclid when cookies are limited. */
  gbraid?: string | null;
  wbraid?: string | null;
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
  utmContent?: string | null;
  utmTerm?: string | null;
  landingUrl?: string | null;
  /** When this was captured, ms since epoch. */
  at: number;
}

function readStore(): StoredAttribution | null {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredAttribution;
    if (!parsed?.at || Date.now() - parsed.at > MAX_AGE_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeStore(value: StoredAttribution): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(value));
  } catch {
    /* private mode / storage full — attribution is best-effort, never fatal */
  }
}

/** The `_fbp` browser id the pixel sets. Absent until the pixel has run. */
function fbpCookie(): string | null {
  const m = /(?:^|;\s*)_fbp=([^;]+)/.exec(document.cookie);
  return m ? decodeURIComponent(m[1]) : null;
}

/**
 * Reads the landing URL and stores what it finds.
 *
 * Last touch wins: someone who clicks a second ad should be credited to the
 * second one. A visit with no campaign parameters leaves an earlier capture
 * alone — otherwise navigating within the site would erase it.
 */
export function captureAttribution(): void {
  try {
    const params = new URLSearchParams(window.location.search);
    const fbclid = params.get('fbclid');
    // Google sends exactly one of these three: gclid on the web, gbraid/wbraid
    // when the click came through an app or an iOS privacy-limited path.
    const google = {
      gclid: params.get('gclid'),
      gbraid: params.get('gbraid'),
      wbraid: params.get('wbraid'),
    };
    const utm = {
      utmSource: params.get('utm_source'),
      utmMedium: params.get('utm_medium'),
      utmCampaign: params.get('utm_campaign'),
      utmContent: params.get('utm_content'),
      utmTerm: params.get('utm_term'),
    };
    const hasAnything =
      Boolean(fbclid) || Object.values(google).some(Boolean) || Object.values(utm).some(Boolean);
    if (!hasAnything) return;

    const previous = readStore();
    writeStore({
      // Meta's documented click-id format: fb.<subdomainIndex>.<ts>.<fbclid>
      fbc: fbclid ? `fb.1.${Date.now()}.${fbclid}` : (previous?.fbc ?? null),
      // A visit carrying only utm_* (a newsletter link, say) must not wipe the
      // click id an earlier ad click left behind — that id is what makes the
      // booking importable back into Google Ads.
      gclid: google.gclid ?? (Object.values(google).some(Boolean) ? null : (previous?.gclid ?? null)),
      gbraid: google.gbraid ?? (Object.values(google).some(Boolean) ? null : (previous?.gbraid ?? null)),
      wbraid: google.wbraid ?? (Object.values(google).some(Boolean) ? null : (previous?.wbraid ?? null)),
      ...utm,
      landingUrl: window.location.href.slice(0, 600),
      at: Date.now(),
    });
  } catch {
    /* never let analytics break the page */
  }
}

/** What checkout sends to the server. Null when there is nothing to say. */
export function attributionPayload(): Record<string, string> | null {
  const stored = readStore();
  const fbp = fbpCookie();
  const out: Record<string, string> = {};
  if (stored) {
    for (const [k, v] of Object.entries(stored)) {
      if (k === 'at') continue;
      if (typeof v === 'string' && v) out[k] = v;
    }
  }
  if (fbp) out.fbp = fbp;
  return Object.keys(out).length > 0 ? out : null;
}

/* ------------------------------------------------------------------ */
/* Meta pixel                                                          */
/* ------------------------------------------------------------------ */

type FbqFn = ((...args: unknown[]) => void) & { queue?: unknown[]; loaded?: boolean; version?: string; callMethod?: unknown };
declare global {
  interface Window {
    fbq?: FbqFn;
    _fbq?: FbqFn;
  }
}

function pixelId(): string | null {
  const raw = String(import.meta.env.VITE_META_PIXEL_ID ?? '').trim();
  return raw || null;
}

/**
 * Loads the pixel and reports the page view.
 *
 * This is the standard Meta snippet written out in TypeScript rather than
 * pasted into index.html, so the id comes from the environment and a build
 * without one ships no tracking at all.
 */
export function initPixel(): void {
  const id = pixelId();
  if (!id || window.fbq) return;

  const fbq: FbqFn = function (...args: unknown[]) {
    if (fbq.callMethod) (fbq.callMethod as (...a: unknown[]) => void).apply(fbq, args);
    else (fbq.queue as unknown[]).push(args);
  } as FbqFn;
  fbq.queue = [];
  fbq.loaded = true;
  fbq.version = '2.0';
  window.fbq = fbq;
  window._fbq = window._fbq ?? fbq;

  const script = document.createElement('script');
  script.async = true;
  script.src = 'https://connect.facebook.net/en_US/fbevents.js';
  document.head.appendChild(script);

  // Call through the local reference: `window.fbq` was just narrowed to
  // undefined by the guard above, and the queue is what matters anyway.
  fbq('init', id);
  fbq('track', 'PageView');
}

/**
 * Fires when the customer sends themselves to the payment provider.
 *
 * The point is not the number — it is the audience it builds: everyone who
 * reached checkout and did not pay, which is the warmest list Eventana can
 * retarget and does not exist today.
 */
export function trackInitiateCheckout(valueFils: number): void {
  try {
    window.fbq?.('track', 'InitiateCheckout', {
      currency: 'AED',
      value: Number((valueFils / 100).toFixed(2)),
    });
  } catch {
    /* ignore */
  }
}
