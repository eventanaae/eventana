/**
 * Internal Operations Dashboard API.
 *
 * Guarded by a staff token. Refunds live here and only here — never in
 * the customer app, never in the assistant (spec §9).
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { formatAed, isCancelled } from '@eventana/shared';
import { config } from '../config.js';
import { pool } from '../db/pool.js';
import { getProvider, integrationStatus } from '../payments/index.js';
import { invalidateConfigCache, loadConfig, savePricingRules } from '../domain/settings.js';
import { applyPaymentStatus, recordPaymentEvent } from '../domain/orders.js';
import { withTransaction } from '../db/pool.js';
import { reconcileOnce } from '../domain/reconcile.js';

/**
 * Moves an event to the terminal Cancelled phase and stands its
 * operation down: reservations released, scheduled messages stopped,
 * outstanding tasks closed, live tracking cleared.
 */
async function cancelEvent(eventId: string, reason: string) {
  return withTransaction(async (db) => {
    const { rows } = await db.query(
      `UPDATE events
          SET phase = 'Cancelled', eta = NULL,
              cancelled_at = now(), cancellation_reason = $2
        WHERE id = $1
        RETURNING *`,
      [eventId, reason],
    );
    if (!rows[0]) return null;

    // Free the physical assets for other customers immediately.
    await db.query(
      `UPDATE inventory_holds SET status = 'released'
        WHERE event_id = $1 AND status IN ('held','reserved')`,
      [eventId],
    );
    // Stop anything scheduled for an event that is not happening.
    await db.query(
      `UPDATE notifications SET cancelled_at = now()
        WHERE event_id = $1 AND sent_at IS NULL AND cancelled_at IS NULL`,
      [eventId],
    );
    // Close outstanding preparation work.
    await db.query(
      `UPDATE event_tasks SET status = 'done' WHERE event_id = $1 AND status <> 'done'`,
      [eventId],
    );
    await db.query(
      `INSERT INTO event_tasks (event_id, department, title)
       VALUES ($1,'finance',$2)`,
      [eventId, `Cancellation — decide refund position (${reason})`],
    );
    await db.query(
      `INSERT INTO notifications (event_id, channel, template, scheduled_for, payload)
       VALUES ($1,'email','event_cancelled', now(), $2)`,
      [eventId, JSON.stringify({ eventId, reason })],
    );

    return rows[0];
  });
}

export async function adminRoutes(app: FastifyInstance) {
  app.addHook('preHandler', async (request, reply) => {
    const token = request.headers['x-staff-token'];
    if (token !== config.staffToken) {
      return reply.status(401).send({ error: 'unauthorized' });
    }
  });

  /* ------------------------------ Today --------------------------- */

  app.get('/api/admin/today', async () => {
    const [kpis, events, tasks, inventory, approvals] = await Promise.all([
      pool.query(
        `SELECT
           (SELECT count(*)::int FROM events WHERE event_date = CURRENT_DATE) AS events_today,
           (SELECT count(*)::int FROM orders WHERE status = 'paid'
              AND created_at >= date_trunc('month', now())) AS bookings_month,
           (SELECT COALESCE(sum(total_fils),0)::bigint FROM orders WHERE status = 'paid'
              AND created_at >= date_trunc('month', now())) AS revenue_month,
           (SELECT count(*)::int FROM event_tasks WHERE status = 'open') AS open_tasks,
           (SELECT count(*)::int FROM orders WHERE status = 'needs_review') AS needs_review,
           (SELECT count(*)::int FROM orders WHERE status = 'processing') AS processing`,
      ),
      pool.query(
        `SELECT e.id, e.event_date, e.start_time, e.base_end_time, e.phase, e.eta,
                e.emirate, c.name AS customer, p.name AS package_name, o.total_fils
           FROM events e
           JOIN customers c ON c.id = e.customer_id
           JOIN orders o ON o.id = e.order_id
           LEFT JOIN packages p ON p.id = e.package_id
          WHERE e.event_date >= CURRENT_DATE
          ORDER BY e.event_date, e.start_time
          LIMIT 25`,
      ),
      pool.query(
        `SELECT t.id, t.event_id, t.department, t.title, t.status, t.blocked_reason
           FROM event_tasks t
           JOIN events e ON e.id = t.event_id
          WHERE t.status <> 'done'
          ORDER BY e.event_date, t.department
          LIMIT 40`,
      ),
      pool.query(
        `SELECT a.code, a.name, a.variant, a.units, a.status,
                count(h.id) FILTER (
                  WHERE h.status IN ('held','reserved')
                    AND (h.expires_at IS NULL OR h.expires_at > now())
                )::int AS committed
           FROM inventory_assets a
           LEFT JOIN inventory_holds h ON h.asset_code = a.code
          WHERE a.units = 1
          GROUP BY a.code
          ORDER BY committed DESC, a.name`,
      ),
      pool.query(
        `SELECT d.id, d.event_id, d.version, d.status, d.created_at
           FROM designs d WHERE d.status = 'pending' ORDER BY d.created_at LIMIT 10`,
      ),
    ]);

    const k = kpis.rows[0];
    return {
      kpis: {
        eventsToday: k.events_today,
        bookingsThisMonth: k.bookings_month,
        revenueThisMonthDisplay: formatAed(Number(k.revenue_month)),
        openTasks: k.open_tasks,
        needsReview: k.needs_review,
        processing: k.processing,
      },
      events: events.rows.map((e) => ({
        ...e,
        totalDisplay: formatAed(Number(e.total_fils)),
      })),
      tasks: tasks.rows,
      criticalInventory: inventory.rows,
      pendingDesignApprovals: approvals.rows,
      integrations: integrationStatus(),
    };
  });

  /* ------------------------------ Events -------------------------- */

  app.get('/api/admin/events', async (request) => {
    const { status } = request.query as { status?: string };
    const { rows } = await pool.query(
      `SELECT e.id, e.event_date, e.start_time, e.base_end_time, e.phase, e.emirate,
              e.celebration_type, c.name AS customer, c.phone, o.id AS order_id,
              o.status AS order_status, o.total_fils
         FROM events e
         JOIN customers c ON c.id = e.customer_id
         JOIN orders o ON o.id = e.order_id
        WHERE ($1::text IS NULL OR o.status = $1)
        ORDER BY e.event_date DESC
        LIMIT 200`,
      [status ?? null],
    );
    return rows.map((r) => ({ ...r, totalDisplay: formatAed(Number(r.total_fils)) }));
  });

  app.get('/api/admin/events/:eventId', async (request, reply) => {
    const { eventId } = request.params as { eventId: string };
    const { rows } = await pool.query(
      `SELECT e.*, c.name AS customer, c.phone, c.email, o.id AS order_id,
              o.status AS order_status, o.total_fils, o.quote, o.cart
         FROM events e
         JOIN customers c ON c.id = e.customer_id
         JOIN orders o ON o.id = e.order_id
        WHERE e.id = $1`,
      [eventId],
    );
    if (!rows[0]) return reply.status(404).send({ error: 'not_found' });

    const [services, tasks, team, holds, messages, photos, orders, payments] = await Promise.all([
      pool.query(`SELECT * FROM event_services WHERE event_id = $1 ORDER BY id`, [eventId]),
      pool.query(`SELECT * FROM event_tasks WHERE event_id = $1 ORDER BY department, id`, [eventId]),
      pool.query(
        `SELECT m.* FROM event_team et JOIN team_members m ON m.id = et.member_id WHERE et.event_id = $1`,
        [eventId],
      ),
      pool.query(
        `SELECT h.*, a.name, a.variant FROM inventory_holds h
           JOIN inventory_assets a ON a.code = h.asset_code
          WHERE h.event_id = $1 ORDER BY a.name`,
        [eventId],
      ),
      pool.query(`SELECT * FROM messages WHERE event_id = $1 ORDER BY created_at`, [eventId]),
      pool.query(`SELECT * FROM event_setup_photos WHERE event_id = $1`, [eventId]),
      pool.query(`SELECT * FROM orders WHERE event_id = $1 OR id = $2 ORDER BY created_at`, [
        eventId,
        rows[0].order_id,
      ]),
      pool.query(
        `SELECT p.* FROM payments p JOIN orders o ON o.id = p.order_id
          WHERE o.event_id = $1 OR o.id = $2 ORDER BY p.created_at`,
        [eventId, rows[0].order_id],
      ),
    ]);

    return {
      event: {
        ...rows[0],
        totalDisplay: formatAed(Number(rows[0].total_fils)),
        // Who the party is for — distinct from the account holder (#23/#24).
        eventFor: (rows[0].cart as { eventFor?: string } | null)?.eventFor ?? null,
      },
      services: services.rows,
      tasks: tasks.rows,
      team: team.rows,
      reservations: holds.rows,
      messages: messages.rows,
      setupPhotos: photos.rows,
      orders: orders.rows.map((o) => ({ ...o, totalDisplay: formatAed(Number(o.total_fils)) })),
      payments: payments.rows,
    };
  });

  app.post('/api/admin/events/:eventId/phase', async (request, reply) => {
    const { eventId } = request.params as { eventId: string };
    const schema = z.object({
      phase: z.enum([
        'Booking Confirmed',
        'Preparing',
        'On The Way',
        'Arrived',
        'Setting Up',
        'Setup Ready',
        'Party Started',
        'Event Completed',
      ]),
      eta: z.string().nullable().optional(),
    });
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'invalid_request' });

    // Cancelled is terminal. Advancing a cancelled event back onto the
    // normal timeline would re-open purchases and live tracking for an
    // event that is not happening; use the cancel/reinstate route.
    const { rows: current } = await pool.query(`SELECT phase FROM events WHERE id = $1`, [eventId]);
    if (!current[0]) return reply.status(404).send({ error: 'not_found' });
    if (isCancelled(current[0].phase)) {
      return reply.status(409).send({
        error: 'event_cancelled',
        message: 'This event is cancelled. Reinstate it before advancing its status.',
      });
    }

    const { rows } = await pool.query(
      `UPDATE events SET phase = $2, eta = COALESCE($3, eta) WHERE id = $1 RETURNING *`,
      [eventId, parsed.data.phase, parsed.data.eta ?? null],
    );
    return rows[0];
  });

  /**
   * Cancels an event. Terminal for the customer: live tracking stops, the
   * timeline collapses to Confirmed → Cancelled, and every self-service
   * purchase and location change is refused from this point.
   *
   * Cancelling does NOT refund by itself — money is returned through the
   * refund route, deliberately as a separate, explicit decision.
   */
  app.post('/api/admin/events/:eventId/cancel', async (request, reply) => {
    const { eventId } = request.params as { eventId: string };
    const schema = z.object({ reason: z.string().min(1).max(500) });
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'reason_required', message: 'Give a cancellation reason.' });
    }

    const result = await cancelEvent(eventId, parsed.data.reason);
    if (!result) return reply.status(404).send({ error: 'not_found' });
    return result;
  });

  /** Undo an accidental cancellation, before anything was refunded. */
  app.post('/api/admin/events/:eventId/reinstate', async (request, reply) => {
    const { eventId } = request.params as { eventId: string };
    const { rows } = await pool.query(
      `UPDATE events
          SET phase = 'Booking Confirmed', cancelled_at = NULL, cancellation_reason = NULL
        WHERE id = $1 AND phase = 'Cancelled'
        RETURNING *`,
      [eventId],
    );
    if (!rows[0]) {
      return reply.status(409).send({ error: 'not_cancelled', message: 'This event is not cancelled.' });
    }
    await pool.query(
      `INSERT INTO event_tasks (event_id, department, title)
       VALUES ($1,'operations','Event reinstated — re-check inventory availability and crew')`,
      [eventId],
    );
    return rows[0];
  });

  /** Team reply in the event chat. The staff name shows; no phone number. */
  app.post('/api/admin/events/:eventId/messages', async (request, reply) => {
    const { eventId } = request.params as { eventId: string };
    const schema = z.object({ body: z.string().min(1).max(2000), author: z.string().default('Eventana Team') });
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'invalid_request' });
    const { rows } = await pool.query(
      `INSERT INTO messages (event_id, sender, author, body) VALUES ($1,'team',$2,$3) RETURNING *`,
      [eventId, parsed.data.author, parsed.data.body],
    );
    return rows[0];
  });

  app.post('/api/admin/events/:eventId/chat', async (request, reply) => {
    const { eventId } = request.params as { eventId: string };
    const schema = z.object({ open: z.boolean() });
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'invalid_request' });
    await pool.query(`UPDATE events SET chat_open = $2 WHERE id = $1`, [eventId, parsed.data.open]);
    return { eventId, chatOpen: parsed.data.open };
  });

  /* ------------------------------ Tasks --------------------------- */

  app.get('/api/admin/tasks', async () => {
    const { rows } = await pool.query(
      `SELECT t.*, e.event_date, e.start_time
         FROM event_tasks t JOIN events e ON e.id = t.event_id
        ORDER BY e.event_date, t.department, t.id
        LIMIT 300`,
    );
    return rows;
  });

  app.patch('/api/admin/tasks/:taskId', async (request, reply) => {
    const { taskId } = request.params as { taskId: string };
    const schema = z.object({
      status: z.enum(['open', 'done', 'blocked']),
      blockedReason: z.string().max(500).nullable().optional(),
    });
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'invalid_request' });
    const { rows } = await pool.query(
      `UPDATE event_tasks SET status = $2, blocked_reason = $3 WHERE id = $1 RETURNING *`,
      [Number(taskId), parsed.data.status, parsed.data.blockedReason ?? null],
    );
    if (!rows[0]) return reply.status(404).send({ error: 'not_found' });
    return rows[0];
  });

  /* ---------------------------- Inventory ------------------------- */

  app.get('/api/admin/inventory', async () => {
    const { rows } = await pool.query(
      `SELECT a.*,
              count(h.id) FILTER (
                WHERE h.status = 'reserved'
              )::int AS reserved,
              count(h.id) FILTER (
                WHERE h.status = 'held' AND h.expires_at > now()
              )::int AS held,
              (SELECT json_agg(json_build_object(
                 'eventId', h2.event_id, 'orderId', h2.order_id,
                 'startsAt', h2.starts_at, 'endsAt', h2.ends_at, 'status', h2.status))
                 FROM inventory_holds h2
                WHERE h2.asset_code = a.code AND h2.status IN ('held','reserved')
                  AND h2.ends_at > now()) AS upcoming
         FROM inventory_assets a
         LEFT JOIN inventory_holds h ON h.asset_code = a.code
        GROUP BY a.code
        ORDER BY a.name, a.variant`,
    );
    return rows;
  });

  app.patch('/api/admin/inventory/:code', async (request, reply) => {
    const { code } = request.params as { code: string };
    const schema = z.object({
      status: z.enum(['available', 'maintenance', 'retired']).optional(),
      units: z.number().int().min(0).max(50).optional(),
      notes: z.string().max(500).nullable().optional(),
    });
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'invalid_request' });
    const { rows } = await pool.query(
      `UPDATE inventory_assets
          SET status = COALESCE($2, status),
              units = COALESCE($3, units),
              notes = COALESCE($4, notes)
        WHERE code = $1 RETURNING *`,
      [code, parsed.data.status ?? null, parsed.data.units ?? null, parsed.data.notes ?? null],
    );
    if (!rows[0]) return reply.status(404).send({ error: 'not_found' });
    return rows[0];
  });

  /* ------------------------------ Team ---------------------------- */

  app.get('/api/admin/team', async () => {
    const { rows } = await pool.query(
      `SELECT m.*,
              (SELECT json_agg(json_build_object('eventId', et.event_id, 'date', e.event_date))
                 FROM event_team et JOIN events e ON e.id = et.event_id
                WHERE et.member_id = m.id AND e.event_date >= CURRENT_DATE) AS assignments
         FROM team_members m ORDER BY m.name`,
    );
    return rows;
  });

  /* ---------------------------- Settings -------------------------- */

  app.get('/api/admin/settings', async () => {
    const cfg = await loadConfig(pool, { fresh: true });
    return {
      rules: cfg.rules,
      deliveryZones: cfg.zones,
      integrations: integrationStatus(),
      googleMaps: {
        configured: Boolean(config.googleMapsApiKey),
        note: config.googleMapsApiKey
          ? 'API key loaded from the server environment.'
          : 'Set GOOGLE_MAPS_API_KEY in the server environment to enable geocoding and live ETA.',
      },
    };
  });

  app.patch('/api/admin/settings/rules', async (request, reply) => {
    const schema = z.object({
      byoDiscountPercent: z.number().min(0).max(100).optional(),
      byoDiscountThresholdFils: z.number().int().min(0).optional(),
      customThemeFeeFils: z.number().int().min(0).optional(),
      additionalHourFils: z.number().int().min(0).optional(),
      socksPerPairFils: z.number().int().min(0).optional(),
      inventoryHoldMinutes: z.number().int().min(1).max(120).optional(),
      activityMinimumChildren: z.number().int().min(1).max(100).optional(),
      customTshirtMinimum: z.number().int().min(1).max(100).optional(),
      latestEndHour: z.number().int().min(12).max(30).optional(),
      standardEventHours: z.number().int().min(1).max(12).optional(),
      loyaltyPointsPerAed: z.number().min(0).max(100).optional(),
      allowDiscountStacking: z.boolean().optional(),
    });
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'invalid_request', details: parsed.error.flatten() });
    }
    const staff = String(request.headers['x-staff-name'] ?? 'dashboard');
    return savePricingRules(parsed.data, staff);
  });

  app.patch('/api/admin/delivery-zones/:emirate', async (request, reply) => {
    const { emirate } = request.params as { emirate: string };
    const schema = z.object({
      feeFils: z.number().int().min(0).nullable().optional(),
      available: z.boolean().optional(),
      specialConditions: z.string().max(500).nullable().optional(),
    });
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'invalid_request' });

    const { rows } = await pool.query(
      `UPDATE delivery_zones
          SET fee_fils = COALESCE($2, fee_fils),
              available = COALESCE($3, available),
              special_conditions = COALESCE($4, special_conditions)
        WHERE emirate = $1 RETURNING *`,
      [
        decodeURIComponent(emirate),
        parsed.data.feeFils ?? null,
        parsed.data.available ?? null,
        parsed.data.specialConditions ?? null,
      ],
    );
    if (!rows[0]) return reply.status(404).send({ error: 'not_found' });
    invalidateConfigCache();
    return rows[0];
  });

  app.patch('/api/admin/services/:serviceId', async (request, reply) => {
    const { serviceId } = request.params as { serviceId: string };
    const schema = z.object({
      priceFils: z.number().int().min(0).optional(),
      extraServingFils: z.number().int().min(0).nullable().optional(),
      needsAdminReview: z.boolean().optional(),
      active: z.boolean().optional(),
    });
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'invalid_request' });

    const { rows } = await pool.query(
      `UPDATE services
          SET price_fils = COALESCE($2, price_fils),
              extra_serving_fils = COALESCE($3, extra_serving_fils),
              needs_admin_review = COALESCE($4, needs_admin_review),
              active = COALESCE($5, active)
        WHERE id = $1 RETURNING *`,
      [
        serviceId,
        parsed.data.priceFils ?? null,
        parsed.data.extraServingFils ?? null,
        parsed.data.needsAdminReview ?? null,
        parsed.data.active ?? null,
      ],
    );
    if (!rows[0]) return reply.status(404).send({ error: 'not_found' });
    invalidateConfigCache();
    return rows[0];
  });

  /* ----------------------------- Themes --------------------------- */

  app.patch('/api/admin/themes/:themeId', async (request, reply) => {
    const { themeId } = request.params as { themeId: string };
    const schema = z.object({
      name: z.string().min(1).max(120).optional(),
      active: z.boolean().optional(),
      featured: z.boolean().optional(),
      popular: z.boolean().optional(),
      coverImageUrl: z.string().url().nullable().optional(),
      sortOrder: z.number().int().optional(),
      tags: z.array(z.string()).optional(),
    });
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'invalid_request' });
    const d = parsed.data;
    const { rows } = await pool.query(
      `UPDATE themes SET
         name = COALESCE($2, name), active = COALESCE($3, active),
         featured = COALESCE($4, featured), popular = COALESCE($5, popular),
         cover_image_url = COALESCE($6, cover_image_url),
         sort_order = COALESCE($7, sort_order), tags = COALESCE($8, tags)
       WHERE id = $1 RETURNING *`,
      [
        themeId, d.name ?? null, d.active ?? null, d.featured ?? null, d.popular ?? null,
        d.coverImageUrl ?? null, d.sortOrder ?? null, d.tags ?? null,
      ],
    );
    if (!rows[0]) return reply.status(404).send({ error: 'not_found' });
    return rows[0];
  });

  /* ----------------------------- Refunds -------------------------- */

  /**
   * Refunds are initiated only here, by a staff token. The resulting
   * status comes from the provider response — never set optimistically
   * (spec §9).
   */
  app.post('/api/admin/orders/:orderId/refund', async (request, reply) => {
    const { orderId } = request.params as { orderId: string };
    const schema = z.object({
      amountFils: z.number().int().min(1),
      reason: z.string().min(1).max(500),
    });
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'invalid_request' });

    const { rows } = await pool.query(
      `SELECT p.*, o.total_fils, o.event_id, o.customer_id
         FROM payments p JOIN orders o ON o.id = p.order_id
        WHERE p.order_id = $1 ORDER BY p.created_at DESC LIMIT 1`,
      [orderId],
    );
    const payment = rows[0];
    if (!payment) return reply.status(404).send({ error: 'not_found' });
    if (!payment.provider_payment_id) {
      return reply.status(409).send({ error: 'no_provider_payment' });
    }
    if (payment.status !== 'paid' && payment.status !== 'captured' && payment.status !== 'partially_refunded') {
      return reply.status(409).send({ error: 'not_refundable', status: payment.status });
    }
    const alreadyRefunded = Number(payment.refunded_fils);
    if (alreadyRefunded + parsed.data.amountFils > Number(payment.amount_fils)) {
      return reply.status(422).send({ error: 'exceeds_paid_amount' });
    }

    const provider = getProvider(payment.provider);
    const verified = await provider.refund(
      payment.provider_payment_id,
      parsed.data.amountFils,
      parsed.data.reason,
    );

    const refundedTotal = alreadyRefunded + parsed.data.amountFils;
    const nextStatus =
      refundedTotal >= Number(payment.amount_fils) ? 'refunded' : 'partially_refunded';

    await withTransaction(async (db) => {
      await applyPaymentStatus(db, {
        paymentId: payment.id,
        nextStatus,
        source: 'admin',
        providerStatus: verified.providerStatus,
        payload: verified.raw,
        refundedFils: refundedTotal,
        note: `Refund ${formatAed(parsed.data.amountFils)} AED — ${parsed.data.reason}`,
      });

      // Reverse the loyalty points the booking earned, proportionally.
      const cfg = await loadConfig();
      const points = Math.floor((parsed.data.amountFils / 100) * cfg.rules.loyaltyPointsPerAed);
      if (points > 0) {
        await db.query(
          `INSERT INTO loyalty_transactions (customer_id, event_id, order_id, points, reason)
           VALUES ($1,$2,$3,$4,'Refund reversal')`,
          [payment.customer_id, payment.event_id, orderId, -points],
        );
        await db.query(
          `UPDATE customers SET loyalty_points = GREATEST(0, loyalty_points - $2) WHERE id = $1`,
          [payment.customer_id, points],
        );
      }

      if (nextStatus === 'refunded') {
        // A fully refunded booking is a cancelled event: release the
        // reservations, stop the scheduled emails, and move the event to
        // the terminal Cancelled phase so the customer app stops offering
        // add-ons and live tracking.
        await db.query(
          `UPDATE inventory_holds SET status = 'released' WHERE order_id = $1`,
          [orderId],
        );
        if (payment.event_id) {
          await db.query(
            `UPDATE notifications SET cancelled_at = now()
              WHERE event_id = $1 AND sent_at IS NULL AND cancelled_at IS NULL`,
            [payment.event_id],
          );
          await db.query(
            `UPDATE events
                SET phase = 'Cancelled', eta = NULL,
                    cancelled_at = COALESCE(cancelled_at, now()),
                    cancellation_reason = COALESCE(cancellation_reason, $2)
              WHERE id = $1`,
            [payment.event_id, `Fully refunded — ${parsed.data.reason}`],
          );
          await db.query(
            `UPDATE event_tasks SET status = 'done'
              WHERE event_id = $1 AND status <> 'done'`,
            [payment.event_id],
          );
        }
      }
    });

    return { orderId, status: nextStatus, refundedFils: refundedTotal, provider: verified.providerStatus };
  });

  /* -------------------------- Audit + ops ------------------------- */

  app.get('/api/admin/orders/:orderId/audit', async (request) => {
    const { orderId } = request.params as { orderId: string };
    const { rows } = await pool.query(
      `SELECT * FROM payment_events WHERE order_id = $1 ORDER BY created_at, id`,
      [orderId],
    );
    return rows;
  });

  app.get('/api/admin/needs-review', async () => {
    const { rows } = await pool.query(
      `SELECT o.id, o.status, o.total_fils, o.created_at, o.event_id,
              (SELECT note FROM payment_events pe WHERE pe.order_id = o.id
                ORDER BY pe.created_at DESC LIMIT 1) AS last_note
         FROM orders o WHERE o.status = 'needs_review' ORDER BY o.created_at DESC`,
    );
    return rows.map((r) => ({ ...r, totalDisplay: formatAed(Number(r.total_fils)) }));
  });

  app.post('/api/admin/reconcile', async () => reconcileOnce());

  app.get('/api/admin/notifications', async () => {
    const { rows } = await pool.query(
      `SELECT * FROM notifications ORDER BY created_at DESC LIMIT 100`,
    );
    return rows;
  });

  /* ------------------------- consumables inventory ------------------------ */

  app.get('/api/admin/consumables', async () => {
    const { rows } = await pool.query(
      `SELECT *, (on_hand <= reorder_level) AS low_stock
         FROM consumables ORDER BY category, name`,
    );
    return rows;
  });

  app.post('/api/admin/consumables', async (request, reply) => {
    const schema = z.object({
      id: z.string().trim().min(1).optional(),
      name: z.string().trim().min(1).max(120),
      category: z.string().trim().max(40).default('general'),
      unit: z.string().trim().max(20).default('pcs'),
      onHand: z.number().int().min(0).default(0),
      reorderLevel: z.number().int().min(0).default(0),
      perGuest: z.boolean().default(false),
      perEventQty: z.number().int().min(0).default(0),
      supplier: z.string().trim().max(120).optional(),
      active: z.boolean().default(true),
    });
    const p = schema.safeParse(request.body);
    if (!p.success) return reply.status(400).send({ error: 'invalid_request', details: p.error.flatten() });
    const d = p.data;
    const id = d.id ?? `CON-${Date.now().toString(36).toUpperCase()}`;
    const { rows } = await pool.query(
      `INSERT INTO consumables (id, name, category, unit, on_hand, reorder_level, per_guest, per_event_qty, supplier, active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (id) DO UPDATE SET
         name=EXCLUDED.name, category=EXCLUDED.category, unit=EXCLUDED.unit,
         reorder_level=EXCLUDED.reorder_level, per_guest=EXCLUDED.per_guest,
         per_event_qty=EXCLUDED.per_event_qty, supplier=EXCLUDED.supplier, active=EXCLUDED.active
       RETURNING *`,
      [id, d.name, d.category, d.unit, d.onHand, d.reorderLevel, d.perGuest, d.perEventQty, d.supplier ?? null, d.active],
    );
    return rows[0];
  });

  // Restock (positive delta) or manual draw-down (negative); records the
  // movement and updates on-hand stock.
  app.post('/api/admin/consumables/:id/adjust', async (request, reply) => {
    const { id } = request.params as { id: string };
    const schema = z.object({
      delta: z.number().int(),
      reason: z.string().max(40).optional(),
      eventId: z.string().optional(),
    });
    const p = schema.safeParse(request.body);
    if (!p.success) return reply.status(400).send({ error: 'invalid_request' });
    return withTransaction(async (db) => {
      const { rows } = await db.query(
        `UPDATE consumables SET on_hand = GREATEST(0, on_hand + $2) WHERE id = $1 RETURNING *`,
        [id, p.data.delta],
      );
      if (!rows[0]) {
        reply.status(404).send({ error: 'not_found' });
        return;
      }
      await db.query(
        `INSERT INTO consumable_usage (consumable_id, event_id, quantity, reason)
         VALUES ($1,$2,$3,$4)`,
        [id, p.data.eventId ?? null, -p.data.delta, p.data.reason ?? (p.data.delta >= 0 ? 'restock' : 'manual')],
      );
      return rows[0];
    });
  });

  /* --------------------------- missing items ----------------------------- */

  app.get('/api/admin/missing-items', async () => {
    const { rows } = await pool.query(
      `SELECT * FROM missing_items ORDER BY (status = 'requested') DESC, created_at DESC LIMIT 200`,
    );
    return rows;
  });

  app.post('/api/admin/missing-items', async (request, reply) => {
    const schema = z.object({
      item: z.string().trim().min(1).max(120),
      quantity: z.number().int().min(1).default(1),
      eventId: z.string().optional(),
      supplier: z.string().max(120).optional(),
      note: z.string().max(300).optional(),
      reportedBy: z.string().max(80).optional(),
    });
    const p = schema.safeParse(request.body);
    if (!p.success) return reply.status(400).send({ error: 'invalid_request', details: p.error.flatten() });
    const d = p.data;
    const { rows } = await pool.query(
      `INSERT INTO missing_items (item, quantity, event_id, supplier, note, reported_by)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [d.item, d.quantity, d.eventId ?? null, d.supplier ?? null, d.note ?? null, d.reportedBy ?? null],
    );
    return rows[0];
  });

  app.patch('/api/admin/missing-items/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const schema = z.object({ status: z.enum(['requested', 'ordered', 'received', 'cancelled']) });
    const p = schema.safeParse(request.body);
    if (!p.success) return reply.status(400).send({ error: 'invalid_request' });
    const { rows } = await pool.query(
      `UPDATE missing_items SET status = $2 WHERE id = $1 RETURNING *`,
      [id, p.data.status],
    );
    if (!rows[0]) return reply.status(404).send({ error: 'not_found' });
    return rows[0];
  });

  void recordPaymentEvent;
}
