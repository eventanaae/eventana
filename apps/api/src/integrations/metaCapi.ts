/**
 * Meta Conversions API — reporting paid bookings back to the ad account.
 *
 * A thin adapter over the Graph API, no SDK. When META_PIXEL_ID or
 * META_CAPI_ACCESS_TOKEN is unset the whole thing is a graceful no-op, so
 * the booking flow is unchanged until the credentials are in.
 *
 * Why server-side rather than a browser pixel event: the Purchase is only
 * true once the PROVIDER confirms the money, and that confirmation arrives
 * on a webhook the browser never sees. Posting from here means the event
 * cannot be lost to an ad blocker, a closed tab, or a customer who never
 * returns from the payment page.
 *
 * Identity is sent as SHA-256 hashes only (Meta's requirement, and ours):
 * the raw phone and email of an Eventana customer never leave this server.
 */
import { createHash } from 'node:crypto';
import { config } from '../config.js';

export function metaCapiEnabled(): boolean {
  return Boolean(config.meta.pixelId && config.meta.capiAccessToken);
}

/** What the customer app captured on the landing click. */
export interface Attribution {
  /** Meta's click id cookie value, `fb.1.<ts>.<fbclid>`. */
  fbc?: string | null;
  /** Meta's browser id cookie value, `fb.1.<ts>.<random>`. */
  fbp?: string | null;
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
  utmContent?: string | null;
  utmTerm?: string | null;
  /** Page the visitor first landed on — Meta wants an event_source_url. */
  landingUrl?: string | null;
  userAgent?: string | null;
  clientIp?: string | null;
}

export interface CapiResult {
  ok: boolean;
  eventsReceived?: number;
  error?: string;
}

/** Meta hashes lowercase, trimmed values; phones as digits only, with country code. */
function hash(value: string | null | undefined): string | undefined {
  const v = (value ?? '').trim().toLowerCase();
  if (!v) return undefined;
  return createHash('sha256').update(v).digest('hex');
}

function hashPhone(value: string | null | undefined): string | undefined {
  // Digits only. A local UAE number (05x…) is meaningless to Meta without a
  // country code, so promote it to 9715x… before hashing.
  let digits = (value ?? '').replace(/\D+/g, '');
  if (!digits) return undefined;
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.startsWith('0')) digits = `971${digits.slice(1)}`;
  else if (digits.length === 9 && digits.startsWith('5')) digits = `971${digits}`;
  return createHash('sha256').update(digits).digest('hex');
}

/** Splits "Sara Al Mansoori" into the first/last names Meta matches on. */
function splitName(name: string | null | undefined): { fn?: string; ln?: string } {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return {};
  if (parts.length === 1) return { fn: parts[0] };
  return { fn: parts[0], ln: parts.slice(1).join(' ') };
}

/**
 * Posts one Purchase event.
 *
 * `eventId` must be the Eventana order id: Meta de-duplicates on it, so a
 * replayed webhook — or a browser pixel that later sends the same purchase
 * — is counted once, not twice.
 */
export async function sendPurchaseEvent(args: {
  orderId: string;
  valueFils: number;
  currency?: string;
  /** When the payment was confirmed. Meta rejects events older than 7 days. */
  occurredAt?: Date;
  customer?: { name?: string | null; phone?: string | null; email?: string | null };
  attribution?: Attribution | null;
  /** 'booking' | 'shop' — reported as the content category. */
  kind?: string;
}): Promise<CapiResult> {
  const pixelId = config.meta.pixelId;
  const accessToken = config.meta.capiAccessToken;
  if (!pixelId || !accessToken) return { ok: false, error: 'meta_capi_disabled' };

  const attr = args.attribution ?? {};
  const { fn, ln } = splitName(args.customer?.name);

  const userData: Record<string, unknown> = {
    ph: hashPhone(args.customer?.phone),
    em: hash(args.customer?.email),
    fn: hash(fn),
    ln: hash(ln),
    country: hash('ae'),
    fbc: attr.fbc || undefined,
    fbp: attr.fbp || undefined,
    client_user_agent: attr.userAgent || undefined,
    client_ip_address: attr.clientIp || undefined,
  };
  for (const k of Object.keys(userData)) if (userData[k] === undefined) delete userData[k];

  // No identifiers at all means Meta can never attribute the event; skip it
  // rather than spend a request and pollute the dataset's match quality.
  if (Object.keys(userData).length === 0) {
    return { ok: false, error: 'no_match_keys' };
  }

  const event = {
    event_name: 'Purchase',
    event_time: Math.floor((args.occurredAt ?? new Date()).getTime() / 1000),
    event_id: args.orderId,
    action_source: 'website',
    ...(attr.landingUrl ? { event_source_url: attr.landingUrl } : {}),
    user_data: userData,
    custom_data: {
      currency: (args.currency ?? 'AED').toUpperCase(),
      value: Number((args.valueFils / 100).toFixed(2)),
      order_id: args.orderId,
      ...(args.kind ? { content_category: args.kind } : {}),
    },
  };

  const url = `https://graph.facebook.com/${config.meta.graphVersion}/${pixelId}/events`;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        data: [event],
        access_token: accessToken,
        ...(config.meta.testEventCode ? { test_event_code: config.meta.testEventCode } : {}),
      }),
    });
    if (!res.ok) {
      return { ok: false, error: `${res.status}: ${(await res.text()).slice(0, 300)}` };
    }
    const json = (await res.json()) as { events_received?: number };
    return { ok: true, eventsReceived: json.events_received };
  } catch (err) {
    return { ok: false, error: (err as Error).message.slice(0, 300) };
  }
}
