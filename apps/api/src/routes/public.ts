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
import { loadConfig } from '../domain/settings.js';
import { CheckoutError, previewQuote, startCheckout } from '../domain/checkout.js';
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
});

export async function publicRoutes(app: FastifyInstance) {
  /** Ops probe: is the Google Calendar link actually working? Status only. */
  app.get('/api/calendar/check', async () => checkCalendarConnection());

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
      customerId: z.string(),
      provider: z.enum(['tabby', 'tamara', 'ziina']),
      lang: z.enum(['en', 'ar']).optional(),
      idempotencyKey: z.string().optional(),
    });
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'invalid_request', details: parsed.error.flatten() });
    }

    try {
      const result = await startCheckout({
        cart: parsed.data.cart as unknown as CheckoutCart,
        customerId: parsed.data.customerId,
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
    return { customerId: id, name, email, phone };
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
    return { customerId: c.id, name: c.name, email: c.email, phone: c.phone };
  });
}

type CheckoutCart = Parameters<typeof startCheckout>[0]['cart'];
