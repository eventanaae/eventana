/**
 * "My Event" — everything a customer can do after their booking is
 * confirmed. Every route is scoped to the customer who owns the event.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  computeRefund,
  formatAed,
  formatHour,
  isCancelled,
  parseHour,
  purchasableExtraHours,
  quoteAddons,
  REFUND_TIERS,
  suggestedSocksPairs,
} from '@eventana/shared';

/** "17:00" -> "5:00 PM". Times are stored 24h and displayed 12h. */
const display = (time: string) => formatHour(parseHour(time));
import { pool, withTransaction } from '../db/pool.js';
import { loadConfig } from '../domain/settings.js';
import { CheckoutError, startAddonCheckout, startTipCheckout } from '../domain/checkout.js';
import { signUpload, uploadsEnabled } from '../integrations/cloudinary.js';
import { registerDevice, pushToStaff } from '../integrations/push.js';
import { generateEventPass, walletEnabled } from '../integrations/wallet.js';
import { customerFromRequest } from '../domain/customerAuth.js';
import { rescheduleEvent, RescheduleError, RESCHEDULE_MIN_HOURS } from '../domain/reschedule.js';
import { refundOrderMoney } from '../domain/refund.js';

/**
 * The customer is identified by their signed session token — never a raw
 * client-set id. Unauthenticated requests get an empty id, so scoped queries
 * return nothing instead of another customer's (or the demo customer's) data.
 */
function customerIdOf(request: any): string {
  return customerFromRequest(request);
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

  /**
   * Real loyalty balance for the signed-in customer. Points are already
   * earned on every confirmed booking (see confirmBooking); this exposes the
   * true balance, tier and history so the app can stop showing invented
   * numbers. Redeemable value is shown once redemption ships.
   */
  app.get('/api/rewards', async (request) => {
    const customerId = customerIdOf(request);

    const { rows: cust } = await pool.query(
      `SELECT loyalty_points, referral_code, referral_credit_fils FROM customers WHERE id = $1`,
      [customerId],
    );
    const points = Number(cust[0]?.loyalty_points ?? 0);
    const referralCode = cust[0]?.referral_code ?? null;
    const creditFils = Number(cust[0]?.referral_credit_fils ?? 0);

    const { rows: earned } = await pool.query(
      `SELECT COALESCE(SUM(points),0) AS earned
         FROM loyalty_transactions WHERE customer_id = $1 AND points > 0`,
      [customerId],
    );
    const lifetimeEarned = Number(earned[0]?.earned ?? 0);

    // Personal, unused, unexpired vouchers (e.g. the 20%-off next-booking reward).
    const { rows: voucherRows } = await pool.query(
      `SELECT code, value, expires_at
         FROM promo_codes p
        WHERE p.customer_id = $1 AND p.active AND p.kind = 'percent'
          AND (p.expires_at IS NULL OR p.expires_at > now())
          AND (p.max_uses IS NULL OR p.uses < p.max_uses)
          AND NOT EXISTS (SELECT 1 FROM promo_redemptions r WHERE r.code = p.code AND r.customer_id = $1)
        ORDER BY p.created_at DESC`,
      [customerId],
    );
    const vouchers = voucherRows.map((v) => ({
      code: v.code,
      percent: Number(v.value),
      expiresAt: v.expires_at?.toISOString?.() ?? null,
    }));

    const { rows: history } = await pool.query(
      `SELECT points, reason, created_at
         FROM loyalty_transactions WHERE customer_id = $1
        ORDER BY created_at DESC LIMIT 10`,
      [customerId],
    );

    // Tiers are earned by lifetime points, so a redemption never demotes a
    // customer. Thresholds are deliberately simple and easy to tune later.
    const TIERS = [
      { name: 'SILVER', min: 0 },
      { name: 'GOLD', min: 3000 },
      { name: 'PLATINUM', min: 8000 },
    ];
    let tierIndex = 0;
    for (let i = 0; i < TIERS.length; i++) if (lifetimeEarned >= TIERS[i].min) tierIndex = i;
    const next = TIERS[tierIndex + 1] ?? null;
    const floor = TIERS[tierIndex].min;
    const progressPct = next
      ? Math.min(100, Math.round(((lifetimeEarned - floor) / (next.min - floor)) * 100))
      : 100;

    return {
      points,
      redeemableFils: points * 2, // 100 points = AED 2
      referralCode,
      creditFils,
      vouchers,
      lifetimeEarned,
      tier: TIERS[tierIndex].name,
      nextTier: next?.name ?? null,
      pointsToNextTier: next ? Math.max(0, next.min - lifetimeEarned) : 0,
      progressPct,
      history: history.map((h) => ({
        points: h.points,
        reason: h.reason,
        at: h.created_at?.toISOString?.() ?? null,
      })),
    };
  });

  /**
   * Rebooking — reconstruct the exact selections from a past booking into a
   * fresh draft the app can drop the customer straight into (with a new date
   * and a re-pin). Reads the original cart, the faithful source of truth.
   */
  app.get('/api/events/:eventId/rebook', async (request, reply) => {
    const customerId = customerIdOf(request);
    const { eventId } = request.params as { eventId: string };
    const { rows } = await pool.query(
      `SELECT o.cart FROM events e JOIN orders o ON o.id = e.order_id
        WHERE e.id = $1 AND e.customer_id = $2`,
      [eventId, customerId],
    );
    if (!rows[0]) return reply.status(404).send({ error: 'not_found' });
    const cart = (rows[0].cart ?? {}) as any;

    const services: Record<string, number> = {};
    for (const s of cart.services ?? []) if (s?.serviceId && s.quantity > 0) services[s.serviceId] = s.quantity;

    return {
      celebrationType: cart.celebrationType ?? 'kids',
      ageBand: cart.ageBand ?? null,
      packageId: cart.packageId ?? null,
      services,
      themeId: cart.themeId ?? null,
      customTheme: Boolean(cart.customTheme),
      themeBrief: cart.themeBrief ?? null,
      castleVariant: cart.castleVariant ?? null,
      emirate: cart.emirate ?? 'Dubai',
      childrenCount: cart.childrenCount ?? 25,
      movie: cart.movie ?? null,
      eventFor: cart.eventFor ?? '',
      address: cart.address ?? { area: '', street: '', villa: '', details: '' },
      mapPin: cart.mapPin ?? null,
    };
  });

  /**
   * Self-service reschedule — move the date/time when the event is more than
   * 72h away and the assets are free in the new slot. Theme changes and
   * cancellations stay with the team.
   */
  app.post('/api/events/:eventId/reschedule', async (request, reply) => {
    const customerId = customerIdOf(request);
    if (!customerId) return reply.status(401).send({ error: 'auth_required' });
    const { eventId } = request.params as { eventId: string };
    const schema = z.object({
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      startTime: z.string().regex(/^\d{2}:\d{2}$/),
    });
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'invalid_request' });
    try {
      const r = await rescheduleEvent({
        eventId,
        customerId,
        newDate: parsed.data.date,
        newStartTime: parsed.data.startTime,
      });
      return { ok: true, ...r };
    } catch (err) {
      if (err instanceof RescheduleError) {
        const status = err.code === 'not_found' ? 404 : err.code === 'unavailable' ? 409 : 422;
        return reply.status(status).send({ error: err.code, message: err.message });
      }
      request.log.error({ err }, 'reschedule failed');
      return reply.status(500).send({ error: 'reschedule_failed' });
    }
  });

  /**
   * Cancellation refund preview — server-authoritative, no changes made. The
   * app shows exactly this before the customer confirms, so the number they
   * see is the number that will be honoured. Refund policy lives in
   * packages/shared/src/refund.ts (Terms & Conditions §7).
   */
  const startMsOf = (ev: { event_date: unknown; start_time: string }): number =>
    Date.parse(
      `${new Date(ev.event_date as string).toISOString().slice(0, 10)}T${ev.start_time}:00+04:00`,
    );

  const refundView = (ev: {
    event_date: unknown;
    start_time: string;
    total_fils: unknown;
    quote: any;
  }) => {
    const hoursToEvent = (startMsOf(ev) - Date.now()) / 3_600_000;
    const b = computeRefund({
      lines: ev.quote?.lines ?? [],
      totalPaidFils: Number(ev.total_fils),
      hoursToEvent,
    });
    return {
      ...b,
      totalPaidDisplay: formatAed(b.totalPaidFils),
      deliveryDisplay: formatAed(b.deliveryFils),
      nonRefundableExtrasDisplay: formatAed(b.nonRefundableExtrasFils),
      partyValueDisplay: formatAed(b.partyValueFils),
      refundDisplay: formatAed(b.refundFils),
      deductionDisplay: formatAed(b.deductionFils),
    };
  };

  app.get('/api/events/:eventId/cancellation-quote', async (request, reply) => {
    const customerId = customerIdOf(request);
    if (!customerId) return reply.status(401).send({ error: 'auth_required' });
    const { eventId } = request.params as { eventId: string };
    const { rows } = await pool.query(
      `SELECT e.phase, e.event_date, e.start_time, o.status AS order_status, o.total_fils, o.quote
         FROM events e JOIN orders o ON o.id = e.order_id
        WHERE e.id = $1 AND e.customer_id = $2`,
      [eventId, customerId],
    );
    const ev = rows[0];
    if (!ev) return reply.status(404).send({ error: 'not_found' });

    const alreadyCancelled = isCancelled(ev.phase);
    const started = ['Party Started', 'Event Completed'].includes(ev.phase);
    const passed = startMsOf(ev) - Date.now() <= 0;
    const cancellable = !alreadyCancelled && ev.order_status === 'paid' && !started && !passed;

    return {
      cancellable,
      reason: alreadyCancelled
        ? 'already_cancelled'
        : ev.order_status !== 'paid'
          ? 'not_paid'
          : started || passed
            ? 'event_started'
            : null,
      refund: refundView(ev),
      refundEta: 'approximately 7 business days',
      policy: REFUND_TIERS,
    };
  });

  /**
   * Customer-initiated cancellation. This cancels the event and records the
   * refund the policy owes — it does NOT move money. The actual refund is a
   * separate, staff-reviewed step (the existing admin refund route), which is
   * what flips the refund to "processed" and sends the refund email. Guarded
   * against double-clicks and stale clients by the phase check under a row lock.
   */
  app.post('/api/events/:eventId/cancel', async (request, reply) => {
    const customerId = customerIdOf(request);
    if (!customerId) return reply.status(401).send({ error: 'auth_required' });
    const { eventId } = request.params as { eventId: string };
    const schema = z.object({ reason: z.string().max(500).optional() });
    const parsed = schema.safeParse(request.body ?? {});
    const reason =
      (parsed.success && parsed.data.reason?.trim()) || 'Customer cancelled from the app';

    const result = await withTransaction(async (db) => {
      const { rows } = await db.query(
        `SELECT e.*, o.id AS order_id, o.status AS order_status, o.total_fils, o.quote
           FROM events e JOIN orders o ON o.id = e.order_id
          WHERE e.id = $1 AND e.customer_id = $2
          FOR UPDATE OF e`,
        [eventId, customerId],
      );
      const ev = rows[0];
      if (!ev) return { code: 404 as const, error: 'not_found' };
      if (isCancelled(ev.phase)) return { code: 409 as const, error: 'already_cancelled' };
      if (ev.order_status !== 'paid') return { code: 409 as const, error: 'not_paid' };
      if (['Party Started', 'Event Completed'].includes(ev.phase)) {
        return { code: 409 as const, error: 'event_started' };
      }
      if (startMsOf(ev) - Date.now() <= 0) return { code: 409 as const, error: 'event_passed' };

      const hoursToEvent = (startMsOf(ev) - Date.now()) / 3_600_000;
      const b = computeRefund({
        lines: ev.quote?.lines ?? [],
        totalPaidFils: Number(ev.total_fils),
        hoursToEvent,
      });

      // Freeze the event.
      await db.query(
        `UPDATE events SET phase = 'Cancelled', eta = NULL, cancelled_at = now(),
                cancellation_reason = $2 WHERE id = $1`,
        [eventId, reason],
      );
      await db.query(
        `UPDATE inventory_holds SET status = 'released'
          WHERE event_id = $1 AND status IN ('held','reserved')`,
        [eventId],
      );
      await db.query(
        `UPDATE notifications SET cancelled_at = now()
          WHERE event_id = $1 AND sent_at IS NULL AND cancelled_at IS NULL`,
        [eventId],
      );
      await db.query(
        `UPDATE event_tasks SET status = 'done' WHERE event_id = $1 AND status <> 'done'`,
        [eventId],
      );

      // Record the cancellation + the refund we owe. A 0% refund is recorded
      // as 'none' so the team isn't asked to process a zero payout.
      const refundStatus = b.refundFils > 0 ? 'pending' : 'none';
      await db.query(
        `INSERT INTO cancellations
           (order_id, event_id, cancelled_by, reason, total_paid_fils, delivery_fils,
            non_refundable_fils, party_value_fils, refund_percent, refund_amount_fils, refund_status)
         VALUES ($1,$2,'customer',$3,$4,$5,$6,$7,$8,$9,$10)
         ON CONFLICT (order_id) DO NOTHING`,
        [
          ev.order_id,
          eventId,
          reason,
          b.totalPaidFils,
          b.deliveryFils,
          b.nonRefundableExtrasFils,
          b.partyValueFils,
          b.percent,
          b.refundFils,
          refundStatus,
        ],
      );

      // Ops: a finance task to action the refund, plus a dashboard alert.
      await db.query(
        `INSERT INTO event_tasks (event_id, department, title)
         VALUES ($1,'finance',$2)`,
        [
          eventId,
          b.refundFils > 0
            ? `Customer cancelled — process ${b.percent}% refund (${formatAed(b.refundFils)})`
            : `Customer cancelled — no refund due per policy`,
        ],
      );
      await db.query(
        `INSERT INTO notifications (event_id, channel, template, scheduled_for, payload)
         VALUES ($1,'ops_alert','order_cancelled', now(), $2)`,
        [
          eventId,
          JSON.stringify({
            orderId: ev.order_id,
            refundFils: b.refundFils,
            percent: b.percent,
          }),
        ],
      );

      // Customer: the cancellation email (with the refund breakdown).
      await db.query(
        `INSERT INTO notifications (event_id, channel, template, scheduled_for, payload)
         VALUES ($1,'email','cancellation_refund', now(), $2)`,
        [eventId, JSON.stringify({ orderId: ev.order_id })],
      );

      return { code: 200 as const, breakdown: b, refundStatus, orderId: ev.order_id };
    });

    if (result.code !== 200) {
      return reply.status(result.code).send({ error: result.error });
    }

    // Auto-refund the money straight away through the payment provider (Stripe
    // etc.) and email the customer. Runs after the cancellation is committed so
    // a slow/failed provider call never rolls back the cancellation; on failure
    // the refund stays 'pending'/'failed' for the team to complete by hand.
    let refundStatus = result.refundStatus;
    if (result.refundStatus === 'pending' && result.breakdown.refundFils > 0) {
      const r = await refundOrderMoney({
        orderId: result.orderId,
        amountFils: result.breakdown.refundFils,
        reason: `Customer cancellation — ${result.breakdown.percent}% per policy`,
        source: 'customer_cancel',
      });
      refundStatus = r.ok ? 'processed' : 'pending';
    }

    return {
      ok: true,
      refundStatus,
      refund: {
        percent: result.breakdown.percent,
        refundFils: result.breakdown.refundFils,
        refundDisplay: formatAed(result.breakdown.refundFils),
        totalPaidDisplay: formatAed(result.breakdown.totalPaidFils),
      },
      refundEta: 'approximately 7 business days',
    };
  });

  app.get('/api/events/:eventId', async (request, reply) => {
    const { eventId } = request.params as { eventId: string };
    const customerId = customerIdOf(request);
    const cfg = await loadConfig();

    const { rows } = await pool.query(
      `SELECT e.*, o.total_fils, o.status AS order_status, o.cart, o.quote, p.name AS package_name,
              th.name AS theme_name,
              c.name AS contact_name, c.phone AS contact_phone, c.email AS contact_email,
              cx.cancelled_by, cx.refund_percent, cx.refund_amount_fils,
              cx.total_paid_fils AS cx_total_paid, cx.refund_status, cx.refund_reference,
              cx.processed_at AS refund_processed_at
         FROM events e
         JOIN orders o ON o.id = e.order_id
         JOIN customers c ON c.id = e.customer_id
         LEFT JOIN packages p ON p.id = e.package_id
         LEFT JOIN themes th ON th.id = e.theme_id
         LEFT JOIN cancellations cx ON cx.order_id = e.order_id
        WHERE e.id = $1 AND e.customer_id = $2`,
      [eventId, customerId],
    );
    const event = rows[0];
    if (!event) return reply.status(404).send({ error: 'not_found' });

    const [services, team, staffing, messages, designs, tasks, rating, payment] = await Promise.all([
      pool.query(`SELECT * FROM event_services WHERE event_id = $1 ORDER BY id`, [eventId]),
      pool.query(
        `SELECT m.id, m.name, m.role, m.color FROM event_team et
           JOIN team_members m ON m.id = et.member_id
          WHERE et.event_id = $1`,
        [eventId],
      ),
      pool.query(
        `SELECT es.role, es.status, es.part_time_name, es.is_leader, tm.name AS assignee_name
           FROM event_staff es LEFT JOIN team_members tm ON tm.id = es.assignee_id
          WHERE es.event_id = $1 ORDER BY es.is_leader DESC, es.role, es.slot`,
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
      pool.query(`SELECT stars, feedback FROM event_ratings WHERE event_id = $1`, [eventId]),
      pool.query(
        `SELECT provider, captured_fils, amount_fils, created_at, raw FROM payments
          WHERE order_id = $1 AND status IN ('captured','paid','confirmed','succeeded')
          ORDER BY created_at DESC LIMIT 1`,
        [event.order_id],
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

    // Self-service reschedule is offered only while the event is comfortably
    // ahead (more than 72h) and not cancelled.
    const startMs = Date.parse(
      `${new Date(event.event_date).toISOString().slice(0, 10)}T${event.start_time}:00+04:00`,
    );
    const canReschedule = !cancelled && startMs - Date.now() > RESCHEDULE_MIN_HOURS * 3_600_000;

    return {
      id: event.id,
      orderId: event.order_id,
      phase: event.phase,
      cancelled,
      canReschedule,
      cancelledAt: event.cancelled_at,
      cancellationReason: event.cancellation_reason,
      // Whether the customer may cancel from the app right now, and (once
      // cancelled) the refund the server computed and its progress.
      canCancel:
        !cancelled &&
        event.order_status === 'paid' &&
        !['Party Started', 'Event Completed'].includes(event.phase) &&
        startMs - Date.now() > 0,
      cancellation: event.refund_status
        ? {
            cancelledBy: event.cancelled_by,
            refundPercent: Number(event.refund_percent ?? 0),
            refundAmountFils: Number(event.refund_amount_fils ?? 0),
            refundAmountDisplay: formatAed(Number(event.refund_amount_fils ?? 0)),
            totalPaidDisplay: formatAed(Number(event.cx_total_paid ?? 0)),
            refundStatus: event.refund_status,
            refundReference: event.refund_reference,
            processedAt: event.refund_processed_at,
          }
        : null,
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
      themeName: event.theme_name ?? null,
      customTheme: event.custom_theme,
      // Custom-theme brief (concept / colours / notes) the customer submitted —
      // a JSONB blob, surfaced so the receipt can echo what was requested.
      customThemeBrief: event.custom_theme_brief ?? null,
      movie: event.movie_id ?? null,
      // Guest of honour ("who it's for") + age band live only in the order cart.
      eventFor: (event.cart as any)?.eventFor ?? null,
      ageBand: (event.cart as any)?.ageBand ?? null,
      childrenCount: event.children_count,
      emirate: event.emirate,
      address: event.address,
      mapPin: { lat: event.map_lat, lng: event.map_lng },
      castleVariant: event.castle_variant,
      // The customer's own contact on file (backup phone only if it was captured
      // into the cart — the customers table has no column for it).
      contact: {
        name: event.contact_name ?? null,
        phone: event.contact_phone ?? null,
        backupPhone:
          (event.cart as any)?.guest?.backupPhone ?? (event.cart as any)?.backupPhone ?? null,
        email: event.contact_email ?? null,
      },
      // Full price breakdown straight from the stored quote, so the receipt
      // mirrors exactly what was charged at checkout (items, discount, delivery).
      pricing: (() => {
        const q = (event.quote as any) || {};
        const delivery = Number(q.deliveryFils ?? 0);
        const discount = Number(q.discountFils ?? 0);
        const total = Number(event.total_fils);
        const items = Array.isArray(q.lines)
          ? q.lines
              .filter((l: any) => l.kind !== 'discount' && l.kind !== 'delivery')
              .map((l: any) => ({
                label: l.label,
                quantity: l.quantity,
                amountFils: Number(l.amountFils),
                amountDisplay: formatAed(Number(l.amountFils)),
              }))
          : [];
        const subtotal = items.reduce((s: number, l: any) => s + l.amountFils, 0);
        return {
          items,
          subtotalFils: subtotal,
          subtotalDisplay: formatAed(subtotal),
          discountFils: discount,
          discountDisplay: formatAed(discount),
          deliveryFils: delivery,
          deliveryDisplay: formatAed(delivery),
          totalFils: total,
          totalDisplay: formatAed(total),
        };
      })(),
      payment: payment.rows[0]
        ? (() => {
            const p = payment.rows[0] as any;
            const raw = (p.raw as any) || {};
            const card = raw?.card ?? raw?.payment_method_details?.card ?? {};
            const providerLabel: Record<string, string> = {
              stripe: 'Card', tabby: 'Tabby', tamara: 'Tamara', cash: 'Cash', link: 'Payment link',
            };
            const paid = Number(p.captured_fils || p.amount_fils || 0);
            return {
              method: providerLabel[p.provider] ?? p.provider,
              brand: card?.brand ?? null,
              last4: card?.last4 ?? null,
              paidFils: paid,
              paidDisplay: formatAed(paid),
              paidAt: p.created_at,
            };
          })()
        : null,
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
      // Customer-safe crew from the smart staffing plan. On-site roles only —
      // never the driver or the remote designer — and NEVER the word "part-time":
      // an unfilled or part-timer slot simply reads "To be confirmed" / the real
      // name once entered. A cancelled event shows no crew.
      crew: cancelled
        ? []
        : (() => {
            const LABEL: Record<string, string> = {
              leader: 'Event Leader', balloon_artist: 'Balloon Décor Artist', clown: 'Entertainer',
              face_painting: 'Face Painter', helper: 'Party Star', balloon_twisting: 'Balloon Magician',
              staff: 'Party Crew', acrobat_clown: 'Acrobat Entertainer',
            };
            // The event leader, designer and driver are internal roles — never
            // surfaced to the customer.
            const HIDE = new Set(['design', 'driver', 'leader']);
            return staffing.rows
              .filter((r) => !HIDE.has(r.role) && !r.is_leader)
              .map((r) => {
                const name =
                  r.status === 'assigned' ? r.assignee_name
                  : r.status === 'confirmed' ? r.part_time_name
                  : null;
                return {
                  role: LABEL[r.role] ?? 'Party Crew',
                  isLeader: r.is_leader,
                  name: name ?? null,
                  confirmed: !!name,
                };
              });
          })(),
      // Ratings & tips open once the party is under way / done, and never on a
      // cancelled event. The crew list above is who a tip can be aimed at.
      review: {
        canReview: !cancelled && ['Party Started', 'Event Completed'].includes(event.phase),
        rating: rating.rows[0] ?? null,
        tipPresetsFils: [5000, 10000, 15000],
      },
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
      provider: z.enum(['tabby', 'tamara', 'stripe']),
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

  /** Apple Wallet pass (.pkpass) for the customer's event ticket. */
  app.get('/api/events/:eventId/pass', async (request, reply) => {
    if (!walletEnabled()) return reply.status(409).send({ error: 'wallet_disabled' });
    const { eventId } = request.params as { eventId: string };
    const { rows } = await pool.query(
      `SELECT e.*, p.name AS package_name, o.cart
         FROM events e
         LEFT JOIN packages p ON p.id = e.package_id
         LEFT JOIN orders o ON o.id = e.order_id
        WHERE e.id = $1 AND e.customer_id = $2`,
      [eventId, customerIdOf(request)],
    );
    const ev = rows[0];
    if (!ev) return reply.status(404).send({ error: 'not_found' });

    const cart = (ev.cart ?? {}) as { eventFor?: string };
    try {
      const buffer = await generateEventPass({
        id: ev.id,
        title: ev.package_name ?? String(ev.celebration_type ?? 'Celebration'),
        dateLabel: new Date(ev.event_date).toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' }),
        timeLabel: `${display(ev.start_time)} – ${display(ev.base_end_time)}`,
        guest: cart.eventFor ?? null,
        emirate: ev.emirate,
      });
      return reply
        .header('Content-Type', 'application/vnd.apple.pkpass')
        .header('Content-Disposition', `attachment; filename="${ev.id}.pkpass"`)
        .send(buffer);
    } catch (err) {
      request.log.error({ err }, 'pass generation failed');
      return reply.status(500).send({ error: 'pass_failed' });
    }
  });

  /** Register this customer's device for push notifications. */
  app.post('/api/devices/register', async (request, reply) => {
    const schema = z.object({ token: z.string().min(10), platform: z.enum(['ios', 'android', 'web']).default('ios') });
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'invalid_request' });
    await registerDevice('customer', customerIdOf(request), parsed.data.token, parsed.data.platform);
    return { ok: true };
  });

  /** Rate the event (1–5 + optional feedback). One rating per event; a
   *  re-submit updates it. No payment — this is separate from tipping. */
  app.post('/api/events/:eventId/rating', async (request, reply) => {
    const { eventId } = request.params as { eventId: string };
    const schema = z.object({
      stars: z.number().int().min(1).max(5),
      feedback: z.string().max(2000).optional(),
    });
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'invalid_request' });

    const customerId = customerIdOf(request);
    const { rows } = await pool.query(
      `SELECT phase FROM events WHERE id = $1 AND customer_id = $2`,
      [eventId, customerId],
    );
    if (!rows[0]) return reply.status(404).send({ error: 'not_found' });
    if (isCancelled(rows[0].phase)) return reply.status(409).send(CANCELLED_ERROR);

    const inserted = await pool.query(
      `INSERT INTO event_ratings (event_id, customer_id, stars, feedback)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (event_id) DO UPDATE
         SET stars = EXCLUDED.stars, feedback = EXCLUDED.feedback, created_at = now()
       RETURNING stars, feedback`,
      [eventId, customerId, parsed.data.stars, parsed.data.feedback ?? null],
    );
    // Let the crew see the rating land — surfaced in the dashboard's alerts.
    await pool.query(
      `INSERT INTO notifications (event_id, channel, template, scheduled_for, payload)
       VALUES ($1,'push','rating_received', now(), $2)`,
      [eventId, JSON.stringify({ eventId, stars: parsed.data.stars })],
    );
    void pushToStaff('New rating ⭐', `${eventId} was rated ${parsed.data.stars}/5`, { eventId });
    return inserted.rows[0];
  });

  /** Tip the crew — a real Ziina payment on the same Event ID. Optionally
   *  aimed at one team member; otherwise it's for the whole crew. */
  app.post('/api/events/:eventId/tip/checkout', async (request, reply) => {
    const { eventId } = request.params as { eventId: string };
    const schema = z.object({
      amountFils: z.number().int().min(500).max(5_000_00),
      memberId: z.string().nullable().optional(),
      provider: z.enum(['tabby', 'tamara', 'stripe']).default('stripe'),
      lang: z.enum(['en', 'ar']).optional(),
    });
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'invalid_request' });

    try {
      return await startTipCheckout({
        eventId,
        customerId: customerIdOf(request),
        amountFils: parsed.data.amountFils,
        memberId: parsed.data.memberId ?? null,
        provider: parsed.data.provider,
        lang: parsed.data.lang,
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

  /** Sign a direct-to-Cloudinary upload for this customer's own event photo. */
  app.post('/api/events/:eventId/uploads/sign', async (request, reply) => {
    if (!uploadsEnabled()) return reply.status(409).send({ error: 'uploads_disabled' });
    const { eventId } = request.params as { eventId: string };
    const { rows } = await pool.query(
      `SELECT phase FROM events WHERE id = $1 AND customer_id = $2`,
      [eventId, customerIdOf(request)],
    );
    if (!rows[0]) return reply.status(404).send({ error: 'not_found' });
    if (isCancelled(rows[0].phase)) return reply.status(409).send(CANCELLED_ERROR);
    return signUpload('eventana/setup-photos');
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
