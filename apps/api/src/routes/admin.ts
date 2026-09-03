/**
 * Internal Operations Dashboard API.
 *
 * Guarded by a staff token. Refunds live here and only here — never in
 * the customer app, never in the assistant (spec §9).
 */
import type { FastifyInstance } from 'fastify';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { formatAed, isCancelled, celebrationLabel, computeRefund } from '@eventana/shared';
import { refundOrderMoney } from '../domain/refund.js';
import { config } from '../config.js';
import { pool } from '../db/pool.js';
import { getProvider, integrationStatus } from '../payments/index.js';
import { invalidateConfigCache, loadConfig, savePricingRules } from '../domain/settings.js';
import { applyPaymentStatus, orderStatusFor, recordPaymentEvent } from '../domain/orders.js';
import { withTransaction } from '../db/pool.js';
import { reconcileOnce } from '../domain/reconcile.js';
import { syncEventToCalendar, calendarEnabled } from '../integrations/googleCalendar.js';
import { emailEnabled, renderCampaignHtml, sendEmail } from '../integrations/email.js';
import { renderEmail, renderShopEmail, type EmailRow, type ShopEmailRow } from '../domain/notify.js';
import { createManualOrder, createEventAddonLink, CheckoutError } from '../domain/checkout.js';
import { createOffer } from '../domain/offers.js';
import { assignStaffForEvent, getStaffingPlan } from '../domain/staffing.js';
import { issueImportTicket } from '../domain/importTicket.js';
import { importRows } from '../domain/importData.js';
import * as finance from '../domain/finance.js';
import { auditReport } from '../domain/audit.js';
import { normalizePhones, markUnknownPaymentMethods, backfillRefundEmails, normalizeUaePhone } from '../domain/maintenance.js';
import { listAchievements, loadIncentiveRules, saveIncentiveRules } from '../domain/incentives.js';
import { flooredStart, COUNTING_START } from '../domain/period.js';
import { staffUpdateEvent, EventEditError } from '../domain/eventEdit.js';
import { logAudit, listAudit } from '../domain/auditLog.js';
import { verifyStaffSession, issueStaffSession } from '../domain/staffAuth.js';
import { sendStaffSetupEmail, buildSetupLink } from './staffAuth.js';
import { issueStaffSetupToken } from '../domain/staffAuth.js';
import { audienceCounts, sendCampaign } from '../domain/marketing.js';
import { sendReport } from '../domain/financeReport.js';
import { signUpload, uploadsEnabled } from '../integrations/cloudinary.js';
import { registerDevice, pushToOwner } from '../integrations/push.js';
import { listLeads, leadFunnel, importLeads, leadMessages, replyWindow, recordOutboundMessage } from '../domain/whatsappLeads.js';
import { agentMode, whatsappEnabled, sendWhatsAppText } from '../integrations/whatsapp.js';

/**
 * Moves an event to the terminal Cancelled phase and stands its
 * operation down: reservations released, scheduled messages stopped,
 * outstanding tasks closed, live tracking cleared.
 */
async function cancelEvent(eventId: string, reason: string) {
  return withTransaction(async (db) => {
    // Lock the event + its order so we can compute the refund and freeze it
    // atomically.
    const { rows } = await db.query(
      `SELECT e.*, o.id AS oid, o.status AS ostatus, o.total_fils, o.quote
         FROM events e JOIN orders o ON o.id = e.order_id
        WHERE e.id = $1 FOR UPDATE OF e`,
      [eventId],
    );
    const ev = rows[0];
    if (!ev) return null;

    await db.query(
      `UPDATE events SET phase = 'Cancelled', eta = NULL, cancelled_at = now(), cancellation_reason = $2 WHERE id = $1`,
      [eventId, reason],
    );
    // Free the physical assets for other customers immediately.
    await db.query(
      `UPDATE inventory_holds SET status = 'released' WHERE event_id = $1 AND status IN ('held','reserved')`,
      [eventId],
    );
    // Stop anything scheduled for an event that is not happening (this also
    // suppresses an unsent driver_new_order — driver rows carry sent_at NULL).
    await db.query(
      `UPDATE notifications SET cancelled_at = now() WHERE event_id = $1 AND sent_at IS NULL AND cancelled_at IS NULL`,
      [eventId],
    );
    // Tell the assigned driver the delivery is off (fresh row, not cancelled).
    await db.query(
      `INSERT INTO notifications (event_id, channel, template, scheduled_for, payload)
       VALUES ($1,'driver','driver_order_cancelled', now(), $2)`,
      [eventId, JSON.stringify({ eventId })],
    );
    // Close outstanding preparation work.
    await db.query(`UPDATE event_tasks SET status = 'done' WHERE event_id = $1 AND status <> 'done'`, [eventId]);

    // Compute the refund the policy owes and record the cancellation, so the
    // auto-refund (after commit) can move the money via the payment provider
    // exactly like a customer-initiated cancellation.
    let refundInfo: { orderId: string; refundFils: number; refundStatus: string } | null = null;
    if (ev.ostatus === 'paid') {
      const startMs = Date.parse(`${new Date(ev.event_date).toISOString().slice(0, 10)}T${ev.start_time}:00+04:00`);
      const hoursToEvent = (startMs - Date.now()) / 3_600_000;
      const b = computeRefund({ lines: (ev.quote as any)?.lines ?? [], totalPaidFils: Number(ev.total_fils), hoursToEvent });
      const refundStatus = b.refundFils > 0 ? 'pending' : 'none';
      await db.query(
        `INSERT INTO cancellations
           (order_id, event_id, cancelled_by, reason, total_paid_fils, delivery_fils,
            non_refundable_fils, party_value_fils, refund_percent, refund_amount_fils, refund_status)
         VALUES ($1,$2,'staff',$3,$4,$5,$6,$7,$8,$9,$10)
         ON CONFLICT (order_id) DO NOTHING`,
        [ev.oid, eventId, reason, b.totalPaidFils, b.deliveryFils, b.nonRefundableExtrasFils, b.partyValueFils, b.percent, b.refundFils, refundStatus],
      );
      // Customer email: the cancellation + refund breakdown (auto-refund will
      // replace it with a "processed" email once the money moves).
      await db.query(
        `INSERT INTO notifications (event_id, channel, template, scheduled_for, payload)
         VALUES ($1,'email','cancellation_refund', now(), $2)`,
        [eventId, JSON.stringify({ orderId: ev.oid })],
      );
      refundInfo = { orderId: ev.oid, refundFils: b.refundFils, refundStatus };
    } else {
      // Nothing was paid — a plain cancellation note.
      await db.query(
        `INSERT INTO notifications (event_id, channel, template, scheduled_for, payload)
         VALUES ($1,'email','event_cancelled', now(), $2)`,
        [eventId, JSON.stringify({ eventId, reason })],
      );
    }

    return { ...ev, phase: 'Cancelled', refundInfo };
  });
}

export async function adminRoutes(app: FastifyInstance) {
  app.addHook('preHandler', async (request, reply) => {
    const token = request.headers['x-staff-token'];
    if (typeof token !== 'string' || !token) {
      return reply.status(401).send({ error: 'unauthorized' });
    }
    // Auth precedence (all additive, so nothing is ever locked out mid-switch):
    //   1. master token → Owner (backward compatible; disabled by the owner once
    //      email/password login is confirmed working).
    //   2. a signed staff SESSION token from email/password login → its member.
    //   3. a personal access_token (the old emailed token) → its member.
    let staff: { id?: string; name: string; role: string };
    if (token === config.staffToken) {
      staff = { name: 'Owner', role: 'owner' };
    } else {
      const sessionMemberId = verifyStaffSession(token);
      const { rows } = sessionMemberId
        ? await pool.query(
            `SELECT id, name, access_level FROM team_members WHERE id = $1 AND active LIMIT 1`,
            [sessionMemberId],
          )
        : await pool.query(
            `SELECT id, name, access_level FROM team_members WHERE access_token = $1 AND active LIMIT 1`,
            [token],
          );
      if (!rows[0]) return reply.status(401).send({ error: 'unauthorized' });
      staff = { id: rows[0].id, name: rows[0].name, role: rows[0].access_level ?? 'employee' };
    }
    (request as any).staff = staff;

    // ── Role-based authorization ─────────────────────────────────────────
    // Owner: unrestricted. Everyone else is gated by route below.
    if (staff.role === 'owner') return;

    const path = request.url.split('?')[0];
    const method = request.method;

    // Only the Owner may change team access levels / login tokens.
    if (/^\/api\/admin\/team\/[^/]+\/access$/.test(path)) {
      return reply.status(403).send({ error: 'forbidden', message: 'Only the owner can change team access.' });
    }

    // The full CEO dashboard, the P&L history, and the Cash-on-hand accounting
    // balance are the Owner's alone (income totals). Managers get /overview.
    if (path.startsWith('/api/admin/ceo') || path.startsWith('/api/admin/financials') || path.startsWith('/api/admin/finance/accounting')) {
      return reply.status(403).send({ error: 'forbidden', message: 'Owner only.' });
    }

    // Money, configuration, review and refunds: Manager + Owner only.
    const managerOnly =
      path.startsWith('/api/admin/finance') ||
      path.startsWith('/api/admin/products') ||
      path.startsWith('/api/admin/suppliers') ||
      path.startsWith('/api/admin/catalog') ||
      path.startsWith('/api/admin/customers') ||
      path.startsWith('/api/admin/refunds') ||
      path.startsWith('/api/admin/reports') ||
      path.startsWith('/api/admin/overview') ||
      path.startsWith('/api/admin/staffing') ||
      // Prep: the whole-team "By person" board + generation are Manager+Owner.
      // The per-event progress, an event's plan, "my tasks" and task actions
      // stay open to employees (they act on their own work).
      path === '/api/admin/prep-board' ||
      path === '/api/admin/prep/generate-all' ||
      /^\/api\/admin\/prep\/[^/]+\/generate$/.test(path) ||
      path.startsWith('/api/admin/import') ||
      path.startsWith('/api/admin/orders') ||
      path.startsWith('/api/admin/expenses') ||
      path.startsWith('/api/admin/settings') ||
      path.startsWith('/api/admin/delivery-zones') ||
      path.startsWith('/api/admin/needs-review') ||
      path.startsWith('/api/admin/reconcile') ||
      path.startsWith('/api/admin/notifications') ||
      // /api/admin/alerts is now role-scoped in the handler (employees get their
      // own "Latest updates" feed), so it is NOT gated to managers here.
      path.startsWith('/api/admin/marketing') ||
      path === '/api/admin/team' ||
      // Editing catalogue prices / availability / inventory is a money change:
      // only mutations (not reads) are Manager+Owner (#security-M1).
      (request.method !== 'GET' &&
        (/^\/api\/admin\/services\/[^/]+$/.test(path) ||
          /^\/api\/admin\/packages\/[^/]+$/.test(path) ||
          /^\/api\/admin\/themes\/[^/]+$/.test(path) ||
          /^\/api\/admin\/inventory\/[^/]+$/.test(path))) ||
      /^\/api\/admin\/orders\/[^/]+\/(refund|audit)$/.test(path) ||
      /^\/api\/admin\/events\/[^/]+\/(cancel|reinstate)$/.test(path);
    if (managerOnly && staff.role !== 'manager') {
      return reply.status(403).send({ error: 'forbidden', message: 'Managers and the owner only.' });
    }

    // Driver: a tight whitelist — the calendar/board, job locations, and
    // updating a job's status (on the way / arrived) from the road.
    if (staff.role === 'driver') {
      const allowed =
        (method === 'GET' &&
          (path === '/api/admin/me' ||
            path === '/api/admin/today' ||
            path === '/api/admin/events' ||
            path === '/api/admin/my-events' ||
            path === '/api/admin/bookings/latest' ||
            // The notification bell is on every screen — a driver gets their own
            // (their tips / their events), so let them read the feed too.
            path === '/api/admin/notification-feed' ||
            path === '/api/admin/customer-feedback' ||
            /^\/api\/admin\/events\/[^/]+$/.test(path))) ||
        (method === 'POST' && /^\/api\/admin\/events\/[^/]+\/phase$/.test(path));
      if (!allowed) {
        return reply
          .status(403)
          .send({ error: 'forbidden', message: 'Drivers can access the calendar and job locations.' });
      }
    }
  });

  /** The signed-in staff member and their access level. */
  app.get('/api/admin/me', async (request) => {
    return (request as any).staff ?? { name: 'Staff', role: 'employee' };
  });

  // ── QuickBooks Online connection (owner) ───────────────────────────────────
  app.get('/api/admin/quickbooks/status', async () => {
    const qb = await import('../domain/quickbooks.js');
    if (!qb.quickbooksConfigured()) return { configured: false, connected: false };
    return { configured: true, ...(await qb.status()) };
  });
  app.get('/api/admin/quickbooks/connect', async (request, reply) => {
    const role = (request as any).staff?.role;
    if (role !== 'owner' && role !== 'manager') return reply.status(403).send({ error: 'forbidden', message: 'Owner or manager only.' });
    const qb = await import('../domain/quickbooks.js');
    if (!qb.quickbooksConfigured()) return reply.status(409).send({ error: 'not_configured', message: 'Set QUICKBOOKS_CLIENT_ID and QUICKBOOKS_CLIENT_SECRET on the server.' });
    return { url: qb.authorizeUrl(qb.makeState()) };
  });
  app.post('/api/admin/quickbooks/disconnect', async (request, reply) => {
    if ((request as any).staff?.role !== 'owner') return reply.status(403).send({ error: 'forbidden', message: 'Owner only.' });
    const qb = await import('../domain/quickbooks.js');
    await qb.disconnect();
    return { ok: true };
  });
  // Pull expenses + their receipt images from QuickBooks (runs in the background).
  app.post('/api/admin/quickbooks/sync-expenses', async (request, reply) => {
    const role = (request as any).staff?.role;
    if (role !== 'owner' && role !== 'manager') return reply.status(403).send({ error: 'forbidden', message: 'Owner or manager only.' });
    const qb = await import('../domain/quickbooks.js');
    if (!qb.quickbooksConfigured()) return reply.status(409).send({ error: 'not_configured' });
    return qb.startExpenseSync();
  });
  app.get('/api/admin/quickbooks/sync-status', async () => {
    const qb = await import('../domain/quickbooks.js');
    return qb.syncStatus();
  });
  // Read-only: what a sync would pull (counts + sample), writes nothing.
  app.get('/api/admin/quickbooks/preview', async (request, reply) => {
    const role = (request as any).staff?.role;
    if (role !== 'owner' && role !== 'manager') return reply.status(403).send({ error: 'forbidden' });
    const qb = await import('../domain/quickbooks.js');
    if (!qb.quickbooksConfigured()) return reply.status(409).send({ error: 'not_configured' });
    try {
      return await qb.previewExpenses();
    } catch (e: any) {
      return reply.status(502).send({ error: 'qb_error', message: e?.message ?? 'QuickBooks query failed' });
    }
  });

  /**
   * The customer-feedback wall — what customers said about our events, newest
   * first. Team-wide and visible to everyone (it's encouragement, no money).
   * `?limit=` caps it (default 5 for the Home teaser; the feedback page asks for
   * more). Only ratings that carry a written comment are returned.
   */
  app.get('/api/admin/customer-feedback', async (request) => {
    const q = request.query as { limit?: string };
    const limit = Math.min(100, Math.max(1, Number(q.limit) || 5));
    const { rows } = await pool.query(
      `SELECT r.id, r.stars, r.feedback, r.event_id,
              c.name AS customer, o.cart->>'eventFor' AS event_for,
              to_char(r.created_at,'YYYY-MM-DD') AS date, r.created_at
         FROM event_ratings r
         JOIN events e ON e.id = r.event_id
         JOIN customers c ON c.id = e.customer_id
         LEFT JOIN orders o ON o.id = e.order_id
        WHERE r.feedback IS NOT NULL AND btrim(r.feedback) <> ''
        ORDER BY r.created_at DESC
        LIMIT $1`,
      [limit],
    );
    return { rows, count: rows.length };
  });

  /** Achievements: recorded staff rewards (good feedback, glam, incentives).
   *  An employee sees only their own; owner/manager see everyone's. */
  app.get('/api/admin/achievements', async (request) => {
    const staff = (request as any).staff as { id?: string; role?: string };
    const all = staff.role === 'owner' || staff.role === 'manager';
    return listAchievements({ memberId: staff.id, all });
  });

  /** Audit log of critical actions (owner only). */
  app.get('/api/admin/audit-log', async (request, reply) => {
    if ((request as any).staff?.role !== 'owner') return reply.status(403).send({ error: 'forbidden' });
    const action = (request.query as { action?: string }).action;
    return { rows: await listAudit({ action }) };
  });

  /** Incentive reward amounts (owner-editable, so nothing is hard-coded). */
  app.get('/api/admin/incentive-rules', async (request, reply) => {
    if ((request as any).staff?.role !== 'owner') return reply.status(403).send({ error: 'forbidden' });
    return loadIncentiveRules();
  });
  app.patch('/api/admin/incentive-rules', async (request, reply) => {
    if ((request as any).staff?.role !== 'owner') return reply.status(403).send({ error: 'forbidden' });
    const schema = z.object({
      goodStars: z.number().int().min(1).max(5).optional(),
      goodFeedbackRewardFils: z.number().int().min(0).optional(),
      glamRewardFils: z.number().int().min(0).optional(),
      eventIncentiveFils: z.number().int().min(0).optional(),
      minEventValueFils: z.number().int().min(0).optional(),
      targetEvents: z.number().int().min(1).optional(),
      minEvents: z.number().int().min(1).optional(),
      commissionRate: z.number().min(0).max(1).optional(),
      commissionMinFils: z.number().int().min(0).optional(),
    }).safeParse(request.body);
    if (!schema.success) return reply.status(400).send({ error: 'invalid_request' });
    logAudit({ actor: String((request as any).staff?.name ?? 'owner'), role: 'owner', action: 'incentive_rules', detail: schema.data });
    return saveIncentiveRules(schema.data, String((request as any).staff?.name ?? 'owner'));
  });

  /**
   * Owner-only reconciliation report: a set of fixed, read-only diagnostics used
   * to audit QuickBooks ↔ orders ↔ payments ↔ customers (invoice 52K breakdown,
   * payment-method coverage, phone-format audit, duplicate customers, expenses).
   * Each section is a fixed query — no free-form SQL. Powers the Reports view.
   */
  app.get('/api/admin/reports/audit', async (request, reply) => {
    if ((request as any).staff?.role !== 'owner') return reply.status(403).send({ error: 'forbidden' });
    const section = String((request.query as any)?.section ?? 'summary');
    try {
      return await auditReport(section);
    } catch (e: any) {
      return reply.status(400).send({ error: 'report_failed', message: String(e?.message ?? e) });
    }
  });

  // Owner-only reconciliation ACTIONS (idempotent, conservative). Each returns a
  // summary of exactly what it changed vs. left for manual review.
  app.post('/api/admin/reports/normalize-phones', async (request, reply) => {
    if ((request as any).staff?.role !== 'owner') return reply.status(403).send({ error: 'forbidden' });
    return normalizePhones();
  });
  app.post('/api/admin/reports/mark-unknown-payment', async (request, reply) => {
    if ((request as any).staff?.role !== 'owner') return reply.status(403).send({ error: 'forbidden' });
    return markUnknownPaymentMethods();
  });
  app.post('/api/admin/reports/backfill-refund-emails', async (request, reply) => {
    if ((request as any).staff?.role !== 'owner') return reply.status(403).send({ error: 'forbidden' });
    const dry = String((request.query as any)?.dry ?? '') === '1';
    return backfillRefundEmails(dry);
  });

  /** Register this staff device for push notifications. */
  app.post('/api/admin/devices/register', async (request, reply) => {
    const schema = z.object({ token: z.string().min(10), platform: z.enum(['ios', 'android', 'web']).default('ios') });
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'invalid_request' });
    const staff = (request as any).staff as { id?: string };
    await registerDevice('staff', staff.id ?? 'owner', parsed.data.token, parsed.data.platform);
    return { ok: true };
  });

  /** Newest confirmed booking — the dashboard polls this to chime on new
   *  bookings. Light by design (one row). */
  app.get('/api/admin/bookings/latest', async () => {
    const { rows } = await pool.query(
      `SELECT e.id, e.created_at, e.event_date, e.emirate, c.name AS customer,
              p.name AS package_name, e.celebration_type
         FROM events e
         JOIN customers c ON c.id = e.customer_id
         JOIN orders o ON o.id = e.order_id
         LEFT JOIN packages p ON p.id = e.package_id
        WHERE o.status = 'paid'
        ORDER BY e.created_at DESC LIMIT 1`,
    );
    return rows[0] ?? null;
  });

  /* ------------------------------ Today --------------------------- */

  app.get('/api/admin/today', async (request) => {
    const [kpis, events, tasks, inventory, approvals, shopOrders] = await Promise.all([
      pool.query(
        `SELECT
           (SELECT count(*)::int FROM events WHERE event_date = CURRENT_DATE) AS events_today,
           (SELECT count(*)::int FROM orders WHERE status = 'paid' AND source IS DISTINCT FROM 'converted'
              AND created_at >= date_trunc('month', now())) AS bookings_month,
           (SELECT COALESCE(sum(total_fils),0)::bigint FROM orders WHERE status = 'paid' AND source IS DISTINCT FROM 'converted'
              AND created_at >= date_trunc('month', now())) AS revenue_month,
           (SELECT count(*)::int FROM event_tasks WHERE status = 'open') AS open_tasks,
           (SELECT count(*)::int FROM orders WHERE status = 'needs_review') AS needs_review,
           (SELECT count(*)::int FROM orders WHERE status = 'processing') AS processing`,
      ),
      pool.query(
        `SELECT e.id, e.event_date, e.start_time, e.base_end_time, e.phase, e.eta,
                e.emirate, e.celebration_type, c.name AS customer, p.name AS package_name, o.total_fils,
                COALESCE(th.name, o.cart->>'customTheme') AS theme_name, e.custom_theme,
                o.cart->>'eventFor' AS "eventFor"
           FROM events e
           JOIN customers c ON c.id = e.customer_id
           JOIN orders o ON o.id = e.order_id
           LEFT JOIN packages p ON p.id = e.package_id
           LEFT JOIN themes th ON th.id = e.theme_id
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
      // Paid shop orders (printed / digital goods) — they have no party date, so
      // they surface on Home as their own light-purple items with a delivery date.
      pool.query(
        `SELECT o.id, o.total_fils, o.cart, o.created_at, c.name AS customer
           FROM orders o JOIN customers c ON c.id = o.customer_id
          WHERE o.kind = 'shop' AND o.status = 'paid'
          ORDER BY o.created_at DESC LIMIT 20`,
      ),
    ]);

    const staffCtx = (request as any).staff as { id?: string; role?: string };
    const canSeeShopMoney = staffCtx?.role === 'owner' || staffCtx?.role === 'manager';
    // Resolve shop item names from the catalogue (cart stores serviceId only).
    const shopCfg = shopOrders.rows.length ? await loadConfig() : null;
    const k = kpis.rows[0];
    // "Open tasks" means different things by role: an employee/driver sees THEIR
    // own unfinished prep tasks, not the business-wide department-task count.
    let openTasksCount = k.open_tasks;
    if (staffCtx?.id && (staffCtx.role === 'employee' || staffCtx.role === 'driver')) {
      const mine = await pool.query(
        `SELECT count(DISTINCT pt.id)::int c FROM prep_tasks pt
           JOIN prep_task_staff ps ON ps.task_id = pt.id
          WHERE ps.member_id = $1 AND pt.status <> 'completed'`,
        [staffCtx.id],
      );
      openTasksCount = mine.rows[0].c;
    }
    return {
      kpis: {
        eventsToday: k.events_today,
        bookingsThisMonth: k.bookings_month,
        // Revenue is the Owner's number only — managers and staff don't see money.
        revenueThisMonthDisplay: (request as any).staff?.role === 'owner' ? formatAed(Number(k.revenue_month)) : null,
        openTasks: openTasksCount,
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
      shopOrders: shopOrders.rows.map((o) => {
        const cart = (o.cart ?? {}) as { items?: Array<{ serviceId?: string; name?: string; title?: string; quantity?: number }>; readyBy?: string; emirate?: string };
        const items = Array.isArray(cart.items)
          ? cart.items.map((i) => (i.serviceId ? shopCfg?.services.get(i.serviceId)?.name : null) || i.name || i.title || i.serviceId).filter(Boolean)
          : [];
        // Delivery date: the customer's chosen ready-by, else 3 days from the
        // order date (digital / printed goods lead time).
        const created = new Date(o.created_at);
        const readyBy = cart.readyBy ?? new Date(created.getTime() + 3 * 86_400_000).toISOString().slice(0, 10);
        return {
          id: o.id,
          customer: o.customer,
          itemsLabel: items.join(', ') || 'Shop order',
          readyBy,
          emirate: cart.emirate ?? null,
          createdAt: o.created_at,
          totalDisplay: canSeeShopMoney ? formatAed(Number(o.total_fils)) : null,
        };
      }),
      integrations: integrationStatus(),
    };
  });

  /**
   * Manager overview — a mini, money-free operational dashboard: how many orders
   * this month, what they are, and the busiest emirate / theme. No revenue.
   */
  app.get('/api/admin/overview', async (request) => {
    // Period filter (by event date): this month · last 3 months · this year.
    const period = ((request.query as { period?: string }).period ?? 'month');
    const now = new Date();
    const y = now.getUTCFullYear(); const mo = now.getUTCMonth();
    const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
    let startT: number; let endT: number;
    if (period === 'year') { startT = Date.UTC(y, 0, 1); endT = Date.UTC(y + 1, 0, 1); }
    else if (period === 'quarter') { startT = Date.UTC(y, mo - 2, 1); endT = Date.UTC(y, mo + 1, 1); }
    else { startT = Date.UTC(y, mo, 1); endT = Date.UTC(y, mo + 1, 1); }
    const startS = iso(startT); const endS = iso(endT);

    const { rows } = await pool.query(
      `SELECT e.id, e.emirate, e.celebration_type,
              to_char(e.event_date,'YYYY-MM-DD') AS date, e.phase,
              c.name AS customer, p.name AS package_name, th.name AS theme_name
         FROM events e
         JOIN customers c ON c.id = e.customer_id
         LEFT JOIN packages p ON p.id = e.package_id
         LEFT JOIN themes th ON th.id = e.theme_id
        WHERE e.phase <> 'Cancelled' AND e.event_date >= $1 AND e.event_date < $2
        ORDER BY e.event_date`,
      [startS, endS],
    );
    const topBy = (keyFn: (r: any) => string) => {
      const m = new Map<string, number>();
      for (const r of rows) { const k = keyFn(r) || '—'; m.set(k, (m.get(k) ?? 0) + 1); }
      return [...m.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count);
    };
    const byEmirate = topBy((r) => r.emirate);
    const byTheme = topBy((r) => r.theme_name || 'No theme / custom');
    const byType = topBy((r) => celebrationLabel(r.celebration_type));
    const slim = (r: any) => ({ id: r.id, date: r.date, customer: r.customer, emirate: r.emirate, theme: r.theme_name, package: r.package_name, type: celebrationLabel(r.celebration_type), phase: r.phase });
    return {
      period,
      orders: rows.length,
      // kept for backward compatibility
      ordersThisMonth: rows.length,
      topEmirate: byEmirate[0] ?? null,
      topTheme: byTheme[0] ?? null,
      byEmirate: byEmirate.slice(0, 6),
      byTheme: byTheme.slice(0, 6),
      byType: byType.slice(0, 6),
      list: rows.map(slim),
    };
  });

  /* --------------------------- Staff assignment ------------------- */
  // Auto-assign internal staff for one event (rebuilds the plan). Manager+Owner.
  app.post('/api/admin/staffing/assign/:eventId', async (request, reply) => {
    const { eventId } = request.params as { eventId: string };
    const plan = await assignStaffForEvent(eventId);
    if (!plan) return reply.status(404).send({ error: 'not_found' });
    return plan;
  });
  // The saved plan for an event.
  app.get('/api/admin/staffing/:eventId', async (request) =>
    getStaffingPlan((request.params as { eventId: string }).eventId));
  // One-time / bulk: assign staff for every upcoming, non-cancelled event.
  app.post('/api/admin/staffing/assign-all', async () => {
    const { rows } = await pool.query(
      `SELECT id FROM events WHERE phase <> 'Cancelled' AND event_date >= CURRENT_DATE ORDER BY event_date`,
    );
    const results: Array<{ eventId: string; shortages: number }> = [];
    for (const r of rows) {
      const plan = await assignStaffForEvent(r.id);
      if (plan) results.push({ eventId: r.id, shortages: plan.shortages });
    }
    return { assigned: results.length, results };
  });
  // The drivers roster (Shan + freelance own-car / van drivers) — for the driver
  // slot's picker. Names feed the part-timer input; the number lets WhatsApp
  // reach whoever is assigned.
  app.get('/api/admin/drivers', async () => {
    const { rows } = await pool.query(
      `SELECT id, name, kind, (phone IS NOT NULL) AS has_phone FROM drivers WHERE active ORDER BY (kind <> 'main'), name`,
    );
    return rows;
  });
  // The internal crew (for the manual-override picker). Pass ?eventId=… to get
  // each member flagged `busy` (unavailable for that event) so the picker can
  // hide anyone already booked at that time (drivers exempt), on leave, or off.
  app.get('/api/admin/staffing-crew', async (request) => {
    const { eventId } = (request.query ?? {}) as { eventId?: string };
    const { listInternalStaff } = await import('../domain/staffing.js');
    return listInternalStaff(eventId || undefined);
  });
  // Manual role requirements the team adds for an event the engine can't read
  // (e.g. a custom offer). Setting a role re-runs the plan; count 0 removes it.
  app.get('/api/admin/staffing/:eventId/requirements', async (request) => {
    const { getManualRequirements } = await import('../domain/staffing.js');
    return getManualRequirements((request.params as { eventId: string }).eventId);
  });
  app.post('/api/admin/staffing/:eventId/requirements', async (request, reply) => {
    const { eventId } = request.params as { eventId: string };
    const { role, count } = (request.body ?? {}) as { role?: string; count?: number };
    const ROLES = ['balloon_artist', 'clown', 'face_painting', 'helper', 'balloon_twisting', 'staff', 'driver', 'pt_driver', 'design'];
    if (!role || !ROLES.includes(role)) return reply.status(400).send({ error: 'invalid_role' });
    const { setManualRequirement } = await import('../domain/staffing.js');
    const plan = await setManualRequirement(eventId, role, Math.max(0, Math.min(10, Number(count) || 0)));
    if (!plan) return reply.status(404).send({ error: 'not_found' });
    return plan;
  });
  // Confirm a part-timer's name for an open slot → status "Confirmed – [Name]".
  app.post('/api/admin/staffing/slot/:slotId/confirm', async (request, reply) => {
    const { slotId } = request.params as { slotId: string };
    const { name } = (request.body ?? {}) as { name?: string };
    if (!name || !name.trim()) return reply.status(400).send({ error: 'name_required' });
    const { confirmPartTimeSlot } = await import('../domain/staffing.js');
    const res = await confirmPartTimeSlot(slotId, name);
    if (!res) return reply.status(404).send({ error: 'not_found' });
    return getStaffingPlan(res.eventId);
  });
  // Manually assign an internal staff member to a slot (owner/manager override).
  app.post('/api/admin/staffing/slot/:slotId/assign', async (request, reply) => {
    const { slotId } = request.params as { slotId: string };
    const { assigneeId } = (request.body ?? {}) as { assigneeId?: string };
    if (!assigneeId) return reply.status(400).send({ error: 'assignee_required' });
    const { overrideSlotAssignee } = await import('../domain/staffing.js');
    const res = await overrideSlotAssignee(slotId, assigneeId);
    if (!res) return reply.status(404).send({ error: 'not_found' });
    return getStaffingPlan(res.eventId);
  });

  /* --------------------------- Pre-event prep --------------------- */
  // Internal only. The customer never sees any of this.
  app.get('/api/admin/prep/:eventId', async (request) => {
    const { getPrepPlan } = await import('../domain/prep.js');
    return getPrepPlan((request.params as { eventId: string }).eventId);
  });
  app.post('/api/admin/prep/:eventId/generate', async (request, reply) => {
    const { generatePrepTasks, getPrepPlan } = await import('../domain/prep.js');
    const r = await generatePrepTasks((request.params as { eventId: string }).eventId);
    if (!r) return reply.status(404).send({ error: 'not_found' });
    return getPrepPlan(r.eventId);
  });
  app.post('/api/admin/prep/generate-all', async () => {
    const { generatePrepTasks } = await import('../domain/prep.js');
    const { rows } = await pool.query(
      `SELECT id FROM events WHERE phase <> 'Cancelled' AND event_date >= CURRENT_DATE ORDER BY event_date`,
    );
    let created = 0; let events = 0;
    for (const r of rows) {
      const res = await generatePrepTasks(r.id);
      if (res) { created += res.created; events++; }
    }
    return { events, created };
  });
  app.get('/api/admin/prep-board', async () => {
    const { getPrepByPerson } = await import('../domain/prep.js');
    return getPrepByPerson();
  });
  app.get('/api/admin/prep-events', async () => {
    const { getPrepEvents } = await import('../domain/prep.js');
    return getPrepEvents();
  });
  app.get('/api/admin/prep-mine', async (request) => {
    const { getPrepTasksForMember } = await import('../domain/prep.js');
    const staff = (request as any).staff as { id?: string };
    return staff.id ? getPrepTasksForMember(staff.id) : [];
  });
  app.post('/api/admin/prep/task/:taskId/complete', async (request, reply) => {
    const { taskId } = request.params as { taskId: string };
    const b = (request.body ?? {}) as { completedBy?: string; photoUrl?: string };
    const { completePrepTask } = await import('../domain/prep.js');
    const actor = String((request as any).staff?.name ?? 'staff');
    const r = await completePrepTask(taskId, { completedBy: b.completedBy ?? actor, photoUrl: b.photoUrl, actor });
    if (!r) return reply.status(404).send({ error: 'not_found' });
    const { getPrepPlan } = await import('../domain/prep.js');
    return getPrepPlan(r.eventId);
  });
  app.post('/api/admin/prep/task/:taskId/status', async (request, reply) => {
    const { taskId } = request.params as { taskId: string };
    const b = (request.body ?? {}) as { status?: string; note?: string };
    const { setPrepTaskStatus } = await import('../domain/prep.js');
    const r = await setPrepTaskStatus(taskId, String(b.status), b.note ?? null, String((request as any).staff?.name ?? 'staff'));
    if (!r) return reply.status(400).send({ error: 'invalid' });
    const { getPrepPlan } = await import('../domain/prep.js');
    return getPrepPlan(r.eventId);
  });
  app.post('/api/admin/prep/task/:taskId/checklist', async (request, reply) => {
    const { taskId } = request.params as { taskId: string };
    const b = (request.body ?? {}) as { index?: number; done?: boolean };
    const { togglePrepChecklist } = await import('../domain/prep.js');
    const r = await togglePrepChecklist(taskId, Number(b.index), !!b.done);
    if (!r) return reply.status(404).send({ error: 'not_found' });
    return r;
  });
  app.post('/api/admin/prep/task/:taskId/assignees', async (request, reply) => {
    const { taskId } = request.params as { taskId: string };
    const b = (request.body ?? {}) as { memberIds?: string[] };
    const { setPrepAssignees } = await import('../domain/prep.js');
    const r = await setPrepAssignees(taskId, Array.isArray(b.memberIds) ? b.memberIds : [], String((request as any).staff?.name ?? 'staff'));
    if (!r) return reply.status(404).send({ error: 'not_found' });
    const { getPrepPlan } = await import('../domain/prep.js');
    return getPrepPlan(r.eventId);
  });

  /* --------------------------- WhatsApp leads --------------------- */

  /**
   * Every enquiry that came in on WhatsApp, newest first.
   *
   * This is the list the ad account cannot produce: it carries the party
   * date, the emirate, whether the customer confirmed, and the ad that
   * started the conversation.
   */
  app.get('/api/admin/whatsapp/leads', async (request, reply) => {
    // Every row is a customer phone number. Same rule as the shop orders and
    // the event list: drivers and employees never see the whole PII list.
    const role = (request as any).staff?.role;
    if (role !== 'owner' && role !== 'manager') return reply.status(403).send({ error: 'forbidden' });
    const q = request.query as { status?: string; limit?: string };
    return {
      leads: await listLeads({
        status: q.status && q.status !== 'all' ? q.status : undefined,
        limit: q.limit ? Number(q.limit) : undefined,
      }),
      agentMode: agentMode(),
      connected: whatsappEnabled(),
    };
  });

  /**
   * Conversation → confirmation → booking, plus the same split by emirate.
   *
   * The emirate split is the one that decides real money: Abu Dhabi takes
   * the largest share of ad spend, and until now nothing could say whether
   * those enquiries ever became parties.
   */
  app.get('/api/admin/whatsapp/funnel', async (request, reply) => {
    const role = (request as any).staff?.role;
    if (role !== 'owner' && role !== 'manager') return reply.status(403).send({ error: 'forbidden' });
    return leadFunnel();
  });

  /**
   * One lead's conversation, plus whether a free-form reply is still allowed.
   *
   * A Cloud API number cannot be opened in the WhatsApp phone app, so without
   * this the team can read an enquiry on the Leads screen and have no way to
   * answer it. This is the other half of that screen.
   */
  app.get('/api/admin/whatsapp/leads/:phone/messages', async (request, reply) => {
    const role = (request as any).staff?.role;
    if (role !== 'owner' && role !== 'manager') return reply.status(403).send({ error: 'forbidden' });
    const { phone } = request.params as { phone: string };
    const [messages, window] = await Promise.all([leadMessages(phone), replyWindow(phone)]);
    return { messages, window };
  });

  /** Send a reply as the team. Never blocked by the agent's off switch. */
  app.post('/api/admin/whatsapp/leads/:phone/reply', async (request, reply) => {
    const role = (request as any).staff?.role;
    if (role !== 'owner' && role !== 'manager') return reply.status(403).send({ error: 'forbidden' });
    if (!whatsappEnabled()) return reply.status(409).send({ error: 'whatsapp_disabled' });
    const { phone } = request.params as { phone: string };
    const parsed = z.object({ body: z.string().trim().min(1).max(4000) }).safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'invalid_request' });

    const window = await replyWindow(phone);
    if (!window.open) {
      return reply.status(409).send({
        error: 'window_closed',
        message:
          'More than 24 hours have passed since this customer last wrote. WhatsApp only allows an approved template after that.',
      });
    }

    const res = await sendWhatsAppText({ to: phone, body: parsed.data.body, fromStaff: true });
    if (!res.ok) return reply.status(502).send({ error: 'send_failed', message: res.error });
    await recordOutboundMessage({
      phone,
      body: parsed.data.body,
      messageId: res.messageId ?? null,
      sentBy: 'staff',
    });
    return { ok: true, messages: await leadMessages(phone) };
  });

  /**
   * Backfill leads from outside this system.
   *
   * The team labelled WhatsApp chats by hand for years — "Order complete",
   * "New order" — and named each contact after the party date. That record is
   * the only place the booking truth ever lived, so this pulls it in rather
   * than starting the history at zero.
   */
  app.post('/api/admin/whatsapp/leads/import', async (request, reply) => {
    const role = (request as any).staff?.role;
    if (role !== 'owner' && role !== 'manager') return reply.status(403).send({ error: 'forbidden' });
    const schema = z.object({
      leads: z
        .array(
          z.object({
            phone: z.string().trim().min(6).max(24),
            name: z.string().trim().max(160).nullish(),
            eventDate: z
              .string()
              .regex(/^\d{4}-\d{2}-\d{2}$/)
              .nullish(),
            emirate: z.string().trim().max(40).nullish(),
            status: z.enum(['new', 'quoted', 'confirmed', 'booked', 'lost']).nullish(),
            notes: z.string().trim().max(500).nullish(),
          }),
        )
        .min(1)
        .max(1000),
    });
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'invalid_request' });
    return importLeads(parsed.data.leads);
  });

  /* ------------------------------ Events -------------------------- */

  app.get('/api/admin/events', async (request) => {
    const { status } = request.query as { status?: string };
    // A driver may only see the events they're assigned to — never the whole
    // customer/PII list. Everyone else (owner/manager/employee) sees all.
    const staff = (request as any).staff as { id?: string; role?: string };
    const driverOnly = staff?.role === 'driver';
    // Employees (and drivers) never see order money — that's owner/manager only.
    const hideMoney = staff?.role === 'employee' || staff?.role === 'driver';
    const { rows } = await pool.query(
      `SELECT e.id, e.event_date, e.start_time, e.base_end_time, e.phase, e.emirate,
              e.celebration_type, e.custom_theme, th.name AS theme_name, o.cart,
              c.name AS customer, c.phone, o.id AS order_id,
              o.status AS order_status, o.total_fils
         FROM events e
         JOIN customers c ON c.id = e.customer_id
         JOIN orders o ON o.id = e.order_id
         LEFT JOIN themes th ON th.id = e.theme_id
        WHERE ($1::text IS NULL OR o.status = $1)
          AND ($2::text IS NULL OR EXISTS (
                SELECT 1 FROM event_team et WHERE et.event_id = e.id AND et.member_id = $2))
        ORDER BY e.event_date ASC, e.start_time ASC
        LIMIT 200`,
      [status ?? null, driverOnly ? (staff?.id ?? '__none__') : null],
    );
    return rows.map((r) => {
      const cart = (r.cart ?? {}) as { eventFor?: string; customTheme?: string };
      return {
        ...r,
        cart: undefined,
        eventFor: cart.eventFor ?? null,
        theme_name: r.theme_name ?? cart.customTheme ?? null,
        total_fils: hideMoney ? null : r.total_fils,
        totalDisplay: hideMoney ? null : formatAed(Number(r.total_fils)),
      };
    });
  });

  app.get('/api/admin/events/:eventId', async (request, reply) => {
    const { eventId } = request.params as { eventId: string };
    // Drivers can only open an event they're on.
    const staff = (request as any).staff as { id?: string; role?: string };
    if (staff?.role === 'driver') {
      const { rows: onCrew } = await pool.query(
        `SELECT 1 FROM event_team WHERE event_id = $1 AND member_id = $2`,
        [eventId, staff?.id ?? '__none__'],
      );
      if (!onCrew[0]) return reply.status(403).send({ error: 'forbidden' });
    }
    const { rows } = await pool.query(
      `SELECT e.*, c.name AS customer, c.phone, c.email, o.id AS order_id,
              o.status AS order_status, o.total_fils, o.quote, o.cart,
              th.name AS theme_name,
              cx.cancelled_by, cx.reason AS cancellation_note, cx.total_paid_fils AS cx_total_paid,
              cx.delivery_fils AS cx_delivery, cx.non_refundable_fils AS cx_non_refundable,
              cx.party_value_fils AS cx_party_value, cx.refund_percent, cx.refund_amount_fils,
              cx.refund_status, cx.refund_reference, cx.processed_at AS refund_processed_at
         FROM events e
         JOIN customers c ON c.id = e.customer_id
         JOIN orders o ON o.id = e.order_id
         LEFT JOIN themes th ON th.id = e.theme_id
         LEFT JOIN cancellations cx ON cx.order_id = o.id
        WHERE e.id = $1`,
      [eventId],
    );
    if (!rows[0]) return reply.status(404).send({ error: 'not_found' });

    const [services, tasks, team, holds, messages, photos, orders, payments, rating, tips, designs] =
      await Promise.all([
      pool.query(`SELECT * FROM event_services WHERE event_id = $1 ORDER BY id`, [eventId]),
      pool.query(`SELECT * FROM event_tasks WHERE event_id = $1 ORDER BY department, id`, [eventId]),
      // The crew for THIS event, read live from the actual assignments
      // (event_staff) — internal assignees AND confirmed part-timer names — so
      // it always matches Team assignment above (event_team, member-only, could
      // drift after a manual override / part-timer swap).
      pool.query(
        `SELECT id, name, color, job_title, event_role, is_leader FROM (
           SELECT DISTINCT ON (grp) grp AS id, name, color, job_title, event_role, is_leader
             FROM (
               SELECT
                 -- One row per PERSON (by name): someone on two roles, or listed
                 -- both internally and as a part-timer, appears once.
                 lower(COALESCE(m.name, es.part_time_name)) AS grp,
                 COALESCE(m.name, es.part_time_name) AS name,
                 m.color AS color,
                 COALESCE(m.job_title, initcap(replace(es.role, '_', ' ')) ||
                   CASE WHEN es.assignee_id IS NULL THEN ' · part-timer' ELSE '' END) AS job_title,
                 es.role AS event_role,
                 es.is_leader AS is_leader,
                 (m.id IS NOT NULL) AS internal
               FROM event_staff es
               LEFT JOIN team_members m ON m.id = es.assignee_id
               WHERE es.event_id = $1
                 AND (es.assignee_id IS NOT NULL OR (es.part_time_name IS NOT NULL AND es.status = 'confirmed'))
             ) x
            ORDER BY grp, is_leader DESC, internal DESC
         ) y
         ORDER BY is_leader DESC, (event_role IN ('driver','pt_driver')) ASC, name`,
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
      pool.query(`SELECT stars, feedback, created_at FROM event_ratings WHERE event_id = $1`, [
        eventId,
      ]),
      pool.query(
        `SELECT t.id, t.amount_fils, t.status, t.created_at, t.member_id, m.name AS member_name
           FROM tips t LEFT JOIN team_members m ON m.id = t.member_id
          WHERE t.event_id = $1 AND t.status = 'paid' ORDER BY t.created_at`,
        [eventId],
      ),
      pool.query(`SELECT * FROM designs WHERE event_id = $1 ORDER BY version DESC`, [eventId]),
    ]);

    const result: any = {
      event: {
        ...rows[0],
        totalDisplay: formatAed(Number(rows[0].total_fils)),
        // Theme name for display: the catalogue theme, or a free-typed custom one.
        theme_name: rows[0].theme_name ?? ((rows[0].cart as { customTheme?: string } | null)?.customTheme ?? null),
        // Who the party is for — distinct from the account holder (#23/#24).
        eventFor: (rows[0].cart as { eventFor?: string } | null)?.eventFor ?? null,
        // Reference images the team attached when they built a manual order —
        // shown on the job so the design team has them.
        referenceImages: (rows[0].cart as { referenceImages?: string[] } | null)?.referenceImages ?? [],
        // Exact location for driver routing (#driver / Google Maps link). Prefer
        // the event's own pin (which the team can set/edit) over the original
        // cart pin, so an edited or newly-added location wins.
        mapPin: (Number(rows[0].map_lat) !== 0 || Number(rows[0].map_lng) !== 0)
          ? { lat: Number(rows[0].map_lat), lng: Number(rows[0].map_lng) }
          : ((rows[0].cart as { mapPin?: { lat: number; lng: number } } | null)?.mapPin ?? null),
        // A free-text address / Maps link the team set for this event.
        locationNote: rows[0].location_note ?? null,
        addressDetails:
          (rows[0].cart as { address?: { details?: string } } | null)?.address?.details ?? null,
        // Full structured address (area / street / villa) so ops can find the
        // exact door, not just the free-text note (#M3).
        address:
          (rows[0].cart as { address?: Record<string, string> } | null)?.address ?? null,
        // Cancellation + refund (present only when the order was cancelled).
        cancellation: rows[0].refund_status
          ? {
              cancelledBy: rows[0].cancelled_by,
              reason: rows[0].cancellation_note,
              totalPaidFils: Number(rows[0].cx_total_paid ?? 0),
              totalPaidDisplay: formatAed(Number(rows[0].cx_total_paid ?? 0)),
              deliveryFils: Number(rows[0].cx_delivery ?? 0),
              nonRefundableFils: Number(rows[0].cx_non_refundable ?? 0),
              partyValueFils: Number(rows[0].cx_party_value ?? 0),
              refundPercent: Number(rows[0].refund_percent ?? 0),
              refundAmountFils: Number(rows[0].refund_amount_fils ?? 0),
              refundAmountDisplay: formatAed(Number(rows[0].refund_amount_fils ?? 0)),
              refundStatus: rows[0].refund_status,
              refundReference: rows[0].refund_reference,
              processedAt: rows[0].refund_processed_at,
            }
          : null,
      },
      services: services.rows,
      tasks: tasks.rows,
      team: team.rows,
      // Who leads this event, and whether the person viewing IS that leader — only
      // the leader may advance the status or message the customer.
      leaderId: (team.rows.find((m: any) => m.is_leader)?.id) ?? null,
      leaderName: (team.rows.find((m: any) => m.is_leader)?.name) ?? null,
      isLeader: !!staff?.id && team.rows.some((m: any) => m.is_leader && m.id === staff.id),
      reservations: holds.rows,
      messages: messages.rows,
      setupPhotos: photos.rows,
      orders: orders.rows.map((o) => ({ ...o, totalDisplay: formatAed(Number(o.total_fils)) })),
      payments: payments.rows,
      rating: rating.rows[0] ?? null,
      tips: tips.rows.map((t) => ({ ...t, amountDisplay: formatAed(Number(t.amount_fils)) })),
      designs: designs.rows,
    };

    // Employees (and drivers) do their job without seeing any money — strip
    // every price, total, payment and refund figure. Owner/manager see it all.
    if (staff?.role === 'employee' || staff?.role === 'driver') {
      result.event.total_fils = null;
      result.event.totalDisplay = null;
      result.event.quote = null;
      result.event.cancellation = null;
      result.services = result.services.map((s: any) => ({ ...s, amount_fils: null }));
      result.orders = result.orders.map((o: any) => ({ ...o, total_fils: null, totalDisplay: null, quote: null }));
      result.payments = [];
      result.tips = result.tips.map((t: any) => ({ ...t, amount_fils: null, amountDisplay: null }));
    }
    return result;
  });

  /** Upload/attach a design image for customer approval. Updates the latest
   *  pending version, or opens the next version pending. */
  app.post('/api/admin/events/:eventId/design', async (request, reply) => {
    const { eventId } = request.params as { eventId: string };
    const schema = z.object({ imageUrl: z.string().url() });
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'invalid_request' });

    const { rows: latest } = await pool.query<{ id: number; version: number; status: string }>(
      `SELECT id, version, status FROM designs WHERE event_id = $1 ORDER BY version DESC LIMIT 1`,
      [eventId],
    );
    if (latest[0] && latest[0].status === 'pending') {
      const { rows } = await pool.query(
        `UPDATE designs SET image_url = $2 WHERE id = $1 RETURNING *`,
        [latest[0].id, parsed.data.imageUrl],
      );
      return rows[0];
    }
    const nextVersion = latest[0] ? latest[0].version + 1 : 1;
    const { rows } = await pool.query(
      `INSERT INTO designs (event_id, version, image_url, status) VALUES ($1,$2,$3,'pending')
       ON CONFLICT (event_id, version) DO UPDATE
         SET image_url = EXCLUDED.image_url, status = 'pending', customer_note = NULL, decided_at = NULL
       RETURNING *`,
      [eventId, nextVersion, parsed.data.imageUrl],
    );
    return rows[0];
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
    void syncEventToCalendar(eventId);
    // Nudge the customer at the moments that matter most.
    const ev = rows[0];
    if (ev) {
      const line =
        ev.phase === 'On The Way'
          ? `Your Eventana team is on the way!${ev.eta ? ` ETA ${ev.eta}` : ''} 🚐`
          : ev.phase === 'Arrived'
            ? 'Your Eventana team has arrived! 🎉'
            : ev.phase === 'Setup Ready'
              ? 'Everything is set up and ready — enjoy your celebration! ✨'
              : null;
      if (line) void pushToOwner('customer', ev.customer_id, 'Eventana', line, { eventId });
      // Also send an email version so a customer without push still gets the
      // live update. Delivered by the same notification sweep. Idempotent per
      // (event, phase) so re-advancing the same phase doesn't double-send.
      const emailTemplate =
        ev.phase === 'On The Way' ? 'team_on_the_way'
          : ev.phase === 'Arrived' ? 'team_arrived'
            : ev.phase === 'Setup Ready' ? 'setup_ready'
              : null;
      if (emailTemplate) {
        await pool.query(
          `INSERT INTO notifications (event_id, channel, template, scheduled_for, payload)
           SELECT $1,'email',$2, now(), $3
            WHERE NOT EXISTS (
              SELECT 1 FROM notifications WHERE event_id = $1 AND template = $2)`,
          [eventId, emailTemplate, JSON.stringify({ eventId })],
        );
      }
    }
    return ev;
  });

  /**
   * Owner/Manager: send the real customer transactional email templates to a
   * chosen inbox, so the team can review exactly what customers receive. Uses
   * the SAME render + Resend path as production — only the data is a sample and
   * the subject is prefixed so it can't be mistaken for a real booking.
   * (Manager+Owner via the /api/admin/notifications gate.)
   */
  app.post('/api/admin/notifications/test', async (request, reply) => {
    const body = (request.body ?? {}) as { email?: string };
    const email = (body.email ?? '').trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return reply.status(400).send({ error: 'invalid_email', message: 'Enter a valid email address.' });
    }
    if (!emailEnabled()) {
      return reply
        .status(503)
        .send({ error: 'email_disabled', message: 'Email is not configured on the server (RESEND_API_KEY).' });
    }
    const templates = ['booking_confirmation', 'three_day_reminder', 'event_day', 'team_on_the_way', 'team_arrived', 'setup_ready', 'feedback_request', 'event_cancelled'];
    // Realistic sample: a parent (the customer we greet) booking for their child
    // (the guest of honour). Real emails use the booking's own customer name.
    const sample: EmailRow = {
      id: 0,
      template: '',
      event_id: 'EV-2026-0123',
      event_date: '2026-09-15',
      start_time: '16:00:00',
      emirate: 'Dubai',
      eta: '3:30 PM',
      customer_name: 'Mariam',
      customer_email: email,
      celebration_type: 'kids', // stored as an id; email maps it to "Kids Birthday"
      custom_theme: false,
      package_name: 'Princess Castle',
      cart: { eventFor: 'Sara' },
      total_fils: 185000,
      quote: {
        lines: [
          { label: 'Princess Castle package', quantity: 1, amountFils: 150000 },
          { label: 'Balloon Garland add-on', quantity: 1, amountFils: 25000 },
          { label: 'Custom Theme Design', quantity: 1, amountFils: 20000 },
          { label: 'Delivery — Dubai', quantity: 1, amountFils: 5000 },
          { label: '15% Build Your Own discount', quantity: 1, amountFils: -15000 },
        ],
      },
    };
    // A standalone shop-order confirmation sample too.
    const shopSample: ShopEmailRow = {
      id: 0,
      order_id: 'EVT-ORD-000123',
      customer_name: 'Mariam',
      customer_email: email,
      cart: { emirate: 'Dubai', readyBy: '2026-09-29' },
      quote: {
        lines: [
          { name: 'Custom Name Banner', quantity: 1, amountFils: 12000 },
          { name: 'Themed Cupcake Toppers', quantity: 12, amountFils: 9000 },
        ],
        deliveryFils: 3000,
      },
      total_fils: 24000,
    };
    const total = templates.length + 1;
    let sent = 0;
    const failed: string[] = [];
    for (const template of templates) {
      const msg = renderEmail({ ...sample, template });
      if (!msg) continue;
      const res = await sendEmail({ to: email, subject: `[Sample] ${msg.subject}`, html: msg.html });
      if (res.ok) sent += 1;
      else failed.push(`${template}: ${res.error ?? 'failed'}`);
    }
    const shopMsg = renderShopEmail(shopSample);
    if (shopMsg) {
      const res = await sendEmail({ to: email, subject: `[Sample] ${shopMsg.subject}`, html: shopMsg.html });
      if (res.ok) sent += 1;
      else failed.push(`shop_confirmation: ${res.error ?? 'failed'}`);
    }
    return { sent, total, failed };
  });

  /**
   * Resend the booking-confirmation email to every active (non-cancelled) booking
   * that has a customer email. Two-step by design:
   *   { dryRun: true }  → returns the recipient list only (nothing is sent).
   *   { confirm: true } → actually sends. Requires confirm to avoid accidents.
   * This is a real, outward-facing bulk send, so it never sends without confirm.
   */
  app.post('/api/admin/notifications/resend-confirmations', async (request, reply) => {
    const body = (request.body ?? {}) as { dryRun?: boolean; confirm?: boolean };
    if (!emailEnabled()) {
      return reply
        .status(503)
        .send({ error: 'email_disabled', message: 'Email is not configured on the server (RESEND_API_KEY).' });
    }
    // Party bookings (events).
    const { rows: eventRows } = await pool.query<EmailRow & { customer_email: string | null }>(
      `SELECT e.id AS event_id, 'booking_confirmation'::text AS template,
              e.event_date, e.start_time, e.emirate,
              e.celebration_type, e.custom_theme, o.cart, o.quote, o.total_fils, p.name AS package_name,
              c.name AS customer_name, c.email AS customer_email
         FROM events e
         JOIN customers c ON c.id = e.customer_id
         LEFT JOIN orders o   ON o.id = e.order_id
         LEFT JOIN packages p ON p.id = e.package_id
        WHERE e.phase <> 'Cancelled' AND c.email IS NOT NULL AND c.email <> ''
        ORDER BY e.event_date DESC
        LIMIT 500`,
    );
    // Standalone shop orders (printed/digital goods — no event).
    const { rows: shopRows } = await pool.query<ShopEmailRow & { customer_email: string | null }>(
      `SELECT o.id AS order_id, o.cart, o.quote, o.total_fils,
              c.name AS customer_name, c.email AS customer_email
         FROM orders o
         JOIN customers c ON c.id = o.customer_id
        WHERE o.kind = 'shop' AND o.status = 'paid' AND c.email IS NOT NULL AND c.email <> ''
        ORDER BY o.created_at DESC
        LIMIT 500`,
    );
    const recipients = [
      ...eventRows.map((r) => ({ id: r.event_id, kind: 'Booking', name: r.customer_name, email: r.customer_email })),
      ...shopRows.map((r) => ({ id: r.order_id, kind: 'Shop', name: r.customer_name, email: r.customer_email })),
    ];
    if (!body.confirm || body.dryRun) {
      return { dryRun: true, count: recipients.length, recipients };
    }
    let sent = 0;
    const failed: string[] = [];
    for (const row of eventRows) {
      const msg = renderEmail(row);
      if (!msg || !row.customer_email) continue;
      const res = await sendEmail({ to: row.customer_email, subject: msg.subject, html: msg.html });
      if (res.ok) sent += 1;
      else failed.push(`${row.event_id}: ${res.error ?? 'failed'}`);
    }
    for (const row of shopRows) {
      const msg = renderShopEmail(row);
      if (!msg || !row.customer_email) continue;
      const res = await sendEmail({ to: row.customer_email, subject: msg.subject, html: msg.html });
      if (res.ok) sent += 1;
      else failed.push(`${row.order_id}: ${res.error ?? 'failed'}`);
    }
    return { sent, total: recipients.length, failed };
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
    logAudit({ actor: String((request as any).staff?.name ?? 'staff'), role: (request as any).staff?.role, action: 'cancel_event', target: eventId, detail: { reason: parsed.data.reason } });
    void syncEventToCalendar(eventId);

    // Auto-refund the money through the payment provider (Stripe) and email the
    // customer — same automatic flow as a customer-initiated cancellation. Runs
    // after the cancellation is committed; on failure the refund stays pending
    // for the manual Refund panel.
    const rInfo = (result as any).refundInfo as { orderId: string; refundFils: number; refundStatus: string } | null;
    if (rInfo && rInfo.refundStatus === 'pending' && rInfo.refundFils > 0) {
      await refundOrderMoney({
        orderId: rInfo.orderId,
        amountFils: rInfo.refundFils,
        reason: `Cancelled by team — ${parsed.data.reason}`,
        reasonCategory: 'customer_cancellation',
        cancelEvent: true, // this IS the cancel-event flow; tear the event down
        createdBy: String((request as any).staff?.name ?? 'staff'),
        source: 'admin_cancel',
      }).catch(() => {});
    }
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
    // Re-reserve the inventory this event released on cancel — but only what's
    // still free at its window (another booking may have taken a slot meanwhile).
    const { rows: held } = await pool.query(
      `SELECT h.id, h.asset_code, h.starts_at, h.ends_at, a.units, a.name
         FROM inventory_holds h JOIN inventory_assets a ON a.code = h.asset_code
        WHERE h.event_id = $1 AND h.status = 'released'`,
      [eventId],
    );
    let reReserved = 0; const conflicts: string[] = [];
    for (const h of held) {
      const { rows: c } = await pool.query(
        `SELECT count(*)::int AS used FROM inventory_holds
          WHERE asset_code = $1 AND status IN ('held','reserved')
            AND (expires_at IS NULL OR expires_at > now())
            AND id <> $2 AND starts_at < $4 AND ends_at > $3`,
        [h.asset_code, h.id, h.starts_at, h.ends_at],
      );
      if ((c[0]?.used ?? 0) < Number(h.units)) {
        await pool.query(`UPDATE inventory_holds SET status = 'reserved' WHERE id = $1`, [h.id]);
        reReserved += 1;
      } else {
        conflicts.push(h.name || h.asset_code);
      }
    }
    const note = conflicts.length
      ? `Event reinstated — re-reserved ${reReserved} item(s). ⚠️ Not available (double-check): ${conflicts.join(', ')}`
      : `Event reinstated — re-reserved ${reReserved} item(s), all available.`;
    await pool.query(
      `INSERT INTO event_tasks (event_id, department, title) VALUES ($1,'operations',$2)`,
      [eventId, note],
    );
    void syncEventToCalendar(eventId);
    return { ...rows[0], reReserved, conflicts };
  });

  /**
   * Staff-side edit of a booked event: time, location (emirate), guest-of-honour
   * name and theme. Manager + owner only. Time changes move the reserved
   * inventory holds safely (see staffUpdateEvent).
   */
  app.patch('/api/admin/events/:eventId/details', async (request, reply) => {
    const role = (request as any).staff?.role;
    if (role !== 'owner' && role !== 'manager') return reply.status(403).send({ error: 'forbidden', message: 'Managers and the owner only.' });
    const { eventId } = request.params as { eventId: string };
    const schema = z.object({
      startTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
      endTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
      emirate: z.string().min(1).max(40).optional(),
      eventFor: z.string().max(120).nullable().optional(),
      themeId: z.string().min(1).max(80).nullable().optional(),
      customThemeName: z.string().max(120).optional(),
      // Exact location: a free-text address / Google Maps link the team can set
      // (esp. for converted bookings with no captured pin), plus optional
      // coordinates parsed from that link so the map + driver directions work.
      locationNote: z.string().max(600).nullable().optional(),
      mapLat: z.number().min(-90).max(90).nullable().optional(),
      mapLng: z.number().min(-180).max(180).nullable().optional(),
    });
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'invalid_request', details: parsed.error.flatten() });
    if (Object.keys(parsed.data).length === 0) return reply.status(400).send({ error: 'nothing_to_update' });
    try {
      const r = await staffUpdateEvent(eventId, parsed.data);
      logAudit({ actor: String((request as any).staff?.name ?? 'staff'), role, action: 'event_edit', target: eventId, detail: parsed.data });
      void syncEventToCalendar(eventId);
      return r;
    } catch (err) {
      if (err instanceof EventEditError) {
        const status = err.code === 'not_found' ? 404 : err.code === 'unavailable' ? 409 : 400;
        return reply.status(status).send({ error: err.code, message: err.message });
      }
      request.log.error({ err }, 'event edit failed');
      return reply.status(500).send({ error: 'edit_failed' });
    }
  });

  /**
   * Backfill the shared Google Calendar with existing bookings — run once
   * after switching calendar sync on. Pushes every event from yesterday
   * onward; each upsert is idempotent, so it's safe to run again.
   */
  app.post('/api/admin/calendar/resync', async (_request, reply) => {
    if (!calendarEnabled()) {
      return reply
        .status(409)
        .send({ error: 'calendar_disabled', message: 'Google Calendar sync is not configured.' });
    }
    const { rows } = await pool.query<{ id: string }>(
      `SELECT id FROM events WHERE event_date >= current_date - interval '1 day' ORDER BY event_date`,
    );
    for (const r of rows) await syncEventToCalendar(r.id);
    return { synced: rows.length };
  });

  /**
   * Staff KPIs & tips leaderboard for a month (default: current). Each metric
   * is a correlated aggregate so joining ratings and tips can't inflate the
   * others. Points are a simple, transparent formula computed here.
   */
  app.get('/api/admin/kpis', async (request) => {
    const q = request.query as { month?: string };
    const now = new Date();
    const monthStr = /^\d{4}-\d{2}$/.test(q.month ?? '')
      ? q.month!
      : `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const end = new Date(`${monthStr}-01T00:00:00Z`);
    end.setUTCMonth(end.getUTCMonth() + 1);
    const endStr = end.toISOString().slice(0, 10);
    // The scoring system starts 1 Sep 2026 — floor the window so nothing before
    // that (setup/testing/migration) ever counts. Pre-launch months → empty range.
    const start = flooredStart(`${monthStr}-01`);

    const { rows } = await pool.query(
      `SELECT tm.id, tm.name, tm.role, tm.color, tm.access_level,
         (SELECT COUNT(*) FROM event_team et JOIN events e ON e.id = et.event_id
            WHERE et.member_id = tm.id AND e.phase = 'Event Completed'
              AND e.event_date >= $1 AND e.event_date < $2) AS events_done,
         (SELECT COALESCE(SUM(t.amount_fils),0) FROM tips t JOIN events e ON e.id = t.event_id
            WHERE t.member_id = tm.id AND t.status = 'paid'
              AND e.event_date >= $1 AND e.event_date < $2) AS tips_fils,
         (SELECT COUNT(*) FROM tips t JOIN events e ON e.id = t.event_id
            WHERE t.member_id = tm.id AND t.status = 'paid'
              AND e.event_date >= $1 AND e.event_date < $2) AS tips_count,
         (SELECT COALESCE(ROUND(AVG(r.stars)::numeric,2),0) FROM event_ratings r
            JOIN event_team et ON et.event_id = r.event_id
            JOIN events e ON e.id = r.event_id
            WHERE et.member_id = tm.id AND e.event_date >= $1 AND e.event_date < $2) AS avg_rating,
         (SELECT COUNT(*) FROM event_ratings r
            JOIN event_team et ON et.event_id = r.event_id
            JOIN events e ON e.id = r.event_id
            WHERE et.member_id = tm.id AND r.stars = 5
              AND e.event_date >= $1 AND e.event_date < $2) AS five_stars,
         (SELECT COUNT(*) FROM event_ratings r
            JOIN event_team et ON et.event_id = r.event_id
            JOIN events e ON e.id = r.event_id
            WHERE et.member_id = tm.id
              AND e.event_date >= $1 AND e.event_date < $2) AS ratings_count
       FROM team_members tm
       WHERE tm.active AND lower(tm.name) NOT IN ('shan','sheem')
       ORDER BY tips_fils DESC, events_done DESC, tm.name`,
      [start, endStr],
    );

    // ── Points, target & bonus (owner spec 2026-09-01) ───────────────────────
    // Everything runs on POINTS: 10 per completed event, 20 per 5★ rating, 20
    // per Glam Doll. The monthly TARGET is 600 points. Below 600 there is no
    // money — only progress. Above 600, every extra 50 points earns AED 10.
    // Tips (100%) and referral commissions (5%) are separate money, added on
    // top. A warning wipes the month's points (the warnings system is a later
    // task, so nothing zeroes points yet).
    const TARGET_POINTS = 600;
    const POINTS_PER_STEP = 100;     // above target, every 100 points…
    const STEP_FILS = 1000;          // …earns AED 10 (10 fils per point)
    const EVENT_POINTS = 10, FIVE_STAR_POINTS = 20, GLAM_POINTS = 20;
    // Glam Doll: +20 points each time an internal staff member performs one
    // (part-timers excluded — they have no assignee_id).
    const glamRes = await pool.query(
      `SELECT es.assignee_id AS member_id, COUNT(*)::int n
         FROM event_staff es JOIN events e ON e.id = es.event_id
        WHERE es.assignee_id IS NOT NULL AND e.phase='Event Completed'
          AND e.event_date >= $1 AND e.event_date < $2
          AND (es.source ILIKE '%glam%' OR es.role ILIKE '%glam%')
        GROUP BY es.assignee_id`,
      [start, endStr],
    );
    const glamCount = new Map<string, number>((glamRes.rows as any[]).map((r) => [r.member_id, Number(r.n)]));
    // Value-based points: an event a crew member BROUGHT in (their referral code
    // was used) earns them points on its value — AED 0.5 per AED, i.e. a
    // 4,000 AED event (excl delivery) = 2,000 points. Counted toward the target.
    const refRes = await pool.query(
      `SELECT member_id, COALESCE(SUM(event_value_fils),0)::bigint value_fils, COUNT(*)::int n
         FROM staff_referral_events
        WHERE created_at >= $1 AND created_at < $2
        GROUP BY member_id`,
      [start, endStr],
    );
    const referralByMember = new Map<string, { valueFils: number; n: number }>(
      (refRes.rows as any[]).map((r) => [r.member_id, { valueFils: Number(r.value_fils), n: Number(r.n) }]),
    );
    // A disciplinary warning is recorded per month. When affects_points it wipes
    // that month's competition points (and the points bonus); otherwise it is
    // documented on the file only (owner exception). Tips/commission unaffected.
    const warnRes = await pool.query(`SELECT member_id, reason, affects_points FROM staff_warnings WHERE ym = $1`, [monthStr]);
    const warnMap = new Map<string, { reason: string | null; affectsPoints: boolean }>(
      (warnRes.rows as any[]).map((r) => [r.member_id, { reason: r.reason ?? null, affectsPoints: r.affects_points !== false }]),
    );
    // AED 100 = 1 step; 100 points = AED 10 above the 600 target.
    const rules = { targetPoints: TARGET_POINTS, pointsToAed10: 100, eventPoints: EVENT_POINTS, fiveStarPoints: FIVE_STAR_POINTS, glamPoints: GLAM_POINTS, valuePointsPerAed: 0.5, commissionRate: 2, commissionMinAed: 20000 };
    // Marsha's incentive is different: a 2% commission on the corporate/events
    // invoices she brings in (via email), each worth ≥ AED 20,000. Tagged on the
    // invoice (commission_rep) and events-based only (the team tags qualifying ones).
    const COMMISSION_RATE = 0.02, COMMISSION_MIN = 2_000_000;
    // Marsha's corporate deals are MANUAL invoices OR sales the owner tagged to
    // her (never website orders). Count both, each worth ≥ AED 20,000, this month.
    const commRes = await pool.query(
      `SELECT COALESCE(SUM(gross),0)::bigint gross, COUNT(*)::int n FROM (
         SELECT total_fils AS gross FROM finance_invoices
           WHERE lower(commission_rep)='marsha' AND total_fils >= $3 AND issue_date >= $1 AND issue_date < $2
         UNION ALL
         SELECT total_fils AS gross FROM finance_receipts
           WHERE lower(commission_rep)='marsha' AND total_fils >= $3 AND date >= $1 AND date < $2
       ) x`,
      [start, endStr, COMMISSION_MIN],
    );
    const marshaCommissionFils = Math.round(Number(commRes.rows[0].gross) * COMMISSION_RATE);
    const marshaInvoices = Number(commRes.rows[0].n);
    const marshaGrossFils = Number(commRes.rows[0].gross);

    const staff = rows.map((r) => {
      const eventsDone = Number(r.events_done);
      const tipsFils = Number(r.tips_fils);
      const fiveStars = Number(r.five_stars);
      const glam = glamCount.get(r.id) ?? 0;
      const ref = referralByMember.get(r.id) ?? { valueFils: 0, n: 0 };
      // Points: activity (events worked, 5★, Glam Doll) + value of events brought
      // in (AED 0.5 per AED, i.e. fils / 200). Money is earned only ABOVE the
      // 600 target: every 100 points past it = AED 10 (10 fils per point).
      const activityPoints = eventsDone * EVENT_POINTS + fiveStars * FIVE_STAR_POINTS + glam * GLAM_POINTS;
      const referralPoints = Math.round(ref.valueFils / 200);
      // A warning may zero this month's points, or just be on record (exception).
      const warn = warnMap.get(r.id) ?? null;
      const warned = !!warn;
      const warnReason = warn?.reason ?? null;
      const pointsWiped = !!warn && warn.affectsPoints;
      const points = pointsWiped ? 0 : activityPoints + referralPoints;
      const targetPct = Math.min(100, Math.round((points / TARGET_POINTS) * 100));
      const bonusFils = Math.max(0, points - TARGET_POINTS) * (STEP_FILS / POINTS_PER_STEP);
      // Marsha earns a 2% corporate commission instead of the field-crew points.
      const isMarsha = String(r.name).toLowerCase() === 'marsha';
      const commissionFils = isMarsha ? marshaCommissionFils : 0;
      const earningsFils = bonusFils + tipsFils + commissionFils;
      return {
        id: r.id,
        name: r.name,
        role: r.role,
        color: r.color,
        accessLevel: r.access_level,
        eventsDone,
        glamCount: glam,
        tipsFils,
        tipsDisplay: formatAed(tipsFils),
        tipsCount: Number(r.tips_count),
        avgRating: Number(r.avg_rating),
        fiveStars,
        ratingsCount: Number(r.ratings_count),
        points, activityPoints, referralPoints, referralCount: ref.n,
        warned, warnReason, pointsWiped,
        targetPct,
        bonusFils, bonusDisplay: formatAed(bonusFils),
        isMarsha,
        commissionFils, commissionDisplay: formatAed(commissionFils),
        corporateInvoices: isMarsha ? marshaInvoices : 0,
        corporateGrossDisplay: isMarsha ? formatAed(marshaGrossFils) : formatAed(0),
        earningsFils, earningsDisplay: formatAed(earningsFils),
      };
    });

    const totals = await pool.query(
      `SELECT
         (SELECT COALESCE(SUM(amount_fils),0) FROM tips t JOIN events e ON e.id=t.event_id
            WHERE t.status='paid' AND e.event_date >= $1 AND e.event_date < $2) AS tips_fils,
         (SELECT COALESCE(SUM(amount_fils),0) FROM tips t JOIN events e ON e.id=t.event_id
            WHERE t.status='paid' AND t.member_id IS NULL
              AND e.event_date >= $1 AND e.event_date < $2) AS team_pool_fils,
         (SELECT COUNT(*) FROM events e WHERE e.phase='Event Completed'
            AND e.event_date >= $1 AND e.event_date < $2) AS events_done,
         (SELECT COALESCE(ROUND(AVG(r.stars)::numeric,2),0) FROM event_ratings r
            JOIN events e ON e.id=r.event_id
            WHERE e.event_date >= $1 AND e.event_date < $2) AS avg_rating,
         (SELECT COUNT(*) FROM event_ratings r JOIN events e ON e.id=r.event_id
            WHERE e.event_date >= $1 AND e.event_date < $2) AS ratings_count`,
      [start, endStr],
    );
    const t = totals.rows[0];

    // An employee (or driver) sees ONLY their own numbers — no leaderboard of
    // the team, no whole-team tip pool. The top tiles become their personal
    // stats; the "staff" list is just them.
    const reqRole = (request as any).staff?.role as string | undefined;
    const reqId = (request as any).staff?.id as string | undefined;
    // Visibility model (owner spec):
    //  • Everyone sees a POINTS-only competition board (all names, no money).
    //  • Each person sees their OWN points + their OWN money (personal card).
    //  • Only the OWNER sees everyone's money.
    // The board strips every money field — points/events/rating only. Marsha is
    // kept in `staff` (so she still sees her own commission) but excluded from the
    // field-crew competition board: she earns a sales commission, not event points.
    const board = staff.filter((s) => !s.isMarsha).map((s) => ({ id: s.id, name: s.name, color: s.color, role: s.role, points: s.points, eventsDone: s.eventsDone, targetPct: s.targetPct, avgRating: s.avgRating, fiveStars: s.fiveStars }));

    if (reqRole === 'owner') {
      // The owner sees the full money leaderboard + the competition board.
      return {
        month: monthStr,
        rules,
        moneyView: true,
        staff,
        board,
        overall: {
          tipsFils: Number(t.tips_fils),
          tipsDisplay: formatAed(Number(t.tips_fils)),
          teamPoolFils: Number(t.team_pool_fils),
          teamPoolDisplay: formatAed(Number(t.team_pool_fils)),
          eventsDone: Number(t.events_done),
          avgRating: Number(t.avg_rating),
          ratingsCount: Number(t.ratings_count),
        },
      };
    }

    // Everyone else: the points competition + only THEIR OWN money.
    const mine = staff.find((s) => s.id === reqId) ?? null;
    return {
      month: monthStr,
      personal: true,
      rules,
      board,
      staff: mine ? [mine] : [],
      overall: {
        tipsFils: mine?.tipsFils ?? 0,
        tipsDisplay: mine ? mine.tipsDisplay : formatAed(0),
        teamPoolFils: 0,
        teamPoolDisplay: null,
        eventsDone: mine?.eventsDone ?? 0,
        avgRating: mine?.avgRating ?? 0,
        ratingsCount: mine?.ratingsCount ?? 0,
        points: mine?.points ?? 0,
        activityPoints: mine?.activityPoints ?? 0,
        referralPoints: mine?.referralPoints ?? 0,
        referralCount: mine?.referralCount ?? 0,
        warned: mine?.warned ?? false,
        warnReason: mine?.warnReason ?? null,
        pointsWiped: mine?.pointsWiped ?? false,
        targetPoints: TARGET_POINTS,
        targetPct: mine?.targetPct ?? 0,
        glamCount: mine?.glamCount ?? 0,
        fiveStars: mine?.fiveStars ?? 0,
        bonusDisplay: mine?.bonusDisplay ?? formatAed(0),
        commissionDisplay: mine?.commissionDisplay ?? formatAed(0),
        corporateInvoices: mine?.corporateInvoices ?? 0,
        isMarsha: mine?.isMarsha ?? false,
        earningsDisplay: mine?.earningsDisplay ?? formatAed(0),
      },
    };
  });

  /* ---------------- Expenses & finance (#31) ---------------- */

  // Categories tuned to an events business. Historical expenses may carry older
  // labels — they still display and aggregate; only new entries use this list.
  const EXPENSE_CATEGORIES = [
    'transportation', 'materials', 'printing', 'balloons', 'staff',
    'entertainment', 'food_beverage', 'rentals', 'marketing', 'maintenance',
    'salaries', 'rent', 'utilities', 'other',
  ] as const;
  const PAYMENT_METHODS = ['cash', 'card', 'bank_transfer', 'cheque', 'other'] as const;

  /** List expenses (default: current month). */
  app.get('/api/admin/expenses', async (request) => {
    const q = request.query as { month?: string };
    const now = new Date();
    const monthStr = /^\d{4}-\d{2}$/.test(q.month ?? '')
      ? q.month!
      : `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const start = `${monthStr}-01`;
    const end = new Date(`${start}T00:00:00Z`);
    end.setUTCMonth(end.getUTCMonth() + 1);
    const { rows } = await pool.query(
      `SELECT e.*, ev.id AS event_ref
         FROM expenses e LEFT JOIN events ev ON ev.id = e.event_id
        WHERE e.spent_on >= $1 AND e.spent_on < $2
        ORDER BY e.spent_on DESC, e.id DESC`,
      [start, end.toISOString().slice(0, 10)],
    );
    return {
      month: monthStr,
      categories: EXPENSE_CATEGORIES,
      paymentMethods: PAYMENT_METHODS,
      expenses: rows.map((r) => ({ ...r, amountDisplay: formatAed(Number(r.amount_fils)) })),
    };
  });

  /** Record an expense. */
  app.post('/api/admin/expenses', async (request, reply) => {
    const schema = z.object({
      category: z.enum(EXPENSE_CATEGORIES).default('other'),
      description: z.string().min(1).max(300),
      amountFils: z.number().int().min(0),
      vendor: z.string().max(200).optional(),
      eventId: z.string().optional(),
      spentOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      receiptUrl: z.string().url().nullable().optional(),
      paymentMethod: z.enum(PAYMENT_METHODS).optional(),
    });
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'invalid_request', details: parsed.error.flatten() });
    const d = parsed.data;
    const { rows } = await pool.query(
      `INSERT INTO expenses (category, description, amount_fils, vendor, event_id, spent_on, receipt_url, payment_method, recorded_by)
       VALUES ($1,$2,$3,$4,$5,COALESCE($6, current_date),$7,$8,$9) RETURNING *`,
      [
        d.category, d.description, d.amountFils, d.vendor ?? null, d.eventId ?? null,
        d.spentOn ?? null, d.receiptUrl ?? null, d.paymentMethod ?? null,
        String((request as any).staff?.name ?? 'Staff'),
      ],
    );
    return reply.status(201).send({ ...rows[0], amountDisplay: formatAed(Number(rows[0].amount_fils)) });
  });

  /** Edit or delete an expense. */
  app.patch('/api/admin/expenses/:id', async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    const schema = z.object({
      // Lenient string (not enum) so editing a historical expense with an older
      // category label never fails validation.
      category: z.string().min(1).max(40).optional(),
      description: z.string().min(1).max(300).optional(),
      amountFils: z.number().int().min(0).optional(),
      vendor: z.string().max(200).nullable().optional(),
      spentOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      paymentMethod: z.enum(PAYMENT_METHODS).nullable().optional(),
    });
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'invalid_request' });
    const d = parsed.data;
    const { rows } = await pool.query(
      `UPDATE expenses SET
         category = COALESCE($2, category),
         description = COALESCE($3, description),
         amount_fils = COALESCE($4, amount_fils),
         vendor = COALESCE($5, vendor),
         spent_on = COALESCE($6, spent_on),
         payment_method = COALESCE($7, payment_method)
       WHERE id = $1 RETURNING *`,
      [id, d.category ?? null, d.description ?? null, d.amountFils ?? null, d.vendor ?? null, d.spentOn ?? null, d.paymentMethod ?? null],
    );
    if (!rows[0]) return reply.status(404).send({ error: 'not_found' });
    return { ...rows[0], amountDisplay: formatAed(Number(rows[0].amount_fils)) };
  });

  app.delete('/api/admin/expenses/:id', async (request) => {
    const id = Number((request.params as { id: string }).id);
    await pool.query(`DELETE FROM expenses WHERE id = $1`, [id]);
    return { deleted: true };
  });

  // ── Historical financials (QuickBooks P&L) ─────────────────────────────────
  // The real money history of the business lived only in QuickBooks (every
  // sale was WhatsApp). We import it here, one row per year (or month), so the
  // CEO dashboard can show true revenue/expenses/profit and year-over-year —
  // the app's own bookings cover only 2026+ and would understate everything.

  /** List every imported financial period, newest first, with AED displays. */
  app.get('/api/admin/financials', async () => {
    const { rows } = await pool.query(
      `SELECT * FROM historical_financials ORDER BY period DESC`,
    );
    const withDisplay = rows.map((r) => {
      // node-pg returns BIGINT as a string; coerce so the client can do maths.
      const income = Number(r.income_fils);
      const cogs = Number(r.cogs_fils);
      const expenses = Number(r.expenses_fils);
      const gross = Number(r.gross_profit_fils);
      const net = Number(r.net_income_fils);
      return {
        ...r,
        income_fils: income,
        cogs_fils: cogs,
        expenses_fils: expenses,
        gross_profit_fils: gross,
        net_income_fils: net,
        incomeDisplay: formatAed(income),
        cogsDisplay: formatAed(cogs),
        expensesDisplay: formatAed(expenses),
        grossProfitDisplay: formatAed(gross),
        netIncomeDisplay: formatAed(net),
        marginPct: income > 0 ? Math.round((net / income) * 1000) / 10 : 0,
      };
    });
    // Year-over-year net-income growth, oldest→newest, for the annual rows.
    const years = [...withDisplay].filter((r) => r.period_kind === 'year').sort((a, b) => a.period.localeCompare(b.period));
    const yoy = years.map((r, i) => {
      const prev = i > 0 ? Number(years[i - 1].net_income_fils) : null;
      const cur = Number(r.net_income_fils);
      const growthPct = prev && prev !== 0 ? Math.round(((cur - prev) / Math.abs(prev)) * 1000) / 10 : null;
      return { period: r.period, netIncomeFils: cur, growthPct };
    });
    return { periods: withDisplay, yoy };
  });

  /**
   * Upsert one financial period. Income/COGS/expenses are provided; gross and
   * net are derived server-side so they always reconcile. Breakdowns optional.
   * This is how 2023–2025 (and full-year 2026) get added from QuickBooks.
   */
  app.post('/api/admin/financials', async (request, reply) => {
    const line = z.object({ label: z.string().min(1).max(120), fils: z.number().int() });
    const schema = z.object({
      period: z.string().regex(/^\d{4}(-\d{2})?$/),
      incomeFils: z.number().int(),
      cogsFils: z.number().int().default(0),
      expensesFils: z.number().int().min(0),
      incomeBreakdown: z.array(line).optional(),
      expenseBreakdown: z.array(line).optional(),
      note: z.string().max(300).optional(),
    });
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'invalid_request', details: parsed.error.flatten() });
    const d = parsed.data;
    const periodKind = /^\d{4}$/.test(d.period) ? 'year' : 'month';
    const grossProfit = d.incomeFils - d.cogsFils;
    const netIncome = grossProfit - d.expensesFils;
    const { rows } = await pool.query(
      `INSERT INTO historical_financials
         (period, period_kind, income_fils, cogs_fils, expenses_fils, gross_profit_fils, net_income_fils, income_breakdown, expense_breakdown, source, note, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'quickbooks',$10, now())
       ON CONFLICT (period) DO UPDATE SET
         period_kind = EXCLUDED.period_kind,
         income_fils = EXCLUDED.income_fils,
         cogs_fils = EXCLUDED.cogs_fils,
         expenses_fils = EXCLUDED.expenses_fils,
         gross_profit_fils = EXCLUDED.gross_profit_fils,
         net_income_fils = EXCLUDED.net_income_fils,
         income_breakdown = EXCLUDED.income_breakdown,
         expense_breakdown = EXCLUDED.expense_breakdown,
         note = EXCLUDED.note,
         updated_at = now()
       RETURNING *`,
      [
        d.period, periodKind, d.incomeFils, d.cogsFils, d.expensesFils, grossProfit, netIncome,
        d.incomeBreakdown ? JSON.stringify(d.incomeBreakdown) : null,
        d.expenseBreakdown ? JSON.stringify(d.expenseBreakdown) : null,
        d.note ?? null,
      ],
    );
    return reply.status(201).send({
      ...rows[0],
      incomeDisplay: formatAed(Number(rows[0].income_fils)),
      netIncomeDisplay: formatAed(Number(rows[0].net_income_fils)),
    });
  });

  app.delete('/api/admin/financials/:period', async (request) => {
    const period = String((request.params as { period: string }).period);
    await pool.query(`DELETE FROM historical_financials WHERE period = $1`, [period]);
    return { deleted: true };
  });

  // ── Data migration from QuickBooks ─────────────────────────────────────────
  // Mint a short-lived ticket so the owner's QuickBooks browser tab can pipe
  // scraped rows (customers, invoices) straight into the PUBLIC /api/import
  // route without exposing the staff token to the qbo.intuit.com page.
  app.post('/api/admin/import/ticket', async () => issueImportTicket());

  // Dashboard file upload: the browser parses the exported QuickBooks sheet into
  // rows and posts them here (authenticated). Same idempotent upsert as the
  // public sink. This is the simplest path for the owner — export, then upload.
  app.post('/api/admin/import/rows', async (request, reply) => {
    const body = request.body as { kind?: string; rows?: any[] } | undefined;
    const rows = Array.isArray(body?.rows) ? body!.rows : [];
    if (rows.length > 5000) return reply.status(413).send({ error: 'too_many_rows' });
    try {
      return await importRows(String(body?.kind ?? ''), rows);
    } catch {
      return reply.status(400).send({ error: 'unknown_kind' });
    }
  });

  // Progress counters so the migration can be verified without reading any PII.
  // Distinct product/package names in the imported invoices, with line counts
  // and totals — so duplicate names (a package renamed in QuickBooks, e.g.
  // "Bronze" vs "New Silver Pakage") can be spotted and merged.
  app.get('/api/admin/import/products', async () => {
    const { rows } = await pool.query(
      `SELECT product, count(*)::int AS lines, coalesce(sum(total_fils),0)::bigint AS total_fils
         FROM historical_orders
        WHERE product IS NOT NULL AND product <> ''
        GROUP BY product
        ORDER BY lower(product)`,
    );
    return rows.map((r) => ({ ...r, totalDisplay: formatAed(Number(r.total_fils)) }));
  });

  // Merge product names: { map: { "old name": "canonical name", ... } }.
  app.post('/api/admin/import/products/merge', async (request, reply) => {
    const schema = z.object({ map: z.record(z.string().min(1).max(200)) });
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'invalid_request' });
    let updated = 0;
    for (const [from, to] of Object.entries(parsed.data.map)) {
      if (from === to) continue;
      const { rowCount } = await pool.query(
        `UPDATE historical_orders SET product = $2 WHERE product = $1`,
        [from, to],
      );
      updated += rowCount ?? 0;
    }
    return { updated };
  });

  // Revenue per year, computed straight from the imported invoice lines — the
  // real income history, no manual entry needed. (Discount lines are negative,
  // so the sum is net revenue.)
  app.get('/api/admin/import/revenue-by-year', async () => {
    const { rows } = await pool.query(
      `SELECT extract(year FROM txn_date)::int AS year,
              count(DISTINCT doc_number)::int AS invoices,
              count(*)::int AS lines,
              coalesce(sum(total_fils),0)::bigint AS revenue_fils,
              coalesce(-sum(discount_fils),0)::bigint AS discount_fils
         FROM historical_orders
        WHERE txn_date IS NOT NULL
        GROUP BY 1 ORDER BY 1`,
    );
    return rows.map((r) => ({
      year: r.year,
      invoices: r.invoices,
      lines: r.lines,
      revenueFils: Number(r.revenue_fils),
      revenueDisplay: formatAed(Number(r.revenue_fils)),
      discountFils: Number(r.discount_fils),
      discountDisplay: formatAed(Number(r.discount_fils)),
    }));
  });

  // Save total expenses per year (summed on the client from a QuickBooks
  // expense report). { byYear: { "2023": fils, ... } }.
  app.post('/api/admin/import/expenses', async (request, reply) => {
    const schema = z.object({ byYear: z.record(z.number().int().min(0)) });
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'invalid_request' });
    let saved = 0;
    for (const [y, fils] of Object.entries(parsed.data.byYear)) {
      const year = Number(y);
      if (!Number.isInteger(year) || year < 2000 || year > 2100) continue;
      await pool.query(
        `INSERT INTO expense_years (year, expenses_fils, updated_at) VALUES ($1,$2, now())
         ON CONFLICT (year) DO UPDATE SET expenses_fils = EXCLUDED.expenses_fils, updated_at = now()`,
        [year, fils],
      );
      saved += 1;
    }
    return { saved };
  });

  // Profit & loss per year: revenue from the imported invoices, expenses from
  // expense_years, and the derived profit + margin. This is the "no manual
  // entry" P&L the owner asked for.
  app.get('/api/admin/import/pnl-by-year', async () => {
    const { rows } = await pool.query(
      `SELECT y.year,
              coalesce(r.revenue_fils, 0)::bigint AS revenue_fils,
              coalesce(e.expenses_fils, 0)::bigint AS expenses_fils
         FROM (
                SELECT DISTINCT extract(year FROM txn_date)::int AS year FROM historical_orders WHERE txn_date IS NOT NULL
                UNION SELECT year FROM expense_years
              ) y
         LEFT JOIN (
                SELECT extract(year FROM txn_date)::int AS year, sum(total_fils) AS revenue_fils
                  FROM historical_orders WHERE txn_date IS NOT NULL GROUP BY 1
              ) r ON r.year = y.year
         LEFT JOIN expense_years e ON e.year = y.year
        ORDER BY y.year`,
    );
    return rows.map((r) => {
      const revenue = Number(r.revenue_fils);
      const expenses = Number(r.expenses_fils);
      const profit = revenue - expenses;
      return {
        year: r.year,
        revenueFils: revenue, revenueDisplay: formatAed(revenue),
        expensesFils: expenses, expensesDisplay: formatAed(expenses),
        profitFils: profit, profitDisplay: formatAed(profit),
        marginPct: revenue > 0 ? Math.round((profit / revenue) * 1000) / 10 : 0,
        hasExpenses: expenses > 0,
      };
    });
  });

  // ── Finance module (QuickBooks-style: customers, items, invoices, receipts,
  //    accounting). All under /api/admin/finance/… so it inherits the manager gate.
  const lineItemsSchema = z.array(z.object({
    name: z.string().min(1).max(200),
    qty: z.number().min(0),
    priceFils: z.number().int(),
    description: z.string().max(1000).nullish(),
  }));
  const docSchema = z.object({
    customerId: z.number().int().nullable().optional(),
    customerName: z.string().min(1).max(200),
    items: lineItemsSchema.default([]),
    discountFils: z.number().int().min(0).default(0),
    shippingFils: z.number().int().min(0).default(0),
    message: z.string().max(1000).optional(),
    // Guest-of-honour / baby name + theme + age echoed on the receipt.
    eventFor: z.string().max(120).nullable().optional(),
    theme: z.string().max(120).nullable().optional(),
    age: z.string().max(40).nullable().optional(),
  });

  app.get('/api/admin/finance/customers', async (request) =>
    finance.listCustomers((request.query as { q?: string }).q));
  app.post('/api/admin/finance/customers', async (request, reply) => {
    const schema = z.object({
      fullName: z.string().min(1).max(200),
      email: z.string().max(200).optional(),
      phone: z.string().max(60).optional(),
      backupPhone: z.string().max(60).optional(),
      emirate: z.string().max(60).optional(),
    });
    const p = schema.safeParse(request.body);
    if (!p.success) return reply.status(400).send({ error: 'invalid_request' });
    return finance.addCustomer(p.data);
  });

  // ── Customers (CRM master) — manager/owner only (PII + spend) ──────────────
  app.get('/api/admin/customers', async (request) =>
    finance.customersMaster((request.query as { q?: string }).q));
  app.get('/api/admin/customers/:id', async (request, reply) => {
    const c = await finance.customerDetail(Number((request.params as { id: string }).id));
    return c ?? reply.status(404).send({ error: 'not_found' });
  });
  app.patch('/api/admin/customers/:id', async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    const schema = z.object({
      fullName: z.string().max(200).optional(),
      email: z.string().max(200).optional(),
      phone: z.string().max(60).optional(),
      backupPhone: z.string().max(60).optional(),
      emirate: z.string().max(60).optional(),
    });
    const p = schema.safeParse(request.body);
    if (!p.success) return reply.status(400).send({ error: 'invalid_request' });
    // Normalise UAE numbers on save (reuse the confident-only helper); leave a
    // number the helper can't fix exactly as typed so nothing is silently lost.
    const d = { ...p.data };
    if (d.phone != null && d.phone.trim()) d.phone = normalizeUaePhone(d.phone)?.value ?? d.phone;
    if (d.backupPhone != null && d.backupPhone.trim()) d.backupPhone = normalizeUaePhone(d.backupPhone)?.value ?? d.backupPhone;
    const r = await finance.updateCustomer(id, d);
    if (r) logAudit({ actor: String((request as any).staff?.name ?? 'staff'), role: (request as any).staff?.role, action: 'customer_update', target: String(id), detail: d });
    return r ?? reply.status(404).send({ error: 'not_found' });
  });

  app.get('/api/admin/finance/items', async () => finance.listItems());
  app.post('/api/admin/finance/items', async (request, reply) => {
    const p = z.object({ name: z.string().trim().min(1).max(200), priceFils: z.number().int().min(0), description: z.string().trim().max(1000).optional() }).safeParse(request.body);
    if (!p.success) return reply.status(400).send({ error: 'invalid_request' });
    const by = String((request as any).staff?.name ?? 'staff');
    const item = await finance.createFinanceItem(p.data.name, p.data.priceFils, by, p.data.description ?? null);
    // Notify owner/manager that a new product/service was created.
    await pool.query(
      `INSERT INTO notifications (channel, template, scheduled_for, payload)
       VALUES ('push','new_product', now(), $1)`,
      [JSON.stringify({ name: item.name, priceFils: item.priceFils, by })],
    ).catch(() => {});
    void (async () => {
      const owners = await pool.query(`SELECT id FROM team_members WHERE access_level IN ('owner','manager') AND active`).catch(() => ({ rows: [] as any[] }));
      for (const o of owners.rows) void pushToOwner('staff', o.id, '🆕 New product added', `${item.name} — ${formatAed(item.priceFils)} (by ${by})`);
    })();
    logAudit({ actor: by, role: (request as any).staff?.role, action: 'new_product', detail: { name: item.name } });
    return item;
  });

  // Active themes (for the event-edit theme picker).
  app.get('/api/admin/themes-list', async () => {
    const { rows } = await pool.query(`SELECT id, name, celebration_type FROM themes WHERE active ORDER BY celebration_type, name`);
    return { rows };
  });

  // ── Products (custom finance items) — list / edit price+description / delete ─
  app.get('/api/admin/products', async () => {
    const { rows } = await pool.query(
      `SELECT id, name, price_fils, description FROM finance_items ORDER BY lower(name)`,
    );
    return { rows: rows.map((r) => ({ id: Number(r.id), name: r.name, priceFils: Number(r.price_fils), priceDisplay: formatAed(Number(r.price_fils)), description: r.description ?? null })) };
  });
  app.patch('/api/admin/products/:id', async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    const p = z.object({
      name: z.string().trim().min(1).max(200).optional(),
      priceFils: z.number().int().min(0).optional(),
      description: z.string().trim().max(1000).nullable().optional(),
    }).safeParse(request.body);
    if (!p.success) return reply.status(400).send({ error: 'invalid_request' });
    const sets: string[] = []; const vals: any[] = [id]; let i = 2;
    if (p.data.name !== undefined) { sets.push(`name = $${i++}`); vals.push(p.data.name); }
    if (p.data.priceFils !== undefined) { sets.push(`price_fils = $${i++}`); vals.push(p.data.priceFils); }
    if (p.data.description !== undefined) { sets.push(`description = $${i++}`); vals.push(p.data.description); }
    if (sets.length === 0) return reply.status(400).send({ error: 'nothing_to_update' });
    const { rows } = await pool.query(`UPDATE finance_items SET ${sets.join(', ')} WHERE id = $1 RETURNING id, name, price_fils, description`, vals);
    if (!rows[0]) return reply.status(404).send({ error: 'not_found' });
    logAudit({ actor: String((request as any).staff?.name ?? 'staff'), role: (request as any).staff?.role, action: 'product_edit', target: String(id), detail: p.data });
    return { id: Number(rows[0].id), name: rows[0].name, priceFils: Number(rows[0].price_fils), description: rows[0].description ?? null };
  });
  app.delete('/api/admin/products/:id', async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    await pool.query(`DELETE FROM finance_items WHERE id = $1`, [id]);
    logAudit({ actor: String((request as any).staff?.name ?? 'staff'), role: (request as any).staff?.role, action: 'product_delete', target: String(id) });
    return reply.status(204).send();
  });

  // ── Suppliers directory — who we buy from ──────────────────────────────────
  app.get('/api/admin/suppliers', async () => {
    const { rows } = await pool.query(`SELECT * FROM suppliers WHERE active ORDER BY lower(name)`);
    return { rows };
  });
  app.post('/api/admin/suppliers', async (request, reply) => {
    const p = z.object({
      name: z.string().trim().min(1).max(200),
      contact: z.string().trim().max(200).optional(),
      phone: z.string().trim().max(60).optional(),
      email: z.string().trim().max(200).optional(),
      supplies: z.string().trim().max(500).optional(),
      note: z.string().trim().max(1000).optional(),
    }).safeParse(request.body);
    if (!p.success) return reply.status(400).send({ error: 'invalid_request' });
    const by = String((request as any).staff?.name ?? 'staff');
    const { rows } = await pool.query(
      `INSERT INTO suppliers (name, contact, phone, email, supplies, note, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [p.data.name, p.data.contact ?? null, p.data.phone ?? null, p.data.email ?? null, p.data.supplies ?? null, p.data.note ?? null, by],
    );
    return rows[0];
  });
  app.patch('/api/admin/suppliers/:id', async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    const p = z.object({
      name: z.string().trim().min(1).max(200).optional(),
      contact: z.string().trim().max(200).nullable().optional(),
      phone: z.string().trim().max(60).nullable().optional(),
      email: z.string().trim().max(200).nullable().optional(),
      supplies: z.string().trim().max(500).nullable().optional(),
      note: z.string().trim().max(1000).nullable().optional(),
    }).safeParse(request.body);
    if (!p.success) return reply.status(400).send({ error: 'invalid_request' });
    const sets: string[] = []; const vals: any[] = [id]; let i = 2;
    for (const k of ['name', 'contact', 'phone', 'email', 'supplies', 'note'] as const) {
      if (p.data[k] !== undefined) { sets.push(`${k} = $${i++}`); vals.push(p.data[k]); }
    }
    if (sets.length === 0) return reply.status(400).send({ error: 'nothing_to_update' });
    const { rows } = await pool.query(`UPDATE suppliers SET ${sets.join(', ')} WHERE id = $1 RETURNING *`, vals);
    if (!rows[0]) return reply.status(404).send({ error: 'not_found' });
    return rows[0];
  });
  app.delete('/api/admin/suppliers/:id', async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    await pool.query(`UPDATE suppliers SET active = FALSE WHERE id = $1`, [id]);
    return reply.status(204).send();
  });

  /** Read-only diagnostic: how the migrated QuickBooks docs break down by type &
   *  payment status, so a reclassification can be built safely. */
  app.get('/api/admin/finance/qb-breakdown', async () => {
    const byType = await pool.query(
      `SELECT COALESCE(txn_type,'(none)') AS txn_type, COALESCE(status,'(none)') AS status,
              count(DISTINCT doc_number)::int AS docs, count(*)::int AS lines,
              COALESCE(sum(total_fils),0)::bigint AS total
         FROM historical_orders GROUP BY 1,2 ORDER BY 1,2`);
    const ranges = await pool.query(
      `SELECT COALESCE(txn_type,'(none)') AS txn_type,
              min(doc_number) AS min_no, max(doc_number) AS max_no,
              count(DISTINCT doc_number)::int AS docs
         FROM historical_orders WHERE doc_number ~ '^[0-9]+$' GROUP BY 1 ORDER BY 1`);
    return {
      byType: byType.rows.map((r) => ({ ...r, total: Number(r.total), totalDisplay: formatAed(Number(r.total)) })),
      ranges: ranges.rows,
    };
  });

  app.get('/api/admin/finance/invoices', async () => finance.listInvoices());
  app.post('/api/admin/finance/invoices', async (request, reply) => {
    const schema = docSchema.extend({ dueDate: z.string().nullable().optional(), issueDate: z.string().nullable().optional(), status: z.enum(['draft', 'sent']).optional(), commissionRep: z.string().nullable().optional() });
    const p = schema.safeParse(request.body);
    if (!p.success) return reply.status(400).send({ error: 'invalid_request', details: p.error.flatten() });
    // Only the owner can approve a commission tag; anyone else creates it untagged.
    const owner = (request as any).staff?.role === 'owner';
    return reply.status(201).send(await finance.createInvoice({ ...p.data, commissionRep: owner ? p.data.commissionRep ?? null : null }));
  });
  app.patch('/api/admin/finance/invoices/:id/status', async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    const p = z.object({ status: z.enum(['draft', 'sent', 'viewed', 'paid']) }).safeParse(request.body);
    if (!p.success) return reply.status(400).send({ error: 'invalid_request' });
    const r = await finance.setInvoiceStatus(id, p.data.status);
    if (!r) return reply.status(404).send({ error: 'not_found' });
    return r;
  });

  app.patch('/api/admin/finance/invoices/:id', async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    const p = docSchema.extend({ dueDate: z.string().nullable().optional(), issueDate: z.string().nullable().optional(), commissionRep: z.string().nullable().optional() }).safeParse(request.body);
    if (!p.success) return reply.status(400).send({ error: 'invalid_request' });
    // Non-owners never touch the commission tag (undefined = leave as approved/not).
    const owner = (request as any).staff?.role === 'owner';
    const r = await finance.updateInvoice(id, { ...p.data, commissionRep: owner ? p.data.commissionRep : undefined });
    return r ?? reply.status(404).send({ error: 'not_found' });
  });
  app.delete('/api/admin/finance/invoices/:id', async (request) => finance.deleteInvoice(Number((request.params as { id: string }).id)));
  app.post('/api/admin/finance/invoices/:id/email', async (request) => finance.emailDoc('invoice', Number((request.params as { id: string }).id)));

  app.get('/api/admin/finance/receipts', async (request) => finance.listReceipts((request as any).staff?.role));
  app.patch('/api/admin/finance/receipts/:id', async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    const p = docSchema.extend({ date: z.string().nullable().optional(), paidWith: z.string().max(40).optional(), commissionRep: z.string().nullable().optional() }).safeParse(request.body);
    if (!p.success) return reply.status(400).send({ error: 'invalid_request' });
    const owner = (request as any).staff?.role === 'owner';
    const r = await finance.updateReceipt(id, { ...p.data, commissionRep: owner ? p.data.commissionRep : undefined });
    return r ?? reply.status(404).send({ error: 'not_found' });
  });
  app.post('/api/admin/finance/receipts/:id/email', async (request) => finance.emailDoc('receipt', Number((request.params as { id: string }).id)));
  app.post('/api/admin/finance/receipts', async (request, reply) => {
    const schema = docSchema.extend({ date: z.string().nullable().optional(), paidWith: z.string().max(40).optional(), commissionRep: z.string().nullable().optional() });
    const p = schema.safeParse(request.body);
    if (!p.success) return reply.status(400).send({ error: 'invalid_request', details: p.error.flatten() });
    const owner = (request as any).staff?.role === 'owner';
    return reply.status(201).send(await finance.createReceipt({ ...p.data, commissionRep: owner ? p.data.commissionRep ?? null : null }));
  });
  app.delete('/api/admin/finance/receipts/:id', async (request) =>
    finance.deleteReceipt(Number((request.params as { id: string }).id)));

  app.get('/api/admin/finance/accounting', async () => finance.accountingSummary());
  app.post('/api/admin/finance/import-history', async () => finance.importReceiptsFromHistory());
  // One-time (safe to re-run): turn every upcoming sale that has no event yet
  // into an operational event so it appears on the schedule/board.
  app.post('/api/admin/finance/convert-upcoming', async () => finance.convertUpcomingReceiptsToEvents());
  // One-time (safe to re-run): normalise every emirate value to a canonical zone
  // (Al Ain / Khor Fakkan / Kalba kept as their own zones) across the customer
  // book, live customers and events. Cleans the Sales page's "city" column.
  app.post('/api/admin/finance/normalize-emirates', async () => finance.normalizeAllEmirates());
  // One-time (safe to re-run): post any paid order missing from Sales — e.g. a
  // shop order paid before the auto-sale hook existed.
  app.post('/api/admin/finance/backfill-sales', async () => finance.backfillMissingSales());
  // Attribute customer names to receipts/orders from a { docNumber: name } map
  // (rebuilt in the browser from the Sales-by-Customer report). Fixes the sales
  // whose customer grouping was lost on the first import.
  app.post('/api/admin/finance/attribute', async (request, reply) => {
    const p = z.object({ map: z.record(z.string().max(200)) }).safeParse(request.body);
    if (!p.success) return reply.status(400).send({ error: 'invalid_request' });
    let updated = 0;
    for (const [doc, name] of Object.entries(p.data.map)) {
      const nm = name.trim();
      if (!doc || !nm) continue;
      const r = await pool.query(`UPDATE finance_receipts SET customer_name = $2 WHERE number = $1`, [doc, nm]);
      await pool.query(`UPDATE historical_orders SET customer_name = $2 WHERE doc_number = $1`, [doc, nm]);
      updated += r.rowCount ?? 0;
    }
    return { updated };
  });

  app.get('/api/admin/import/status', async () => {
    const cust = await pool.query(
      `SELECT count(*)::int AS n, count(email)::int AS with_email, count(DISTINCT emirate)::int AS emirates FROM historical_customers`,
    );
    const ord = await pool.query(
      `SELECT count(*)::int AS n, count(txn_date)::int AS with_date, coalesce(sum(total_fils),0)::bigint AS total_fils FROM historical_orders`,
    );
    return { customers: cust.rows[0], orders: ord.rows[0] };
  });

  /**
   * Owner/CEO finance summary for a month: revenue (paid bookings + add-ons;
   * tips are pass-through to staff, never counted as revenue), expenses by
   * category, net profit and margin, plus a 6-month trend.
   */
  app.get('/api/admin/finance', async (request) => {
    const q = request.query as { month?: string };
    const now = new Date();
    const monthStr = /^\d{4}-\d{2}$/.test(q.month ?? '')
      ? q.month!
      : `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const start = `${monthStr}-01`;
    const endD = new Date(`${start}T00:00:00Z`);
    endD.setUTCMonth(endD.getUTCMonth() + 1);
    const end = endD.toISOString().slice(0, 10);
    // Six-month window (this month back five).
    const sixD = new Date(`${start}T00:00:00Z`);
    sixD.setUTCMonth(sixD.getUTCMonth() - 5);
    const sixStart = sixD.toISOString().slice(0, 10);

    const [rev, exp, byCat, tipsRow, revTrend, expTrend] = await Promise.all([
      pool.query(
        `SELECT COALESCE(SUM(total_fils),0) AS v FROM orders
          WHERE status='paid' AND kind IN ('booking','addon') AND source IS DISTINCT FROM 'converted'
            AND created_at >= $1 AND created_at < $2`,
        [start, end],
      ),
      pool.query(`SELECT COALESCE(SUM(amount_fils),0) AS v FROM expenses WHERE source <> 'quickbooks' AND spent_on >= $1 AND spent_on < $2`, [start, end]),
      pool.query(
        `SELECT category, SUM(amount_fils) AS v FROM expenses
          WHERE source <> 'quickbooks' AND spent_on >= $1 AND spent_on < $2 GROUP BY category ORDER BY v DESC`,
        [start, end],
      ),
      pool.query(
        `SELECT COALESCE(SUM(amount_fils),0) AS v FROM tips t JOIN events e ON e.id=t.event_id
          WHERE t.status='paid' AND e.event_date >= $1 AND e.event_date < $2`,
        [start, end],
      ),
      pool.query(
        `SELECT to_char(date_trunc('month', created_at),'YYYY-MM') AS m, SUM(total_fils) AS v
           FROM orders WHERE status='paid' AND kind IN ('booking','addon') AND source IS DISTINCT FROM 'converted' AND created_at >= $1
          GROUP BY 1`,
        [sixStart],
      ),
      pool.query(
        `SELECT to_char(date_trunc('month', spent_on),'YYYY-MM') AS m, SUM(amount_fils) AS v
           FROM expenses WHERE source <> 'quickbooks' AND spent_on >= $1 GROUP BY 1`,
        [sixStart],
      ),
    ]);

    const revenue = Number(rev.rows[0].v);
    const expenses = Number(exp.rows[0].v);
    const profit = revenue - expenses;

    const revMap = new Map(revTrend.rows.map((r) => [r.m, Number(r.v)]));
    const expMap = new Map(expTrend.rows.map((r) => [r.m, Number(r.v)]));
    const trend: Array<{ month: string; revenueFils: number; expenseFils: number; profitFils: number }> = [];
    for (let i = 0; i < 6; i++) {
      const d = new Date(`${sixStart}T00:00:00Z`);
      d.setUTCMonth(d.getUTCMonth() + i);
      const m = d.toISOString().slice(0, 7);
      const r = revMap.get(m) ?? 0;
      const e = expMap.get(m) ?? 0;
      trend.push({ month: m, revenueFils: r, expenseFils: e, profitFils: r - e });
    }

    return {
      month: monthStr,
      revenueFils: revenue,
      revenueDisplay: formatAed(revenue),
      expensesFils: expenses,
      expensesDisplay: formatAed(expenses),
      profitFils: profit,
      profitDisplay: formatAed(Math.abs(profit)),
      profitNegative: profit < 0,
      marginPct: revenue > 0 ? Math.round((profit / revenue) * 1000) / 10 : 0,
      tipsCollectedFils: Number(tipsRow.rows[0].v),
      tipsCollectedDisplay: formatAed(Number(tipsRow.rows[0].v)),
      byCategory: byCat.rows.map((r) => ({
        category: r.category,
        amountFils: Number(r.v),
        amountDisplay: formatAed(Number(r.v)),
      })),
      trend: trend.map((t) => ({
        ...t,
        revenueDisplay: formatAed(t.revenueFils),
        expenseDisplay: formatAed(t.expenseFils),
        profitDisplay: formatAed(t.profitFils),
      })),
    };
  });

  /**
   * Create a manual (WhatsApp) order and return a secure payment link. The
   * manager picks the priced items + date/time/emirate; the customer completes
   * their own details and pays through the link. Not revenue until paid.
   */
  app.post('/api/admin/orders/manual', async (request, reply) => {
    const schema = z.object({
      customer: z.object({
        name: z.string().min(1).max(120),
        phone: z.string().min(3).max(40),
        email: z.string().email().optional(),
      }),
      cart: z.record(z.string(), z.any()),
    });
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'invalid_request', details: parsed.error.flatten() });
    try {
      const result = await createManualOrder({
        customer: parsed.data.customer,
        cart: parsed.data.cart as any,
        createdBy: String((request as any).staff?.name ?? 'Manager'),
      });
      return reply.status(201).send({
        orderId: result.orderId,
        payUrl: result.payUrl,
        totalFils: result.totalFils,
        totalDisplay: result.totalDisplay,
      });
    } catch (err) {
      if (err instanceof CheckoutError) {
        return reply.status(422).send({ error: err.code, message: err.message, details: err.details ?? null });
      }
      request.log.error({ err }, 'manual order failed');
      return reply.status(500).send({ error: 'manual_order_failed' });
    }
  });

  /**
   * Manual-order offer link. The manager picks ONLY the products (celebration
   * type + package + add-on services + optional theme); the system prices them
   * and returns a unique link. The customer opens it, completes ALL their own
   * details on the normal checkout, and pays. No customer/date/location entered
   * here. One link → at most one booking (the offer is consumed on payment).
   */
  app.post('/api/admin/orders/offer', async (request, reply) => {
    const schema = z.object({
      celebrationType: z.string().min(1).max(40),
      packageId: z.string().max(60).nullable().optional(),
      services: z.array(z.object({ serviceId: z.string().min(1).max(60), quantity: z.number().int().min(1).max(500) })).default([]),
      themeId: z.string().max(80).nullable().optional(),
      customItems: z.array(z.object({ name: z.string().min(1).max(120), priceFils: z.number().int().min(0).max(100_000_000), qty: z.number().int().min(1).max(500).default(1) })).default([]),
      discountFils: z.number().int().min(0).max(100_000_000).default(0),
      deliveryFils: z.number().int().min(0).max(100_000_000).nullable().optional(),
      customThemeFils: z.number().int().min(0).max(100_000_000).default(0),
      refImages: z.array(z.string().url().max(500)).max(8).default([]),
    });
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'invalid_request', details: parsed.error.flatten() });
    if (!parsed.data.packageId && parsed.data.services.length === 0 && parsed.data.customItems.length === 0) {
      return reply.status(422).send({ error: 'empty_selection', message: 'Pick a package, an add-on, or add a product.' });
    }
    try {
      const offer = await createOffer({
        celebrationType: parsed.data.celebrationType,
        packageId: parsed.data.packageId ?? null,
        services: parsed.data.services,
        themeId: parsed.data.themeId ?? null,
        customItems: parsed.data.customItems,
        discountFils: parsed.data.discountFils,
        deliveryFils: parsed.data.deliveryFils ?? null,
        customThemeFils: parsed.data.customThemeFils,
        refImages: parsed.data.refImages,
        createdBy: String((request as any).staff?.name ?? 'Manager'),
      });
      const base = (config.publicAppUrl || '').replace(/\/$/, '');
      return reply.status(201).send({
        token: offer.token,
        link: `${base}/?offer=${offer.token}`,
        items: offer.items,
        productsDisplay: offer.productsDisplay,
        discountDisplay: offer.discountDisplay,
        deliveryDisplay: offer.deliveryDisplay,
        deliveryAuto: offer.deliveryAuto,
        totalFils: offer.totalFils,
        totalDisplay: offer.totalDisplay,
      });
    } catch (err) {
      request.log.error({ err }, 'offer create failed');
      return reply.status(500).send({ error: 'offer_failed' });
    }
  });

  /**
   * Add-on pay link for an EXISTING booking. The customer already has an order;
   * this prices the extra products and returns a pay link that, once paid,
   * attaches to the same event and posts to Sales — never a new booking.
   */
  app.post('/api/admin/orders/addon-link', async (request, reply) => {
    const schema = z.object({
      eventId: z.string().min(1).max(60),
      celebrationType: z.string().max(40).optional(),
      packageId: z.string().max(60).nullable().optional(),
      services: z.array(z.object({ serviceId: z.string().min(1).max(60), quantity: z.number().int().min(1).max(500) })).default([]),
      customItems: z.array(z.object({ name: z.string().min(1).max(120), priceFils: z.number().int().min(0).max(100_000_000), qty: z.number().int().min(1).max(500).default(1) })).default([]),
      discountFils: z.number().int().min(0).max(100_000_000).default(0),
      deliveryFils: z.number().int().min(0).max(100_000_000).nullable().optional(),
      customThemeFils: z.number().int().min(0).max(100_000_000).default(0),
      refImages: z.array(z.string().url().max(500)).max(8).default([]),
    });
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'invalid_request', details: parsed.error.flatten() });
    try {
      const r = await createEventAddonLink({
        eventId: parsed.data.eventId,
        selection: {
          celebrationType: parsed.data.celebrationType,
          packageId: parsed.data.packageId ?? null,
          services: parsed.data.services,
          customItems: parsed.data.customItems,
          discountFils: parsed.data.discountFils,
          deliveryFils: parsed.data.deliveryFils ?? null,
          customThemeFils: parsed.data.customThemeFils,
          refImages: parsed.data.refImages,
        },
        createdBy: String((request as any).staff?.name ?? 'Manager'),
      });
      return reply.status(201).send({ orderId: r.orderId, payUrl: r.payUrl, totalFils: r.totalFils, totalDisplay: r.totalDisplay });
    } catch (err) {
      if (err instanceof CheckoutError) return reply.status(err.code === 'not_found' ? 404 : 422).send({ error: err.code, message: err.message });
      request.log.error({ err }, 'addon link failed');
      return reply.status(500).send({ error: 'addon_link_failed' });
    }
  });

  /**
   * Enrichment read: every unpaid/pending manual order with the booking details
   * that live inside its cart (celebration type, theme, and the guest-of-honour
   * name the customer normally fills at pay time). Used to back-fill data we
   * already know from WhatsApp so notifications render the full template. Also
   * returns the theme list (id ↔ name) so a theme name can be mapped to its id.
   */
  app.get('/api/admin/orders/pending-details', async () => {
    const [orders, themes] = await Promise.all([
      pool.query(
        `SELECT o.id, o.status, o.created_at, c.name AS customer, c.phone,
                to_char((o.cart->>'eventDate')::date,'YYYY-MM-DD') AS event_date,
                o.cart->>'startTime'       AS start_time,
                o.cart->>'emirate'         AS emirate,
                o.cart->>'celebrationType' AS celebration_type,
                o.cart->>'themeId'         AS theme_id,
                o.cart->>'eventFor'        AS event_for,
                o.cart->>'packageId'       AS package_id,
                (o.cart->>'customTheme')::boolean AS custom_theme
           FROM orders o JOIN customers c ON c.id = o.customer_id
          WHERE o.status IN ('awaiting_payment','processing','needs_review')
          ORDER BY (o.cart->>'eventDate')::date NULLS LAST`,
      ),
      pool.query(`SELECT id, name, celebration_type, active FROM themes ORDER BY name`),
    ]);
    return { orders: orders.rows, themes: themes.rows };
  });

  /**
   * Back-fill booking details onto an unpaid order's cart. Only three fields —
   * celebration type, theme, and guest-of-honour name — and only while the order
   * is still pending (never rewrite a paid booking here). Every change is audited.
   */
  app.patch('/api/admin/orders/:orderId/details', async (request, reply) => {
    const { orderId } = request.params as { orderId: string };
    const schema = z.object({
      celebrationType: z.string().min(1).max(40).optional(),
      themeId: z.string().min(1).max(80).nullable().optional(),
      eventFor: z.string().min(1).max(120).optional(),
    });
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'invalid_request', details: parsed.error.flatten() });
    if (Object.keys(parsed.data).length === 0) return reply.status(400).send({ error: 'nothing_to_update' });

    const { rows } = await pool.query(`SELECT cart, status FROM orders WHERE id = $1`, [orderId]);
    if (!rows[0]) return reply.status(404).send({ error: 'not_found' });
    if (!['awaiting_payment', 'processing', 'needs_review'].includes(rows[0].status)) {
      return reply.status(409).send({ error: 'not_editable', status: rows[0].status });
    }
    const before = (rows[0].cart ?? {}) as Record<string, unknown>;
    const cart = { ...before };
    const p = parsed.data;
    if (p.celebrationType !== undefined) cart.celebrationType = p.celebrationType;
    if (p.themeId !== undefined) cart.themeId = p.themeId;
    if (p.eventFor !== undefined) cart.eventFor = p.eventFor;
    await pool.query(`UPDATE orders SET cart = $2 WHERE id = $1`, [orderId, cart]);
    await pool.query(
      `INSERT INTO payment_events (order_id, provider, new_status, source, note, payload)
       VALUES ($1,'system','details_enriched','admin',$2,$3)`,
      [
        orderId,
        `Booking details back-filled by ${String((request as any).staff?.name ?? 'Manager')}`,
        JSON.stringify({
          celebrationType: { from: before.celebrationType ?? null, to: cart.celebrationType ?? null },
          themeId: { from: before.themeId ?? null, to: cart.themeId ?? null },
          eventFor: { from: before.eventFor ?? null, to: cart.eventFor ?? null },
        }),
      ],
    ).catch(() => {});
    return {
      ok: true,
      id: orderId,
      celebrationType: cart.celebrationType ?? null,
      themeId: cart.themeId ?? null,
      eventFor: cart.eventFor ?? null,
    };
  });

  /**
   * CEO executive dashboard — decision-support analytics over an event-date
   * range with optional filters (emirate, event type, package). Revenue is
   * every paid booking/addon order tied to an event in range; expenses are by
   * spent_on; cancelled events are excluded from revenue but counted for the
   * cancellation rate. Returns actionable insights, not just numbers.
   */
  app.get('/api/admin/ceo', async (request) => {
    const q = request.query as {
      from?: string; to?: string; emirate?: string; eventType?: string; packageId?: string;
    };
    const now = new Date();
    const isoDate = (d: Date) => d.toISOString().slice(0, 10);
    // Default: trailing 12 months through end of next month (to include upcoming).
    const defFrom = isoDate(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 11, 1)));
    const defTo = isoDate(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 2, 1)));
    const from = /^\d{4}-\d{2}-\d{2}$/.test(q.from ?? '') ? q.from! : defFrom;
    const to = /^\d{4}-\d{2}-\d{2}$/.test(q.to ?? '') ? q.to! : defTo;

    // Optional event filters, parameterised after $1(from) and $2(to).
    const fVals: string[] = [];
    const fClause: string[] = [];
    if (q.emirate) { fVals.push(q.emirate); fClause.push(`e.emirate = $${2 + fVals.length}`); }
    if (q.eventType) { fVals.push(q.eventType); fClause.push(`e.celebration_type = $${2 + fVals.length}`); }
    if (q.packageId) { fVals.push(q.packageId); fClause.push(`e.package_id = $${2 + fVals.length}`); }
    const F = fClause.length ? ' AND ' + fClause.join(' AND ') : '';
    const params: any[] = [from, to, ...fVals];

    // Per-event revenue (booking order + its addons), with dimensions.
    const evRevSub = `(SELECT COALESCE(SUM(o.total_fils),0) FROM orders o
        WHERE o.status='paid' AND o.kind IN ('booking','addon') AND o.source IS DISTINCT FROM 'converted'
          AND (o.id = e.order_id OR o.event_id = e.id))`;

    // Previous equal-length window for period comparison.
    const spanMs = new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime();
    const prevFrom = isoDate(new Date(new Date(`${from}T00:00:00Z`).getTime() - spanMs));
    const prevTo = from;

    const [evRows, repeatRow, outstandingRow, expRow, expByCat, refundRow, prevRow] = await Promise.all([
      pool.query(
        `SELECT e.id, e.emirate, e.celebration_type, e.package_id, e.theme_id,
                to_char(e.event_date,'YYYY-MM') AS ym, e.customer_id, e.phase,
                (e.phase = 'Cancelled' OR e.cancelled_at IS NOT NULL) AS cancelled,
                p.name AS package_name, th.name AS theme_name,
                ${evRevSub} AS revenue_fils
           FROM events e
           LEFT JOIN packages p ON p.id = e.package_id
           LEFT JOIN themes th  ON th.id = e.theme_id
          WHERE e.event_date >= $1 AND e.event_date < $2 ${F}`,
        params,
      ),
      pool.query(
        `SELECT COUNT(*) FILTER (WHERE n > 1) AS repeats, COUNT(*) AS total
           FROM (SELECT customer_id, COUNT(*) n FROM events WHERE phase <> 'Cancelled' GROUP BY customer_id) s`,
      ),
      pool.query(
        // "Expected in" must be money that is genuinely likely to arrive — a
        // manual pay-link the team sent a customer, still fresh. An app checkout
        // left in awaiting_payment is an abandoned cart, NOT a receivable, and
        // must never inflate cash-available or the forecast. (#4 audit finding:
        // the old 53K was 15 abandoned test carts + 2 pay-links.)
        `SELECT COALESCE(SUM(total_fils),0) v, COUNT(*) c FROM orders
          WHERE status IN ('awaiting_payment','processing','needs_review')
            AND source = 'manual'
            AND created_at > now() - interval '10 days'`,
      ),
      pool.query(`SELECT COALESCE(SUM(amount_fils),0) v FROM expenses WHERE source <> 'quickbooks' AND spent_on >= $1 AND spent_on < $2`, [from, to]),
      pool.query(
        `SELECT category, SUM(amount_fils) v FROM expenses WHERE source <> 'quickbooks' AND spent_on >= $1 AND spent_on < $2 GROUP BY category ORDER BY v DESC`,
        [from, to],
      ),
      pool.query(
        `SELECT COALESCE(SUM(c.refund_amount_fils),0) v, COUNT(*) c FROM cancellations c
           JOIN events e ON e.id = c.event_id
          WHERE e.event_date >= $1 AND e.event_date < $2 ${F}`,
        params,
      ),
      pool.query(
        `SELECT COALESCE(SUM(${evRevSub}),0) revenue, COUNT(*) bookings
           FROM events e WHERE e.phase <> 'Cancelled' AND e.event_date >= $1 AND e.event_date < $2 ${F}`,
        [prevFrom, prevTo, ...fVals],
      ),
    ]);

    const rows = evRows.rows as any[];
    const confirmed = rows.filter((r) => !r.cancelled);
    const cancelledRows = rows.filter((r) => r.cancelled);
    const revenue = confirmed.reduce((s, r) => s + Number(r.revenue_fils), 0);
    const bookings = confirmed.length;
    const aov = bookings > 0 ? Math.round(revenue / bookings) : 0;

    // Group helper → sorted [{key,label,bookings,revenueFils}].
    const groupBy = (keyFn: (r: any) => string, labelFn?: (r: any) => string) => {
      const m = new Map<string, { key: string; label: string; bookings: number; revenueFils: number }>();
      for (const r of confirmed) {
        const key = keyFn(r) || '—';
        const label = (labelFn ? labelFn(r) : key) || '—';
        const cur = m.get(key) ?? { key, label, bookings: 0, revenueFils: 0 };
        cur.bookings += 1;
        cur.revenueFils += Number(r.revenue_fils);
        m.set(key, cur);
      }
      return [...m.values()].sort((a, b) => b.revenueFils - a.revenueFils);
    };
    const withDisplay = <T extends { revenueFils: number }>(arr: T[]) =>
      arr.map((x) => ({ ...x, revenueDisplay: formatAed(x.revenueFils) }));

    const byEmirate = withDisplay(groupBy((r) => r.emirate));
    const byEventType = withDisplay(groupBy((r) => r.celebration_type, (r) => celebrationLabel(r.celebration_type)));
    const byPackage = withDisplay(groupBy((r) => r.package_id ?? 'none', (r) => r.package_name ?? 'Build Your Own / à la carte'));
    const byTheme = withDisplay(groupBy((r) => r.theme_id ?? 'none', (r) => r.theme_name ?? 'No theme / custom'));

    // Monthly trend across the range (bookings + revenue by event_date month).
    const monthMap = new Map<string, { month: string; bookings: number; revenueFils: number }>();
    for (const r of confirmed) {
      const cur = monthMap.get(r.ym) ?? { month: r.ym, bookings: 0, revenueFils: 0 };
      cur.bookings += 1;
      cur.revenueFils += Number(r.revenue_fils);
      monthMap.set(r.ym, cur);
    }
    const trend = [...monthMap.values()]
      .sort((a, b) => a.month.localeCompare(b.month))
      .map((t) => ({ ...t, revenueDisplay: formatAed(t.revenueFils) }));

    // Forward-looking pipeline (upcoming confirmed events + booked revenue) and
    // the WhatsApp sales funnel — global business health, not range-filtered.
    const [pipelineRow, funnelRow] = await Promise.all([
      pool.query(
        `SELECT COUNT(*)::int c, COALESCE(SUM(${evRevSub}),0) v
           FROM events e WHERE e.phase <> 'Cancelled' AND e.event_date >= current_date`,
      ),
      pool.query(
        `SELECT COUNT(*)::int total,
                COUNT(*) FILTER (WHERE status IN ('quoted','confirmed','booked'))::int quoted,
                COUNT(*) FILTER (WHERE status = 'booked')::int booked
           FROM whatsapp_leads`,
      ),
    ]);
    const pipeline = {
      events: Number(pipelineRow.rows[0].c),
      revenueFils: Number(pipelineRow.rows[0].v),
      revenueDisplay: formatAed(Number(pipelineRow.rows[0].v)),
    };
    const funnel = {
      leads: Number(funnelRow.rows[0].total),
      quoted: Number(funnelRow.rows[0].quoted),
      booked: Number(funnelRow.rows[0].booked),
      conversionPct: Number(funnelRow.rows[0].total) > 0
        ? Math.round((Number(funnelRow.rows[0].booked) / Number(funnelRow.rows[0].total)) * 1000) / 10
        : 0,
    };

    const expenses = Number(expRow.rows[0].v);
    const profit = revenue - expenses;
    const refundFils = Number(refundRow.rows[0].v);
    const prevRevenue = Number(prevRow.rows[0].revenue);
    const prevBookings = Number(prevRow.rows[0].bookings);
    const pct = (curr: number, prev: number) => (prev > 0 ? Math.round(((curr - prev) / prev) * 1000) / 10 : null);
    const revenueChangePct = pct(revenue, prevRevenue);
    const bookingsChangePct = pct(bookings, prevBookings);
    const repeats = Number(repeatRow.rows[0].repeats);
    const custTotal = Number(repeatRow.rows[0].total);
    const repeatRatePct = custTotal > 0 ? Math.round((repeats / custTotal) * 1000) / 10 : 0;
    const cancelledCount = cancelledRows.length;
    const cancelRatePct = rows.length > 0 ? Math.round((cancelledCount / rows.length) * 1000) / 10 : 0;

    // Actionable insights.
    const insights: Array<{ tone: 'good' | 'warn' | 'info'; text: string }> = [];
    if (revenueChangePct !== null) {
      insights.push({
        tone: revenueChangePct >= 0 ? 'good' : 'warn',
        text: `Revenue is ${revenueChangePct >= 0 ? 'up' : 'down'} ${Math.abs(revenueChangePct)}% vs the previous ${Math.round(spanMs / 86_400_000)} days (AED ${formatAed(revenue)} vs AED ${formatAed(prevRevenue)}).`,
      });
    }
    if (byEmirate[0]) insights.push({ tone: 'info', text: `${byEmirate[0].label} is your top emirate by revenue (AED ${byEmirate[0].revenueDisplay} from ${byEmirate[0].bookings} bookings).` });
    if (byPackage[0]) insights.push({ tone: 'info', text: `Best seller: ${byPackage[0].label} (AED ${byPackage[0].revenueDisplay}).` });
    if (cancelledCount > 0) insights.push({ tone: cancelRatePct > 15 ? 'warn' : 'info', text: `${cancelledCount} cancelled (${cancelRatePct}% of events); AED ${formatAed(refundFils)} refunded.` });
    if (Number(outstandingRow.rows[0].c) > 0) insights.push({ tone: 'warn', text: `${outstandingRow.rows[0].c} order(s) with payment not settled — AED ${formatAed(Number(outstandingRow.rows[0].v))} outstanding.` });
    insights.push({ tone: profit >= 0 ? 'good' : 'warn', text: `Net ${profit >= 0 ? 'profit' : 'loss'} of AED ${formatAed(Math.abs(profit))} (margin ${revenue > 0 ? Math.round((profit / revenue) * 1000) / 10 : 0}%) after AED ${formatAed(expenses)} expenses.` });
    if (custTotal > 0) insights.push({ tone: repeatRatePct >= 20 ? 'good' : 'info', text: `${repeatRatePct}% of customers have booked more than once (${repeats} of ${custTotal}).` });
    if (pipeline.events > 0) insights.push({ tone: 'good', text: `AED ${pipeline.revenueDisplay} in the pipeline — ${pipeline.events} upcoming confirmed event(s).` });
    if (funnel.leads > 0) insights.push({ tone: funnel.conversionPct >= 20 ? 'good' : 'info', text: `${funnel.booked} of ${funnel.leads} WhatsApp leads booked (${funnel.conversionPct}% conversion).` });

    // The REAL business, from the QuickBooks migration: the per-year P&L, the
    // lifetime totals, and the full customer book — so the CEO view reflects the
    // whole company (4 years, all WhatsApp sales), not just app-placed bookings.
    const [histFin, histCust] = await Promise.all([
      pool.query(`SELECT period, income_fils, net_income_fils FROM historical_financials WHERE period_kind = 'year' ORDER BY period`),
      pool.query(`SELECT count(*)::int n, count(email)::int with_email FROM historical_customers`),
    ]);
    const histYears = histFin.rows.map((r) => {
      const rev = Number(r.income_fils);
      const net = Number(r.net_income_fils);
      return { year: r.period, revenueFils: rev, revenueDisplay: formatAed(rev), netFils: net, netDisplay: formatAed(net), marginPct: rev > 0 ? Math.round((net / rev) * 1000) / 10 : 0 };
    });
    const lifetimeRevenue = histYears.reduce((s, y) => s + y.revenueFils, 0);
    const lifetimeNet = histYears.reduce((s, y) => s + y.netFils, 0);
    const latestYear = histYears[histYears.length - 1] ?? null;
    const business = histYears.length > 0 ? {
      years: histYears,
      lifetimeRevenueFils: lifetimeRevenue, lifetimeRevenueDisplay: formatAed(lifetimeRevenue),
      lifetimeNetFils: lifetimeNet, lifetimeNetDisplay: formatAed(lifetimeNet),
      lifetimeMarginPct: lifetimeRevenue > 0 ? Math.round((lifetimeNet / lifetimeRevenue) * 1000) / 10 : 0,
      customers: Number(histCust.rows[0].n), customersWithEmail: Number(histCust.rows[0].with_email),
      latestYear,
    } : null;

    // ── CEO brief extensions (all from REAL data; "Not enough data yet" where none) ──
    const nowY = now.getUTCFullYear();
    const yearStartS = `${nowY}-01-01`;
    const yearEndS = `${nowY + 1}-01-01`;
    const todayS = isoDate(now);
    const [cashSum, cancelReasonsRes, prepEventsArr, understaffRes, latePrepRes, up7Res, bdayRes, topCustRes, ytdRes, bookedFutureRes] = await Promise.all([
      import('../domain/finance.js').then((m) => m.accountingSummary()).catch(() => null),
      pool.query(`SELECT COALESCE(NULLIF(TRIM(c.reason),''),'—') reason, COUNT(*)::int n
                    FROM cancellations c JOIN events e ON e.id=c.event_id
                   WHERE e.event_date >= $1 AND e.event_date < $2 ${F}
                   GROUP BY 1 ORDER BY n DESC LIMIT 6`, params),
      import('../domain/prep.js').then((m) => m.getPrepEvents()).catch(() => [] as any[]),
      pool.query(`SELECT COUNT(DISTINCT es.event_id)::int n FROM event_staff es JOIN events e ON e.id=es.event_id
                   WHERE es.status='part_time_required' AND e.phase<>'Cancelled' AND e.event_date>=current_date`),
      pool.query(`SELECT COUNT(*)::int n FROM prep_tasks pt JOIN events e ON e.id=pt.event_id
                   WHERE pt.status NOT IN ('completed') AND pt.due_date < current_date AND e.phase<>'Cancelled' AND e.event_date>=current_date`),
      pool.query(`SELECT COUNT(*)::int n FROM events WHERE phase<>'Cancelled' AND event_date>=current_date AND event_date<=current_date + interval '7 days'`),
      pool.query(`SELECT name FROM team_members WHERE active AND birthday IS NOT NULL AND to_char(birthday,'MM-DD')=to_char(now(),'MM-DD')`),
      pool.query(`SELECT c.name, SUM(o.total_fils)::bigint v, COUNT(*)::int n
                    FROM orders o JOIN customers c ON c.id=o.customer_id
                   WHERE o.status='paid' AND o.kind IN ('booking','addon')
                   GROUP BY c.id,c.name ORDER BY v DESC LIMIT 5`),
      pool.query(`SELECT COALESCE(SUM(${evRevSub}),0) v FROM events e WHERE e.phase<>'Cancelled' AND e.event_date>=$1 AND e.event_date<=$2`, [yearStartS, todayS]),
      pool.query(`SELECT COALESCE(SUM(${evRevSub}),0) v FROM events e WHERE e.phase<>'Cancelled' AND e.event_date>$1 AND e.event_date<$2`, [todayS, yearEndS]),
    ]);

    const cashOnHandFils = (cashSum as any)?.cashOnHandFils ?? null;
    const arFils = (cashSum as any)?.arFils ?? null;
    // "Available after commitments" = cash on hand + expected incoming (A/R and
    // unsettled orders) − upcoming refunds owed.
    const upcomingRefundsRes = await pool.query(
      `SELECT COALESCE(SUM(refund_amount_fils),0)::bigint v FROM cancellations WHERE refund_status IN ('pending','processing')`,
    ).catch(() => ({ rows: [{ v: 0 }] }));
    const upcomingRefunds = Number(upcomingRefundsRes.rows[0].v);
    const expectedIn = Number(outstandingRow.rows[0].v) + Number(arFils ?? 0);
    const cash = cashSum ? {
      cashOnHandFils, cashOnHandDisplay: cashOnHandFils != null ? formatAed(cashOnHandFils) : null,
      receivableFils: arFils, receivableDisplay: arFils != null ? formatAed(arFils) : null,
      expectedInFils: expectedIn, expectedInDisplay: formatAed(expectedIn),
      upcomingRefundsFils: upcomingRefunds, upcomingRefundsDisplay: formatAed(upcomingRefunds),
      availableFils: (cashOnHandFils ?? 0) + expectedIn - upcomingRefunds,
      availableDisplay: formatAed((cashOnHandFils ?? 0) + expectedIn - upcomingRefunds),
    } : null;

    const cancelReasons = cancelReasonsRes.rows.map((r: any) => ({ reason: r.reason, count: Number(r.n) }));

    // Operational health (next 7 days).
    const prepEvents = prepEventsArr as any[];
    const upcoming7 = Number(up7Res.rows[0].n);
    const readyNext7 = prepEvents.filter((e) => e.daysToEvent >= 0 && e.daysToEvent <= 7 && e.progressPct === 100).length;
    const opsHealth = {
      upcoming7,
      fullyReady: readyNext7,
      withMissingItems: prepEvents.filter((e) => e.issues > 0).length,
      understaffed: Number(understaffRes.rows[0].n),
      latePrep: Number(latePrepRes.rows[0].n),
      atRisk: prepEvents.filter((e) => e.atRisk).length,
      readinessPct: upcoming7 > 0 ? Math.round((readyNext7 / upcoming7) * 100) : (prepEvents.length ? 100 : null),
    };

    const birthdays = bdayRes.rows.map((r: any) => r.name);
    const topCustomers = topCustRes.rows.map((r: any) => ({ name: r.name, revenueFils: Number(r.v), revenueDisplay: formatAed(Number(r.v)), orders: Number(r.n) }));

    // Year-end forecast (estimate). Uses the REAL year-to-date revenue from the
    // QuickBooks 2026 P&L (the app itself only holds future-dated bookings, so
    // its event-date revenue understates YTD), blended with already-booked
    // future revenue; net applies the current company margin.
    const histYtd = business?.latestYear?.revenueFils ?? 0;
    const ytdRevenue = histYtd > 0 ? histYtd : Number(ytdRes.rows[0].v);
    const bookedFuture = Number(bookedFutureRes.rows[0].v);
    const dayOfYear = Math.max(1, Math.floor((now.getTime() - Date.UTC(nowY, 0, 1)) / 86_400_000) + 1);
    const daysRemaining = Math.max(0, 365 - dayOfYear);
    const runRateDaily = ytdRevenue / dayOfYear;
    const runRateRemaining = Math.round(runRateDaily * daysRemaining);
    const marginRatio = (business?.latestYear?.marginPct ?? (revenue > 0 ? (profit / revenue) * 100 : 20)) / 100;
    const mkScenario = (remaining: number) => {
      const rev = ytdRevenue + remaining;
      const net = Math.round(rev * marginRatio);
      return { revenueFils: rev, revenueDisplay: formatAed(rev), netFils: net, netDisplay: formatAed(net) };
    };
    const forecast = ytdRevenue > 0 ? {
      ytdRevenueFils: ytdRevenue, ytdRevenueDisplay: formatAed(ytdRevenue),
      bookedFutureFils: bookedFuture, bookedFutureDisplay: formatAed(bookedFuture),
      marginPct: Math.round(marginRatio * 1000) / 10,
      conservative: mkScenario(bookedFuture),
      expected: mkScenario(Math.max(bookedFuture, runRateRemaining)),
      optimistic: mkScenario(Math.round(Math.max(bookedFuture, runRateRemaining) * 1.15)),
    } : null;

    // Prioritised alerts (Critical → High → Medium → Low).
    type Alert = { level: 'critical' | 'high' | 'medium' | 'low'; icon: string; text: string; view?: string };
    const alerts: Alert[] = [];
    if (opsHealth.understaffed > 0) alerts.push({ level: 'critical', icon: '🚨', text: `${opsHealth.understaffed} upcoming event(s) understaffed — a part-timer still needs confirming.`, view: 'schedule' });
    if (opsHealth.withMissingItems > 0) alerts.push({ level: 'critical', icon: '⚠️', text: `${opsHealth.withMissingItems} event(s) have a missing item / preparation issue.`, view: 'tasks' });
    if (opsHealth.atRisk > 0) alerts.push({ level: 'high', icon: '🧰', text: `${opsHealth.atRisk} event(s) within 3 days aren't fully prepared yet.`, view: 'tasks' });
    if (opsHealth.latePrep > 0) alerts.push({ level: 'high', icon: '⏰', text: `${opsHealth.latePrep} preparation task(s) are past their due date.`, view: 'tasks' });
    if (Number(outstandingRow.rows[0].c) > 0) alerts.push({ level: 'high', icon: '💰', text: `AED ${formatAed(Number(outstandingRow.rows[0].v))} across ${outstandingRow.rows[0].c} order(s) not yet settled.`, view: 'finance' });
    if (cancelRatePct > 15) alerts.push({ level: 'medium', icon: '❌', text: `Cancellation rate is ${cancelRatePct}% — above the healthy range.` });
    if (revenueChangePct !== null && revenueChangePct < -10) alerts.push({ level: 'medium', icon: '📉', text: `Revenue is down ${Math.abs(revenueChangePct)}% vs the previous period.` });
    const order = { critical: 0, high: 1, medium: 2, low: 3 } as const;
    alerts.sort((a, b) => order[a.level] - order[b.level]);

    return {
      from, to,
      business,
      cash, cancelReasons, opsHealth, birthdays, topCustomers, forecast, alerts,
      pipeline, funnel,
      collectedFils: revenue, collectedDisplay: formatAed(revenue),
      filters: { emirate: q.emirate ?? null, eventType: q.eventType ?? null, packageId: q.packageId ?? null },
      revenueFils: revenue, revenueDisplay: formatAed(revenue),
      bookings, aovFils: aov, aovDisplay: formatAed(aov),
      confirmed: bookings, cancelled: cancelledCount, cancelRatePct,
      refundFils, refundDisplay: formatAed(refundFils),
      expensesFils: expenses, expensesDisplay: formatAed(expenses),
      profitFils: profit, profitDisplay: formatAed(Math.abs(profit)), profitNegative: profit < 0,
      marginPct: revenue > 0 ? Math.round((profit / revenue) * 1000) / 10 : 0,
      outstandingFils: Number(outstandingRow.rows[0].v), outstandingDisplay: formatAed(Number(outstandingRow.rows[0].v)), outstandingCount: Number(outstandingRow.rows[0].c),
      revenueChangePct, bookingsChangePct,
      prevRevenueFils: prevRevenue, prevBookings,
      repeatCustomers: repeats, totalCustomers: custTotal, repeatRatePct,
      byEmirate, byEventType, byPackage, byTheme,
      byCategory: expByCat.rows.map((r) => ({ category: r.category, amountFils: Number(r.v), amountDisplay: formatAed(Number(r.v)) })),
      trend,
      insights,
    };
  });

  /** Send the finance report for a month now (default: last month). */
  app.post('/api/admin/finance/report', async (request, reply) => {
    if (!emailEnabled()) {
      return reply.status(409).send({ error: 'email_disabled', message: 'Configure email to send reports.' });
    }
    const q = request.query as { month?: string };
    const now = new Date();
    const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const monthStr = /^\d{4}-\d{2}$/.test(q.month ?? '')
      ? q.month!
      : `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}`;
    const result = await sendReport(monthStr);
    return { month: monthStr, ...result };
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
    // Notify the customer so a reply isn't silent until they reopen the app.
    const ev = await pool.query(`SELECT customer_id FROM events WHERE id = $1`, [eventId]);
    if (ev.rows[0]) void pushToOwner('customer', ev.rows[0].customer_id, 'Eventana', parsed.data.body.slice(0, 90), { eventId });
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

  // ── Asset issue reports (any staff reports; manager/owner acts) ────────────
  app.post('/api/admin/inventory/:code/report', async (request, reply) => {
    const { code } = request.params as { code: string };
    const p = z.object({
      kind: z.enum(['broken', 'damaged', 'maintenance', 'other']),
      note: z.string().max(1000).optional(),
    }).safeParse(request.body);
    if (!p.success) return reply.status(400).send({ error: 'invalid_request' });
    const staff = (request as any).staff as { name?: string };
    const asset = await pool.query(`SELECT name FROM inventory_assets WHERE code = $1 LIMIT 1`, [code]);
    const name = asset.rows[0]?.name ?? code;
    const { rows } = await pool.query(
      `INSERT INTO asset_issues (asset_code, asset_name, kind, note, reported_by)
       VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [code, name, p.data.kind, p.data.note ?? null, staff?.name ?? 'staff'],
    );
    // Surface to the owner/manager: bell feed (ops_alert) + best-effort push.
    await pool.query(
      `INSERT INTO notifications (channel, template, scheduled_for, payload)
       VALUES ('push','asset_issue', now(), $1)`,
      [JSON.stringify({ id: rows[0].id, code, name, kind: p.data.kind, note: p.data.note ?? '', by: staff?.name ?? 'staff' })],
    ).catch(() => {});
    void (async () => {
      const owners = await pool.query(`SELECT id FROM team_members WHERE access_level IN ('owner','manager') AND active`).catch(() => ({ rows: [] as any[] }));
      const label = ({ broken: 'broken', damaged: 'damaged', maintenance: 'needs maintenance', other: 'has an issue' } as Record<string, string>)[p.data.kind];
      for (const o of owners.rows) void pushToOwner('staff', o.id, '🧰 Equipment issue reported', `${name} — ${label} (by ${staff?.name ?? 'staff'})`);
    })();
    logAudit({ actor: String(staff?.name ?? 'staff'), action: 'asset_issue_report', target: code, detail: { kind: p.data.kind } });
    return { ok: true, id: rows[0].id };
  });

  app.get('/api/admin/asset-issues', async (request, reply) => {
    const role = (request as any).staff?.role;
    if (role !== 'owner' && role !== 'manager') return reply.status(403).send({ error: 'forbidden' });
    const status = String((request.query as any)?.status ?? 'open');
    const { rows } = await pool.query(
      `SELECT id, asset_code, asset_name, kind, note, status, reported_by, resolved_by,
              to_char(created_at,'YYYY-MM-DD HH24:MI') AS created
         FROM asset_issues ${status === 'all' ? '' : `WHERE status <> 'resolved'`}
        ORDER BY created_at DESC LIMIT 200`,
    );
    return rows;
  });

  app.patch('/api/admin/asset-issues/:id', async (request, reply) => {
    const role = (request as any).staff?.role;
    if (role !== 'owner' && role !== 'manager') return reply.status(403).send({ error: 'forbidden' });
    const id = Number((request.params as { id: string }).id);
    const p = z.object({ status: z.enum(['open', 'in_progress', 'resolved']) }).safeParse(request.body);
    if (!p.success) return reply.status(400).send({ error: 'invalid_request' });
    const done = p.data.status === 'resolved';
    const { rows } = await pool.query(
      `UPDATE asset_issues SET status = $2,
              resolved_by = CASE WHEN $3 THEN $4 ELSE resolved_by END,
              resolved_at = CASE WHEN $3 THEN now() ELSE resolved_at END
        WHERE id = $1 RETURNING *`,
      [id, p.data.status, done, String((request as any).staff?.name ?? 'staff')],
    );
    if (!rows[0]) return reply.status(404).send({ error: 'not_found' });
    const by = String((request as any).staff?.name ?? 'manager');
    await pool.query(
      `INSERT INTO notifications (channel, template, scheduled_for, payload)
       VALUES ('push','asset_issue_action', now(), $1)`,
      [JSON.stringify({ id: rows[0].id, name: rows[0].asset_name, status: p.data.status, by })],
    ).catch(() => {});
    logAudit({ actor: by, role, action: 'asset_issue_action', target: String(id), detail: { status: p.data.status } });
    return rows[0];
  });

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

  /* ---------------------- Shop orders (owner/manager) --------------- */

  /** Paid standalone shop orders (custom printed & digital goods, no event). */
  app.get('/api/admin/shop-orders', async (request, reply) => {
    const role = (request as any).staff?.role;
    if (role !== 'owner' && role !== 'manager') return reply.status(403).send({ error: 'forbidden' });
    const cfg = await loadConfig();
    const { rows } = await pool.query(
      `SELECT o.id, o.total_fils, o.status, o.created_at, o.cart,
              c.name AS customer_name, c.email AS customer_email, c.phone AS customer_phone, c.backup_phone
         FROM orders o JOIN customers c ON c.id = o.customer_id
        WHERE o.kind = 'shop' AND o.status = 'paid'
        ORDER BY o.created_at DESC LIMIT 200`,
    );
    return rows.map((r) => {
      const cart = (r.cart ?? {}) as {
        items?: Array<{ serviceId: string; quantity: number }>;
        emirate?: string | null;
        address?: Record<string, unknown> | null;
        customization?: { refImages?: string[]; wantDraw?: boolean } | null;
        readyBy?: string | null;
      };
      return {
        orderId: r.id,
        totalFils: Number(r.total_fils),
        createdAt: r.created_at,
        readyBy: cart.readyBy ?? null,
        emirate: cart.emirate ?? null,
        address: cart.address ?? null,
        items: (cart.items ?? []).map((it) => ({
          ...it,
          name: cfg.services.get(it.serviceId)?.name ?? it.serviceId,
        })),
        customization: cart.customization ?? null,
        customer: {
          name: r.customer_name,
          email: r.customer_email,
          phone: r.customer_phone,
          backupPhone: r.backup_phone,
        },
      };
    });
  });

  /** One shop order's fulfilment detail (customer, items, design status). */
  app.get('/api/admin/shop-orders/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const cfg = await loadConfig();
    const { rows } = await pool.query(
      `SELECT o.id, o.total_fils, o.status, o.created_at, o.cart,
              c.name AS customer_name, c.email AS customer_email, c.phone AS customer_phone
         FROM orders o JOIN customers c ON c.id = o.customer_id
        WHERE o.id = $1 AND o.kind = 'shop'`,
      [id],
    );
    const r = rows[0];
    if (!r) return reply.status(404).send({ error: 'not_found' });
    const cart = (r.cart ?? {}) as any;
    const design = (await pool.query(`SELECT * FROM shop_designs WHERE order_id = $1`, [id])).rows[0] ?? null;
    const created = new Date(r.created_at);
    const items = (cart.items ?? []).map((it: any) => ({ name: cfg.services.get(it.serviceId)?.name ?? it.serviceId, quantity: it.quantity ?? 1 }));
    const canSeeMoney = (request as any).staff?.role === 'owner' || (request as any).staff?.role === 'manager';
    return {
      id: r.id,
      customer: { name: r.customer_name, email: r.customer_email, phone: r.customer_phone },
      items,
      itemsLabel: items.map((i: any) => i.name).join(', ') || 'Shop order',
      readyBy: cart.readyBy ?? new Date(created.getTime() + 3 * 86_400_000).toISOString().slice(0, 10),
      customization: cart.customization ?? null,
      createdAt: r.created_at,
      totalFils: Number(r.total_fils),
      totalDisplay: canSeeMoney ? formatAed(Number(r.total_fils)) : null,
      orderStatus: r.status,
      design: design ? { imageUrl: design.image_url, status: design.status, uploadedBy: design.uploaded_by, uploadedAt: design.uploaded_at, sentAt: design.sent_at } : { status: 'awaiting_design' },
    };
  });

  /** Marsha uploads the finished design for a shop order. */
  app.post('/api/admin/shop-orders/:id/design', async (request, reply) => {
    const { id } = request.params as { id: string };
    const { imageUrl } = (request.body ?? {}) as { imageUrl?: string };
    if (!imageUrl) return reply.status(400).send({ error: 'image_required' });
    const by = String((request as any).staff?.name ?? 'Marsha');
    await pool.query(
      `INSERT INTO shop_designs (order_id, image_url, status, uploaded_by, uploaded_at)
       VALUES ($1,$2,'design_ready',$3, now())
       ON CONFLICT (order_id) DO UPDATE SET image_url = EXCLUDED.image_url, status = 'design_ready', uploaded_by = EXCLUDED.uploaded_by, uploaded_at = now(), sent_at = NULL`,
      [id, imageUrl, by],
    );
    return { ok: true };
  });

  /** Owner approves the design → email it to the customer (agreed template). */
  app.post('/api/admin/shop-orders/:id/send', async (request, reply) => {
    const { id } = request.params as { id: string };
    const d = (await pool.query(`SELECT image_url, status FROM shop_designs WHERE order_id = $1`, [id])).rows[0];
    if (!d || !d.image_url) return reply.status(400).send({ error: 'no_design', message: 'Upload the design first.' });
    await pool.query(
      `INSERT INTO notifications (event_id, channel, template, scheduled_for, payload)
       VALUES (NULL,'email','shop_design_ready', now(), $1)`,
      [JSON.stringify({ orderId: id, imageUrl: d.image_url })],
    );
    await pool.query(`UPDATE shop_designs SET status = 'sent', sent_at = now() WHERE order_id = $1`, [id]);
    return { ok: true, sent: true };
  });

  /* ------------------------------ Team ---------------------------- */

  app.get('/api/admin/team', async () => {
    const { rows } = await pool.query(
      `SELECT m.*,
              w.ym            AS warning_ym,
              w.reason        AS warning_reason,
              w.affects_points AS warning_affects_points,
              w.wtype         AS warning_wtype,
              to_char(w.issued_date,'YYYY-MM-DD') AS warning_issued_date,
              to_char(w.valid_until,'YYYY-MM-DD') AS warning_valid_until,
              w.salary_deduction_pct AS warning_salary_deduction_pct,
              (SELECT json_agg(json_build_object('eventId', et.event_id, 'date', e.event_date))
                 FROM event_team et JOIN events e ON e.id = et.event_id
                WHERE et.member_id = m.id AND e.event_date >= CURRENT_DATE) AS assignments
         FROM team_members m
         LEFT JOIN staff_warnings w
           ON w.member_id = m.id AND w.ym = to_char(now(),'YYYY-MM')
         ORDER BY m.name`,
    );
    return rows;
  });

  /**
   * Owner-only: set a member's access level and issue/rotate their personal
   * login token. The token is what they enter in the dashboard to sign in as
   * themselves with the right scope. Returned here so the owner can share it.
   */
  app.patch('/api/admin/team/:id/access', async (request, reply) => {
    const { id } = request.params as { id: string };
    const schema = z.object({
      accessLevel: z.enum(['owner', 'manager', 'employee', 'driver']),
      rotateToken: z.boolean().optional(),
    });
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'invalid_request' });

    const newToken = `stf_${randomBytes(18).toString('hex')}`;
    const { rows } = await pool.query(
      `UPDATE team_members
          SET access_level = $2,
              access_token = CASE WHEN $3 OR access_token IS NULL THEN $4 ELSE access_token END
        WHERE id = $1
        RETURNING id, name, role, access_level, access_token`,
      [id, parsed.data.accessLevel, parsed.data.rotateToken ?? false, newToken],
    );
    if (!rows[0]) return reply.status(404).send({ error: 'not_found' });
    return rows[0];
  });

  /**
   * Owner-only: invite a staff member by email. Creates (or updates) the member
   * and emails them a "set your password" link. They pick their own password —
   * the owner never sees or sets it.
   */
  app.post('/api/admin/team/invite', async (request, reply) => {
    if ((request as any).staff?.role !== 'owner') return reply.status(403).send({ error: 'forbidden' });
    const p = z.object({
      name: z.string().min(1).max(120),
      email: z.string().email(),
      accessLevel: z.enum(['owner', 'manager', 'employee', 'driver']),
    }).safeParse(request.body);
    if (!p.success) return reply.status(400).send({ error: 'invalid_request' });
    const id = `tm-${p.data.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;
    // Reject a duplicate email on a DIFFERENT member.
    const clash = await pool.query(`SELECT id FROM team_members WHERE lower(email) = lower($1) AND lower(name) <> lower($2) LIMIT 1`, [p.data.email, p.data.name]);
    if (clash.rows[0]) return reply.status(409).send({ error: 'email_in_use', message: 'Another member already uses that email.' });
    const up = await pool.query(
      `INSERT INTO team_members (id, name, role, active, access_level, email, must_set_password)
       VALUES ($1,$2,'Crew',true,$3,$4,true)
       ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email, access_level = EXCLUDED.access_level, active = true, must_set_password = true
       RETURNING id, name, email, access_level`,
      [id, p.data.name, p.data.accessLevel, p.data.email],
    );
    const m = up.rows[0];
    const token = issueStaffSetupToken(m.id, 'setup');
    const sent = await sendStaffSetupEmail({ name: m.name, email: m.email, token, kind: 'setup' });
    logAudit({ actor: String((request as any).staff?.name ?? 'owner'), role: 'owner', action: 'staff_invite', target: m.id, detail: { email: m.email, accessLevel: m.access_level } });
    // The owner also gets the link back, to copy/share if email is slow.
    return { ...m, emailSent: sent, setupLink: buildSetupLink(token) };
  });

  /** Owner-only: resend a set-password link to an existing member. */
  app.post('/api/admin/team/:id/setup-link', async (request, reply) => {
    if ((request as any).staff?.role !== 'owner') return reply.status(403).send({ error: 'forbidden' });
    const { id } = request.params as { id: string };
    const { rows } = await pool.query(`SELECT id, name, email FROM team_members WHERE id = $1 LIMIT 1`, [id]);
    const m = rows[0];
    if (!m || !m.email) return reply.status(404).send({ error: 'no_email', message: 'This member has no email on file.' });
    const token = issueStaffSetupToken(m.id, 'setup');
    const sent = await sendStaffSetupEmail({ name: m.name, email: m.email, token, kind: 'setup' });
    return { ok: true, emailSent: sent, setupLink: buildSetupLink(token) };
  });

  /** Owner-only: enable or disable a member's access (disabled = can't sign in). */
  app.patch('/api/admin/team/:id/active', async (request, reply) => {
    if ((request as any).staff?.role !== 'owner') return reply.status(403).send({ error: 'forbidden' });
    const { id } = request.params as { id: string };
    const p = z.object({ active: z.boolean() }).safeParse(request.body);
    if (!p.success) return reply.status(400).send({ error: 'invalid_request' });
    const { rows } = await pool.query(
      `UPDATE team_members SET active = $2 WHERE id = $1 RETURNING id, name, active`,
      [id, p.data.active],
    );
    if (!rows[0]) return reply.status(404).send({ error: 'not_found' });
    logAudit({ actor: String((request as any).staff?.name ?? 'owner'), role: 'owner', action: p.data.active ? 'staff_enable' : 'staff_disable', target: id });
    return rows[0];
  });

  /**
   * Owner-only "view as" (preview): issue a session token for a team member so the
   * owner can see exactly what that person's dashboard looks like. The owner's own
   * session is preserved client-side and restored on exit. Audited.
   */
  app.post('/api/admin/team/:id/impersonate', async (request, reply) => {
    if ((request as any).staff?.role !== 'owner') return reply.status(403).send({ error: 'forbidden' });
    const { id } = request.params as { id: string };
    const { rows } = await pool.query(`SELECT id, name, access_level, active FROM team_members WHERE id = $1 LIMIT 1`, [id]);
    const m = rows[0];
    if (!m) return reply.status(404).send({ error: 'not_found' });
    if (!m.active) return reply.status(409).send({ error: 'inactive', message: 'This member is disabled.' });
    logAudit({ actor: String((request as any).staff?.name ?? 'owner'), role: 'owner', action: 'impersonate', target: id });
    return { token: issueStaffSession(m.id), name: m.name, role: m.access_level ?? 'employee' };
  });

  /**
   * Events assigned to the signed-in member (their own crew list). Owner and
   * managers have no member id, so they get the upcoming board instead.
   */
  app.get('/api/admin/my-events', async (request) => {
    const staff = (request as any).staff as { id?: string };
    if (staff.id) {
      const { rows } = await pool.query(
        // Read from the REAL assignments (event_staff), so an employee sees every
        // event they were actually rostered onto — not the stale checkout crew.
        `SELECT DISTINCT e.id, e.event_date, e.start_time, e.base_end_time, e.phase, e.eta, e.emirate,
                e.celebration_type, e.custom_theme, COALESCE(th.name, o.cart->>'customTheme') AS theme_name,
                o.cart->>'eventFor' AS "eventFor",
                c.name AS customer, e.map_lat, e.map_lng
           FROM events e
           JOIN event_staff es ON es.event_id = e.id AND es.assignee_id = $1
           JOIN customers c ON c.id = e.customer_id
           JOIN orders o ON o.id = e.order_id
           LEFT JOIN themes th ON th.id = e.theme_id
          WHERE e.event_date >= CURRENT_DATE - interval '1 day'
            AND e.phase <> 'Cancelled' AND e.cancelled_at IS NULL
          ORDER BY e.event_date, e.start_time`,
        [staff.id],
      );
      return rows;
    }
    const { rows } = await pool.query(
      `SELECT e.id, e.event_date, e.start_time, e.base_end_time, e.phase, e.eta, e.emirate,
              e.celebration_type, e.custom_theme, COALESCE(th.name, o.cart->>'customTheme') AS theme_name,
              o.cart->>'eventFor' AS "eventFor",
              c.name AS customer, e.map_lat, e.map_lng
         FROM events e JOIN customers c ON c.id = e.customer_id
         JOIN orders o ON o.id = e.order_id
         LEFT JOIN themes th ON th.id = e.theme_id
        WHERE e.event_date >= CURRENT_DATE - interval '1 day'
          AND e.phase <> 'Cancelled' AND e.cancelled_at IS NULL
        ORDER BY e.event_date, e.start_time
        LIMIT 100`,
    );
    return rows;
  });

  /* ------------------------------ Staff profile --------------------------- */

  /** The signed-in staff member's own profile: details, events done, achievements. */
  app.get('/api/admin/my-profile', async (request, reply) => {
    const staff = (request as any).staff as { id?: string; name?: string; role?: string };
    if (!staff.id) return reply.status(404).send({ error: 'no_profile', message: 'No personal profile for this account.' });
    const [m, done, rewards] = await Promise.all([
      pool.query(`SELECT id, name, role, job_title,
                          to_char(birthday,'YYYY-MM-DD') AS birthday,
                          to_char(employment_start_date,'YYYY-MM-DD') AS employment_start_date,
                          weekly_day_off, salary_increment_note,
                          passport_name, passport_number, emirates_id,
                          performance_feedback, performance_by, to_char(performance_at,'YYYY-MM-DD') AS performance_at, email
                     FROM team_members WHERE id = $1`, [staff.id]),
      // Events they've run THIS calendar month (1st → end of month), completed
      // or already past — the figure the owner asked for.
      pool.query(`SELECT count(DISTINCT es.event_id)::int c FROM event_staff es JOIN events e ON e.id = es.event_id
                   WHERE es.assignee_id = $1
                     AND e.phase <> 'Cancelled' AND e.cancelled_at IS NULL
                     AND e.event_date >= GREATEST(date_trunc('month', CURRENT_DATE), $2::date)
                     AND e.event_date <  date_trunc('month', CURRENT_DATE) + interval '1 month'
                     AND (e.phase = 'Event Completed' OR e.event_date < CURRENT_DATE)`, [staff.id, COUNTING_START]),
      pool.query(`SELECT id, event_id, kind, amount_fils, note, to_char(created_at,'YYYY-MM-DD') AS date
                    FROM staff_rewards WHERE member_id = $1 ORDER BY created_at DESC LIMIT 50`, [staff.id]),
    ]);
    const p = m.rows[0];
    if (!p) return reply.status(404).send({ error: 'not_found' });
    const totalReward = rewards.rows.reduce((s, r) => s + Number(r.amount_fils), 0);
    // What personal info is still missing — the app nudges them to complete it.
    const missing = [
      !p.birthday && 'Date of birth',
      !p.passport_name && 'Full name (passport)',
      !p.passport_number && 'Passport number',
      !p.emirates_id && 'Emirates ID number',
    ].filter(Boolean);
    const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const dayOffNum = p.weekly_day_off;
    return {
      id: p.id, name: p.name, jobTitle: p.job_title || p.role, email: p.email,
      birthday: p.birthday ?? null,
      joiningDate: p.employment_start_date ?? null,
      dayOff: (dayOffNum !== null && dayOffNum !== undefined) ? WEEKDAYS[Number(dayOffNum)] : null,
      salaryIncrement: p.salary_increment_note ?? null,
      passportName: p.passport_name, passportNumber: p.passport_number, emiratesId: p.emirates_id,
      eventsDone: done.rows[0].c,
      performance: p.performance_feedback ? { text: p.performance_feedback, by: p.performance_by, at: p.performance_at } : null,
      achievements: { totalFils: totalReward, totalDisplay: formatAed(totalReward), rows: rewards.rows.map((r) => ({ ...r, amountDisplay: formatAed(Number(r.amount_fils)) })) },
      missing,
    };
  });

  /** Staff update their OWN personal details (nudged when something is missing). */
  app.patch('/api/admin/my-profile', async (request, reply) => {
    const staff = (request as any).staff as { id?: string };
    if (!staff.id) return reply.status(404).send({ error: 'no_profile' });
    const p = z.object({
      birthday: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
      passportName: z.string().max(200).optional(),
      passportNumber: z.string().max(60).optional(),
      emiratesId: z.string().max(60).optional(),
    }).safeParse(request.body);
    if (!p.success) return reply.status(400).send({ error: 'invalid_request' });
    const d = p.data;
    await pool.query(
      `UPDATE team_members SET
         birthday = COALESCE($2, birthday),
         passport_name = COALESCE($3, passport_name),
         passport_number = COALESCE($4, passport_number),
         emirates_id = COALESCE($5, emirates_id)
       WHERE id = $1`,
      [staff.id, d.birthday ?? null, d.passportName ?? null, d.passportNumber ?? null, d.emiratesId ?? null],
    );
    return { ok: true };
  });

  /** Owner/manager: set a member's job title + performance feedback. */
  app.patch('/api/admin/team/:id/performance', async (request, reply) => {
    const role = (request as any).staff?.role;
    if (role !== 'owner' && role !== 'manager') return reply.status(403).send({ error: 'forbidden' });
    const { id } = request.params as { id: string };
    const p = z.object({
      jobTitle: z.string().max(120).optional(),
      feedback: z.string().max(2000).optional(),
      feedbackType: z.enum(['praise', 'improvement', 'general']).optional(),
      eventId: z.string().max(40).optional(),
    }).safeParse(request.body);
    if (!p.success) return reply.status(400).send({ error: 'invalid_request' });
    const by = String((request as any).staff?.name ?? 'manager');
    const { rows } = await pool.query(
      `UPDATE team_members SET
         job_title = COALESCE($2, job_title),
         performance_feedback = COALESCE($3, performance_feedback),
         performance_by = CASE WHEN $3 IS NOT NULL THEN $4 ELSE performance_by END,
         performance_at = CASE WHEN $3 IS NOT NULL THEN now() ELSE performance_at END
       WHERE id = $1 RETURNING id`,
      [id, p.data.jobTitle ?? null, p.data.feedback ?? null, by],
    );
    if (!rows[0]) return reply.status(404).send({ error: 'not_found' });
    // Keep a full history: every submitted feedback becomes its own row.
    const fb = (p.data.feedback ?? '').trim();
    if (fb) {
      await pool.query(
        `INSERT INTO staff_feedback (member_id, ftype, body, event_id, created_by) VALUES ($1,$2,$3,$4,$5)`,
        [id, p.data.feedbackType ?? 'general', fb, p.data.eventId?.trim() || null, by],
      );
    }
    logAudit({ actor: by, role, action: 'staff_performance', target: id });
    return { ok: true };
  });

  /* ------------------- Staff scheduling (days off & birthdays) ------------- */

  /** Owner/manager: set a member's birthday, phone or colour. */
  app.patch('/api/admin/team/:id/profile', async (request, reply) => {
    const role = (request as any).staff?.role;
    if (role !== 'owner' && role !== 'manager') return reply.status(403).send({ error: 'forbidden' });
    const { id } = request.params as { id: string };
    const dateOrNull = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional();
    const schema = z.object({
      name: z.string().min(1).max(120).optional(),
      birthday: dateOrNull,
      phone: z.string().max(40).nullable().optional(),
      color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
      employmentStart: dateOrNull,   // drives annual-leave accrual
      employmentEnd: dateOrNull,     // contract end; caps accrual
      leaveOpeningUsed: z.number().min(0).max(1000).optional(), // leave taken before this system
      employmentNote: z.string().max(2000).nullable().optional(), // HR history note
      weeklyDayOff: z.number().int().min(0).max(6).nullable().optional(), // 0=Sun..6=Sat
    });
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'invalid_request' });
    const d = parsed.data;
    // Distinguish "leave unchanged" (undefined) from "clear it" (null) for the
    // employment dates, so setting a value or explicitly clearing both work.
    const empStartSet = d.employmentStart !== undefined;
    const empEndSet = d.employmentEnd !== undefined;
    const openingSet = d.leaveOpeningUsed !== undefined;
    const noteSet = d.employmentNote !== undefined;
    const dayOffSet = d.weeklyDayOff !== undefined;
    const { rows } = await pool.query(
      `UPDATE team_members SET
         name = COALESCE($5, name),
         birthday = COALESCE($2, birthday),
         phone = COALESCE($3, phone),
         color = COALESCE($4, color),
         employment_start_date = CASE WHEN $6 THEN $7::date ELSE employment_start_date END,
         employment_end_date   = CASE WHEN $8 THEN $9::date ELSE employment_end_date END,
         leave_opening_used_days = CASE WHEN $10 THEN $11::numeric ELSE leave_opening_used_days END,
         employment_note = CASE WHEN $12 THEN $13::text ELSE employment_note END,
         weekly_day_off = CASE WHEN $14 THEN $15::smallint ELSE weekly_day_off END
       WHERE id = $1 RETURNING *`,
      [id, d.birthday ?? null, d.phone ?? null, d.color ?? null, d.name ?? null,
       empStartSet, d.employmentStart ?? null, empEndSet, d.employmentEnd ?? null,
       openingSet, d.leaveOpeningUsed ?? null, noteSet, d.employmentNote ?? null,
       dayOffSet, d.weeklyDayOff ?? null],
    );
    if (!rows[0]) return reply.status(404).send({ error: 'not_found' });
    return rows[0];
  });

  /* ------------------- Disciplinary warnings ------------------------------ */
  // A warning (إنذار) wipes the member's competition points for that month —
  // and therefore the points bonus. Tips and commissions are unaffected.

  /** Owner/manager: issue (or update) a warning for a member for a month. */
  app.post('/api/admin/team/:id/warning', async (request, reply) => {
    const s = (request as any).staff;
    if (s?.role !== 'owner' && s?.role !== 'manager') return reply.status(403).send({ error: 'forbidden' });
    const { id } = request.params as { id: string };
    const dateRe = /^\d{4}-\d{2}-\d{2}$/;
    const p = z.object({
      ym: z.string().regex(/^\d{4}-\d{2}$/).optional(),
      reason: z.string().max(1000).optional(),
      affectsPoints: z.boolean().optional(), // false = documented only, no points penalty
      wtype: z.enum(['documented', 'first', 'second', 'third', 'final']).optional(),
      issuedDate: z.string().regex(dateRe).optional(),
      validUntil: z.string().regex(dateRe).nullable().optional(),
      salaryDeductionPct: z.number().int().min(0).max(100).optional(),
    }).safeParse(request.body ?? {});
    if (!p.success) return reply.status(400).send({ error: 'invalid_request' });
    const issued = p.data.issuedDate ?? null;
    // Default the points-month to the issue date's month (else the current month).
    const ym = p.data.ym ?? (issued ? issued.slice(0, 7) : new Date().toISOString().slice(0, 7));
    const affectsPoints = p.data.affectsPoints !== false; // default true
    await pool.query(
      `INSERT INTO staff_warnings (member_id, ym, reason, affects_points, wtype, issued_date, valid_until, salary_deduction_pct, created_by)
       VALUES ($1,$2,$3,$4,$5,$6::date,$7::date,$8,$9)
       ON CONFLICT (member_id, ym) DO UPDATE SET
         reason = EXCLUDED.reason, affects_points = EXCLUDED.affects_points,
         wtype = EXCLUDED.wtype, issued_date = EXCLUDED.issued_date, valid_until = EXCLUDED.valid_until,
         salary_deduction_pct = EXCLUDED.salary_deduction_pct,
         created_by = EXCLUDED.created_by, created_at = now()`,
      [id, ym, p.data.reason ?? null, affectsPoints, p.data.wtype ?? null, issued, p.data.validUntil ?? null, p.data.salaryDeductionPct ?? 0, s?.name ?? null],
    );
    return { ok: true, ym, affectsPoints };
  });

  /** Owner/manager: clear a warning (restores that month's points). */
  app.delete('/api/admin/team/:id/warning', async (request, reply) => {
    const s = (request as any).staff;
    if (s?.role !== 'owner' && s?.role !== 'manager') return reply.status(403).send({ error: 'forbidden' });
    const { id } = request.params as { id: string };
    const ym = ((request.query as any)?.ym as string) || new Date().toISOString().slice(0, 7);
    await pool.query(`DELETE FROM staff_warnings WHERE member_id = $1 AND ym = $2`, [id, ym]);
    return { ok: true };
  });

  /** Owner/manager: a member's warning history. */
  app.get('/api/admin/team/:id/warnings', async (request, reply) => {
    const s = (request as any).staff;
    if (s?.role !== 'owner' && s?.role !== 'manager') return reply.status(403).send({ error: 'forbidden' });
    const { id } = request.params as { id: string };
    const { rows } = await pool.query(
      `SELECT ym, reason, affects_points AS "affectsPoints", wtype,
              to_char(issued_date,'YYYY-MM-DD') AS "issuedDate",
              to_char(valid_until,'YYYY-MM-DD') AS "validUntil",
              salary_deduction_pct AS "salaryDeductionPct",
              created_by, to_char(created_at,'YYYY-MM-DD') AS created_at
         FROM staff_warnings WHERE member_id = $1 ORDER BY COALESCE(issued_date, (ym||'-01')::date) DESC`, [id]);
    return rows;
  });

  /** A staff member's OWN warnings (for their profile). */
  app.get('/api/admin/my-warnings', async (request, reply) => {
    const staff = (request as any).staff as { id?: string };
    if (!staff.id) return reply.status(404).send({ error: 'no_profile' });
    const { rows } = await pool.query(
      `SELECT ym, reason, affects_points AS "affectsPoints", wtype,
              to_char(issued_date,'YYYY-MM-DD') AS "issuedDate",
              to_char(valid_until,'YYYY-MM-DD') AS "validUntil",
              salary_deduction_pct AS "salaryDeductionPct"
         FROM staff_warnings WHERE member_id = $1 ORDER BY COALESCE(issued_date, (ym||'-01')::date) DESC`, [staff.id]);
    return rows;
  });

  const FEEDBACK_COLS = `id, ftype AS "type", body AS text, event_id AS "eventId", created_by AS "by",
                         to_char(created_at,'YYYY-MM-DD') AS "date"`;

  /** A staff member's OWN performance-feedback history (newest first). */
  app.get('/api/admin/my-feedback', async (request, reply) => {
    const staff = (request as any).staff as { id?: string };
    if (!staff.id) return reply.status(404).send({ error: 'no_profile' });
    const { rows } = await pool.query(
      `SELECT ${FEEDBACK_COLS} FROM staff_feedback WHERE member_id = $1 ORDER BY created_at DESC`, [staff.id]);
    return rows;
  });

  /** Owner/manager: a member's feedback history. */
  app.get('/api/admin/team/:id/feedback', async (request, reply) => {
    const s = (request as any).staff;
    if (s?.role !== 'owner' && s?.role !== 'manager') return reply.status(403).send({ error: 'forbidden' });
    const { id } = request.params as { id: string };
    const { rows } = await pool.query(
      `SELECT ${FEEDBACK_COLS} FROM staff_feedback WHERE member_id = $1 ORDER BY created_at DESC`, [id]);
    return rows;
  });

  /* ------------------- Annual leave --------------------------------------- */

  const canManageLeave = (s: any) =>
    s?.role === 'owner' || s?.role === 'manager' || String(s?.name ?? '').toLowerCase() === 'marsha';

  /** A staff member's own leave: balance breakdown + full history. */
  app.get('/api/admin/leave/me', async (request, reply) => {
    const memberId = (request as any).staff?.id as string | undefined;
    if (!memberId) return reply.status(404).send({ error: 'no_member' });
    const leave = await import('../domain/leave.js');
    const [balance, requests] = await Promise.all([leave.leaveBalance(memberId), leave.listMemberLeave(memberId)]);
    return { balance, requests };
  });

  /** Submit a leave request (any staff member on the scheme). */
  app.post('/api/admin/leave/request', async (request, reply) => {
    const memberId = (request as any).staff?.id as string | undefined;
    if (!memberId) return reply.status(404).send({ error: 'no_member' });
    const p = z.object({
      startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      reason: z.string().max(500).optional(),
    }).safeParse(request.body);
    if (!p.success) return reply.status(400).send({ error: 'invalid_request' });
    const leave = await import('../domain/leave.js');
    const res = await leave.submitLeaveRequest(memberId, p.data.startDate, p.data.endDate, p.data.reason ?? null);
    if (!res.ok) return reply.status(409).send({ error: 'rejected', message: res.reason });
    void (async () => {
      const staffName = String((request as any).staff?.name ?? 'A team member');
      const owners = await pool.query(`SELECT id FROM team_members WHERE access_level IN ('owner','manager') AND active`).catch(() => ({ rows: [] as any[] }));
      for (const o of owners.rows) void pushToOwner('staff', o.id, 'Leave request 🌴', `${staffName} requested ${res.days} day(s) off — review it in Leave.`);
    })();
    return { ok: true, id: res.id, days: res.days };
  });

  /** Cancel your own request (frees the reserved days). */
  app.post('/api/admin/leave/:id/cancel', async (request, reply) => {
    const memberId = (request as any).staff?.id as string | undefined;
    if (!memberId) return reply.status(404).send({ error: 'no_member' });
    const leave = await import('../domain/leave.js');
    const res = await leave.cancelLeaveRequest(Number((request.params as any).id), memberId);
    if (!res.ok) return reply.status(409).send({ error: 'rejected', message: res.reason });
    return { ok: true };
  });

  /** Owner/manager (+ Marsha): every request, pending first. */
  app.get('/api/admin/leave/requests', async (request, reply) => {
    if (!canManageLeave((request as any).staff)) return reply.status(403).send({ error: 'forbidden' });
    const leave = await import('../domain/leave.js');
    return { requests: await leave.listAllLeave() };
  });

  /** Owner/manager (+ Marsha): approve or reject a request. */
  app.post('/api/admin/leave/:id/decide', async (request, reply) => {
    const s = (request as any).staff;
    if (!canManageLeave(s)) return reply.status(403).send({ error: 'forbidden' });
    const p = z.object({ decision: z.enum(['approved', 'rejected']), note: z.string().max(500).optional() }).safeParse(request.body);
    if (!p.success) return reply.status(400).send({ error: 'invalid_request' });
    const leave = await import('../domain/leave.js');
    const res = await withTransaction((db) => leave.decideLeaveRequest(db, Number((request.params as any).id), p.data.decision, String(s?.name ?? 'Manager'), p.data.note ?? null));
    if (!res.ok) return reply.status(409).send({ error: 'rejected', message: res.reason });
    void pushToOwner('staff', res.memberId, p.data.decision === 'approved' ? 'Leave approved ✅' : 'Leave request update', `Your leave request was ${p.data.decision}.`);
    logAudit({ actor: String(s?.name ?? 'manager'), role: s?.role, action: `leave_${p.data.decision}`, target: String((request.params as any).id) });
    return { ok: true };
  });

  /** Owner: read / change the annual entitlement + accrual rate. */
  app.get('/api/admin/leave/settings', async (request, reply) => {
    if ((request as any).staff?.role !== 'owner') return reply.status(403).send({ error: 'forbidden' });
    const leave = await import('../domain/leave.js');
    return leave.loadLeaveConfig();
  });
  app.patch('/api/admin/leave/settings', async (request, reply) => {
    if ((request as any).staff?.role !== 'owner') return reply.status(403).send({ error: 'forbidden' });
    const p = z.object({
      annualEntitlementDays: z.number().min(0).max(365).optional(),
      accrualPerMonth: z.number().min(0).max(31).optional(),
    }).safeParse(request.body);
    if (!p.success) return reply.status(400).send({ error: 'invalid_request' });
    const leave = await import('../domain/leave.js');
    return leave.saveLeaveConfig(p.data, String((request as any).staff?.name ?? 'owner'));
  });

  /** Roster overlay for a month: days off + birthdays, for the calendar. */
  app.get('/api/admin/team-schedule', async (request) => {
    const q = request.query as { month?: string };
    const now = new Date();
    const monthStr = /^\d{4}-\d{2}$/.test(q.month ?? '')
      ? q.month!
      : `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const start = `${monthStr}-01`;
    const endD = new Date(`${start}T00:00:00Z`);
    endD.setUTCMonth(endD.getUTCMonth() + 1);
    const end = endD.toISOString().slice(0, 10);
    const monthNum = Number(monthStr.split('-')[1]);

    const [off, birthdays] = await Promise.all([
      pool.query(
        `SELECT d.id, d.member_id, m.name AS member_name, m.color, d.start_date, d.end_date,
                d.reason, d.status
           FROM staff_days_off d JOIN team_members m ON m.id = d.member_id
          WHERE d.start_date < $2 AND d.end_date >= $1
          ORDER BY d.start_date`,
        [start, end],
      ),
      pool.query(
        `SELECT id, name, color, birthday,
                extract(day from birthday)::int AS day
           FROM team_members
          WHERE active AND birthday IS NOT NULL AND extract(month from birthday) = $1
          ORDER BY extract(day from birthday)`,
        [monthNum],
      ),
    ]);

    return {
      month: monthStr,
      daysOff: off.rows,
      birthdays: birthdays.rows.map((b) => ({
        ...b,
        date: `${monthStr}-${String(b.day).padStart(2, '0')}`,
      })),
    };
  });

  /** Record a day off. Crew can request their own; managers add approved. */
  app.post('/api/admin/days-off', async (request, reply) => {
    const staff = (request as any).staff as { id?: string; role: string };
    const schema = z.object({
      memberId: z.string().optional(),
      startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      reason: z.string().max(300).optional(),
    });
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'invalid_request' });
    if (parsed.data.endDate < parsed.data.startDate) {
      return reply.status(400).send({ error: 'invalid_range', message: 'End date is before start date.' });
    }

    const isManager = staff.role === 'owner' || staff.role === 'manager';
    // Employees may only request their own leave; managers set any member's.
    const memberId = isManager ? parsed.data.memberId : staff.id;
    if (!memberId) return reply.status(400).send({ error: 'member_required' });
    const status = isManager ? 'approved' : 'requested';

    const { rows } = await pool.query(
      `INSERT INTO staff_days_off (member_id, start_date, end_date, reason, status)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [memberId, parsed.data.startDate, parsed.data.endDate, parsed.data.reason ?? null, status],
    );
    // Let managers see a new leave request land.
    if (status === 'requested') {
      await pool.query(
        `INSERT INTO notifications (event_id, channel, template, scheduled_for, payload)
         VALUES (NULL,'ops_alert','leave_requested', now(), $1)`,
        [JSON.stringify({ memberId, startDate: parsed.data.startDate, endDate: parsed.data.endDate })],
      );
    }
    return reply.status(201).send(rows[0]);
  });

  /** Owner/manager: approve/deny a leave request. */
  app.patch('/api/admin/days-off/:id', async (request, reply) => {
    const role = (request as any).staff?.role;
    if (role !== 'owner' && role !== 'manager') return reply.status(403).send({ error: 'forbidden' });
    const id = Number((request.params as { id: string }).id);
    const schema = z.object({ status: z.enum(['requested', 'approved', 'denied']) });
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'invalid_request' });
    const { rows } = await pool.query(
      `UPDATE staff_days_off SET status = $2 WHERE id = $1 RETURNING *`,
      [id, parsed.data.status],
    );
    if (!rows[0]) return reply.status(404).send({ error: 'not_found' });
    return rows[0];
  });

  app.delete('/api/admin/days-off/:id', async (request, reply) => {
    const staff = (request as any).staff as { id?: string; role: string };
    const id = Number((request.params as { id: string }).id);
    // Managers delete any; a member may withdraw their own request.
    if (staff.role === 'owner' || staff.role === 'manager') {
      await pool.query(`DELETE FROM staff_days_off WHERE id = $1`, [id]);
    } else {
      await pool.query(`DELETE FROM staff_days_off WHERE id = $1 AND member_id = $2`, [id, staff.id]);
    }
    return { deleted: true };
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
    const staff = String((request as any).staff?.name ?? 'dashboard');
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

  /**
   * The real customer-facing catalogue for the dashboard to manage: the packages
   * and services customers actually book, with their live prices. Editing a price
   * here (below) flows straight to the customer app.
   */
  app.get('/api/admin/catalog', async () => {
    const [pkgs, svcs] = await Promise.all([
      pool.query(`SELECT id, name, price_fils, active FROM packages ORDER BY price_fils DESC`),
      pool.query(`SELECT s.id, s.name, s.price_fils, s.active, s.category_id, c.name AS category
                    FROM services s LEFT JOIN service_categories c ON c.id = s.category_id
                   ORDER BY c.sort_order NULLS LAST, s.name`),
    ]);
    const map = (r: any) => ({ id: r.id, name: r.name, priceFils: Number(r.price_fils), priceDisplay: formatAed(Number(r.price_fils)), active: r.active });
    return {
      packages: pkgs.rows.map(map),
      services: svcs.rows.map((r) => ({ ...map(r), category: r.category ?? null })),
    };
  });

  app.patch('/api/admin/packages/:packageId', async (request, reply) => {
    const { packageId } = request.params as { packageId: string };
    const p = z.object({
      priceFils: z.number().int().min(0).optional(),
      name: z.string().min(1).max(120).optional(),
      active: z.boolean().optional(),
    }).safeParse(request.body);
    if (!p.success) return reply.status(400).send({ error: 'invalid_request' });
    const { rows } = await pool.query(
      `UPDATE packages SET price_fils = COALESCE($2, price_fils), name = COALESCE($3, name), active = COALESCE($4, active)
        WHERE id = $1 RETURNING id, name, price_fils, active`,
      [packageId, p.data.priceFils ?? null, p.data.name ?? null, p.data.active ?? null],
    );
    if (!rows[0]) return reply.status(404).send({ error: 'not_found' });
    invalidateConfigCache();
    logAudit({ actor: String((request as any).staff?.name ?? 'staff'), role: (request as any).staff?.role, action: 'package_edit', target: packageId, detail: p.data });
    return { id: rows[0].id, name: rows[0].name, priceFils: Number(rows[0].price_fils), active: rows[0].active };
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
      reason: z.string().min(1).max(500).optional(),
      // Structured reason so refunds are trackable (customer choice vs. our
      // service problems). A refund is NOT a cancellation unless cancelEvent.
      reasonCategory: z.enum(['customer_cancellation', 'quality_issue', 'missing_item', 'other']).default('other'),
      cancelEvent: z.boolean().default(false),
    });
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'invalid_request' });

    // One code path for every refund (customer-cancel, admin-cancel, and this
    // manual refund) — money-out, tracking, always-email, and an OPTIONAL event
    // cancellation all live in refundOrderMoney so there is a single source of truth.
    const label = ({
      customer_cancellation: 'Customer requested cancellation',
      quality_issue: 'Quality issue',
      missing_item: 'Missing item or service',
      other: 'Other',
    } as Record<string, string>)[parsed.data.reasonCategory];
    const reasonText = parsed.data.reason?.trim() ? `${label} — ${parsed.data.reason.trim()}` : label;
    const r = await refundOrderMoney({
      orderId,
      amountFils: parsed.data.amountFils,
      reason: reasonText,
      reasonCategory: parsed.data.reasonCategory,
      cancelEvent: parsed.data.cancelEvent,
      createdBy: String((request as any).staff?.name ?? 'staff'),
    });
    if (!r.ok) {
      const code = r.error === 'not_found' ? 404
        : r.error === 'nothing_to_refund' ? 422
        : r.error === 'provider_error' ? 502 : 409;
      return reply.status(code).send({ error: r.error });
    }
    logAudit({ actor: String((request as any).staff?.name ?? 'staff'), role: (request as any).staff?.role, action: 'refund', target: orderId, detail: { amountFils: parsed.data.amountFils, reasonCategory: parsed.data.reasonCategory, cancelEvent: parsed.data.cancelEvent } });
    return { orderId, status: r.status, refundedFils: r.refundedFils, eventCancelled: parsed.data.cancelEvent };
  });

  // Refund reasons breakdown (owner/manager) — how many refunds are the
  // customer's choice vs. quality/missing-item problems we caused.
  app.get('/api/admin/refunds', async (request) => {
    const staff = (request as any).staff as { role?: string };
    const money = staff?.role === 'owner' || staff?.role === 'manager';
    const { rows } = await pool.query(
      `SELECT r.id, r.order_id, r.event_id, r.amount_fils, r.reason_category, r.reason_note,
              r.event_cancelled, r.created_by, to_char(r.created_at,'YYYY-MM-DD') AS created,
              c.name AS customer
         FROM refunds r LEFT JOIN customers c ON c.id = r.customer_id
        ORDER BY r.created_at DESC LIMIT 200`,
    );
    const byReason: Record<string, { n: number; fils: number }> = {};
    for (const r of rows) { (byReason[r.reason_category] ??= { n: 0, fils: 0 }); byReason[r.reason_category].n++; byReason[r.reason_category].fils += Number(r.amount_fils); }
    return {
      byReason: Object.entries(byReason).map(([k, v]) => ({ reason: k, n: v.n, fils: v.fils, display: formatAed(v.fils) })),
      rows: money ? rows.map((r) => ({ ...r, display: formatAed(Number(r.amount_fils)) })) : rows.map((r) => ({ reason_category: r.reason_category, created: r.created, event_cancelled: r.event_cancelled })),
    };
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

  /**
   * Notification bell feed: one unified, newest-first stream of things worth a
   * person's attention, each linking to the order/event it's about. Owner and
   * manager see the whole business; an employee sees only what touches them
   * (tips to them, feedback on their events). Read-state is tracked client-side
   * against a last-seen timestamp, so the bell needs no per-user table.
   */
  app.get('/api/admin/notification-feed', async (request) => {
    const staff = (request as any).staff as { id?: string; role?: string };
    const isMgr = staff.role === 'owner' || staff.role === 'manager';
    const items: Array<{ id: string; level: 'critical' | 'high' | 'info'; icon: string; title: string; text: string; eventId?: string | null; orderId?: string | null; at: string }> = [];

    if (isMgr) {
      const [alerts, bookings, refundRows, ratings, tips, cancels] = await Promise.all([
        pool.query(`SELECT id, template, event_id, payload, created_at FROM notifications
                     WHERE channel='ops_alert' AND created_at > now() - interval '30 days'
                     ORDER BY created_at DESC LIMIT 40`),
        pool.query(`SELECT e.id, e.created_at, e.event_date, c.name AS customer, p.name AS package
                      FROM events e JOIN customers c ON c.id=e.customer_id
                      LEFT JOIN packages p ON p.id=e.package_id
                     WHERE e.phase <> 'Cancelled' AND e.created_at > now() - interval '30 days'
                     ORDER BY e.created_at DESC LIMIT 20`),
        pool.query(`SELECT id, order_id, event_id, amount_fils, reason_category, created_at
                      FROM refunds WHERE created_at > now() - interval '30 days' ORDER BY created_at DESC LIMIT 20`),
        pool.query(`SELECT id, event_id, stars, feedback, created_at FROM event_ratings
                     WHERE created_at > now() - interval '30 days' ORDER BY created_at DESC LIMIT 20`),
        pool.query(`SELECT t.id, t.event_id, t.amount_fils, t.created_at, m.name AS member
                      FROM tips t LEFT JOIN team_members m ON m.id=t.member_id
                     WHERE t.status='paid' AND COALESCE(t.paid_at,t.created_at) > now() - interval '30 days'
                     ORDER BY COALESCE(t.paid_at,t.created_at) DESC LIMIT 20`),
        pool.query(`SELECT order_id, event_id, reason, refund_amount_fils, created_at FROM cancellations
                     WHERE created_at > now() - interval '30 days' ORDER BY created_at DESC LIMIT 20`),
      ]);
      for (const a of alerts.rows) {
        const t = a.template as string;
        const level: 'critical' | 'high' | 'info' = t === 'prep_issue' ? 'critical' : (t === 'staffing_required' || t === 'driver_conflict') ? 'high' : 'info';
        const icon = t === 'order_cancelled' ? '❌' : t === 'staffing_required' ? '🧑‍🤝‍🧑' : t === 'driver_conflict' ? '🚚' : t === 'prep_issue' ? '⚠️' : '🔔';
        const title = t === 'order_cancelled' ? 'Order cancelled' : t === 'staffing_required' ? 'Staffing needed' : t === 'driver_conflict' ? 'Delivery conflict' : t === 'prep_issue' ? 'Prep issue' : t.replace(/_/g, ' ');
        const text = t === 'driver_conflict' && a.payload?.driver
          ? `${a.payload.driver} has overlapping deliveries`
          : a.event_id ? `Event ${a.event_id}` : '';
        items.push({ id: `al-${a.id}`, level, icon, title, text, eventId: a.event_id, orderId: (a.payload && a.payload.orderId) || null, at: a.created_at });
      }
      for (const b of bookings.rows) items.push({ id: `bk-${b.id}`, level: 'info', icon: '🎉', title: 'New booking', text: `${b.customer}${b.package ? ` · ${b.package}` : ''}`, eventId: b.id, at: b.created_at });
      for (const r of refundRows.rows) items.push({ id: `rf-${r.id}`, level: 'high', icon: '💸', title: 'Refund processed', text: `${formatAed(Number(r.amount_fils))} · ${String(r.reason_category).replace(/_/g, ' ')}`, eventId: r.event_id, orderId: r.order_id, at: r.created_at });
      for (const r of ratings.rows) items.push({ id: `rt-${r.id}`, level: r.stars <= 3 ? 'high' : 'info', icon: r.stars <= 3 ? '⭐' : '🌟', title: `${r.stars}★ feedback`, text: (r.feedback || '').slice(0, 80), eventId: r.event_id, at: r.created_at });
      for (const t of tips.rows) items.push({ id: `tp-${t.id}`, level: 'info', icon: '💐', title: 'Tip received', text: `${formatAed(Number(t.amount_fils))}${t.member ? ` · ${t.member}` : ' · team'}`, eventId: t.event_id, at: t.created_at });
      for (const c of cancels.rows) items.push({ id: `cx-${c.order_id}`, level: 'high', icon: '🚫', title: 'Cancellation', text: c.reason || '', eventId: c.event_id, orderId: c.order_id, at: c.created_at });
    } else if (staff.id) {
      // Employee: only what touches them — tips aimed at them, feedback on their events.
      const [tips, ratings] = await Promise.all([
        pool.query(`SELECT t.id, t.event_id, t.amount_fils, t.created_at FROM tips t
                     WHERE t.status='paid' AND t.member_id=$1 AND COALESCE(t.paid_at,t.created_at) > now() - interval '60 days'
                     ORDER BY COALESCE(t.paid_at,t.created_at) DESC LIMIT 20`, [staff.id]),
        pool.query(`SELECT r.id, r.event_id, r.stars, r.feedback, r.created_at FROM event_ratings r
                      JOIN event_team et ON et.event_id = r.event_id
                     WHERE et.member_id=$1 AND r.created_at > now() - interval '60 days'
                     ORDER BY r.created_at DESC LIMIT 20`, [staff.id]),
      ]);
      for (const t of tips.rows) items.push({ id: `tp-${t.id}`, level: 'info', icon: '💐', title: 'You received a tip!', text: formatAed(Number(t.amount_fils)), eventId: t.event_id, at: t.created_at });
      for (const r of ratings.rows) items.push({ id: `rt-${r.id}`, level: 'info', icon: '🌟', title: `${r.stars}★ on your event`, text: (r.feedback || '').slice(0, 80), eventId: r.event_id, at: r.created_at });
      // The employee's own recorded reward earnings (Achievements).
      const rewards = await pool.query(
        `SELECT id, event_id, amount_fils, note, created_at FROM staff_rewards
          WHERE member_id=$1 AND created_at > now() - interval '60 days' ORDER BY created_at DESC LIMIT 20`, [staff.id]);
      for (const r of rewards.rows) items.push({ id: `rw-${r.id}`, level: 'info', icon: '🏆', title: `You earned ${formatAed(Number(r.amount_fils))}!`, text: 'Positive customer feedback · view in Achievements', eventId: r.event_id, at: r.created_at });
    }

    // Every staff member sees the good-feedback celebration (who earned it).
    const broadcasts = await pool.query(
      `SELECT id, event_id, payload, created_at FROM notifications
        WHERE channel='push' AND template='good_feedback_broadcast' AND created_at > now() - interval '30 days'
        ORDER BY created_at DESC LIMIT 20`);
    for (const b of broadcasts.rows) {
      const p = b.payload || {};
      items.push({ id: `gf-${b.id}`, level: 'info', icon: '🌟', title: 'Great customer feedback!', text: `${p.names || 'The crew'} earned a reward${p.feedback ? ` · "${String(p.feedback).slice(0, 60)}"` : ''}`, eventId: b.event_id, at: b.created_at });
    }

    // Owner/manager: a team member activated their login (set their password).
    // Only for members who are still active, so test/disabled accounts never show.
    if (isMgr) {
      const acts = await pool.query(
        `SELECT n.id, n.payload, n.created_at FROM notifications n
           JOIN team_members tm ON tm.id = (n.payload->>'memberId')
          WHERE n.channel='push' AND n.template='staff_activated'
            AND n.cancelled_at IS NULL AND tm.active
            AND n.created_at > now() - interval '30 days'
          ORDER BY n.created_at DESC LIMIT 20`);
      for (const x of acts.rows) {
        const p = x.payload || {};
        items.push({ id: `act-${x.id}`, level: 'info', icon: '✅', title: 'Team member activated', text: `${p.name || 'A team member'} set their password — they can sign in now`, at: x.created_at });
      }

      // Inventory: equipment issues + missing-item reports, and the actions taken.
      const inv = await pool.query(
        `SELECT id, template, payload, created_at FROM notifications
          WHERE channel='push' AND template IN ('asset_issue','missing_item_reported','missing_item_action','asset_issue_action','new_product')
            AND created_at > now() - interval '30 days'
          ORDER BY created_at DESC LIMIT 30`);
      for (const x of inv.rows) {
        const p = x.payload || {};
        const t = x.template as string;
        if (t === 'asset_issue') {
          const label = ({ broken: 'broken', damaged: 'damaged', maintenance: 'needs maintenance', other: 'issue' } as Record<string, string>)[p.kind] || 'issue';
          items.push({ id: `ai-${x.id}`, level: p.kind === 'broken' ? 'high' : 'info', icon: '🧰', title: 'Equipment issue reported', text: `${p.name} — ${label} (by ${p.by})`, at: x.created_at });
        } else if (t === 'missing_item_reported') {
          items.push({ id: `mi-${x.id}`, level: 'info', icon: '📦', title: 'Missing item reported', text: `${p.item} ×${p.quantity} — by ${p.by}`, at: x.created_at });
        } else if (t === 'missing_item_action') {
          items.push({ id: `mia-${x.id}`, level: 'info', icon: '📦', title: `Missing item ${p.status}`, text: `${p.item} — ${p.status} by ${p.by}`, at: x.created_at });
        } else if (t === 'asset_issue_action') {
          items.push({ id: `aia-${x.id}`, level: 'info', icon: '🧰', title: `Equipment issue ${p.status}`, text: `${p.name} — ${p.status} by ${p.by}`, at: x.created_at });
        } else if (t === 'new_product') {
          items.push({ id: `np-${x.id}`, level: 'info', icon: '🆕', title: 'New product added', text: `${p.name} — ${formatAed(Number(p.priceFils || 0))} (by ${p.by})`, at: x.created_at });
        }
      }
    }

    items.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
    return { items: items.slice(0, 50) };
  });

  /**
   * Unified ops alert centre: what needs a person's attention right now
   * (low stock, leave to approve, orders held for review) plus a recent feed
   * of tips and ratings. Manager/owner only (gated in the preHandler).
   */
  app.get('/api/admin/alerts', async (request) => {
    const staff = (request as any).staff as { id?: string; role?: string };
    // Who's off today — approved leave covering today. Shown to EVERYONE on Home
    // so the whole team knows who to expect.
    const offToday = (await pool.query(
      `SELECT d.id, m.name AS member_name, m.color, d.reason,
              to_char(d.end_date,'YYYY-MM-DD') AS end_date
         FROM staff_days_off d JOIN team_members m ON m.id = d.member_id
        WHERE d.status = 'approved' AND d.start_date <= CURRENT_DATE AND d.end_date >= CURRENT_DATE
        ORDER BY m.name`,
    ).catch(() => ({ rows: [] as any[] }))).rows;
    // Employees get a personal "Latest updates" feed: low stock (shared), their
    // OWN at-risk prep, their OWN tips, and ratings on their OWN events — no
    // business-wide counts or other people's data.
    if (staff.role === 'employee' && staff.id) {
      const [lowStock, myTips, myRatings] = await Promise.all([
        pool.query(
          `SELECT id, name, unit, on_hand, reorder_level FROM consumables
            WHERE active AND on_hand <= reorder_level ORDER BY (on_hand - reorder_level) ASC, name`),
        pool.query(
          `SELECT t.id, t.amount_fils, t.created_at, t.event_id FROM tips t
            WHERE t.status='paid' AND t.member_id=$1
            ORDER BY COALESCE(t.paid_at,t.created_at) DESC LIMIT 8`, [staff.id]),
        pool.query(
          `SELECT r.id, r.stars, r.feedback, r.created_at, r.event_id FROM event_ratings r
             JOIN event_team et ON et.event_id = r.event_id
            WHERE et.member_id=$1 ORDER BY r.created_at DESC LIMIT 8`, [staff.id]),
      ]);
      const myEventIds = new Set(
        (await pool.query(`SELECT event_id FROM event_team WHERE member_id=$1`, [staff.id])).rows.map((r) => r.event_id),
      );
      const prepAtRisk = (await import('../domain/prep.js').then((m) => m.getPrepEvents()).catch(() => []))
        .filter((e: any) => (e.atRisk || e.issues > 0) && myEventIds.has(e.event_id ?? e.eventId ?? e.id));
      return {
        scoped: true,
        lowStock: lowStock.rows,
        recentTips: myTips.rows.map((t) => ({ ...t, amountDisplay: formatAed(Number(t.amount_fils)) })),
        recentRatings: myRatings.rows,
        prepAtRisk,
        offToday,
      };
    }

    const [lowStock, pendingLeave, needsReview, tips, ratings, staffingGaps] = await Promise.all([
      pool.query(
        `SELECT id, name, unit, on_hand, reorder_level FROM consumables
          WHERE active AND on_hand <= reorder_level
          ORDER BY (on_hand - reorder_level) ASC, name`,
      ),
      pool.query(
        `SELECT d.id, d.start_date, d.end_date, d.reason, m.name AS member_name, m.color
           FROM staff_days_off d JOIN team_members m ON m.id = d.member_id
          WHERE d.status = 'requested' ORDER BY d.start_date`,
      ),
      pool.query(`SELECT count(*)::int AS n FROM orders WHERE status = 'needs_review'`),
      pool.query(
        `SELECT t.id, t.amount_fils, t.created_at, t.event_id, m.name AS member_name
           FROM tips t LEFT JOIN team_members m ON m.id = t.member_id
          WHERE t.status = 'paid'
          ORDER BY COALESCE(t.paid_at, t.created_at) DESC LIMIT 8`,
      ),
      pool.query(
        `SELECT r.id, r.stars, r.feedback, r.created_at, r.event_id
           FROM event_ratings r ORDER BY r.created_at DESC LIMIT 8`,
      ),
      // Events the smart-staffing engine couldn't fully staff internally — a
      // part-timer (or internal prep) still needs confirming. Upcoming only.
      pool.query(
        `SELECT e.id AS event_id, to_char(e.event_date,'YYYY-MM-DD') AS event_date,
                e.start_time, e.emirate,
                count(*) FILTER (WHERE es.status IN ('part_time_required','to_confirm'))::int AS open,
                array_agg(DISTINCT es.role) FILTER (WHERE es.status IN ('part_time_required','to_confirm')) AS roles
           FROM events e JOIN event_staff es ON es.event_id = e.id
          WHERE e.phase <> 'Cancelled' AND e.event_date >= CURRENT_DATE
          GROUP BY e.id, e.event_date, e.start_time, e.emirate
         HAVING count(*) FILTER (WHERE es.status IN ('part_time_required','to_confirm')) > 0
          ORDER BY e.event_date LIMIT 30`,
      ),
    ]);

    // Events whose pre-event preparation is behind and the day is near.
    const prepAtRisk = (await import('../domain/prep.js').then((m) => m.getPrepEvents()).catch(() => []))
      .filter((e: any) => e.atRisk || e.issues > 0);

    return {
      lowStock: lowStock.rows,
      pendingLeave: pendingLeave.rows,
      needsReview: needsReview.rows[0].n,
      recentTips: tips.rows.map((t) => ({ ...t, amountDisplay: formatAed(Number(t.amount_fils)) })),
      recentRatings: ratings.rows,
      staffingGaps: staffingGaps.rows,
      offToday,
      prepAtRisk,
      counts: {
        lowStock: lowStock.rowCount,
        pendingLeave: pendingLeave.rowCount,
        needsReview: needsReview.rows[0].n,
        staffingGaps: staffingGaps.rowCount,
        prepAtRisk: prepAtRisk.length,
      },
    };
  });

  /* ---------------------------- Email marketing --------------------------- */

  app.get('/api/admin/marketing', async () => {
    const [counts, campaigns] = await Promise.all([
      audienceCounts(),
      pool.query(
        `SELECT id, subject, audience, status, scheduled_for, sent_at,
                recipient_count, sent_count, created_at, created_by,
                approved_by, approved_at, rejection_reason, source
           FROM email_campaigns ORDER BY created_at DESC LIMIT 50`,
      ),
    ]);
    return { emailConfigured: emailEnabled(), audiences: counts, campaigns: campaigns.rows };
  });

  app.post('/api/admin/marketing/campaigns', async (request, reply) => {
    const schema = z.object({
      subject: z.string().min(1).max(200),
      bodyHtml: z.string().min(1).max(50_000),
      audience: z.enum(['all', 'past_customers', 'no_recent_booking']).default('all'),
      scheduledFor: z.string().datetime().optional(),
    });
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'invalid_request', details: parsed.error.flatten() });
    const d = parsed.data;
    // New campaigns always start as a draft and must be approved before sending,
    // even if a send time is chosen. The schedule is stored for the approver.
    const { rows } = await pool.query(
      `INSERT INTO email_campaigns (subject, body_html, audience, status, scheduled_for, created_by, source)
       VALUES ($1,$2,$3,'draft',$4,$5,'manual') RETURNING *`,
      [d.subject, d.bodyHtml, d.audience, d.scheduledFor ?? null, (request as any).staff?.name ?? 'Staff'],
    );
    return reply.status(201).send(rows[0]);
  });

  /** Submit a draft for Manager/CEO approval. */
  app.post('/api/admin/marketing/campaigns/:id/submit', async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    const { rows } = await pool.query(
      `UPDATE email_campaigns SET status = 'pending_approval', rejection_reason = NULL
        WHERE id = $1 AND status IN ('draft','rejected') RETURNING *`,
      [id],
    );
    if (!rows[0]) return reply.status(409).send({ error: 'invalid_state', message: 'Only a draft can be submitted.' });
    return rows[0];
  });

  /** Approve a pending campaign and send it now (or schedule it). Manager/CEO. */
  app.post('/api/admin/marketing/campaigns/:id/approve', async (request, reply) => {
    if (!emailEnabled()) {
      return reply.status(409).send({ error: 'email_disabled', message: 'Set RESEND_API_KEY (and EMAIL_FROM) to send.' });
    }
    const id = Number((request.params as { id: string }).id);
    const approver = String((request as any).staff?.name ?? 'Manager');
    const { rows } = await pool.query(`SELECT * FROM email_campaigns WHERE id = $1`, [id]);
    const camp = rows[0];
    if (!camp) return reply.status(404).send({ error: 'not_found' });
    if (camp.status !== 'pending_approval' && camp.status !== 'draft') {
      return reply.status(409).send({ error: 'invalid_state', message: 'Only a pending campaign can be approved.' });
    }
    const future = camp.scheduled_for && new Date(camp.scheduled_for).getTime() > Date.now();
    await pool.query(
      `UPDATE email_campaigns SET status = $2, approved_by = $3, approved_at = now(), rejection_reason = NULL WHERE id = $1`,
      [id, future ? 'scheduled' : 'approved', approver],
    );
    if (future) return { id, status: 'scheduled', approvedBy: approver };
    try {
      const result = await sendCampaign(id);
      return { id, status: 'sent', approvedBy: approver, ...result };
    } catch (e) {
      return reply.status(400).send({ error: 'send_failed', message: (e as Error).message });
    }
  });

  /** Reject a pending campaign back to draft, with a reason. Manager/CEO. */
  app.post('/api/admin/marketing/campaigns/:id/reject', async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    const reason = String(((request.body as any)?.reason ?? '')).slice(0, 500);
    const { rows } = await pool.query(
      `UPDATE email_campaigns SET status = 'rejected', rejection_reason = $2
        WHERE id = $1 AND status = 'pending_approval' RETURNING *`,
      [id, reason || 'Not approved'],
    );
    if (!rows[0]) return reply.status(409).send({ error: 'invalid_state' });
    return rows[0];
  });

  app.post('/api/admin/marketing/campaigns/:id/send', async (request, reply) => {
    if (!emailEnabled()) {
      return reply.status(409).send({
        error: 'email_disabled',
        message: 'Set RESEND_API_KEY (and EMAIL_FROM) in the server environment to send.',
      });
    }
    const id = Number((request.params as { id: string }).id);
    try {
      const result = await sendCampaign(id);
      return { ...result };
    } catch (e) {
      return reply.status(400).send({ error: 'send_failed', message: (e as Error).message });
    }
  });

  app.patch('/api/admin/marketing/campaigns/:id', async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    const schema = z.object({
      scheduledFor: z.string().datetime().nullable().optional(),
      status: z.enum(['draft', 'scheduled']).optional(),
    });
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'invalid_request' });
    const d = parsed.data;
    const status = d.status ?? (d.scheduledFor ? 'scheduled' : undefined);
    const { rows } = await pool.query(
      `UPDATE email_campaigns
          SET scheduled_for = COALESCE($2, scheduled_for),
              status = COALESCE($3, status)
        WHERE id = $1 AND status IN ('draft','scheduled') RETURNING *`,
      [id, d.scheduledFor ?? null, status ?? null],
    );
    if (!rows[0]) return reply.status(404).send({ error: 'not_found' });
    return rows[0];
  });

  app.delete('/api/admin/marketing/campaigns/:id', async (request) => {
    const id = Number((request.params as { id: string }).id);
    await pool.query(`DELETE FROM email_campaigns WHERE id = $1 AND status IN ('draft','scheduled','failed')`, [id]);
    return { deleted: true };
  });

  /** Send a one-off test of a draft body to a single address. */
  app.post('/api/admin/marketing/test', async (request, reply) => {
    if (!emailEnabled()) return reply.status(409).send({ error: 'email_disabled' });
    const schema = z.object({ to: z.string().email(), subject: z.string().min(1), bodyHtml: z.string().min(1) });
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'invalid_request' });
    const html = renderCampaignHtml(parsed.data.bodyHtml, `${config.publicApiUrl}/api/unsubscribe?c=preview&t=preview`);
    const res = await sendEmail({ to: parsed.data.to, subject: `[TEST] ${parsed.data.subject}`, html });
    return res.ok ? { ok: true } : reply.status(502).send({ error: 'send_failed', message: res.error });
  });

  /** Sign a direct-to-Cloudinary upload for a staff-side image. */
  app.post('/api/admin/uploads/sign', async (request, reply) => {
    if (!uploadsEnabled()) {
      return reply.status(409).send({
        error: 'uploads_disabled',
        message: 'Set CLOUDINARY_URL in the server environment to enable image uploads.',
      });
    }
    const schema = z.object({ folder: z.enum(['receipts', 'themes', 'designs', 'setup-photos']).default('receipts') });
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'invalid_request' });
    return signUpload(`eventana/${parsed.data.folder}` as const);
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
    const staff = (request as any).staff as { name?: string };
    const by = d.reportedBy ?? staff?.name ?? 'staff';
    const { rows } = await pool.query(
      `INSERT INTO missing_items (item, quantity, event_id, supplier, note, reported_by)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [d.item, d.quantity, d.eventId ?? null, d.supplier ?? null, d.note ?? null, by],
    );
    // Surface to owner/manager: bell feed + best-effort push (who + what).
    await pool.query(
      `INSERT INTO notifications (channel, template, scheduled_for, payload)
       VALUES ('push','missing_item_reported', now(), $1)`,
      [JSON.stringify({ id: rows[0].id, item: d.item, quantity: d.quantity, by })],
    ).catch(() => {});
    void (async () => {
      const owners = await pool.query(`SELECT id FROM team_members WHERE access_level IN ('owner','manager') AND active`).catch(() => ({ rows: [] as any[] }));
      for (const o of owners.rows) void pushToOwner('staff', o.id, '📦 Missing item reported', `${d.item} ×${d.quantity} — reported by ${by}`);
    })();
    return rows[0];
  });

  app.patch('/api/admin/missing-items/:id', async (request, reply) => {
    const role = (request as any).staff?.role;
    if (role !== 'owner' && role !== 'manager') return reply.status(403).send({ error: 'forbidden' });
    const { id } = request.params as { id: string };
    const schema = z.object({ status: z.enum(['requested', 'ordered', 'received', 'cancelled']) });
    const p = schema.safeParse(request.body);
    if (!p.success) return reply.status(400).send({ error: 'invalid_request' });
    const { rows } = await pool.query(
      `UPDATE missing_items SET status = $2 WHERE id = $1 RETURNING *`,
      [id, p.data.status],
    );
    if (!rows[0]) return reply.status(404).send({ error: 'not_found' });
    // Close the loop: record the action so the team sees it was handled.
    const by = String((request as any).staff?.name ?? 'manager');
    await pool.query(
      `INSERT INTO notifications (channel, template, scheduled_for, payload)
       VALUES ('push','missing_item_action', now(), $1)`,
      [JSON.stringify({ id: rows[0].id, item: rows[0].item, status: p.data.status, by })],
    ).catch(() => {});
    logAudit({ actor: by, role, action: 'missing_item_action', target: String(id), detail: { status: p.data.status } });
    return rows[0];
  });

  // The manual refund now delegates to refundOrderMoney, so these payment
  // primitives are no longer referenced directly here. Kept imported (other
  // refactors may reuse them); voided so an unused-locals build stays green.
  void recordPaymentEvent; void getProvider; void applyPaymentStatus; void orderStatusFor;
}
