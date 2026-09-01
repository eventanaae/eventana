/**
 * The checkout sequence (spec §4).
 *
 *   1. revalidate the cart server-side
 *   2. re-check availability across the FULL operational window
 *   3. create the inventory hold transactionally, TTL from settings
 *   4. create the Order with the server-computed total
 *   5. create the provider session
 *   6. hand the hosted checkout URL back to the app
 *   7. …and then wait for the webhook. Nothing here confirms anything.
 */
import {
  effectiveEventHours,
  eventEndHour,
  formatAed,
  isCancelled,
  quote as computeQuote,
  quoteAddons,
  quoteShop,
  SHOP_READY_DAYS,
  SHOP_DIGITAL_READY_DAYS,
  SHOP_DRAWING_IDS,
  type AddonRequest,
  type CartInput,
  type Quote,
  type ShopItem,
} from '@eventana/shared';
import { randomBytes, randomUUID } from 'node:crypto';
import { config } from '../config.js';
import { pool, withTransaction } from '../db/pool.js';
import { getProvider } from '../payments/index.js';
import { ConflictError, acquireHolds, releaseHolds, unavailableAssets } from './inventory.js';
import { createOrder, createPayment, nextOrderId, orderViewToken, recordPaymentEvent } from './orders.js';
import { loadConfig, toPricingContext, type LoadedConfig } from './settings.js';
import { offerIsOpen, getOfferAdjustments, applyOfferToQuote } from './offers.js';
import { computeDiscounts, makeReferralCode, type DiscountInput } from './discounts.js';
import { resolveStaffCode } from './staffReferral.js';

export interface CheckoutRequest {
  cart: CartInput & {
    address?: Record<string, unknown>;
    mapPin?: { lat: number; lng: number } | null;
  };
  /** Signed-in customer, or null for a guest checkout (see `guest`). */
  customerId: string | null;
  /** Guest contact details, used to mint a lightweight customer when not signed in. */
  guest?: { name: string; phone: string; backupPhone: string; email: string };
  provider: string;
  lang?: 'en' | 'ar';
  idempotencyKey?: string;
  termsAccepted?: boolean;
  discounts?: DiscountInput;
  /** Ad-click parameters the app captured on landing (see metaCapi.ts). */
  attribution?: unknown;
  /** Set when the customer arrived from a manual-order link: the offer token.
   *  Marks the resulting booking source 'manual' and consumes the offer on
   *  payment so one link can only ever produce one booking. */
  offerToken?: string | null;
}

/**
 * Provider return URLs, each carrying the unguessable order-view token.
 *
 * These point at the app ROOT (with the order in the query) rather than a
 * /pay/* deep path: the static host does not rewrite deep paths to index.html,
 * so a /pay/return URL 404s ("Not Found") after payment. The app reads the
 * `order` param on any path and then polls the SERVER for the real status
 * (paid / failed / cancelled), so one root URL serves all three outcomes.
 */
function payReturnUrls(orderId: string): { successUrl: string; cancelUrl: string; failureUrl: string } {
  const t = orderViewToken(orderId);
  const base = config.publicAppUrl;
  const ret = `${base}/?order=${orderId}&t=${t}`;
  return { successUrl: ret, cancelUrl: ret, failureUrl: ret };
}

export class CheckoutError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'CheckoutError';
  }
}

/**
 * Every physical asset a cart needs: the package's own items plus each
 * chosen service, with the bouncy castle resolved to the colour the
 * customer picked.
 */
export function resolveRequiredAssets(cart: CartInput, cfg: LoadedConfig): string[] {
  const assets = new Set<string>();

  const pkg = cart.packageId ? cfg.packages.get(cart.packageId) : null;
  if (pkg) for (const item of pkg.items) for (const a of item.assets) assets.add(a);

  for (const line of cart.services) {
    const svc = cfg.services.get(line.serviceId);
    if (!svc) continue;
    for (const a of svc.requiresAssets) assets.add(a);
  }

  // The castle is one asset per colour; swap the catalogue's default for
  // the chosen variant so two customers can hold different colours at the
  // same time but never the same one.
  if (cart.castleVariant && [...assets].some((a) => a.startsWith('castle-'))) {
    for (const a of [...assets]) if (a.startsWith('castle-')) assets.delete(a);
    assets.add(cart.castleVariant);
  }

  return [...assets];
}

/** Read-only quote for the app's live total. Never creates anything. */
export async function previewQuote(cart: CartInput, offerToken?: string | null): Promise<Quote & { unavailable: string[] }> {
  const cfg = await loadConfig();
  let taken = new Set<string>();

  if (cart.eventDate && cart.startTime) {
    const assets = resolveRequiredAssets(cart, cfg);
    taken = await unavailableAssets(
      pool,
      assets,
      cart.eventDate,
      cart.startTime,
      eventEndHour(cart.startTime, cfg.rules, 0, effectiveEventHours(cart, cfg.rules)),
    );
  }

  const result = computeQuote(cart, { ...toPricingContext(cfg, taken), nowMs: Date.now() });
  // Same manual offer pieces as the final checkout, so the live total the
  // customer sees on a manual-order link matches exactly what they will pay.
  if (offerToken) {
    const adj = await getOfferAdjustments(offerToken);
    if (adj) applyOfferToQuote(result, adj);
  }
  return { ...result, unavailable: [...taken] };
}

export interface CheckoutResult {
  orderId: string;
  /** The order-view token, so the app can poll status even in the in-app
   *  (embedded) flow where there is no provider return URL to carry it. */
  orderToken: string;
  paymentId: string;
  provider: string;
  checkoutUrl: string | null;
  /** In-app iframe widget URL (Ziina); null when only a hosted redirect exists. */
  embeddedUrl?: string | null;
  /** Stripe embedded-checkout client secret; the app mounts Stripe.js with it. */
  clientSecret?: string | null;
  /** Stripe publishable key so the app can init Stripe.js. */
  publishableKey?: string | null;
  eligible: boolean;
  totalFils: number;
  holdExpiresAt: string;
  quote: Quote;
}

export async function startCheckout(req: CheckoutRequest): Promise<CheckoutResult> {
  const cfg = await loadConfig(pool, { fresh: true });
  const cart = req.cart;

  // The customer must accept the Terms & Conditions to book (enforced server-
  // side, not just in the UI).
  if (req.termsAccepted !== true) {
    throw new CheckoutError('Please accept the Terms & Conditions to continue.', 'terms_required');
  }

  // A manual-order link: the offer must still be open. Once its booking is paid
  // the offer flips to 'used' (in confirmBooking), so re-opening a used link can
  // never create a second booking.
  if (req.offerToken) {
    if (!(await offerIsOpen(req.offerToken))) {
      throw new CheckoutError('This link has already been used for a booking.', 'unavailable');
    }
  }

  // Resolve the customer: a signed-in id, or a lightweight guest customer minted
  // from the checkout contact details. A prior guest with the same email is reused
  // (never duplicated); a registered account must sign in (createGuestCustomer
  // guards that). Everything downstream keys off this id exactly as a registered
  // customer would.
  const customerId = req.customerId ?? (req.guest ? await createGuestCustomer(req.guest) : null);
  if (!customerId) {
    throw new CheckoutError('Please sign in or enter your details to continue.', 'auth_required');
  }

  // (1) The server recomputes everything. A total submitted by the
  // device is not read at all — it is not even a parameter here.
  const serverQuote = computeQuote(cart, { ...toPricingContext(cfg), nowMs: Date.now() });

  // A manual-order link layers the team's manual pieces (custom products, a
  // discount, a fixed delivery, a custom-theme charge) on top of the engine
  // price — identically to the live quote, so the charge matches what was shown.
  // Reference images ride onto the booking so the design team sees them.
  if (req.offerToken) {
    const adj = await getOfferAdjustments(req.offerToken);
    if (adj) {
      applyOfferToQuote(serverQuote, adj);
      if (adj.refImages?.length) (cart as unknown as Record<string, unknown>).referenceImages = adj.refImages;
    }
  }

  // The map pin is required to complete a booking (spec item 7).
  if (!cart.mapPin || typeof cart.mapPin.lat !== 'number' || typeof cart.mapPin.lng !== 'number') {
    serverQuote.problems.push({
      code: 'missing_map_pin',
      message: 'Drop the map pin for your exact event location to continue.',
    });
    serverQuote.bookable = false;
  }
  if (!cart.eventDate) {
    serverQuote.problems.push({ code: 'missing_time', message: 'Choose your event date.' });
    serverQuote.bookable = false;
  }

  if (!serverQuote.bookable) {
    throw new CheckoutError('This booking cannot be completed yet.', 'not_bookable', {
      problems: serverQuote.problems,
    });
  }

  // Apply promo / store credit / point redemption, server-validated. Recorded
  // on the cart so confirmation can consume them once (and only once) the
  // payment actually lands.
  const applied = await computeDiscounts(pool, {
    customerId,
    subtotalFils: serverQuote.totalFils,
    input: req.discounts ?? {},
  });
  if (applied.totalFils > 0) {
    serverQuote.lines.push(...applied.lines);
    serverQuote.discountFils += applied.totalFils;
    serverQuote.totalFils -= applied.totalFils;
    (cart as unknown as Record<string, unknown>).appliedDiscounts = applied;
  }

  // A crew member's referral code (entered in the promo field) gives the
  // customer no discount — it credits that crew member 5% of the event when it
  // is paid (see confirm.ts). Recorded on the cart; never blocks checkout.
  try {
    const staffRef = await resolveStaffCode(pool, req.discounts?.promoCode);
    if (staffRef) (cart as unknown as Record<string, unknown>).staffReferral = staffRef;
  } catch { /* attribution is best-effort — never fail a booking over it */ }

  // A method that is disabled (not production-ready) is never charged.
  if (config.providers[req.provider as keyof typeof config.providers]?.mode === 'disabled') {
    throw new CheckoutError('This payment method is not currently available.', 'unavailable');
  }
  const provider = getProvider(req.provider);
  const endHour = eventEndHour(cart.startTime!, cfg.rules, 0, effectiveEventHours(cart, cfg.rules));
  const requiredAssets = resolveRequiredAssets(cart, cfg);

  // (2)(3)(4) availability, hold and order in ONE transaction.
  const { orderId } = await withTransaction(async (db) => {
    const id = await nextOrderId(db);

    // The order row first — inventory_holds references it. Both writes
    // are in this one transaction, so a hold conflict below still rolls
    // the order back with it and nothing is left half-created.
    // A manual-order link produces a normal booking, just tagged 'manual' and
    // carrying its offer token so confirmation can consume the offer.
    if (req.offerToken) (cart as unknown as Record<string, unknown>).offerToken = req.offerToken;
    await createOrder(db, {
      id,
      kind: 'booking',
      customerId,
      totalFils: serverQuote.totalFils,
      cart,
      quote: serverQuote,
      idempotencyKey: req.idempotencyKey ?? null,
      attribution: req.attribution ?? null,
      source: req.offerToken ? 'manual' : null,
    });

    await acquireHolds(db, {
      orderId: id,
      assetCodes: requiredAssets,
      eventDate: cart.eventDate!,
      startTime: cart.startTime!,
      endHour,
      holdMinutes: cfg.rules.inventoryHoldMinutes,
    });

    return { orderId: id };
  }).catch((err) => {
    if (err instanceof ConflictError) {
      throw new CheckoutError(err.message, 'unavailable', { assets: err.assets });
    }
    throw err;
  });

  // (5) The provider session. Outside the transaction because it is a
  // network call — but a failure here must not strand the hold.
  const customer = await loadCustomer(customerId);
  const paymentId = randomUUID();

  try {
    const session = await provider.createSession({
      orderId,
      amountFils: serverQuote.totalFils,
      currency: 'AED',
      customer,
      items: serverQuote.lines
        .filter((l) => l.kind !== 'discount' && l.kind !== 'delivery')
        .map((l) => ({
          title: l.label,
          quantity: l.quantity,
          unitPriceFils: l.unitFils,
          referenceId: l.refId,
          category: 'events',
        })),
      shippingFils: serverQuote.deliveryFils,
      discountFils: serverQuote.discountFils,
      city: String(cart.emirate ?? ''),
      address: [cart.address?.area, cart.address?.street, cart.address?.villa]
        .filter(Boolean)
        .join(', '),
      lang: req.lang ?? 'en',
      ...payReturnUrls(orderId),
      orderHistory: await loadOrderHistory(customerId),
    });

    await createPayment(pool, {
      id: paymentId,
      orderId,
      provider: provider.name,
      amountFils: serverQuote.totalFils,
      providerPaymentId: session.providerPaymentId || null,
      checkoutUrl: session.checkoutUrl,
      raw: session.raw,
    });

    await recordPaymentEvent(pool, {
      paymentId,
      orderId,
      provider: provider.name,
      newStatus: session.eligible ? 'created' : 'failed',
      source: 'api',
      note: session.eligible
        ? 'Checkout session created'
        : 'Provider declined this customer at session creation — offer another method',
    });

    if (!session.eligible) {
      // The hold stays alive: the customer can still pay another way (§7).
      return {
        orderId,
        orderToken: orderViewToken(orderId),
        paymentId,
        provider: provider.name,
        checkoutUrl: null,
        eligible: false,
        totalFils: serverQuote.totalFils,
        holdExpiresAt: new Date(
          Date.now() + cfg.rules.inventoryHoldMinutes * 60_000,
        ).toISOString(),
        quote: serverQuote,
      };
    }

    return {
      orderId,
      orderToken: orderViewToken(orderId),
      paymentId,
      provider: provider.name,
      checkoutUrl: session.checkoutUrl,
      embeddedUrl: session.embeddedUrl ?? null,
      clientSecret: session.clientSecret ?? null,
      publishableKey: session.publishableKey ?? null,
      eligible: true,
      totalFils: serverQuote.totalFils,
      holdExpiresAt: new Date(Date.now() + cfg.rules.inventoryHoldMinutes * 60_000).toISOString(),
      quote: serverQuote,
    };
  } catch (err) {
    // The provider never got a usable session — free the assets now
    // rather than making another customer wait out the TTL.
    await releaseHolds(pool, orderId, 'session creation failed');
    await pool.query(`UPDATE orders SET status = 'failed', updated_at = now() WHERE id = $1`, [
      orderId,
    ]);
    await recordPaymentEvent(pool, {
      orderId,
      provider: provider.name,
      newStatus: 'failed',
      source: 'api',
      note: `Session creation failed: ${(err as Error).message}`,
    });
    throw new CheckoutError(
      'We could not start the payment. Please try again or choose another method.',
      'session_failed',
    );
  }
}

/* ------------------------------------------------------------------ */
/* Standalone shop (custom printed & digital goods, no party)          */
/* ------------------------------------------------------------------ */

export interface ShopCheckoutRequest {
  items: ShopItem[];
  emirate: string | null;
  address?: { area?: string; street?: string; villa?: string; details?: string } | null;
  /** The guest's drawing(s) to print, or the request that we draw one. */
  customization?: { refImages?: string[]; wantDraw?: boolean } | null;
  customerId: string | null;
  guest?: { name: string; phone: string; backupPhone: string; email: string };
  provider: string;
  lang?: 'en' | 'ar';
  termsAccepted?: boolean;
  /** Ad-click parameters the app captured on landing (see metaCapi.ts). */
  attribution?: unknown;
}

export interface ShopCheckoutResult {
  orderId: string;
  /** Order-view token so the app can poll status without a provider return URL. */
  orderToken: string;
  /** Stripe embedded-checkout client secret; the app mounts Stripe.js with it. */
  clientSecret?: string | null;
  /** Stripe publishable key so the app can init Stripe.js. */
  publishableKey?: string | null;
  checkoutUrl: string | null;
  embeddedUrl?: string | null;
  eligible: boolean;
  totalFils: number;
  /** ISO estimated delivery date (printed ~2 weeks, digital ~3 days); null if neither. */
  readyBy: string | null;
}

/**
 * Checkout for a standalone shop order — no event, no inventory holds, no crew.
 * Digital goods are emailed; printed goods ship after ~2 weeks. On payment the
 * webhook marks it paid and notifies the team (see confirm.ts `shop` branch).
 */
export async function startShopCheckout(req: ShopCheckoutRequest): Promise<ShopCheckoutResult> {
  if (req.termsAccepted !== true) {
    throw new CheckoutError('Please accept the terms to continue.', 'terms_required');
  }

  const cfg = await loadConfig();
  const q = quoteShop(req.items ?? [], req.emirate, cfg.services);
  if (!q.bookable) {
    throw new CheckoutError('This order cannot be completed yet.', 'not_bookable', { problems: q.problems });
  }

  // Server-side enforcement (never trust the client gate): drawing-based items
  // need either an uploaded reference or the "draw one for us" request, and any
  // printed order needs a real delivery address — otherwise the team has
  // nothing to make or nowhere to ship.
  const needsDrawing = (req.items ?? []).some((i) => SHOP_DRAWING_IDS.has(i.serviceId));
  if (needsDrawing) {
    const c = req.customization;
    const hasArt = (c?.refImages?.length ?? 0) > 0 || c?.wantDraw === true;
    if (!hasArt) {
      throw new CheckoutError(
        'Attach the guest’s drawing, or ask us to create one, to continue.',
        'customization_required',
      );
    }
  }
  if (q.hasPrinted && !req.address?.area?.trim()) {
    throw new CheckoutError('Add a delivery address for your printed items.', 'address_required');
  }

  // A standalone shop order grants no account access and spends nothing, so a
  // registered email may check out as a guest — the order attaches to that
  // account without modifying it (no sign-in dead-end for a simple purchase).
  const customerId =
    req.customerId ?? (req.guest ? await createGuestCustomer(req.guest, { reuseRegistered: true }) : null);
  if (!customerId) {
    throw new CheckoutError('Please sign in or enter your details to continue.', 'auth_required');
  }

  if (config.providers[req.provider as keyof typeof config.providers]?.mode === 'disabled') {
    throw new CheckoutError('This payment method is not currently available.', 'unavailable');
  }
  const provider = getProvider(req.provider);

  // Estimated ready/delivery date — printed goods take longer than digital ones.
  // Both now carry an estimate so the customer always sees a delivery date.
  const leadDays = q.hasPrinted ? SHOP_READY_DAYS : SHOP_DIGITAL_READY_DAYS;
  const readyBy =
    q.hasPrinted || q.hasDigital
      ? new Date(Date.now() + leadDays * 86_400_000).toISOString().slice(0, 10)
      : null;
  const cart = {
    kind: 'shop',
    items: q.lines.map((l) => ({ serviceId: l.serviceId, quantity: l.quantity })),
    emirate: req.emirate,
    address: req.address ?? null,
    customization: req.customization ?? null,
    readyBy,
  };

  const orderId = await withTransaction(async (db) => {
    const id = await nextOrderId(db);
    await createOrder(db, {
      id,
      kind: 'shop',
      customerId,
      totalFils: q.totalFils,
      cart,
      quote: q as unknown as Quote,
      attribution: req.attribution ?? null,
    });
    return id;
  });

  const customer = await loadCustomer(customerId);
  const paymentId = randomUUID();

  try {
    const session = await provider.createSession({
      orderId,
      amountFils: q.totalFils,
      currency: 'AED',
      customer,
      items: q.lines.map((l) => ({
        title: l.name,
        quantity: l.quantity,
        unitPriceFils: l.unitFils,
        referenceId: l.serviceId,
        category: 'events',
      })),
      shippingFils: q.deliveryFils,
      discountFils: 0,
      city: String(req.emirate ?? ''),
      address: [req.address?.area, req.address?.street, req.address?.villa].filter(Boolean).join(', '),
      lang: req.lang ?? 'en',
      ...payReturnUrls(orderId),
      orderHistory: await loadOrderHistory(customerId),
    });

    await createPayment(pool, {
      id: paymentId,
      orderId,
      provider: provider.name,
      amountFils: q.totalFils,
      providerPaymentId: session.providerPaymentId || null,
      checkoutUrl: session.checkoutUrl,
      raw: session.raw,
    });
    await recordPaymentEvent(pool, {
      paymentId,
      orderId,
      provider: provider.name,
      newStatus: session.eligible ? 'created' : 'failed',
      source: 'api',
      note: session.eligible ? 'Shop checkout session created' : 'Provider declined at session creation',
    });

    return {
      orderId,
      orderToken: orderViewToken(orderId),
      checkoutUrl: session.eligible ? session.checkoutUrl : null,
      embeddedUrl: session.embeddedUrl ?? null,
      clientSecret: session.clientSecret ?? null,
      publishableKey: session.publishableKey ?? null,
      eligible: session.eligible,
      totalFils: q.totalFils,
      readyBy,
    };
  } catch (err) {
    console.error(
      '[shop-checkout] session creation failed:',
      (err as Error).message,
      'status=', (err as any).status,
      'body=', JSON.stringify((err as any).body ?? null).slice(0, 500),
    );
    await pool.query(`UPDATE orders SET status = 'failed', updated_at = now() WHERE id = $1`, [orderId]);
    throw new CheckoutError(
      'We could not start the payment. Please try again or choose another method.',
      'session_failed',
    );
  }
}

/* ------------------------------------------------------------------ */
/* Post-booking add-ons                                                */
/* ------------------------------------------------------------------ */

export async function startAddonCheckout(args: {
  eventId: string;
  request: AddonRequest;
  provider: string;
  customerId: string;
  lang?: 'en' | 'ar';
}): Promise<CheckoutResult> {
  const cfg = await loadConfig(pool, { fresh: true });

  const { rows } = await pool.query(
    `SELECT * FROM events WHERE id = $1 AND customer_id = $2`,
    [args.eventId, args.customerId],
  );
  const event = rows[0];
  if (!event) throw new CheckoutError('Event not found.', 'not_found');

  // A cancelled event sells nothing. Checked here as well as in the route
  // so no future caller can reach the payment path around it.
  if (isCancelled(event.phase)) {
    throw new CheckoutError(
      'This event has been cancelled. Additional purchases are no longer available — please contact the Eventana team.',
      'event_cancelled',
    );
  }

  const addonQuote = quoteAddons(args.request, {
    rules: cfg.rules,
    services: cfg.services,
    startTime: event.start_time,
    hoursAlreadyPurchased: event.extra_hours,
  });

  if (!addonQuote.bookable) {
    throw new CheckoutError('These extras cannot be added.', 'not_bookable', {
      problems: addonQuote.problems,
    });
  }

  if (config.providers[args.provider as keyof typeof config.providers]?.mode === 'disabled') {
    throw new CheckoutError('This payment method is not currently available.', 'unavailable');
  }
  const provider = getProvider(args.provider);
  const orderId = await withTransaction(async (db) => {
    const id = await nextOrderId(db);
    await createOrder(db, {
      id,
      kind: 'addon',
      customerId: args.customerId,
      eventId: args.eventId,
      totalFils: addonQuote.totalFils,
      cart: { eventId: args.eventId, request: args.request },
      quote: addonQuote,
    });
    return id;
  });

  const customer = await loadCustomer(args.customerId);
  const paymentId = randomUUID();

  const session = await provider.createSession({
    orderId,
    amountFils: addonQuote.totalFils,
    currency: 'AED',
    customer,
    items: addonQuote.lines.map((l) => ({
      title: l.label,
      quantity: l.quantity,
      unitPriceFils: l.unitFils,
      referenceId: l.refId,
      category: 'events',
    })),
    shippingFils: 0,
    discountFils: 0,
    city: event.emirate,
    address: String((event.address as any)?.area ?? ''),
    lang: args.lang ?? 'en',
    ...payReturnUrls(orderId),
    orderHistory: await loadOrderHistory(args.customerId),
  });

  await createPayment(pool, {
    id: paymentId,
    orderId,
    provider: provider.name,
    amountFils: addonQuote.totalFils,
    providerPaymentId: session.providerPaymentId || null,
    checkoutUrl: session.checkoutUrl,
    raw: session.raw,
  });

  return {
    orderId,
    orderToken: orderViewToken(orderId),
    paymentId,
    provider: provider.name,
    checkoutUrl: session.checkoutUrl,
    eligible: session.eligible,
    totalFils: addonQuote.totalFils,
    holdExpiresAt: new Date(Date.now() + cfg.rules.inventoryHoldMinutes * 60_000).toISOString(),
    quote: addonQuote as unknown as Quote,
  };
}

/* ------------------------------------------------------------------ */
/* Tips — a real payment for the crew, on the normal order rail          */
/* ------------------------------------------------------------------ */

export async function startTipCheckout(args: {
  eventId: string;
  amountFils: number;
  memberId?: string | null;
  provider: string;
  customerId: string;
  lang?: 'en' | 'ar';
}): Promise<CheckoutResult> {
  const cfg = await loadConfig(pool, { fresh: true });

  const { rows } = await pool.query(
    `SELECT * FROM events WHERE id = $1 AND customer_id = $2`,
    [args.eventId, args.customerId],
  );
  const event = rows[0];
  if (!event) throw new CheckoutError('Event not found.', 'not_found');

  if (!Number.isInteger(args.amountFils) || args.amountFils < 500) {
    throw new CheckoutError('A tip must be at least AED 5.', 'invalid_amount');
  }

  // Optional: a tip aimed at one crew member must be someone actually on the
  // event, so the money and the KPI credit land on the right person.
  if (args.memberId) {
    const { rows: onCrew } = await pool.query(
      `SELECT 1 FROM event_team WHERE event_id = $1 AND member_id = $2`,
      [args.eventId, args.memberId],
    );
    if (!onCrew[0]) throw new CheckoutError('That team member is not on this event.', 'not_found');
  }

  if (config.providers[args.provider as keyof typeof config.providers]?.mode === 'disabled') {
    throw new CheckoutError('This payment method is not currently available.', 'unavailable');
  }
  const provider = getProvider(args.provider);

  const tipQuote = {
    bookable: true,
    totalFils: args.amountFils,
    lines: [
      { refId: 'crew_tip', label: 'Tip for the Eventana crew', quantity: 1, unitFils: args.amountFils, amountFils: args.amountFils },
    ],
  };

  const orderId = await withTransaction(async (db) => {
    const id = await nextOrderId(db);
    await createOrder(db, {
      id,
      kind: 'tip',
      customerId: args.customerId,
      eventId: args.eventId,
      totalFils: args.amountFils,
      cart: { tip: true, eventId: args.eventId, memberId: args.memberId ?? null },
      quote: tipQuote,
    });
    await db.query(
      `INSERT INTO tips (event_id, order_id, member_id, amount_fils, status)
       VALUES ($1,$2,$3,$4,'pending')`,
      [args.eventId, id, args.memberId ?? null, args.amountFils],
    );
    return id;
  });

  const customer = await loadCustomer(args.customerId);
  const paymentId = randomUUID();
  const session = await provider.createSession({
    orderId,
    amountFils: args.amountFils,
    currency: 'AED',
    customer,
    items: [
      { title: 'Crew tip', quantity: 1, unitPriceFils: args.amountFils, referenceId: 'crew_tip', category: 'events' },
    ],
    shippingFils: 0,
    discountFils: 0,
    city: event.emirate,
    address: String((event.address as any)?.area ?? ''),
    lang: args.lang ?? 'en',
    ...payReturnUrls(orderId),
    orderHistory: await loadOrderHistory(args.customerId),
  });

  await createPayment(pool, {
    id: paymentId,
    orderId,
    provider: provider.name,
    amountFils: args.amountFils,
    providerPaymentId: session.providerPaymentId || null,
    checkoutUrl: session.checkoutUrl,
    raw: session.raw,
  });

  return {
    orderId,
    orderToken: orderViewToken(orderId),
    paymentId,
    provider: provider.name,
    checkoutUrl: session.checkoutUrl,
    eligible: session.eligible,
    totalFils: args.amountFils,
    holdExpiresAt: new Date(Date.now() + cfg.rules.inventoryHoldMinutes * 60_000).toISOString(),
    quote: tipQuote as unknown as Quote,
  };
}

/* ------------------------------------------------------------------ */

/**
 * A Manager-created "manual" order (a WhatsApp booking). The manager picks the
 * priced items (package / services / theme) and sets the date, time and
 * emirate; the customer completes the rest (guest of honour, contact, exact
 * location) and pays through a secure link — the session is created lazily when
 * they pay, so the total is fixed and never a stale checkout. No inventory hold
 * is taken until payment (the manager manages availability for these).
 */
export interface ManualOrderInput {
  customer: { name: string; phone: string; backupPhone?: string; email?: string };
  cart: CheckoutRequest['cart'];
  createdBy?: string;
}
export interface ManualOrderResult {
  orderId: string;
  token: string;
  totalFils: number;
  totalDisplay: string;
  payUrl: string;
  quote: Quote;
}

export async function createManualOrder(req: ManualOrderInput): Promise<ManualOrderResult> {
  const cfg = await loadConfig(pool, { fresh: true });
  const cart = req.cart;
  if (!cart.eventDate || !cart.startTime) {
    throw new CheckoutError('Set the event date and time.', 'missing_time');
  }
  if (!cart.emirate) {
    throw new CheckoutError('Choose the emirate — it is needed to price delivery.', 'missing_emirate');
  }
  const customerId = await createGuestCustomer(
    { name: req.customer.name, phone: req.customer.phone, backupPhone: req.customer.backupPhone ?? '', email: req.customer.email ?? '' },
    { reuseRegistered: true },
  );
  const quote = computeQuote(cart, { ...toPricingContext(cfg), nowMs: Date.now() });
  if (!quote.bookable) {
    throw new CheckoutError('This order cannot be priced as entered.', 'not_bookable', { problems: quote.problems });
  }
  const orderId = await withTransaction(async (db) => {
    const id = await nextOrderId(db);
    await createOrder(db, { id, kind: 'booking', customerId, totalFils: quote.totalFils, cart, quote, source: 'manual' });
    return id;
  });
  const token = orderViewToken(orderId);
  const base = (config.publicAppUrl || '').replace(/\/$/, '');
  return {
    orderId,
    token,
    totalFils: quote.totalFils,
    totalDisplay: formatAed(quote.totalFils),
    payUrl: `${base}/?pay=${orderId}&t=${token}`,
    quote,
  };
}

/**
 * Manager-built add-on pay link for an EXISTING booking.
 *
 * The customer already has an order/event — they just asked to add something.
 * This prices the extra products (catalogue + custom items + a manual discount /
 * delivery / custom-theme charge), creates an `addon` order tied to the event,
 * and returns a pay link. On payment the add-on attaches to the same event
 * (applyAddonOrder) and posts to Sales — never a second booking.
 */
export async function createEventAddonLink(req: {
  eventId: string;
  selection: {
    celebrationType?: string;
    packageId?: string | null;
    services?: Array<{ serviceId: string; quantity: number }>;
    customItems?: Array<{ name: string; priceFils: number; qty: number }>;
    discountFils?: number;
    deliveryFils?: number | null;
    customThemeFils?: number;
    refImages?: string[];
  };
  createdBy?: string;
}): Promise<{ orderId: string; token: string; totalFils: number; totalDisplay: string; payUrl: string }> {
  const cfg = await loadConfig(pool, { fresh: true });
  const { rows } = await pool.query(
    `SELECT id, customer_id, celebration_type FROM events WHERE id = $1`,
    [req.eventId],
  );
  const ev = rows[0];
  if (!ev) throw new CheckoutError('That booking was not found.', 'not_found');

  const sel = req.selection;
  const base = computeQuote(
    {
      celebrationType: sel.celebrationType ?? ev.celebration_type,
      packageId: sel.packageId ?? null,
      services: (sel.services ?? []).filter((s) => s.quantity > 0),
      themeId: null,
      customTheme: false,
      startTime: '17:00',
      childrenCount: 15,
    } as unknown as CheckoutRequest['cart'],
    { ...toPricingContext(cfg), nowMs: Date.now() },
  );
  // Add-on prices only the items — no automatic delivery/urgent (the event
  // already exists). Manual delivery/discount/theme are layered on explicitly.
  const lines = base.lines.filter((l) => l.kind !== 'delivery' && l.kind !== 'discount');
  for (const ci of sel.customItems ?? []) {
    const qty = Number(ci.qty) > 0 ? Number(ci.qty) : 1;
    const unit = Number(ci.priceFils) || 0;
    lines.push({ kind: 'addon', refId: null, label: ci.name || 'Item', quantity: qty, unitFils: unit, amountFils: unit * qty, discountEligible: false });
  }
  if (Number(sel.customThemeFils) > 0) lines.push({ kind: 'custom_theme', refId: 'custom_theme', label: 'Custom theme', quantity: 1, unitFils: sel.customThemeFils!, amountFils: sel.customThemeFils!, discountEligible: false });
  if (Number(sel.deliveryFils) > 0) lines.push({ kind: 'delivery', refId: 'delivery', label: 'Delivery', quantity: 1, unitFils: sel.deliveryFils!, amountFils: sel.deliveryFils!, discountEligible: false });
  if (Number(sel.discountFils) > 0) lines.push({ kind: 'discount', refId: 'manual_discount', label: 'Discount', quantity: 1, unitFils: -sel.discountFils!, amountFils: -sel.discountFils!, discountEligible: false });

  const totalFils = lines.reduce((s, l) => s + l.amountFils, 0);
  if (totalFils <= 0) throw new CheckoutError('Add at least one item to the add-on.', 'empty_selection');

  const quote: Quote = { ...base, lines, deliveryFils: Number(sel.deliveryFils ?? 0), discountFils: Number(sel.discountFils ?? 0), totalFils, bookable: true, problems: [] };
  const cart: Record<string, unknown> = { addon: true };
  if (sel.refImages?.length) cart.referenceImages = sel.refImages.filter(Boolean).slice(0, 8);

  const orderId = await withTransaction(async (db) => {
    const id = await nextOrderId(db);
    await createOrder(db, { id, kind: 'addon', customerId: ev.customer_id, eventId: req.eventId, totalFils, cart, quote, source: 'manual' });
    return id;
  });
  const token = orderViewToken(orderId);
  const base2 = (config.publicAppUrl || '').replace(/\/$/, '');
  return { orderId, token, totalFils, totalDisplay: formatAed(totalFils), payUrl: `${base2}/?pay=${orderId}&t=${token}` };
}

/**
 * Create a Stripe session for an existing awaiting-payment order (used by the
 * manual-order pay link). Idempotency and confirmation are handled by the same
 * webhook/poll → confirmBooking path as a normal checkout.
 */
export async function createSessionForOrder(orderId: string): Promise<{
  clientSecret: string | null;
  publishableKey: string | null;
  eligible: boolean;
}> {
  const { rows } = await pool.query(`SELECT * FROM orders WHERE id = $1`, [orderId]);
  const order = rows[0];
  if (!order) throw new CheckoutError('Order not found.', 'not_found');
  if (order.status === 'paid') throw new CheckoutError('This order is already paid.', 'already_paid');
  if (config.providers.stripe.mode === 'disabled') {
    throw new CheckoutError('Card payment is not currently available.', 'unavailable');
  }
  const provider = getProvider('stripe');
  const customer = await loadCustomer(order.customer_id);
  const quote = order.quote as Quote;
  const cart = order.cart as { emirate?: string; address?: { area?: string; street?: string; villa?: string } };
  const paymentId = randomUUID();
  const session = await provider.createSession({
    orderId,
    amountFils: Number(order.total_fils),
    currency: 'AED',
    customer,
    items: quote.lines
      .filter((l) => l.kind !== 'discount' && l.kind !== 'delivery')
      .map((l) => ({ title: l.label, quantity: l.quantity, unitPriceFils: l.unitFils, referenceId: l.refId, category: 'events' as const })),
    shippingFils: quote.deliveryFils ?? 0,
    discountFils: quote.discountFils ?? 0,
    city: String(cart.emirate ?? ''),
    address: [cart.address?.area, cart.address?.street, cart.address?.villa].filter(Boolean).join(', '),
    lang: 'en',
    ...payReturnUrls(orderId),
    orderHistory: await loadOrderHistory(order.customer_id),
  });
  await createPayment(pool, {
    id: paymentId,
    orderId,
    provider: provider.name,
    amountFils: Number(order.total_fils),
    providerPaymentId: session.providerPaymentId || null,
    checkoutUrl: session.checkoutUrl,
    raw: session.raw,
  });
  await recordPaymentEvent(pool, {
    paymentId,
    orderId,
    provider: provider.name,
    newStatus: session.eligible ? 'created' : 'failed',
    source: 'api',
    note: 'Manual order pay-link session',
  });
  return {
    clientSecret: session.clientSecret ?? null,
    publishableKey: session.publishableKey ?? null,
    eligible: session.eligible,
  };
}

/**
 * Mints a lightweight customer for a guest checkout (no password). If the
 * email already belongs to an account we reuse it — a returning guest keeps
 * one identity (and their loyalty/vouchers) instead of fragmenting.
 */
async function createGuestCustomer(
  g: {
    name: string;
    phone: string;
    backupPhone: string;
    email: string;
  },
  opts: { reuseRegistered?: boolean } = {},
): Promise<string> {
  const existing = await pool.query<{ id: string; password_hash: string | null }>(
    `SELECT id, password_hash FROM customers WHERE lower(email) = lower($1) LIMIT 1`,
    [g.email],
  );
  if (existing.rows[0]) {
    // Security: if this email already belongs to a REGISTERED account (it has a
    // password), a guest must not be able to take it over. Reusing it here would
    // let anyone knowing the email rewrite the account's name/phones and spend
    // its loyalty points / store credit.
    if (existing.rows[0].password_hash) {
      // A standalone shop order is the exception: it grants no account access
      // and spends nothing, so it attaches to the account WITHOUT touching its
      // profile (name/phones untouched) rather than dead-ending on sign-in.
      if (opts.reuseRegistered) {
        return existing.rows[0].id;
      }
      // A party booking must sign in instead (that checkout offers a login tab).
      throw new CheckoutError(
        'This email already has an Eventana account. Please sign in to continue.',
        'account_exists',
      );
    }
    // A prior guest (no password) with the same email — safe to reuse and refresh.
    await pool.query(
      `UPDATE customers SET name = $2, phone = $3, backup_phone = $4 WHERE id = $1`,
      [existing.rows[0].id, g.name, g.phone, g.backupPhone],
    );
    return existing.rows[0].id;
  }
  const id = `CUST-${randomBytes(4).toString('hex').toUpperCase()}`;
  let code = makeReferralCode(g.name);
  for (let i = 0; i < 3; i++) {
    const clash = await pool.query(`SELECT 1 FROM customers WHERE referral_code = $1`, [code]);
    if (!clash.rowCount) break;
    code = makeReferralCode(g.name);
  }
  await pool.query(
    `INSERT INTO customers (id, name, phone, backup_phone, email, referral_code)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [id, g.name, g.phone, g.backupPhone, g.email, code],
  );
  return id;
}

async function loadCustomer(customerId: string) {
  const { rows } = await pool.query(`SELECT * FROM customers WHERE id = $1`, [customerId]);
  const c = rows[0];
  if (!c) throw new CheckoutError('Unknown customer.', 'not_found');
  return {
    id: c.id,
    name: c.name,
    phone: c.phone,
    email: c.email,
    registeredSince: c.registered_at?.toISOString?.() ?? null,
    loyaltyLevel: c.loyalty_points,
  };
}

/**
 * Past orders for the provider's credit assessment. Thin buyer history
 * measurably raises BNPL rejection rates, so send everything Eventana
 * legitimately holds (spec §5).
 */
async function loadOrderHistory(customerId: string) {
  const { rows } = await pool.query(
    `SELECT total_fils, status, created_at FROM orders
      WHERE customer_id = $1 AND status IN ('paid','refunded','partially_refunded')
      ORDER BY created_at DESC LIMIT 10`,
    [customerId],
  );
  return rows.map((r) => ({
    purchasedAt: r.created_at.toISOString(),
    amountFils: Number(r.total_fils),
    status: r.status === 'paid' ? 'complete' : r.status,
  }));
}
