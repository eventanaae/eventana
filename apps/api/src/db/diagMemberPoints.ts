/**
 * Diagnostic: why does a staff member's Profile show EVENTS but 0 POINTS?
 * Prints, for the member named in DIAG_MEMBER_POINTS (default "Diana"), every
 * event since the scoring start that they're linked to — via event_staff (the
 * EVENTS stat) and/or event_team (the POINTS stat) — with phase + date, plus the
 * two counts computed exactly like the app. Read-only. Gated; turn off after.
 */
import { pool } from './pool.js';
import { COUNTING_START } from '../domain/period.js';

export async function diagMemberPointsFromEnv(): Promise<void> {
  const name = String(process.env.DIAG_MEMBER_POINTS ?? '').trim();
  if (!name) return;

  const mem = await pool.query<{ id: string; name: string }>(
    `SELECT id, name FROM team_members WHERE lower(name) LIKE lower($1) ORDER BY name LIMIT 1`,
    [`%${name}%`],
  );
  if (!mem.rows[0]) { console.log(`[diag-points] no member matching "${name}"`); return; }
  const { id, name: full } = mem.rows[0];
  console.log(`[diag-points] member ${full} = ${id} · scoring start ${COUNTING_START} · today ${new Date().toISOString().slice(0, 10)}`);

  // Every event this member is linked to since the scoring start, either as a
  // service assignee (event_staff) or on the crew roster (event_team).
  const rows = await pool.query(
    `SELECT e.id,
            to_char(e.event_date,'YYYY-MM-DD') AS event_date,
            e.phase,
            e.cancelled_at IS NOT NULL AS cancelled,
            EXISTS (SELECT 1 FROM event_staff s WHERE s.event_id = e.id AND s.assignee_id = $1) AS in_staff,
            EXISTS (SELECT 1 FROM event_team  t WHERE t.event_id = e.id AND t.member_id   = $1) AS in_team
       FROM events e
      WHERE e.event_date >= date_trunc('month', CURRENT_DATE)
        AND e.event_date <  date_trunc('month', CURRENT_DATE) + interval '1 month'
        AND (EXISTS (SELECT 1 FROM event_staff s WHERE s.event_id = e.id AND s.assignee_id = $1)
          OR EXISTS (SELECT 1 FROM event_team  t WHERE t.event_id = e.id AND t.member_id   = $1))
      ORDER BY e.event_date`,
    [id],
  );
  console.log(`[diag-points] this-month linked events: ${rows.rows.length}`);
  for (const r of rows.rows) {
    console.log(`[diag-points]   ${r.event_date} · ${r.id} · phase="${r.phase}" · cancelled=${r.cancelled} · staff=${r.in_staff} · team=${r.in_team}`);
  }

  // EVENTS stat (myProfile): event_staff, this month, not cancelled, completed OR past.
  const eventsStat = await pool.query(
    `SELECT count(DISTINCT es.event_id)::int c FROM event_staff es JOIN events e ON e.id = es.event_id
      WHERE es.assignee_id = $1 AND e.phase <> 'Cancelled' AND e.cancelled_at IS NULL
        AND e.event_date >= GREATEST(date_trunc('month', CURRENT_DATE), $2::date)
        AND e.event_date <  date_trunc('month', CURRENT_DATE) + interval '1 month'
        AND (e.phase = 'Event Completed' OR e.event_date < CURRENT_DATE)`,
    [id, COUNTING_START],
  );
  // POINTS events_done (kpis): event_team, this month, phase = 'Event Completed'.
  const pointsStat = await pool.query(
    `SELECT COUNT(*)::int c FROM event_team et JOIN events e ON e.id = et.event_id
      WHERE et.member_id = $1 AND e.phase = 'Event Completed'
        AND e.event_date >= $2::date
        AND e.event_date <  date_trunc('month', CURRENT_DATE) + interval '1 month'`,
    [id, COUNTING_START],
  );
  console.log(`[diag-points] EVENTS stat (event_staff, completed-or-past) = ${eventsStat.rows[0].c}`);
  console.log(`[diag-points] POINTS events_done (event_team, Event Completed only) = ${pointsStat.rows[0].c}`);
}
