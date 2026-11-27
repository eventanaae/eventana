/**
 * Read-only team status for the owner's virtual office ("طابق إيفنتانا").
 *
 * GET /api/team/status   (header x-report-key — the same key as the marketing report)
 *
 * For each active internal team member: their parties in the next 7 days (date,
 * start time, emirate, leader flag), open prep tasks due today/tomorrow, and
 * approved days off overlapping the next 7 days. Staff first names only — no
 * customer names, phones, emails or addresses ever leave this route. SELECTs only.
 */
import type { FastifyInstance } from 'fastify';
import { createHash } from 'node:crypto';
import { pool } from '../db/pool.js';
import { safeEqual } from '../payments/provider.js';
import { staffWhatsApp } from '../integrations/push.js';

const REPORT_KEY_SHA256 = 'd7adf93428c04153d718ec5a4d1084a9c5b78e63be712d392de4edf49b112ed9';
const OFFICE_KEY_SHA256 = '7aea653830487eb7c8005bc03c32942b0ede599427388a205112a31d22972653';

function keyOk(given: string | undefined): boolean {
  const envKey = process.env.MARKETING_REPORT_KEY;
  // A separate key only for the owner's virtual office sync (only its SHA-256 lives here).
  if (!!given && safeEqual(createHash('sha256').update(given).digest('hex'), OFFICE_KEY_SHA256)) return true;
  return (!!envKey && envKey.length >= 24 && safeEqual(given, envKey))
    || (!!given && safeEqual(createHash('sha256').update(given).digest('hex'), REPORT_KEY_SHA256));
}

export async function teamStatusRoutes(app: FastifyInstance): Promise<void> {
  /**
   * POST /api/team/notify  { to: "Marsha", headline, details }  (header x-report-key)
   * Lets the AI team send a short ENGLISH work message to ONE active internal team
   * member on WhatsApp, through the approved staff_notify template and the phone
   * already stored in Ops. Staff only — never a customer. Max 10 per day overall.
   */
  /** GET /api/team/replies — the last 30 WhatsApp messages Marsha sent back from the company phone. */
  app.get('/api/team/replies', async (request, reply) => {
    const hdr = request.headers['x-report-key'];
    if (!keyOk(Array.isArray(hdr) ? hdr[0] : hdr)) return reply.code(401).send({ error: 'unauthorized' });
    const r = await pool.query(
      `SELECT body, to_char(created_at AT TIME ZONE 'Asia/Dubai','YYYY-MM-DD HH24:MI') AS at
         FROM whatsapp_messages WHERE direction = 'in' AND right(phone, 9) = '564500777'
        ORDER BY created_at DESC LIMIT 30`).catch(() => ({ rows: [] }));
    const sent = await pool.query(
      `SELECT to_name, headline, to_char(created_at AT TIME ZONE 'Asia/Dubai','YYYY-MM-DD HH24:MI') AS at
         FROM ai_team_notify_log ORDER BY created_at DESC LIMIT 30`).catch(() => ({ rows: [] }));
    const open = await pool.query(
      `SELECT id, text, marsha_said, to_char(created_at AT TIME ZONE 'Asia/Dubai','YYYY-MM-DD HH24:MI') AS at
         FROM ai_team_requests WHERE status = 'open' ORDER BY created_at LIMIT 30`).catch(() => ({ rows: [] }));
    return { fromMarsha: r.rows, sentByTeam: sent.rows, openRequests: open.rows };
  });

  /** POST /api/team/requests/close { id } — the team finished one of Marsha's requests. */
  app.post('/api/team/requests/close', async (request, reply) => {
    const hdr = request.headers['x-report-key'];
    if (!keyOk(Array.isArray(hdr) ? hdr[0] : hdr)) return reply.code(401).send({ error: 'unauthorized' });
    const id = Number((request.body as { id?: unknown } | undefined)?.id);
    if (!Number.isInteger(id)) return reply.code(400).send({ error: 'id required' });
    const r = await pool.query(`UPDATE ai_team_requests SET status = 'done', done_at = now() WHERE id = $1 AND status = 'open'`, [id]);
    return { ok: (r.rowCount ?? 0) > 0 };
  });

  /** POST /api/team/stock { type: resolve_issue|missing_ordered|missing_received, item } — Sheikha's stock updates. */
  app.post('/api/team/stock', async (request, reply) => {
    const hdr = request.headers['x-report-key'];
    if (!keyOk(Array.isArray(hdr) ? hdr[0] : hdr)) return reply.code(401).send({ error: 'unauthorized' });
    const b = (request.body ?? {}) as { type?: unknown; item?: unknown };
    const { applyStockUpdate } = await import('../domain/sheikha.js');
    return { ok: await applyStockUpdate(String(b.type ?? ''), String(b.item ?? '')) };
  });

  /** GET /api/team/marsha-tasks — Marsha's open Ops tasks, for Sheikha's schedule. */
  app.get('/api/team/marsha-tasks', async (request, reply) => {
    const hdr = request.headers['x-report-key'];
    if (!keyOk(Array.isArray(hdr) ? hdr[0] : hdr)) return reply.code(401).send({ error: 'unauthorized' });
    const { marshaTasks } = await import('../domain/sheikha.js');
    return { tasks: await marshaTasks() };
  });

  /** POST /api/team/remind { at: "YYYY-MM-DD HH:MM" (Dubai), text } — a reminder Sheikha sends Marsha. */
  app.post('/api/team/remind', async (request, reply) => {
    const hdr = request.headers['x-report-key'];
    if (!keyOk(Array.isArray(hdr) ? hdr[0] : hdr)) return reply.code(401).send({ error: 'unauthorized' });
    const b = (request.body ?? {}) as { at?: unknown; text?: unknown };
    const { addReminder } = await import('../domain/sheikha.js');
    return { ok: await addReminder(String(b.at ?? ''), String(b.text ?? '')) };
  });

  /**
   * POST /api/team/close-past-tasks { dryRun?: boolean }
   * Owner (27 Nov): «خله شيخه تسكر كل المهام». Marks every unfinished prep task of
   * a party that is already over (event date before today, Dubai) as completed,
   * stamped as Sheikha's cleanup. Future parties and tasks without a party are untouched.
   */
  app.post('/api/team/close-past-tasks', async (request, reply) => {
    const hdr = request.headers['x-report-key'];
    if (!keyOk(Array.isArray(hdr) ? hdr[0] : hdr)) return reply.code(401).send({ error: 'unauthorized' });
    const dry = (request.body as { dryRun?: unknown } | undefined)?.dryRun !== false;
    const where = `pt.status <> 'completed' AND pt.event_id = e.id
                   AND e.event_date < (now() AT TIME ZONE 'Asia/Dubai')::date`;
    const n = await pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM prep_tasks pt, events e WHERE ${where}`);
    if (dry) return { dryRun: true, wouldClose: n.rows[0]?.n ?? 0 };
    const r = await pool.query(
      `UPDATE prep_tasks pt SET status = 'completed', completed_by = 'Sheikha (AI team): past party cleanup', completed_at = now()
         FROM events e WHERE ${where}`);
    return { dryRun: false, closed: r.rowCount ?? 0 };
  });

  app.post('/api/team/notify', async (request, reply) => {
    const hdr = request.headers['x-report-key'];
    if (!keyOk(Array.isArray(hdr) ? hdr[0] : hdr)) return reply.code(401).send({ error: 'unauthorized' });
    const b = (request.body ?? {}) as { to?: unknown; headline?: unknown; details?: unknown };
    const to = String(b.to ?? '').trim(), headline = String(b.headline ?? '').trim().slice(0, 60), details = String(b.details ?? '').trim().slice(0, 600);
    if (!to || !headline || !details) return reply.code(400).send({ error: 'to, headline and details are required' });
    // Marsha reads the company phone (+971 56 450 0777), owner 27 Nov: send hers there.
    if (to.toLowerCase() === 'marsha') {
      const h = new Date(Date.now() + 4 * 3600 * 1000).getUTCHours();
      if (h < 10 || h >= 23) return reply.code(409).send({ error: 'staff messages only 10:00-23:00 Dubai' });
      const sentM = await pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM ai_team_notify_log WHERE created_at > now() - interval '1 day'`);
      if ((sentM.rows[0]?.n ?? 0) >= 10) return reply.code(429).send({ error: 'daily limit reached' });
      await pool.query(`INSERT INTO ai_team_notify_log (to_name, headline) VALUES ($1, $2)`, ['Marsha', headline]);
      const { sendWhatsAppTemplate } = await import('../integrations/whatsapp.js');
      const one = (x: string) => x.replace(/\s*\n+\s*/g, ' • ').trim();
      // Inside WhatsApp's 24h window (Marsha wrote to us in the last 24h) a normal
      // text goes through and keeps line breaks; outside it only the template can.
      const open24 = await pool.query(`SELECT 1 FROM whatsapp_messages WHERE direction = 'in' AND right(phone, 9) = '564500777'
          AND created_at > now() - interval '23 hours' LIMIT 1`).catch(() => ({ rows: [] }));
      const { sendWhatsAppText } = await import('../integrations/whatsapp.js');
      const r = open24.rows.length
        ? await sendWhatsAppText({ to: '971564500777', body: `${headline}\n\n${details}`, fromStaff: true, allowCompanyPhone: true })
        : await sendWhatsAppTemplate({ to: '971564500777', name: 'staff_notify', language: 'en', params: ['Marsha', one(headline), one(details)], fromStaff: true, allowCompanyPhone: true });
      if (r.ok) {
        const { recordOutboundMessage } = await import('../domain/whatsappLeads.js');
        await recordOutboundMessage({ phone: '971564500777', body: `${headline}\n\n${details}`, messageId: r.messageId ?? null, sentBy: 'agent' }).catch(() => {});
      }
      return { ok: r.ok, to: 'Marsha', via: open24.rows.length ? 'text' : 'template', error: r.error };
    }
    const m = await pool.query<{ id: string; name: string }>(
      `SELECT id, name FROM team_members WHERE active AND access_level <> 'owner' AND phone IS NOT NULL AND phone <> ''
         AND lower(split_part(name,' ',1)) = lower($1)`, [to]);
    if (m.rows.length !== 1) return reply.code(404).send({ error: 'no single active team member with that first name' });
    const sent = await pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM ai_team_notify_log WHERE created_at > now() - interval '1 day'`);
    if ((sent.rows[0]?.n ?? 0) >= 10) return reply.code(429).send({ error: 'daily limit reached' });
    await pool.query(`INSERT INTO ai_team_notify_log (to_name, headline) VALUES ($1, $2)`, [m.rows[0].name.split(' ')[0], headline]);
    await staffWhatsApp(headline, details, m.rows[0].id, { force: true });
    return { ok: true, to: m.rows[0].name.split(' ')[0] };
  });

  app.get('/api/team/status', async (request, reply) => {
    const hdr = request.headers['x-report-key'];
    if (!keyOk(Array.isArray(hdr) ? hdr[0] : hdr)) return reply.code(401).send({ error: 'unauthorized' });

    const today = new Date(Date.now() + 4 * 3600 * 1000).toISOString().slice(0, 10); // Dubai, no DST
    const { rows } = await pool.query(
      `SELECT tm.id, tm.name,
          COALESCE((SELECT json_agg(json_build_object(
                     'date', to_char(e.event_date,'YYYY-MM-DD'), 'time', e.start_time,
                     'emirate', e.emirate, 'leader', es.is_leader) ORDER BY e.event_date, e.start_time)
             FROM event_staff es JOIN events e ON e.id = es.event_id
            WHERE es.assignee_id = tm.id AND e.phase <> 'Cancelled' AND NOT COALESCE(e.date_tbd, false)
              AND e.event_date BETWEEN $1::date AND $1::date + 6), '[]') AS events,
          (SELECT count(*) FROM prep_task_staff s JOIN prep_tasks pt ON pt.id = s.task_id
            WHERE s.member_id = tm.id AND pt.status <> 'completed'
              AND pt.due_date BETWEEN $1::date AND $1::date + 1)::int AS prep_open,
          COALESCE((SELECT json_agg(json_build_object('from', to_char(o.start_date,'YYYY-MM-DD'), 'to', to_char(o.end_date,'YYYY-MM-DD')))
             FROM staff_days_off o
            WHERE o.member_id = tm.id AND o.status = 'approved'
              AND o.end_date >= $1::date AND o.start_date <= $1::date + 6), '[]') AS days_off
         FROM team_members tm
        WHERE tm.active AND tm.access_level <> 'owner'
        ORDER BY tm.name`,
      [today],
    );
    // Upcoming parties (next 14 days) for the office board: no customer details.
    const up = await pool.query(
      `SELECT to_char(e.event_date,'YYYY-MM-DD') AS date, e.start_time AS time, e.emirate, e.celebration_type AS occasion,
              pk.name AS package, th.name AS theme, COALESCE(e.custom_theme,false) AS custom_theme,
              COALESCE((SELECT json_agg(DISTINCT split_part(tm.name,' ',1)) FROM event_staff es JOIN team_members tm ON tm.id = es.assignee_id
                         WHERE es.event_id = e.id), '[]') AS crew,
              (SELECT count(*) FROM prep_tasks pt WHERE pt.event_id = e.id)::int AS prep_total,
              (SELECT count(*) FROM prep_tasks pt WHERE pt.event_id = e.id AND pt.status = 'completed')::int AS prep_done,
              (SELECT count(*) FROM prep_tasks pt WHERE pt.event_id = e.id AND pt.category = 'design' AND pt.status <> 'completed')::int AS design_open,
              (SELECT count(*) FROM event_staff es2 WHERE es2.event_id = e.id AND es2.assignee_id IS NULL AND COALESCE(es2.part_time_name,'') = '')::int AS crew_open
         FROM events e
         LEFT JOIN packages pk ON pk.id = e.package_id
         LEFT JOIN themes th ON th.id = e.theme_id
        WHERE e.phase <> 'Cancelled' AND NOT COALESCE(e.date_tbd, false)
          AND e.event_date BETWEEN $1::date AND $1::date + 13
        ORDER BY e.event_date, e.start_time
        LIMIT 60`,
      [today],
    );
    // Office overview: money, leads, alerts, leave requests, ratings. Totals and staff first names only.
    const one = async (sql: string) => (await pool.query(sql, sql.includes('$1') ? [today] : [])).rows[0] ?? {};
    const money = await one(`SELECT
        COALESCE(SUM(total_fils) FILTER (WHERE COALESCE(booked_on, date) = $1::date),0)::bigint AS today_fils,
        COUNT(*) FILTER (WHERE COALESCE(booked_on, date) = $1::date)::int AS today_n,
        COALESCE(SUM(total_fils) FILTER (WHERE COALESCE(booked_on, date) >= date_trunc('month',$1::date)),0)::bigint AS month_fils,
        COUNT(*) FILTER (WHERE COALESCE(booked_on, date) >= date_trunc('month',$1::date))::int AS month_n
       FROM finance_receipts WHERE total_fils > 0 AND source <> 'quickbooks'`).catch(() => ({}));
    // Bookings MADE this month/today (by when they booked, whatever the party date).
    const booked = await one(`SELECT
        COUNT(*) FILTER (WHERE (e.created_at AT TIME ZONE 'Asia/Dubai')::date = $1::date)::int AS today_n,
        COUNT(*) FILTER (WHERE (e.created_at AT TIME ZONE 'Asia/Dubai')::date >= date_trunc('month',$1::date))::int AS month_n
       FROM events e WHERE e.phase <> 'Cancelled'`).catch(() => ({}));
    const leads = await one(`SELECT
        COUNT(*) FILTER (WHERE (first_message_at AT TIME ZONE 'Asia/Dubai')::date = $1::date)::int AS new_today,
        COUNT(*) FILTER (WHERE status = 'new')::int AS new_open,
        COUNT(*) FILTER (WHERE status IN ('quoted','confirmed'))::int AS quoted_open,
        COUNT(*) FILTER (WHERE status = 'booked' AND updated_at > now() - interval '7 days')::int AS booked_week
       FROM whatsapp_leads WHERE right(phone, 9) <> '564500777'`).catch(() => ({}));
    const carts = await one(`SELECT COUNT(*)::int AS n FROM orders WHERE kind = 'booking' AND status = 'awaiting_payment' AND created_at > now() - interval '7 days'`).catch(() => ({}));
    const alerts = await one(`SELECT
        (SELECT COUNT(*) FROM prep_tasks pt JOIN events e ON e.id = pt.event_id WHERE pt.status = 'issue' AND e.event_date >= $1::date AND e.phase <> 'Cancelled')::int AS prep_issues,
        (SELECT COUNT(DISTINCT pt.event_id) FROM prep_tasks pt JOIN events e ON e.id = pt.event_id WHERE pt.status <> 'completed' AND e.phase <> 'Cancelled' AND e.event_date BETWEEN $1::date AND $1::date + 3)::int AS at_risk,
        (SELECT COUNT(*) FROM event_staff es JOIN events e ON e.id = es.event_id WHERE es.assignee_id IS NULL AND COALESCE(es.part_time_name,'') = '' AND e.phase <> 'Cancelled' AND e.event_date BETWEEN $1::date AND $1::date + 3)::int AS crew_open`).catch(() => ({}));
    const ratings = await one(`SELECT ROUND(AVG(stars)::numeric,1)::float AS avg, COUNT(*)::int AS n FROM event_ratings WHERE created_at > now() - interval '30 days'`).catch(() => ({}));
    const leaveReq = (await pool.query(`SELECT split_part(tm.name,' ',1) AS name, to_char(o.start_date,'YYYY-MM-DD') AS "from", to_char(o.end_date,'YYYY-MM-DD') AS "to"
         FROM staff_days_off o JOIN team_members tm ON tm.id = o.member_id WHERE o.status = 'requested' AND o.end_date >= $1::date ORDER BY o.start_date LIMIT 20`, [today]).catch(() => ({ rows: [] }))).rows;
    const tasks = (await pool.query(`SELECT split_part(tm.name,' ',1) AS name, COUNT(*)::int AS n
         FROM prep_tasks pt JOIN prep_task_staff s ON s.task_id = pt.id JOIN team_members tm ON tm.id = s.member_id
        WHERE pt.category = 'manual' AND pt.status <> 'completed' GROUP BY tm.name`).catch(() => ({ rows: [] }))).rows;
    const learn = await one(`SELECT
        to_char(MIN(created_at) AT TIME ZONE 'Asia/Dubai','YYYY-MM-DD') AS listening_since,
        to_char(MIN(created_at) FILTER (WHERE direction = 'out' AND sent_by = 'staff') AT TIME ZONE 'Asia/Dubai','YYYY-MM-DD') AS since,
        COUNT(*) FILTER (WHERE direction = 'out' AND sent_by = 'staff')::int AS team_replies,
        COUNT(*) FILTER (WHERE direction = 'out' AND sent_by = 'staff' AND created_at > now() - interval '7 days')::int AS team_week,
        COUNT(*) FILTER (WHERE direction = 'out' AND sent_by = 'agent')::int AS bot_replies,
        COUNT(*) FILTER (WHERE direction = 'in')::int AS customer_msgs,
        COUNT(DISTINCT phone)::int AS chats
       FROM whatsapp_messages`).catch(() => ({}));
    const mode = await one(`SELECT value FROM settings WHERE key = 'whatsapp_agent_mode'`).catch(() => ({}));
    // Inventory for «بو مخزون»: item names and counts only.
    const invIssues = (await pool.query(`SELECT COALESCE(asset_name, asset_code) AS item, kind, status
         FROM asset_issues WHERE status <> 'resolved' ORDER BY created_at DESC LIMIT 30`).catch(() => ({ rows: [] }))).rows;
    const invLow = (await pool.query(`SELECT name, unit, on_hand, reorder_level FROM consumables
         WHERE active AND on_hand <= reorder_level ORDER BY name LIMIT 40`).catch(() => ({ rows: [] }))).rows;
    const invMissing = (await pool.query(`SELECT m.item, m.quantity, m.status, to_char(e.event_date,'YYYY-MM-DD') AS party_date
         FROM missing_items m LEFT JOIN events e ON e.id = m.event_id
        WHERE m.status IN ('requested','ordered') ORDER BY e.event_date NULLS LAST, m.created_at LIMIT 40`).catch(() => ({ rows: [] }))).rows;
    const invOut = (await pool.query(`SELECT name, status FROM inventory_assets WHERE status <> 'available' ORDER BY name LIMIT 40`).catch(() => ({ rows: [] }))).rows;
    const aed = (f: unknown) => Math.round(Number(f ?? 0)) / 100;
    const office = {
      money: { todayAed: aed(money.today_fils), todayBookings: Number(money.today_n ?? 0), monthAed: aed(money.month_fils), monthBookings: Number(money.month_n ?? 0), bookedToday: Number(booked.today_n ?? 0), bookedMonth: Number(booked.month_n ?? 0) },
      leads: { newToday: Number(leads.new_today ?? 0), newOpen: Number(leads.new_open ?? 0), quotedOpen: Number(leads.quoted_open ?? 0), bookedWeek: Number(leads.booked_week ?? 0) },
      unpaidCheckouts7d: Number(carts.n ?? 0),
      alerts: { prepIssues: Number(alerts.prep_issues ?? 0), partiesAtRisk: Number(alerts.at_risk ?? 0), crewOpen3d: Number(alerts.crew_open ?? 0) },
      ratings30d: { avg: ratings.avg ?? null, count: Number(ratings.n ?? 0) },
      leaveRequests: leaveReq,
      manualTasks: tasks,
      inventory: { openIssues: invIssues, lowStock: invLow, missing: invMissing, outOfService: invOut },
      whatsappLearning: {
        mode: typeof mode.value === 'string' ? mode.value : (process.env.WHATSAPP_AGENT_MODE ?? 'off'),
        listeningSince: learn.listening_since ?? null,
        since: learn.since ?? null,
        teamReplies: Number(learn.team_replies ?? 0),
        teamRepliesWeek: Number(learn.team_week ?? 0),
        botReplies: Number(learn.bot_replies ?? 0),
        customerMessages: Number(learn.customer_msgs ?? 0),
        chats: Number(learn.chats ?? 0),
      },
    };
    return {
      today,
      office,
      team: rows.map((r) => ({ name: String(r.name).split(' ')[0], events: r.events, prepOpen: Number(r.prep_open), daysOff: r.days_off })),
      upcoming: up.rows.map((r) => ({ date: r.date, time: r.time, emirate: r.emirate, occasion: r.occasion, package: r.package, theme: r.theme, customTheme: r.custom_theme, crew: r.crew, prepTotal: Number(r.prep_total), prepDone: Number(r.prep_done), designOpen: Number(r.design_open), crewOpen: Number(r.crew_open) })),
    };
  });
}
