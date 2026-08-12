/**
 * Customer-facing routes. Nothing here can confirm a booking, change a
 * price, approve a refund or read another customer's event.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
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
});

export async function publicRoutes(app: FastifyInstance) {
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
}

type CheckoutCart = Parameters<typeof startCheckout>[0]['cart'];
