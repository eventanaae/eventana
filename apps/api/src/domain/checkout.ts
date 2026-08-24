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
  isCancelled,
  quote as computeQuote,
  quoteAddons,
  quoteShop,
  SHOP_READY_DAYS,
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
import { createOrder, createPayment, nextOrderId, recordPaymentEvent } from './orders.js';
import { loadConfig, toPricingContext, type LoadedConfig } from './settings.js';
import { computeDiscounts, makeReferralCode, type DiscountInput } from './discounts.js';

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
export async function previewQuote(cart: CartInput): Promise<Quote & { unavailable: string[] }> {
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
  return { ...result, unavailable: [...taken] };
}

export interface CheckoutResult {
  orderId: string;
  paymentId: string;
  provider: string;
  checkoutUrl: string | null;
  /** In-app iframe widget URL (Ziina); null when only a hosted redirect exists. */
  embeddedUrl?: string | null;
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

  // Resolve the customer: a signed-in id, or a lightweight guest customer
  // minted from the checkout contact details. Everything downstream keys off
  // this id (order, loyalty, history) exactly as a registered customer would.
  const customerId = req.customerId ?? (req.guest ? await createGuestCustomer(req.guest) : null);
  if (!customerId) {
    throw new CheckoutError('Please sign in or enter your details to continue.', 'auth_required');
  }

  // (1) The server recomputes everything. A total submitted by the
  // device is not read at all — it is not even a parameter here.
  const serverQuote = computeQuote(cart, { ...toPricingContext(cfg), nowMs: Date.now() });

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
    await createOrder(db, {
      id,
      kind: 'booking',
      customerId,
      totalFils: serverQuote.totalFils,
      cart,
      quote: serverQuote,
      idempotencyKey: req.idempotencyKey ?? null,
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
      successUrl: `${config.publicAppUrl}/pay/return?order=${orderId}`,
      cancelUrl: `${config.publicAppUrl}/pay/cancel?order=${orderId}`,
      failureUrl: `${config.publicAppUrl}/pay/failure?order=${orderId}`,
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
      paymentId,
      provider: provider.name,
      checkoutUrl: session.checkoutUrl,
      embeddedUrl: session.embeddedUrl ?? null,
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
}

export interface ShopCheckoutResult {
  orderId: string;
  checkoutUrl: string | null;
  embeddedUrl?: string | null;
  eligible: boolean;
  totalFils: number;
  /** ISO date the made-to-order items are ready by (booking + ~2 weeks). */
  readyBy: string;
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

  const customerId = req.customerId ?? (req.guest ? await createGuestCustomer(req.guest) : null);
  if (!customerId) {
    throw new CheckoutError('Please sign in or enter your details to continue.', 'auth_required');
  }

  if (config.providers[req.provider as keyof typeof config.providers]?.mode === 'disabled') {
    throw new CheckoutError('This payment method is not currently available.', 'unavailable');
  }
  const provider = getProvider(req.provider);

  const readyBy = new Date(Date.now() + SHOP_READY_DAYS * 86_400_000).toISOString().slice(0, 10);
  const cart = {
    kind: 'shop',
    items: q.lines.map((l) => ({ serviceId: l.serviceId, quantity: l.quantity })),
    emirate: req.emirate,
    address: req.address ?? null,
    customization: req.customization ?? null,
    readyBy: q.hasPrinted ? readyBy : null,
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
      successUrl: `${config.publicAppUrl}/pay/return?order=${orderId}`,
      cancelUrl: `${config.publicAppUrl}/pay/cancel?order=${orderId}`,
      failureUrl: `${config.publicAppUrl}/pay/failure?order=${orderId}`,
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
      checkoutUrl: session.eligible ? session.checkoutUrl : null,
      embeddedUrl: session.embeddedUrl ?? null,
      eligible: session.eligible,
      totalFils: q.totalFils,
      readyBy,
    };
  } catch (err) {
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
    successUrl: `${config.publicAppUrl}/pay/return?order=${orderId}`,
    cancelUrl: `${config.publicAppUrl}/pay/cancel?order=${orderId}`,
    failureUrl: `${config.publicAppUrl}/pay/failure?order=${orderId}`,
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
    successUrl: `${config.publicAppUrl}/pay/return?order=${orderId}`,
    cancelUrl: `${config.publicAppUrl}/pay/cancel?order=${orderId}`,
    failureUrl: `${config.publicAppUrl}/pay/failure?order=${orderId}`,
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
 * Mints a lightweight customer for a guest checkout (no password). If the
 * email already belongs to an account we reuse it — a returning guest keeps
 * one identity (and their loyalty/vouchers) instead of fragmenting.
 */
async function createGuestCustomer(g: {
  name: string;
  phone: string;
  backupPhone: string;
  email: string;
}): Promise<string> {
  const existing = await pool.query<{ id: string; password_hash: string | null }>(
    `SELECT id, password_hash FROM customers WHERE lower(email) = lower($1) LIMIT 1`,
    [g.email],
  );
  if (existing.rows[0]) {
    // Security: if this email already belongs to a REGISTERED account (it has a
    // password), a guest must not be able to take it over. Reusing it here would
    // let anyone knowing the email rewrite the account's name/phones and spend
    // its loyalty points / store credit. Require a real sign-in instead.
    if (existing.rows[0].password_hash) {
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
