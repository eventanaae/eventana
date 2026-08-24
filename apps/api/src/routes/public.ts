/**
 * Customer-facing routes. Nothing here can confirm a booking, change a
 * price, approve a refund or read another customer's event.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import {
  CELEBRATION_TYPES,
  CASTLE_VARIANTS,
  MISSING_SERVICE_NOTES,
  NOTICES,
  START_TIMES,
  THEME_TAGS,
  endsBeforeCutoff,
  formatAed,
  type CartInput,
} from '@eventana/shared';
import { pool } from '../db/pool.js';
import { config } from '../config.js';
import { checkCalendarConnection } from '../integrations/googleCalendar.js';
import { verifyUnsub } from '../domain/marketing.js';
import { loadConfig } from '../domain/settings.js';
import { CheckoutError, previewQuote, startCheckout, startShopCheckout } from '../domain/checkout.js';
import { orderViewTokenValid } from '../domain/orders.js';
import { customerFromRequest, issueCustomerToken, issueResetToken, verifyResetToken } from '../domain/customerAuth.js';
import { makeReferralCode, validatePromo } from '../domain/discounts.js';
import { sendEmail, emailEnabled } from '../integrations/email.js';
import { signUpload, uploadsEnabled } from '../integrations/cloudinary.js';
import { allProviders } from '../payments/index.js';
import { answerAssistant } from '../domain/assistant.js';

const cartSchema = z.object({
  celebrationType: z.enum(['kids', 'graduation', 'bride', 'baby', 'gender', 'adult', 'customc']),
  packageId: z.string().nullable().default(null),
  services: z
    .array(z.object({ serviceId: z.string(), quantity: z.number().int().min(0).max(500) }))
    .default([]),
  themeId: z.string().nullable().default(null),
  customTheme: z.boolean().default(false),
  emirate: z.string().nullable().default(null),
  startTime: z.string().nullable().default(null),
  eventDate: z.string().nullable().default(null),
  childrenCount: z.number().int().min(0).max(500).default(0),
  castleVariant: z.string().nullable().optional(),
  address: z
    .object({
      area: z.string().optional(),
      street: z.string().optional(),
      villa: z.string().optional(),
      details: z.string().optional(),
    })
    .optional(),
  mapPin: z.object({ lat: z.number(), lng: z.number() }).nullable().optional(),
  /** Who the celebration is for — distinct from the account holder. */
  eventFor: z.string().max(120).optional(),
  /** Exact age of the guest of honour (e.g. "6" or "Adult"). */
  ageBand: z.string().max(20).nullable().optional(),
  /** Movie Night film choice — so the team preps the right title. */
  movie: z.string().max(60).nullable().optional(),
  /** Custom-theme brief — reaches the design team instead of being lost. */
  themeBrief: z
    .object({
      theme: z.string().max(200).optional(),
      concept: z.string().max(200).optional(),
      colors: z.string().max(200).optional(),
      child: z.string().max(120).optional(),
      age: z.string().max(20).optional(),
      notes: z.string().max(1000).optional(),
      /** Optional reference images the customer uploads for the design team. */
      refImages: z.array(z.string().url().max(500)).max(8).optional(),
    })
    .nullable()
    .optional(),
  /** Chosen kiosk colour per food/games station service id. */
  stationColors: z.record(z.string().max(20)).optional(),
  mascotChoice: z.string().max(40).optional(),
});

/** MET Norway symbol code (e.g. "clearsky_day") → label, emoji, outdoor note. */
function describeWeather(symbol: string): { label: string; emoji: string; outdoorNote: string } {
  const perfect = 'Perfect for an outdoor celebration! ☀️';
  const s = symbol.replace(/_(day|night|polartwilight)$/, '');
  const map: Record<string, [string, string, string]> = {
    clearsky: ['Clear sky', '☀️', perfect],
    fair: ['Mostly sunny', '🌤️', perfect],
    partlycloudy: ['Partly cloudy', '⛅', perfect],
    cloudy: ['Cloudy', '☁️', 'Comfortable and cool — great for outdoors.'],
    fog: ['Foggy', '🌫️', 'Foggy — should clear up during the day.'],
  };
  if (map[s]) return { label: map[s][0], emoji: map[s][1], outdoorNote: map[s][2] };
  if (/thunder/.test(s)) return { label: 'Thunderstorm', emoji: '⛈️', outdoorNote: 'Storms possible — please plan for indoors.' };
  if (/snow|sleet/.test(s)) return { label: 'Snow', emoji: '🌨️', outdoorNote: 'Snow/sleet expected — indoors recommended.' };
  if (/heavyrain/.test(s)) return { label: 'Heavy rain', emoji: '🌧️', outdoorNote: 'Heavy rain likely — an indoor or covered setup is safer.' };
  if (/rain|drizzle|showers/.test(s)) return { label: 'Rain likely', emoji: '🌦️', outdoorNote: 'Some rain possible — consider a covered spot.' };
  return { label: 'Mild', emoji: '🌤️', outdoorNote: perfect };
}

/** Small in-memory cache so repeated lookups don't hammer the weather API. */
const weatherCache = new Map<string, { at: number; value: unknown }>();

export async function publicRoutes(app: FastifyInstance) {
  // ---- Lightweight in-memory rate limiting (single instance) ----
  // Protects the unauthenticated, abuse-prone endpoints: checkout (inventory-
  // hold DoS), registration (referral farming), login/forgot (mailbomb /
  // credential spray), promo (code brute-force) and the Cloudinary upload
  // signer. Keyed by the real client IP behind the proxy.
  const rlBuckets = new Map<string, { count: number; reset: number }>();
  const RL_RULES: Array<{ test: RegExp; max: number; windowMs: number }> = [
    { test: /^\/api\/(checkout|shop\/checkout)$/, max: 15, windowMs: 60_000 },
    { test: /^\/api\/customers\/(register|forgot|login)$/, max: 8, windowMs: 60_000 },
    { test: /^\/api\/promo\/check$/, max: 25, windowMs: 60_000 },
    { test: /^\/api\/customers\/uploads\/sign$/, max: 25, windowMs: 60_000 },
  ];
  app.addHook('onRequest', async (request, reply) => {
    const path = request.url.split('?')[0];
    const rule = RL_RULES.find((r) => r.test.test(path));
    if (!rule) return;
    const ip =
      (request.headers['cf-connecting-ip'] as string | undefined) ||
      ((request.headers['x-forwarded-for'] as string | undefined) ?? '').split(',')[0].trim() ||
      request.ip;
    const key = `${ip}:${path}`;
    const now = Date.now();
    let b = rlBuckets.get(key);
    if (!b || b.reset <= now) {
      b = { count: 0, reset: now + rule.windowMs };
      rlBuckets.set(key, b);
    }
    b.count += 1;
    if (b.count > rule.max) {
      reply.header('retry-after', Math.ceil((b.reset - now) / 1000));
      return reply.status(429).send({ error: 'rate_limited', message: 'Too many requests — please wait a moment.' });
    }
  });
  setInterval(() => {
    const now = Date.now();
    for (const [k, b] of rlBuckets) if (b.reset <= now) rlBuckets.delete(k);
  }, 300_000).unref();

  /** Ops probe: is the Google Calendar link actually working? Status only. */
  app.get('/api/calendar/check', async () => checkCalendarConnection());

  /**
   * Weather forecast for an event's day + location, via Open-Meteo (free, no
   * key). Forecast reaches ~16 days out; beyond that we say so. Used by the
   * customer app once a date and a map pin are chosen.
   */
  app.get('/api/weather', async (request) => {
    const q = request.query as { lat?: string; lng?: string; date?: string };
    const lat = Number(q.lat);
    const lng = Number(q.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || !/^\d{4}-\d{2}-\d{2}$/.test(q.date ?? '')) {
      return { available: false, reason: 'invalid' };
    }
    const daysOut = Math.round(
      (new Date(`${q.date}T00:00:00Z`).getTime() - new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00Z').getTime()) /
        86_400_000,
    );
    if (daysOut < 0) return { available: false, reason: 'past' };
    if (daysOut > 9) return { available: false, reason: 'too_far' };

    const cacheKey = `${lat.toFixed(2)},${lng.toFixed(2)},${q.date}`;
    const cached = weatherCache.get(cacheKey);
    if (cached && Date.now() - cached.at < 3 * 3600_000) return cached.value as object;

    try {
      // MET Norway (Norwegian Meteorological Institute) — free, keyless; a
      // descriptive User-Agent is required by their terms.
      const url = `https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${lat.toFixed(4)}&lon=${lng.toFixed(4)}`;
      const res = await fetch(url, { headers: { 'user-agent': 'EventanaEvents/1.0 hello@eventanauae.com' } });
      if (!res.ok) {
        request.log.warn({ status: res.status }, 'met.no non-ok');
        return { available: false, reason: 'unavailable' };
      }
      const d = (await res.json()) as {
        properties?: { timeseries?: Array<{ time: string; data: any }> };
      };
      const series = (d.properties?.timeseries ?? []).filter((t) => t.time.slice(0, 10) === q.date);
      if (series.length === 0) return { available: false, reason: 'too_far' };

      const temps = series.map((t) => t.data?.instant?.details?.air_temperature).filter((n) => typeof n === 'number');
      const winds = series.map((t) => t.data?.instant?.details?.wind_speed).filter((n) => typeof n === 'number');
      let precip = 0;
      for (const t of series) precip += t.data?.next_6_hours?.details?.precipitation_amount ?? t.data?.next_1_hours?.details?.precipitation_amount ?? 0;
      // Pick the symbol from around midday for a representative condition.
      const noon = series.find((t) => t.time.slice(11, 13) === '12') ?? series[Math.floor(series.length / 2)];
      const symbol: string =
        noon?.data?.next_6_hours?.summary?.symbol_code ?? noon?.data?.next_1_hours?.summary?.symbol_code ?? 'fair_day';
      const w = describeWeather(symbol);

      const value = {
        available: true,
        date: q.date,
        tempMax: Math.round(Math.max(...temps)),
        tempMin: Math.round(Math.min(...temps)),
        precipMm: Math.round(precip * 10) / 10,
        windMax: Math.round(Math.max(...winds, 0) * 3.6), // m/s → km/h
        symbol,
        emoji: w.emoji,
        label: w.label,
        outdoorNote: w.outdoorNote,
      };
      weatherCache.set(cacheKey, { at: Date.now(), value });
      return value;
    } catch (err) {
      request.log.warn({ err: (err as Error).message }, 'weather fetch threw');
      return { available: false, reason: 'unavailable' };
    }
  });

  /** One-click email unsubscribe (token-verified). Returns a small page. */
  app.get('/api/unsubscribe', async (request, reply) => {
    const { c, t } = request.query as { c?: string; t?: string };
    const page = (msg: string) =>
      reply.type('text/html').send(
        `<!doctype html><html><body style="font-family:sans-serif;background:#faf6f2;color:#3B3641;text-align:center;padding:60px 20px">
          <div style="font-size:22px;font-weight:800;color:#E94F9C">Eventana</div>
          <p style="font-size:15px;margin-top:16px">${msg}</p>
        </body></html>`,
      );
    if (!c || !t || !verifyUnsub(c, t)) return page('This unsubscribe link is invalid or expired.');
    await pool.query(`UPDATE customers SET email_opt_out = TRUE WHERE id = $1`, [c]);
    return page('You’ve been unsubscribed from Eventana emails. We’re sorry to see you go! 🎈');
  });

  /** Everything the apps need to render the catalogue. */
  app.get('/api/catalogue', async () => {
    const cfg = await loadConfig();
    const [themes, categories, inspo] = await Promise.all([
      pool.query(`SELECT * FROM themes WHERE active ORDER BY celebration_type, sort_order`),
      pool.query(`SELECT * FROM service_categories ORDER BY sort_order`),
      pool.query<{ theme_id: string; image_url: string }>(
        `SELECT theme_id, image_url FROM theme_inspiration ORDER BY id`,
      ),
    ]);
    // Group the inspiration photos into a gallery per theme (first = cover).
    const galleryByTheme = new Map<string, string[]>();
    for (const row of inspo.rows) {
      const list = galleryByTheme.get(row.theme_id) ?? [];
      list.push(row.image_url);
      galleryByTheme.set(row.theme_id, list);
    }

    return {
      celebrationTypes: CELEBRATION_TYPES,
      categories: categories.rows.map((c) => ({
        id: c.id,
        name: c.name,
        note: c.note,
        celebrationTypes: c.celebration_types,
        sortOrder: c.sort_order,
      })),
      services: [...cfg.services.values()],
      packages: [...cfg.packages.values()],
      themes: themes.rows.map((t) => ({
        id: t.id,
        name: t.name,
        tags: t.tags,
        colors: t.colors,
        gradient: t.gradient,
        coverImageUrl: t.cover_image_url,
        gallery: galleryByTheme.get(t.id) ?? [],
        popular: t.popular,
        featured: t.featured,
        celebrationType: t.celebration_type,
      })),
      themeTags: THEME_TAGS,
      castleVariants: CASTLE_VARIANTS,
      deliveryZones: cfg.zones,
      rules: cfg.rules,
      startTimes: START_TIMES,
      notices: NOTICES,
      missingServiceNotes: MISSING_SERVICE_NOTES,
      paymentMethods: allProviders().map((p) => ({
        name: p.name,
        label: p.label,
        tagline: p.tagline,
        mode: p.mode,
      })),
      // Browser-side Google Maps key (client-exposed by design; restrict by
      // referrer/bundle in Google Cloud). Served from the API so it lives only
      // in the API's environment — never committed to the repo.
      mapsKey: config.googleMapsApiKey ?? null,
    };
  });

  /**
   * A live total for the app to display. The same function runs at
   * checkout, where its result — not this one — is what gets charged.
   */
  app.post('/api/quote', async (request, reply) => {
    const parsed = cartSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'invalid_cart', details: parsed.error.flatten() });
    }
    const result = await previewQuote(parsed.data as unknown as CartInput);
    return {
      ...result,
      totalDisplay: formatAed(result.totalFils),
    };
  });

  /** Which start times still finish before midnight for this event. */
  app.get('/api/start-times', async () => {
    const cfg = await loadConfig();
    return START_TIMES.map((t) => ({
      value: t,
      allowed: endsBeforeCutoff(t, cfg.rules),
    }));
  });

  app.post('/api/checkout', async (request, reply) => {
    const schema = z.object({
      cart: cartSchema,
      // The customer is taken from the signed token, not the body — a client
      // can no longer check out as someone else by sending their id.
      customerId: z.string().optional(),
      provider: z.enum(['tabby', 'tamara', 'ziina']),
      lang: z.enum(['en', 'ar']).optional(),
      idempotencyKey: z.string().optional(),
      termsAccepted: z.boolean().optional(),
      // Guest checkout: contact details when the customer is not signed in.
      guest: z
        .object({
          name: z.string().trim().min(2).max(120),
          phone: z.string().trim().min(6).max(30),
          backupPhone: z.string().trim().min(6).max(30),
          email: z.string().trim().email(),
        })
        .optional(),
      discounts: z
        .object({
          promoCode: z.string().max(40).nullable().optional(),
          useCredit: z.boolean().optional(),
          redeemPoints: z.boolean().optional(),
        })
        .optional(),
    });
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'invalid_request', details: parsed.error.flatten() });
    }

    const customerId = customerFromRequest(request);
    if (!customerId && !parsed.data.guest) {
      return reply.status(401).send({ error: 'auth_required', message: 'Please sign in or enter your details to complete your booking.' });
    }

    try {
      const result = await startCheckout({
        cart: parsed.data.cart as unknown as CheckoutCart,
        // customerFromRequest returns '' (not null) when unauthenticated, and
        // '' is not nullish — so `?? null` would leak '' downstream and break
        // the guest branch. Normalize the empty string to null.
        customerId: customerId || null,
        guest: parsed.data.guest,
        provider: parsed.data.provider,
        lang: parsed.data.lang,
        idempotencyKey: parsed.data.idempotencyKey,
        termsAccepted: parsed.data.termsAccepted,
        discounts: parsed.data.discounts,
      });
      return result;
    } catch (err) {
      if (err instanceof CheckoutError) {
        const status = err.code === 'unavailable' ? 409 : err.code === 'not_found' ? 404 : 422;
        return reply.status(status).send({ error: err.code, message: err.message, details: err.details });
      }
      request.log.error({ err }, 'checkout failed');
      return reply.status(500).send({ error: 'checkout_failed' });
    }
  });

  /**
   * Standalone shop checkout — custom printed/digital goods with no party.
   * Guests allowed (same as /api/checkout). No date/time/venue/map pin.
   */
  app.post('/api/shop/checkout', async (request, reply) => {
    const schema = z.object({
      items: z
        .array(z.object({ serviceId: z.string().max(40), quantity: z.number().int().min(0).max(9999) }))
        .min(1),
      emirate: z.string().max(40).nullable().optional(),
      address: z
        .object({
          area: z.string().max(120).optional(),
          street: z.string().max(120).optional(),
          villa: z.string().max(120).optional(),
          details: z.string().max(300).optional(),
        })
        .nullable()
        .optional(),
      customization: z
        .object({
          // Only our own Cloudinary uploads — never an arbitrary URL the team
          // would open from the dashboard.
          refImages: z
            .array(z.string().url().max(500).startsWith('https://res.cloudinary.com/'))
            .max(3)
            .optional(),
          wantDraw: z.boolean().optional(),
        })
        .nullable()
        .optional(),
      provider: z.enum(['tabby', 'tamara', 'ziina']),
      lang: z.enum(['en', 'ar']).optional(),
      termsAccepted: z.boolean().optional(),
      guest: z
        .object({
          name: z.string().trim().min(2).max(120),
          phone: z.string().trim().min(6).max(30),
          backupPhone: z.string().trim().min(6).max(30),
          email: z.string().trim().email(),
        })
        .optional(),
    });
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'invalid_request', details: parsed.error.flatten() });
    }
    const customerId = customerFromRequest(request);
    if (!customerId && !parsed.data.guest) {
      return reply.status(401).send({ error: 'auth_required', message: 'Please sign in or enter your details.' });
    }
    try {
      const result = await startShopCheckout({
        items: parsed.data.items,
        emirate: parsed.data.emirate ?? null,
        address: parsed.data.address ?? null,
        customization: parsed.data.customization ?? null,
        customerId: customerId || null,
        guest: parsed.data.guest,
        provider: parsed.data.provider,
        lang: parsed.data.lang,
        termsAccepted: parsed.data.termsAccepted,
      });
      return result;
    } catch (err) {
      if (err instanceof CheckoutError) {
        const status = err.code === 'unavailable' ? 409 : 422;
        return reply.status(status).send({ error: err.code, message: err.message, details: err.details });
      }
      request.log.error({ err }, 'shop checkout failed');
      return reply.status(500).send({ error: 'checkout_failed' });
    }
  });

  /**
   * What the "confirming your payment" screen polls. It reports the
   * server's own view — it never asks the app what happened, and the
   * redirect back from the provider proves nothing on its own (§4.7).
   */
  app.get('/api/orders/:orderId', async (request, reply) => {
    const { orderId } = request.params as { orderId: string };
    // Order ids are a visible sequence, so require the unguessable view token
    // (issued in the provider return URL) — otherwise anyone could enumerate
    // orders and read their status/amount.
    const { t } = request.query as { t?: string };
    if (!orderViewTokenValid(orderId, t)) {
      return reply.status(404).send({ error: 'not_found' });
    }
    const { rows } = await pool.query(
      `SELECT o.id, o.status, o.total_fils, o.event_id, o.kind,
              p.provider, p.status AS payment_status, p.checkout_url
         FROM orders o
         LEFT JOIN LATERAL (
           SELECT * FROM payments WHERE order_id = o.id ORDER BY created_at DESC LIMIT 1
         ) p ON TRUE
        WHERE o.id = $1`,
      [orderId],
    );
    const order = rows[0];
    if (!order) return reply.status(404).send({ error: 'not_found' });

    return {
      orderId: order.id,
      status: order.status,
      kind: order.kind,
      paymentStatus: order.payment_status,
      provider: order.provider,
      eventId: order.event_id,
      totalFils: Number(order.total_fils),
      totalDisplay: formatAed(Number(order.total_fils)),
      // The app shows a neutral waiting state until this flips. A booking is
      // confirmed once its event exists; a shop order (no event) is confirmed
      // as soon as it is paid.
      confirmed: order.status === 'paid' && (order.kind === 'shop' || Boolean(order.event_id)),
    };
  });

  /**
   * The Eventana assistant. Answers only from Eventana's own catalogue,
   * and escalates refunds, complaints and price changes to a human
   * rather than answering them.
   */
  app.post('/api/assistant', async (request, reply) => {
    const schema = z.object({
      question: z.string().min(1).max(1000),
      celebrationType: z.string().optional(),
    });
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'invalid_request' });
    return answerAssistant(parsed.data.question, parsed.data.celebrationType);
  });

  /**
   * Real social proof from confirmed events: average rating per package, an
   * overall average, and recent written testimonials (first name only). Public
   * and anonymous — no customer detail beyond a first name leaks.
   */
  app.get('/api/social-proof', async () => {
    const [perPkg, overall, testi] = await Promise.all([
      pool.query(
        `SELECT e.package_id, round(avg(r.stars)::numeric, 1) AS avg, count(*)::int AS count
           FROM event_ratings r JOIN events e ON e.id = r.event_id
          WHERE e.package_id IS NOT NULL
          GROUP BY e.package_id`,
      ),
      pool.query(`SELECT round(avg(stars)::numeric, 1) AS avg, count(*)::int AS count FROM event_ratings`),
      pool.query(
        `SELECT r.stars, r.feedback, c.name
           FROM event_ratings r
           JOIN events e ON e.id = r.event_id
           LEFT JOIN customers c ON c.id = e.customer_id
          WHERE r.feedback IS NOT NULL AND length(trim(r.feedback)) > 0
          ORDER BY r.created_at DESC LIMIT 8`,
      ),
    ]);
    return {
      packages: Object.fromEntries(
        perPkg.rows.map((p) => [p.package_id, { avg: Number(p.avg), count: p.count }]),
      ),
      overall: { avg: Number(overall.rows[0]?.avg ?? 0), count: overall.rows[0]?.count ?? 0 },
      testimonials: testi.rows.map((x) => ({
        stars: x.stars,
        feedback: x.feedback,
        name: String(x.name ?? '').trim().split(' ')[0] || 'Guest',
      })),
    };
  });

  /**
   * AI party planner — a real, deterministic recommender over the live
   * catalogue (same philosophy as the assistant: never invents a price). Given
   * a celebration, head count and budget it returns a concrete proposal the
   * app can drop straight into the cart: a package when one fits, otherwise a
   * budget-fitted Build-Your-Own bundle that reaches the 15% threshold when it
   * can. A matching theme is included.
   */
  app.post('/api/plan', async (request, reply) => {
    const schema = z.object({
      celebrationType: z.enum(['kids', 'graduation', 'bride', 'baby', 'gender', 'adult', 'customc']).default('kids'),
      childrenCount: z.number().int().min(1).max(500).default(20),
      budgetFils: z.number().int().min(0).nullable().optional(),
      age: z.string().max(20).optional(),
    });
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'invalid_request' });
    const { celebrationType, childrenCount, budgetFils, age } = parsed.data;
    const cfg = await loadConfig();
    const budget = budgetFils && budgetFils > 0 ? budgetFils : Number.MAX_SAFE_INTEGER;

    const costOf = (s: any) =>
      s.pricing?.kind === 'per_child'
        ? s.priceFils * Math.max(childrenCount, s.pricing.minChildren ?? 1)
        : s.pricing?.kind === 'per_piece'
          ? s.priceFils * (s.pricing.minQuantity ?? 1)
          : s.priceFils;
    const qtyOf = (s: any) =>
      s.pricing?.kind === 'per_child' ? childrenCount : (s.pricing?.minQuantity ?? 1);

    const { rows: themeRows } = await pool.query(
      `SELECT id, name FROM themes WHERE active AND celebration_type = $1 ORDER BY popular DESC, sort_order LIMIT 1`,
      [celebrationType],
    );
    const theme = themeRows[0] ?? null;

    // 1) A ready-made package (kids) that fits — the fullest within budget.
    const pkg = [...cfg.packages.values()]
      .filter((p) => p.priceFils <= budget)
      .sort((a, b) => b.priceFils - a.priceFils)[0];
    if (celebrationType === 'kids' && pkg) {
      return {
        kind: 'package',
        celebrationType,
        packageId: pkg.id,
        services: {},
        themeId: theme?.id ?? null,
        themeName: theme?.name ?? null,
        estTotalFils: pkg.priceFils,
        summary: `${pkg.name} — ${pkg.capacity}, ${pkg.durationHours}h, setup handled by Eventana. Fits your budget with room for extras.`,
      };
    }

    // 2) Build-Your-Own bundle, greedy within budget.
    const eligible = [...cfg.services.values()]
      .filter((s) => !s.needsAdminReview)
      .filter((s) => !s.celebrationTypes || s.celebrationTypes.includes(celebrationType));
    const chosen: Record<string, number> = {};
    let total = 0;
    const tryAdd = (pred: (s: any) => boolean) => {
      const cand = eligible.filter((s) => pred(s) && !chosen[s.id]).sort((a, b) => costOf(a) - costOf(b));
      for (const s of cand) {
        if (total + costOf(s) <= budget) { chosen[s.id] = qtyOf(s); total += costOf(s); return true; }
      }
      return false;
    };
    tryAdd((s) => /backdrop/i.test(s.name));
    tryAdd((s) => s.pricing?.kind === 'per_child'); // an activity
    tryAdd((s) => s.isFoodStation);
    const threshold = (cfg.rules as any).byoDiscountThresholdFils ?? 250_000;
    let guard = 0;
    while (total < Math.min(budget, threshold) && guard++ < 10) {
      if (!tryAdd(() => true)) break;
    }

    return {
      kind: 'byo',
      celebrationType,
      packageId: null,
      services: chosen,
      themeId: theme?.id ?? null,
      themeName: theme?.name ?? null,
      estTotalFils: total,
      summary:
        Object.keys(chosen).length > 0
          ? `A custom ${childrenCount}-child celebration${age ? ` for age ${age}` : ''} — ${Object.keys(chosen).length} services${total >= threshold ? ', which unlocks 15% off' : ''}.`
          : 'Tell me a little more budget and I’ll put a party together.',
    };
  });

  /* --------------------------- customer accounts ------------------------ */
  // Simple, additive self-service accounts. These do not change the checkout
  // contract: checkout still takes a customerId — registration just creates a
  // real one instead of the demo customer.

  const hashPassword = (password: string): string => {
    const salt = randomBytes(16).toString('hex');
    return `${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
  };
  const verifyPassword = (password: string, stored: string | null): boolean => {
    if (!stored || !stored.includes(':')) return false;
    const [salt, hash] = stored.split(':');
    const check = scryptSync(password, salt, 64).toString('hex');
    const a = Buffer.from(check, 'hex');
    const b = Buffer.from(hash, 'hex');
    return a.length === b.length && timingSafeEqual(a, b);
  };

  app.post('/api/customers/register', async (request, reply) => {
    const schema = z.object({
      name: z.string().trim().min(2).max(120),
      email: z.string().trim().email(),
      phone: z.string().trim().min(6).max(30),
      backupPhone: z.string().trim().min(6).max(30).optional(),
      password: z.string().min(6).max(200),
      referralCode: z.string().trim().max(40).optional(),
    });
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'invalid_request', details: parsed.error.flatten() });
    }
    const { name, email, phone, backupPhone, password, referralCode } = parsed.data;
    const existing = await pool.query('SELECT id FROM customers WHERE lower(email) = lower($1) LIMIT 1', [email]);
    if (existing.rowCount) {
      return reply.status(409).send({ error: 'email_taken', message: 'An account with this email already exists — please sign in.' });
    }

    // A valid referral code grants the new customer welcome credit and links
    // them to the referrer (who is rewarded on this customer's first booking).
    let referredBy: string | null = null;
    let welcomeCredit = 0;
    if (referralCode) {
      const norm = referralCode.toUpperCase();
      const { rows } = await pool.query(`SELECT id FROM customers WHERE referral_code = $1`, [norm]);
      // Record the link only. The referee's AED 250 is granted at their FIRST
      // confirmed booking (see confirm.ts), not instantly — otherwise anyone
      // could mint spendable credit by registering throwaway accounts.
      if (rows[0]) referredBy = norm;
    }

    const id = `CUST-${randomBytes(4).toString('hex').toUpperCase()}`;
    // Retry a couple of times in the unlikely event of a code collision.
    let myCode = makeReferralCode(name);
    for (let attempt = 0; attempt < 3; attempt++) {
      const clash = await pool.query(`SELECT 1 FROM customers WHERE referral_code = $1`, [myCode]);
      if (!clash.rowCount) break;
      myCode = makeReferralCode(name);
    }

    await pool.query(
      `INSERT INTO customers (id, name, phone, backup_phone, email, password_hash, referral_code, referred_by, referral_credit_fils)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [id, name, phone, backupPhone ?? null, email, hashPassword(password), myCode, referredBy, welcomeCredit],
    );
    return {
      customerId: id, name, email, phone, token: issueCustomerToken(id),
      referralCode: myCode, welcomeCreditFils: welcomeCredit,
    };
  });

  /**
   * Live promo-code check for the signed-in customer at a given subtotal, so
   * the app can show the exact saving before paying.
   */
  app.post('/api/promo/check', async (request, reply) => {
    const schema = z.object({ code: z.string().trim().min(1).max(40), subtotalFils: z.number().int().min(0) });
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'invalid_request' });
    // Anyone can check a general code (guest checkout included). A personal
    // voucher is still scoped to its owner inside validatePromo, so a guest
    // (null id) simply can't validate someone else's personal code.
    const customerId = customerFromRequest(request);
    const v = await validatePromo(pool, parsed.data.code, customerId, parsed.data.subtotalFils);
    return v.ok
      ? { ok: true, code: v.code, amountFils: v.amountFils }
      : { ok: false, reason: v.reason };
  });

  /**
   * Signs a direct Cloudinary upload for custom-theme reference images. The
   * customer may attach these before an order exists, so this isn't event- or
   * account-scoped; it only ever returns a short-lived signature for the
   * `eventana/themes` folder (image bytes go straight to Cloudinary).
   */
  app.post('/api/customers/uploads/sign', async (_request, reply) => {
    if (!uploadsEnabled()) return reply.status(503).send({ error: 'uploads_unavailable' });
    const signed = signUpload('eventana/themes');
    if (!signed) return reply.status(503).send({ error: 'uploads_unavailable' });
    return signed;
  });

  app.post('/api/customers/login', async (request, reply) => {
    const schema = z.object({ email: z.string().trim().email(), password: z.string().min(1) });
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'invalid_request' });
    const { email, password } = parsed.data;
    const { rows } = await pool.query(
      'SELECT id, name, phone, email, password_hash, referral_code FROM customers WHERE lower(email) = lower($1) LIMIT 1',
      [email],
    );
    const c = rows[0];
    if (!c || !verifyPassword(password, c.password_hash)) {
      return reply.status(401).send({ error: 'invalid_credentials', message: 'Wrong email or password.' });
    }
    return {
      customerId: c.id, name: c.name, email: c.email, phone: c.phone,
      token: issueCustomerToken(c.id), referralCode: c.referral_code ?? null,
    };
  });

  /**
   * Request a password reset. Always returns ok — it never reveals whether an
   * email is registered. When it is, a short-lived signed link is emailed.
   */
  app.post('/api/customers/forgot', async (request, reply) => {
    const schema = z.object({ email: z.string().trim().email() });
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'invalid_request' });
    const { rows } = await pool.query(
      'SELECT id, name FROM customers WHERE lower(email) = lower($1) LIMIT 1',
      [parsed.data.email],
    );
    const c = rows[0];
    if (c && emailEnabled()) {
      const link = `${config.publicAppUrl}/?reset=${issueResetToken(c.id)}`;
      await sendEmail({
        to: parsed.data.email,
        subject: 'Reset your Eventana password',
        html: `<!doctype html><html><body style="margin:0;background:#faf6f2;font-family:'Segoe UI',Arial,sans-serif;color:#3B3641">
          <div style="max-width:520px;margin:0 auto;padding:24px">
            <div style="text-align:center;padding:14px 0 18px"><span style="font-size:22px;font-weight:800;color:#E94F9C">Eventana</span></div>
            <div style="background:#fff;border-radius:18px;padding:26px 24px;line-height:1.6;font-size:15px">
              <p style="margin:0 0 14px">Hi ${String(c.name).split(' ')[0]} 👋</p>
              <p style="margin:0 0 18px">Tap below to set a new password. This link expires in 30 minutes. If you didn't ask for this, you can ignore this email.</p>
              <a href="${link}" style="display:inline-block;background:#E94F9C;color:#fff;text-decoration:none;font-weight:700;font-size:14px;padding:12px 24px;border-radius:12px">Reset my password →</a>
            </div>
          </div></body></html>`,
      }).catch(() => null);
    }
    return { ok: true };
  });

  /** Complete a password reset with a valid token. */
  app.post('/api/customers/reset', async (request, reply) => {
    const schema = z.object({ token: z.string().min(10), password: z.string().min(6).max(200) });
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'invalid_request', message: 'Your new password needs at least 6 characters.' });
    }
    const cid = verifyResetToken(parsed.data.token);
    if (!cid) return reply.status(401).send({ error: 'invalid_token', message: 'This reset link is invalid or has expired. Please request a new one.' });
    const { rows } = await pool.query('SELECT id, name, email, phone FROM customers WHERE id = $1', [cid]);
    const c = rows[0];
    if (!c) return reply.status(404).send({ error: 'not_found' });
    await pool.query('UPDATE customers SET password_hash = $2 WHERE id = $1', [cid, hashPassword(parsed.data.password)]);
    // Sign them straight in.
    return { customerId: c.id, name: c.name, email: c.email, phone: c.phone, token: issueCustomerToken(c.id) };
  });
}

type CheckoutCart = Parameters<typeof startCheckout>[0]['cart'];
