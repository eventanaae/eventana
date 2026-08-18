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
import { CheckoutError, previewQuote, startCheckout } from '../domain/checkout.js';
import { customerFromRequest, issueCustomerToken } from '../domain/customerAuth.js';
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
    })
    .nullable()
    .optional(),
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
    const [themes, categories] = await Promise.all([
      pool.query(`SELECT * FROM themes WHERE active ORDER BY celebration_type, sort_order`),
      pool.query(`SELECT * FROM service_categories ORDER BY sort_order`),
    ]);

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
    });
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'invalid_request', details: parsed.error.flatten() });
    }

    const customerId = customerFromRequest(request);
    if (!customerId) {
      return reply.status(401).send({ error: 'auth_required', message: 'Please sign in to complete your booking.' });
    }

    try {
      const result = await startCheckout({
        cart: parsed.data.cart as unknown as CheckoutCart,
        customerId,
        provider: parsed.data.provider,
        lang: parsed.data.lang,
        idempotencyKey: parsed.data.idempotencyKey,
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
   * What the "confirming your payment" screen polls. It reports the
   * server's own view — it never asks the app what happened, and the
   * redirect back from the provider proves nothing on its own (§4.7).
   */
  app.get('/api/orders/:orderId', async (request, reply) => {
    const { orderId } = request.params as { orderId: string };
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
      // The app shows a neutral waiting state until this flips.
      confirmed: order.status === 'paid' && Boolean(order.event_id),
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
      password: z.string().min(6).max(200),
    });
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'invalid_request', details: parsed.error.flatten() });
    }
    const { name, email, phone, password } = parsed.data;
    const existing = await pool.query('SELECT id FROM customers WHERE lower(email) = lower($1) LIMIT 1', [email]);
    if (existing.rowCount) {
      return reply.status(409).send({ error: 'email_taken', message: 'An account with this email already exists — please sign in.' });
    }
    const id = `CUST-${randomBytes(4).toString('hex').toUpperCase()}`;
    await pool.query(
      `INSERT INTO customers (id, name, phone, email, password_hash) VALUES ($1,$2,$3,$4,$5)`,
      [id, name, phone, email, hashPassword(password)],
    );
    return { customerId: id, name, email, phone, token: issueCustomerToken(id) };
  });

  app.post('/api/customers/login', async (request, reply) => {
    const schema = z.object({ email: z.string().trim().email(), password: z.string().min(1) });
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'invalid_request' });
    const { email, password } = parsed.data;
    const { rows } = await pool.query(
      'SELECT id, name, phone, email, password_hash FROM customers WHERE lower(email) = lower($1) LIMIT 1',
      [email],
    );
    const c = rows[0];
    if (!c || !verifyPassword(password, c.password_hash)) {
      return reply.status(401).send({ error: 'invalid_credentials', message: 'Wrong email or password.' });
    }
    return { customerId: c.id, name: c.name, email: c.email, phone: c.phone, token: issueCustomerToken(c.id) };
  });
}

type CheckoutCart = Parameters<typeof startCheckout>[0]['cart'];
