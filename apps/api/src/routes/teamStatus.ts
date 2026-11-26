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

const REPORT_KEY_SHA256 = 'd7adf93428c04153d718ec5a4d1084a9c5b78e63be712d392de4edf49b112ed9';

function keyOk(given: string | undefined): boolean {
  const envKey = process.env.MARKETING_REPORT_KEY;
  return (!!envKey && envKey.length >= 24 && safeEqual(given, envKey))
    || (!!given && safeEqual(createHash('sha256').update(given).digest('hex'), REPORT_KEY_SHA256));
}

export async function teamStatusRoutes(app: FastifyInstance): Promise<void> {
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
    return {
      today,
      team: rows.map((r) => ({ name: String(r.name).split(' ')[0], events: r.events, prepOpen: Number(r.prep_open), daysOff: r.days_off })),
      upcoming: up.rows.map((r) => ({ date: r.date, time: r.time, emirate: r.emirate, occasion: r.occasion, package: r.package, theme: r.theme, customTheme: r.custom_theme, crew: r.crew, prepTotal: Number(r.prep_total), prepDone: Number(r.prep_done), designOpen: Number(r.design_open), crewOpen: Number(r.crew_open) })),
    };
  });
}
