/**
 * Diagnostic: why does a staff member's Profile show EVENTS but 0 POINTS?
 * Prints, for the member named in DIAG_MEMBER_POINTS (default "Diana"), every
 * event since the scoring start that they're linked to — via event_staff (the
 * EVENTS stat) and/or event_team (the POINTS stat) — with phase + date, plus the
 * two counts computed exactly like the app. Read-only. Gated; turn off after.
 */
import { pool } from './pool.js';
import { COUNTING_START } from '../domain/period.js';

/**
 * Diagnostic (DIAG_FEEDBACK=true): why are no new ratings coming in? Reports
 * whether post-event feedback requests are actually going out (email + WhatsApp)
 * and what's coming back, over the last 45 days. Read-only. Turn off after.
 */
export async function diagFeedbackFromEnv(): Promise<void> {
  if (String(process.env.DIAG_FEEDBACK ?? '').toLowerCase() !== 'true') return;
  const { config } = await import('../config.js');
  const { whatsappEnabled } = await import('../integrations/whatsapp.js').catch(() => ({ whatsappEnabled: () => false }));
  console.log(`[diag-fb] whatsapp configured=${(() => { try { return whatsappEnabled(); } catch { return 'err'; } })()} · customerNotify=${config.whatsapp?.customerNotify} → WhatsApp feedback ${config.whatsapp?.customerNotify ? 'ON' : 'OFF (email only)'}`);

  const q = async (label: string, sql: string) => {
    try { const { rows } = await pool.query(sql); console.log(`[diag-fb] ${label}: ${JSON.stringify(rows[0] ?? rows)}`); }
    catch (e) { console.log(`[diag-fb] ${label}: ERR ${(e as Error).message}`); }
  };
  await q('events completed (45d)', `SELECT count(*)::int n FROM events WHERE phase='Event Completed' AND event_date >= current_date - 45`);
  await q('feedback_request rows (45d)', `SELECT count(*)::int total, count(*) FILTER (WHERE sent_at IS NOT NULL)::int sent, count(*) FILTER (WHERE sent_at IS NULL AND cancelled_at IS NULL)::int pending, count(*) FILTER (WHERE cancelled_at IS NOT NULL)::int cancelled FROM notifications WHERE template='feedback_request' AND created_at >= now() - interval '45 days'`);
  await q('feedback_request by channel (45d, sent)', `SELECT channel, count(*)::int n FROM notifications WHERE template='feedback_request' AND sent_at IS NOT NULL AND created_at >= now() - interval '45 days' GROUP BY channel`);
  await q('ratings received (45d)', `SELECT count(*)::int n, count(*) FILTER (WHERE created_at >= now() - interval '7 days')::int last7 FROM event_ratings WHERE created_at >= now() - interval '45 days'`);
  await q('latest rating', `SELECT to_char(max(created_at),'YYYY-MM-DD HH24:MI') last_rating FROM event_ratings`);
  try {
    const { rows } = await pool.query(`SELECT event_id, channel, to_char(scheduled_for,'YYYY-MM-DD') sched, (sent_at IS NOT NULL) sent, (cancelled_at IS NOT NULL) cancelled FROM notifications WHERE template='feedback_request' ORDER BY created_at DESC LIMIT 8`);
    for (const r of rows) console.log(`[diag-fb]   ${r.event_id} · ${r.channel} · sched=${r.sched} · sent=${r.sent} · cancelled=${r.cancelled}`);
  } catch (e) { console.log(`[diag-fb] sample ERR ${(e as Error).message}`); }
}

/**
 * Diagnostic (DIAG_AUTH=true): before retiring the master token / access-token
 * login, confirm the owner (and team) can actually sign in with email + password
 * — i.e. each has an email set and a password_hash. Read-only. Turn off after.
 */
export async function diagAuthFromEnv(): Promise<void> {
  if (String(process.env.DIAG_AUTH ?? '').toLowerCase() !== 'true') return;
  const { rows } = await pool.query(
    `SELECT name, access_level, active,
            (email IS NOT NULL AND email <> '') AS has_email,
            email,
            (password_hash IS NOT NULL AND password_hash <> '') AS has_password,
            to_char(last_login_at,'YYYY-MM-DD HH24:MI') AS last_login
       FROM team_members
      ORDER BY (access_level='owner') DESC, (access_level='manager') DESC, name`,
  );
  console.log(`[diag-auth] ${rows.length} members:`);
  for (const r of rows) {
    console.log(`[diag-auth]   ${r.name} · ${r.access_level} · active=${r.active} · email=${r.has_email ? r.email : 'NONE'} · password=${r.has_password ? 'set' : 'NOT SET'} · lastLogin=${r.last_login ?? 'never'}`);
  }
  const owners = rows.filter((r: any) => r.access_level === 'owner' && r.active);
  const readyOwners = owners.filter((r: any) => r.has_email && r.has_password);
  console.log(`[diag-auth] active owners: ${owners.length} · ready to log in (email+password): ${readyOwners.length}`);
  console.log(`[diag-auth] ${readyOwners.length >= 1 ? 'SAFE to retire the master token — an owner can sign in with email+password.' : '⚠️ NOT SAFE yet — no owner has BOTH an email and a password set.'}`);
}

/**
 * Team-wide sweep (DIAG_ALL_POINTS=true): for every scored member, compare the
 * OLD EVENTS count (event_staff) vs the NEW one (event_team = points base),
 * print exact points, and flag any warning whose affects_points is NULL (which
 * the old code would have used to wrongly wipe points). Read-only.
 */
export async function diagAllPointsFromEnv(): Promise<void> {
  if (String(process.env.DIAG_ALL_POINTS ?? '').toLowerCase() !== 'true') return;
  const monthStart = new Date().toISOString().slice(0, 8) + '01';
  const start = monthStart < String(COUNTING_START) ? String(COUNTING_START) : monthStart;
  const end = new Date(); end.setUTCDate(1); end.setUTCMonth(end.getUTCMonth() + 1);
  const endStr = end.toISOString().slice(0, 10);
  const ym = new Date().toISOString().slice(0, 7);
  console.log(`[diag-all] scoring window ${start} → ${endStr} (ym ${ym})`);

  const members = await pool.query<{ id: string; name: string }>(
    `SELECT id, name FROM team_members WHERE active AND lower(name) NOT IN ('shan','sheem') ORDER BY name`,
  );
  const anomalies: string[] = [];
  for (const m of members.rows) {
    const [teamC, staffC, fs, glam, ref, warns] = await Promise.all([
      pool.query(`SELECT COUNT(DISTINCT et.event_id)::int c FROM event_team et JOIN events e ON e.id=et.event_id
                   WHERE et.member_id=$1 AND e.phase='Event Completed' AND e.event_date>=$2 AND e.event_date<$3`, [m.id, start, endStr]),
      pool.query(`SELECT COUNT(DISTINCT es.event_id)::int c FROM event_staff es JOIN events e ON e.id=es.event_id
                   WHERE es.assignee_id=$1 AND e.phase<>'Cancelled' AND e.cancelled_at IS NULL
                     AND e.event_date>=$2 AND e.event_date<$3 AND (e.phase='Event Completed' OR e.event_date<CURRENT_DATE)`, [m.id, start, endStr]),
      pool.query(`SELECT COUNT(*)::int c FROM event_ratings r JOIN event_team et ON et.event_id=r.event_id JOIN events e ON e.id=r.event_id
                   WHERE et.member_id=$1 AND r.stars=5 AND e.event_date>=$2 AND e.event_date<$3`, [m.id, start, endStr]),
      pool.query(`SELECT COUNT(DISTINCT e.id)::int n FROM events e
                   JOIN event_staff gs ON gs.event_id=e.id AND (gs.source ILIKE '%glam%' OR gs.role ILIKE '%glam%')
                   JOIN event_staff crew ON crew.event_id=e.id AND crew.assignee_id=$1
                   WHERE e.phase='Event Completed' AND e.event_date>=$2 AND e.event_date<$3`, [m.id, start, endStr]),
      pool.query(`SELECT COALESCE(SUM(event_value_fils),0)::bigint v FROM staff_referral_events WHERE member_id=$1 AND created_at>=$2 AND created_at<$3`, [m.id, start, endStr]),
      pool.query(`SELECT affects_points, wtype FROM staff_warnings WHERE member_id=$1 AND ym=$2`, [m.id, ym]),
    ]);
    const ev = teamC.rows[0].c, sv = staffC.rows[0].c, five = fs.rows[0].c, gl = glam.rows[0].n;
    const refPts = Math.round(Number(ref.rows[0].v) / 200);
    const wipes = warns.rows.some((w: any) => w.affects_points === true);
    const nullWarn = warns.rows.some((w: any) => w.affects_points === null || w.affects_points === undefined);
    const pts = wipes ? 0 : ev * 10 + five * 20 + gl * 20 + refPts;
    const warnStr = warns.rows.length ? ` · warnings=${warns.rows.map((w: any) => `${w.wtype}:${w.affects_points === null ? 'NULL' : w.affects_points}`).join(',')}` : '';
    console.log(`[diag-all] ${m.name}: EVENTS old(staff)=${sv} new(team)=${ev} · 5★=${five} glam=${gl} ref=${refPts} · POINTS=${pts}${wipes ? ' (WIPED)' : ''}${warnStr}`);
    if (sv !== ev) anomalies.push(`${m.name}: EVENTS mismatch old=${sv} new=${ev}`);
    if (nullWarn) anomalies.push(`${m.name}: warning with NULL affects_points (old code would have wiped points!)`);
  }
  console.log(`[diag-all] anomalies: ${anomalies.length ? anomalies.join(' | ') : 'none'}`);
}

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

  // Why might points show 0 despite completed events? A disciplinary warning for
  // this month with affects_points=true wipes the month's points by design.
  const ym = new Date().toISOString().slice(0, 7);
  const warn = await pool.query(
    `SELECT reason, affects_points, wtype, to_char(issued_date,'YYYY-MM-DD') AS issued
       FROM staff_warnings WHERE member_id = $1 AND ym = $2`,
    [id, ym],
  );
  if (warn.rows[0]) {
    const w = warn.rows[0];
    console.log(`[diag-points] WARNING for ${ym}: type="${w.wtype}" affects_points=${w.affects_points} issued=${w.issued} reason="${w.reason}"`);
    console.log(`[diag-points] → points ${w.affects_points ? 'ARE WIPED to 0 by this warning (by design)' : 'NOT wiped (on record only)'}`);
  } else {
    console.log(`[diag-points] no warning for ${ym} — points should reflect the ${pointsStat.rows[0].c} completed events`);
  }

  // Five-star ratings this month on her team's events (adds 20 pts each).
  const fiveStar = await pool.query(
    `SELECT COUNT(*)::int c FROM event_ratings r
       JOIN event_team et ON et.event_id = r.event_id
       JOIN events e ON e.id = r.event_id
      WHERE et.member_id = $1 AND r.stars = 5 AND e.event_date >= $2::date`,
    [id, COUNTING_START],
  );
  console.log(`[diag-points] this-month 5★ = ${fiveStar.rows[0].c} · expected activity points ≈ ${pointsStat.rows[0].c * 10 + fiveStar.rows[0].c * 20}`);

  // Every warning row for this member — to catch a stale/duplicate row that the
  // kpis engine's warnMap might pick instead of the exception. kpis wipes points
  // when the surviving row has affects_points !== false (so NULL also wipes!).
  const warnAll = await pool.query(
    `SELECT id, ym, wtype, affects_points, reason, to_char(issued_date,'YYYY-MM-DD') AS issued
       FROM staff_warnings WHERE member_id = $1 ORDER BY ym, id`,
    [id],
  );
  console.log(`[diag-points] total warning rows: ${warnAll.rows.length}`);
  for (const w of warnAll.rows) {
    const raw = w.affects_points;
    console.log(`[diag-points]   id=${w.id} ym=${w.ym} type=${w.wtype} affects_points=${raw === null ? 'NULL' : raw} (${raw === null ? 'null' : typeof raw}) issued=${w.issued}`);
  }
  const ymRows = warnAll.rows.filter((w: any) => w.ym === ym);
  const anyWipes = ymRows.some((w: any) => w.affects_points === true);
  console.log(`[diag-points] ym=${ym} warning rows: ${ymRows.length} · points ${anyWipes ? 'WIPED (an explicit affects_points=true)' : 'KEPT'}`);

  // Exact final points, replicating the kpis engine (event_team completed*10 +
  // 5★*20 + glam*20 + referral value/200), using this month's window.
  const monthStart = new Date().toISOString().slice(0, 8) + '01';
  const start = monthStart < String(COUNTING_START) ? String(COUNTING_START) : monthStart;
  const end = new Date(); end.setUTCDate(1); end.setUTCMonth(end.getUTCMonth() + 1);
  const endStr = end.toISOString().slice(0, 10);
  const glam = await pool.query(
    `SELECT COUNT(DISTINCT e.id)::int n FROM events e
       JOIN event_staff gs ON gs.event_id = e.id AND (gs.source ILIKE '%glam%' OR gs.role ILIKE '%glam%')
       JOIN event_staff crew ON crew.event_id = e.id AND crew.assignee_id = $1
      WHERE e.phase='Event Completed' AND e.event_date >= $2 AND e.event_date < $3`,
    [id, start, endStr],
  );
  const ref = await pool.query(
    `SELECT COALESCE(SUM(event_value_fils),0)::bigint v FROM staff_referral_events
      WHERE member_id=$1 AND created_at >= $2 AND created_at < $3`,
    [id, start, endStr],
  );
  const ev = Number(pointsStat.rows[0].c), fs = Number(fiveStar.rows[0].c), gl = Number(glam.rows[0].n);
  const refPts = Math.round(Number(ref.rows[0].v) / 200);
  const finalPts = anyWipes ? 0 : ev * 10 + fs * 20 + gl * 20 + refPts;
  console.log(`[diag-points] EXACT points = ${finalPts}  (events ${ev}×10 + 5★ ${fs}×20 + glam ${gl}×20 + referral ${refPts})`);
}
