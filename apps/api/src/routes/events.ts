/**
 * "My Event" — everything a customer can do after their booking is
 * confirmed. Every route is scoped to the customer who owns the event.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  formatAed,
  formatHour,
  isCancelled,
  parseHour,
  purchasableExtraHours,
  quoteAddons,
  suggestedSocksPairs,
} from '@eventana/shared';

/** "17:00" -> "5:00 PM". Times are stored 24h and displayed 12h. */
const display = (time: string) => formatHour(parseHour(time));
import { pool } from '../db/pool.js';
import { loadConfig } from '../domain/settings.js';
import { CheckoutError, startAddonCheckout } from '../domain/checkout.js';

/** Until real auth lands, the customer identifies itself by header. */
function customerIdOf(request: any): string {
  return String(request.headers['x-customer-id'] ?? 'CUST-4471');
}

/**
 * The single refusal a cancelled event gives to every self-service write:
 * add-ons, extra hours, socks, servings and location changes.
 */
const CANCELLED_ERROR = {
  error: 'event_cancelled',
  message:
    'This event has been cancelled. Additional purchases and location changes are no longer available — please contact the Eventana team.',
};

export async function eventRoutes(app: FastifyInstance) {
  app.get('/api/events', async (request) => {
    const customerId = customerIdOf(request);
    const { rows } = await pool.query(
      `SELECT e.id, e.event_date, e.start_time, e.base_end_time, e.phase,
              e.celebration_type, e.package_id, p.name AS package_name,
              e.emirate, o.total_fils
         FROM events e
         JOIN orders o ON o.id = e.order_id
         LEFT JOIN packages p ON p.id = e.package_id
        WHERE e.customer_id = $1
        ORDER BY e.event_date DESC`,
      [customerId],
    );
    return rows.map((r) => ({
      id: r.id,
      date: r.event_date,
      startTime: r.start_time,
      endTime: r.base_end_time,
      startDisplay: display(r.start_time),
      endDisplay: display(r.base_end_time),
      phase: r.phase,
      celebrationType: r.celebration_type,
      packageName: r.package_name,
      emirate: r.emirate,
      totalDisplay: formatAed(Number(r.total_fils)),
    }));
  });

  app.get('/api/events/:eventId', async (request, reply) => {
    const { eventId } = request.params as { eventId: string };
    const customerId = customerIdOf(request);
    const cfg = await loadConfig();

    const { rows } = await pool.query(
      `SELECT e.*, o.total_fils, o.status AS order_status, p.name AS package_name
         FROM events e
         JOIN orders o ON o.id = e.order_id
         LEFT JOIN packages p ON p.id = e.package_id
        WHERE e.id = $1 AND e.customer_id = $2`,
      [eventId, customerId],
    );
    const event = rows[0];
    if (!event) return reply.status(404).send({ error: 'not_found' });

    const [services, team, messages, designs, tasks] = await Promise.all([
      pool.query(`SELECT * FROM event_services WHERE event_id = $1 ORDER BY id`, [eventId]),
      pool.query(
        `SELECT m.id, m.name, m.role, m.color FROM event_team et
           JOIN team_members m ON m.id = et.member_id
          WHERE et.event_id = $1`,
        [eventId],
      ),
      pool.query(
        `SELECT id, sender, author, body, created_at FROM messages
          WHERE event_id = $1 ORDER BY created_at`,
        [eventId],
      ),
      pool.query(`SELECT * FROM designs WHERE event_id = $1 ORDER BY version DESC`, [eventId]),
      pool.query(
        `SELECT count(*) FILTER (WHERE status = 'done')::int AS done, count(*)::int AS total
           FROM event_tasks WHERE event_id = $1`,
        [eventId],
      ),
    ]);

    const serviceIds = services.rows.map((s) => s.service_id).filter(Boolean) as string[];
    const bookedServices = serviceIds
      .map((id) => cfg.services.get(id))
      .filter((s): s is NonNullable<typeof s> => Boolean(s));

    // Extra servings are offered only for stations actually booked, and
    // package items count too (Popcorn, Cotton Candy, Ice Cream…).
    const stationLabels = services.rows.map((s) => String(s.label).toLowerCase());
    const extraServingOptions = [...cfg.services.values()]
      .filter((s) => s.extraServingFils !== null)
      .filter(
        (s) =>
          bookedServices.some((b) => b.id === s.id) ||
          stationLabels.some((l) => l.includes(s.name.replace(' Station', '').toLowerCase())),
      )
      .map((s) => ({
        serviceId: s.id,
        name: s.name,
        blockSize: cfg.rules.extraServingBlock,
        priceFils: s.extraServingFils!,
        priceDisplay: formatAed(s.extraServingFils!),
      }));

    const hasInflatable =
      bookedServices.some((s) => s.isInflatable) ||
      stationLabels.some((l) => /castle|bubble|slide|inflatable|football/.test(l));

    // A cancelled event sells nothing further and tracks nothing further.
    const cancelled = isCancelled(event.phase);

    const maxExtraHours = cancelled
      ? 0
      : purchasableExtraHours(event.start_time, cfg.rules, event.extra_hours);

    return {
      id: event.id,
      orderId: event.order_id,
      phase: event.phase,
      cancelled,
      cancelledAt: event.cancelled_at,
      cancellationReason: event.cancellation_reason,
      // Live tracking is suppressed outright rather than left to the app
      // to hide — a cancelled event has no team on the way.
      eta: cancelled ? null : event.eta,
      date: event.event_date,
      startTime: event.start_time,
      endTime: event.base_end_time,
      startDisplay: display(event.start_time),
      endDisplay: display(event.base_end_time),
      extraHours: event.extra_hours,
      celebrationType: event.celebration_type,
      packageName: event.package_name,
      themeId: event.theme_id,
      customTheme: event.custom_theme,
      childrenCount: event.children_count,
      emirate: event.emirate,
      address: event.address,
      mapPin: { lat: event.map_lat, lng: event.map_lng },
      castleVariant: event.castle_variant,
      totalDisplay: formatAed(Number(event.total_fils)),
      orderStatus: event.order_status,
      services: services.rows.map((s) => ({
        id: s.id,
        serviceId: s.service_id,
        label: s.label,
        quantity: s.quantity,
        amountDisplay: formatAed(Number(s.amount_fils)),
        source: s.source,
      })),
      team: team.rows,
      messages: messages.rows,
      chatOpen: event.chat_open,
      designs: designs.rows,
      taskProgress: tasks.rows[0],
      // Everything purchasable is emptied for a cancelled event, so a
      // stale client cannot render a buy button at all.
      addOns: {
        maxExtraHours,
        additionalHourFils: cfg.rules.additionalHourFils,
        additionalHourDisplay: formatAed(cfg.rules.additionalHourFils),
        socks: hasInflatable && !cancelled
          ? {
              perPairFils: cfg.rules.socksPerPairFils,
              perPairDisplay: formatAed(cfg.rules.socksPerPairFils),
              suggestedPairs: suggestedSocksPairs(event.children_count),
              suggestedDisplay: formatAed(
                cfg.rules.socksPerPairFils * suggestedSocksPairs(event.children_count),
              ),
            }
          : null,
        extraServings: cancelled ? [] : extraServingOptions,
      },
      notices: {
        inflatable: hasInflatable,
      },
    };
  });

  /** Price an "Add More to My Event" basket without charging anything. */
  app.post('/api/events/:eventId/addons/quote', async (request, reply) => {
    const { eventId } = request.params as { eventId: string };
    const schema = z.object({
      additionalHours: z.number().int().min(0).max(6).default(0),
      socksPairs: z.number().int().min(0).max(500).default(0),
      extraServings: z.record(z.string(), z.number().int().min(0).max(50)).default({}),
    });
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'invalid_request' });

    const cfg = await loadConfig();
    const { rows } = await pool.query(
      `SELECT * FROM events WHERE id = $1 AND customer_id = $2`,
      [eventId, customerIdOf(request)],
    );
    if (!rows[0]) return reply.status(404).send({ error: 'not_found' });
    if (isCancelled(rows[0].phase)) return reply.status(409).send(CANCELLED_ERROR);

    const result = quoteAddons(parsed.data, {
      rules: cfg.rules,
      services: cfg.services,
      startTime: rows[0].start_time,
      hoursAlreadyPurchased: rows[0].extra_hours,
    });
    return { ...result, totalDisplay: formatAed(result.totalFils) };
  });

  /** Add-ons are a NEW order on the same Event ID (spec §8). */
  app.post('/api/events/:eventId/addons/checkout', async (request, reply) => {
    const { eventId } = request.params as { eventId: string };
    const schema = z.object({
      provider: z.enum(['tabby', 'tamara', 'ziina']),
      additionalHours: z.number().int().min(0).max(6).default(0),
      socksPairs: z.number().int().min(0).max(500).default(0),
      extraServings: z.record(z.string(), z.number().int().min(0).max(50)).default({}),
      lang: z.enum(['en', 'ar']).optional(),
    });
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'invalid_request' });

    try {
      return await startAddonCheckout({
        eventId,
        customerId: customerIdOf(request),
        provider: parsed.data.provider,
        lang: parsed.data.lang,
        request: {
          additionalHours: parsed.data.additionalHours,
          socksPairs: parsed.data.socksPairs,
          extraServings: parsed.data.extraServings,
        },
      });
    } catch (err) {
      if (err instanceof CheckoutError) {
        return reply
          .status(err.code === 'not_found' ? 404 : 422)
          .send({ error: err.code, message: err.message, details: err.details });
      }
      throw err;
    }
  });

  /** Event-day chat. No employee phone numbers ever leave the system. */
  app.post('/api/events/:eventId/messages', async (request, reply) => {
    const { eventId } = request.params as { eventId: string };
    const schema = z.object({ body: z.string().min(1).max(2000) });
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'invalid_request' });

    const { rows } = await pool.query(
      `SELECT chat_open FROM events WHERE id = $1 AND customer_id = $2`,
      [eventId, customerIdOf(request)],
    );
    if (!rows[0]) return reply.status(404).send({ error: 'not_found' });
    if (!rows[0].chat_open) {
      return reply.status(423).send({ error: 'chat_closed', message: 'This event chat is closed.' });
    }

    const inserted = await pool.query(
      `INSERT INTO messages (event_id, sender, body) VALUES ($1,'customer',$2) RETURNING *`,
      [eventId, parsed.data.body],
    );
    return inserted.rows[0];
  });

  /** Optional setup-placement photos. Never blocks checkout. */
  app.post('/api/events/:eventId/setup-photos', async (request, reply) => {
    const { eventId } = request.params as { eventId: string };
    const schema = z.object({
      itemKey: z.string().min(1),
      photoUrl: z.string().url().nullable().optional(),
      description: z.string().max(1000).optional(),
    });
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'invalid_request' });

    const { rows } = await pool.query(
      `SELECT phase FROM events WHERE id = $1 AND customer_id = $2`,
      [eventId, customerIdOf(request)],
    );
    if (!rows[0]) return reply.status(404).send({ error: 'not_found' });
    // Placement details describe where the team should set up. On a
    // cancelled event nobody is setting anything up, so this is closed
    // along with every other self-service change.
    if (isCancelled(rows[0].phase)) return reply.status(409).send(CANCELLED_ERROR);

    const inserted = await pool.query(
      `INSERT INTO event_setup_photos (event_id, item_key, photo_url, description)
       VALUES ($1,$2,$3,$4) RETURNING *`,
      [eventId, parsed.data.itemKey, parsed.data.photoUrl ?? null, parsed.data.description ?? null],
    );
    return inserted.rows[0];
  });

  /** Design approval. Approving locks the version and clears the task. */
  app.post('/api/events/:eventId/designs/:version/decision', async (request, reply) => {
    const { eventId, version } = request.params as { eventId: string; version: string };
    const schema = z.object({
      decision: z.enum(['approve', 'request_changes']),
      note: z.string().max(2000).optional(),
    });
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'invalid_request' });
    if (parsed.data.decision === 'request_changes' && !parsed.data.note?.trim()) {
      return reply
        .status(400)
        .send({ error: 'note_required', message: 'Tell us what to change.' });
    }

    const { rows: owned } = await pool.query(
      `SELECT 1 FROM events WHERE id = $1 AND customer_id = $2`,
      [eventId, customerIdOf(request)],
    );
    if (!owned[0]) return reply.status(404).send({ error: 'not_found' });

    const status = parsed.data.decision === 'approve' ? 'approved' : 'changes_requested';
    const { rows } = await pool.query(
      `UPDATE designs
          SET status = $3, customer_note = $4, decided_at = now()
        WHERE event_id = $1 AND version = $2 AND status = 'pending'
        RETURNING *`,
      [eventId, Number(version), status, parsed.data.note ?? null],
    );
    if (!rows[0]) {
      return reply
        .status(409)
        .send({ error: 'already_decided', message: 'This version has already been decided.' });
    }

    if (status === 'approved') {
      await pool.query(
        `UPDATE event_tasks SET status = 'done'
          WHERE event_id = $1 AND department = 'design' AND title ILIKE '%approval%'`,
        [eventId],
      );
    } else {
      await pool.query(
        `INSERT INTO event_tasks (event_id, department, title)
         VALUES ($1,'design',$2)`,
        [eventId, `Revise design — customer requested changes (v${Number(version) + 1})`],
      );
    }

    return rows[0];
  });
}
