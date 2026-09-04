/**
 * Pre-Event Preparation & Task Management — INTERNAL ONLY.
 *
 * When an order is confirmed the engine reads its package / add-ons / services /
 * theme and creates exactly the preparation tasks that order needs, then
 * fair-assigns each task to qualified staff (by skill, current workload, day-off
 * and how many people the task needs). Design work (Marsha) gates the physical
 * preparation that depends on it. None of this is ever shown to the customer.
 *
 * Reuses the existing roster (team_members), the day-off system
 * (staff_days_off) and the day-of crew plan (event_staff) for workload — it does
 * not duplicate any of them.
 */
import { pool } from '../db/pool.js';

// ── Prep skills per employee (from the owner's spec) ─────────────────────────
// Distinct from the day-of performer skills in staff_skills: these are the
// behind-the-scenes preparation abilities.
export const PREP_SKILLS: Record<string, string[]> = {
  Marsha: ['design'],
  Dindo: ['backdrop', 'cake_stand', 'inflatable', 'foam', 'ice_cream_machine', 'braid_corner'],
  Diana: ['inflatable', 'popcorn', 'cotton_candy', 'table_setup', 'robes', 'braid_corner', 'food_station'],
  Gloria: ['entertainer_costume', 'inflatable', 'tables_chairs', 'speaker', 'foam', 'kids_pedicure', 'food_station'],
  Jane: ['face_painting_prep', 'inflatable', 'entrance_stand', 'table_setup', 'giveaways', 'instant_camera', 'slide_balls', 'kids_manicure', 'spa_tables', 'food_station'],
};

// How many days before the event each kind of task is due.
const DESIGN_DUE_DAYS = 5;
const PHYSICAL_DUE_DAYS = 1;

interface Ctx {
  packageKey: string | null;               // gold | silver | bronze | summer | spa
  isDesignPackage: boolean;                 // any of the above
  customTheme: boolean;                     // customer picked a New Theme
  serviceIds: Set<string>;
  categories: Set<string>;
  has: (id: string) => boolean;
  cat: (c: string) => boolean;
  inflatables: number;                      // how many inflatable rides booked
}

interface Template {
  key: string;
  title: string;
  category: 'design' | 'physical';
  skill: string;
  people: number;
  dependsOnKey?: string;                    // design task this waits on
  checklist?: string[];
  when: (c: Ctx) => boolean;
}

// The full template catalogue. `when` decides whether an order needs the task.
const TEMPLATES: Template[] = [
  // ── Design (Marsha) — gate the physical prep that follows ──
  { key: 'design_cricut', title: 'Cricut', category: 'design', skill: 'design', people: 1, when: (c) => c.isDesignPackage },
  { key: 'design_plate_papers', title: 'Plate Papers (design)', category: 'design', skill: 'design', people: 1, when: (c) => c.isDesignPackage },
  { key: 'design_water_labels', title: 'Water Labels', category: 'design', skill: 'design', people: 1, when: (c) => c.isDesignPackage && c.packageKey !== 'spa' },
  { key: 'design_entrance_stand', title: 'Entrance Stand Design', category: 'design', skill: 'design', people: 1, when: (c) => c.isDesignPackage },
  { key: 'design_new_backdrop', title: 'New Backdrop Design (New Theme)', category: 'design', skill: 'design', people: 1, when: (c) => c.customTheme },
  { key: 'design_giveaways', title: 'Giveaways Design + print', category: 'design', skill: 'design', people: 1, when: (c) => c.cat('giveaways') },

  // ── Physical preparation ──
  { key: 'prep_backdrop', title: 'Main Backdrop — clean & ready', category: 'physical', skill: 'backdrop', people: 1,
    dependsOnKey: 'design_new_backdrop', when: (c) => c.isDesignPackage || c.cat('backdrop') },
  { key: 'prep_cake_stand', title: 'Cake Stand — maintenance', category: 'physical', skill: 'cake_stand', people: 1,
    when: (c) => c.isDesignPackage },
  { key: 'prep_entrance_stand', title: 'Entrance Stand — prepare', category: 'physical', skill: 'entrance_stand', people: 1,
    dependsOnKey: 'design_entrance_stand', when: (c) => c.isDesignPackage },
  { key: 'prep_table_setup', title: 'Table Theme Setup', category: 'physical', skill: 'table_setup', people: 1,
    dependsOnKey: 'design_plate_papers', checklist: ['Plate Papers', 'Plates', 'Spoons / Forks', 'Cutlery Cards', 'Water with Theme'],
    when: (c) => c.isDesignPackage },
  { key: 'prep_tables_chairs', title: 'Tables & Chairs — clean & dress', category: 'physical', skill: 'tables_chairs', people: 1,
    checklist: ['Covers clean', 'Covers scented', 'Covers ironed', 'Tables clean', 'Chairs clean'],
    when: (c) => c.isDesignPackage },
  { key: 'prep_giveaways', title: '10 Giveaways — prepare', category: 'physical', skill: 'giveaways', people: 1,
    dependsOnKey: 'design_giveaways', when: (c) => c.cat('giveaways') },
  { key: 'prep_face_paint', title: 'Face Painting — tools, corner table, chairs', category: 'physical', skill: 'face_painting_prep', people: 1,
    checklist: ['Face painting tools', 'Corner table', 'Chairs'], when: (c) => c.has('facepaint') },
  { key: 'prep_popcorn', title: 'Popcorn — kiosk, clean machine, food box', category: 'physical', skill: 'popcorn', people: 1,
    checklist: ['Kiosk', 'Clean machine', 'Food box'], when: (c) => c.has('popcorn') },
  { key: 'prep_cotton', title: 'Cotton Candy — kiosk, clean machine, food box', category: 'physical', skill: 'cotton_candy', people: 1,
    checklist: ['Kiosk', 'Clean machine', 'Food box'], when: (c) => c.has('cotton') },
  { key: 'prep_inflatable', title: 'Inflatables — cleanliness check', category: 'physical', skill: 'inflatable', people: 2,
    when: (c) => c.inflatables > 0 },
  { key: 'prep_foam', title: 'Foam Machine — check & clean', category: 'physical', skill: 'foam', people: 2,
    when: (c) => c.has('foam') },
  { key: 'prep_ice_cream', title: 'Ice Cream Machine — clean & ready', category: 'physical', skill: 'ice_cream_machine', people: 1,
    when: (c) => c.has('icecream') },
  { key: 'prep_slide_balls', title: 'Wave Slide — clean the balls', category: 'physical', skill: 'slide_balls', people: 1,
    when: (c) => c.has('amwaj') || c.has('bluewater') },
  { key: 'prep_speaker', title: 'Music Speaker — charged & ready', category: 'physical', skill: 'speaker', people: 1,
    when: (c) => c.isDesignPackage },
  { key: 'prep_entertainer', title: 'Entertainer costume — clean & ironed', category: 'physical', skill: 'entertainer_costume', people: 1,
    when: (c) => c.has('clown') || c.has('mascot') },
  { key: 'prep_instant_camera', title: 'Instant Camera — 10 photos/films ready', category: 'physical', skill: 'instant_camera', people: 1,
    when: (c) => c.has('camera') || c.has('instantcamera') },

  // ── Spa Party set ──
  { key: 'prep_robes', title: '15 Pink Robes — clean, ironed, on stand', category: 'physical', skill: 'robes', people: 1,
    checklist: ['Clean', 'Ironed', 'Ready on stand'], when: (c) => c.packageKey === 'spa' },
  { key: 'prep_kids_manicure', title: 'Kids Manicure — tools', category: 'physical', skill: 'kids_manicure', people: 1,
    checklist: ['Nail polish', 'Acetone', 'Cotton', 'Pink container', 'All required tools'], when: (c) => c.packageKey === 'spa' },
  { key: 'prep_kids_pedicure', title: 'Kids Pedicure — tools', category: 'physical', skill: 'kids_pedicure', people: 1,
    when: (c) => c.packageKey === 'spa' },
  { key: 'prep_spa_tables', title: 'Spa Tables & Essentials', category: 'physical', skill: 'spa_tables', people: 1,
    checklist: ['Napkins', 'Plates', 'Mask bowls', 'Cucumber slices', 'Face masks', 'Hair ties', 'Mirrors'], when: (c) => c.packageKey === 'spa' },
  { key: 'prep_braid_corner', title: 'Braid Corner — stand, chair, tools, hair, extensions', category: 'physical', skill: 'braid_corner', people: 2,
    when: (c) => c.packageKey === 'spa' || c.has('braid') },
];

function packageKeyOf(name?: string | null): string | null {
  const n = (name ?? '').toLowerCase();
  if (/gold/.test(n)) return 'gold';
  if (/silver/.test(n)) return 'silver';
  if (/bronze/.test(n)) return 'bronze';
  if (/spa/.test(n)) return 'spa';
  if (/summer|splash/.test(n)) return 'summer';
  return null;
}

/** Resolve the internal crew (name → id) once, seeding skills if needed. */
async function roster(): Promise<Array<{ id: string; name: string; skills: Set<string> }>> {
  const { rows } = await pool.query<{ id: string; name: string }>(
    `SELECT id, name FROM team_members WHERE active`,
  );
  return rows
    .filter((r) => PREP_SKILLS[r.name])
    .map((r) => ({ id: r.id, name: r.name, skills: new Set(PREP_SKILLS[r.name]) }));
}

/**
 * Generate (or rebuild) the preparation tasks for an event and fair-assign them.
 * Idempotent: completed tasks and their notes/photos are preserved on a rebuild.
 */
export async function generatePrepTasks(eventId: string): Promise<{ eventId: string; created: number } | null> {
  const evRes = await pool.query(
    `SELECT e.id, to_char(e.event_date,'YYYY-MM-DD') AS date, e.custom_theme, o.cart, p.name AS package_name
       FROM events e JOIN orders o ON o.id = e.order_id
       LEFT JOIN packages p ON p.id = e.package_id
      WHERE e.id = $1`,
    [eventId],
  );
  const ev = evRes.rows[0];
  if (!ev) return null;

  // Load the catalogue lazily so we can classify services by id/category.
  const { loadConfig } = await import('./settings.js');
  const cfg = await loadConfig();

  const cart = (ev.cart ?? {}) as { services?: Array<{ serviceId: string; quantity: number }> };
  const serviceIds = new Set<string>();
  const categories = new Set<string>();
  let inflatables = 0;
  let packageKey = packageKeyOf(ev.package_name);

  if (Array.isArray(cart.services)) {
    for (const s of cart.services) {
      serviceIds.add(s.serviceId);
      const svc = cfg.services.get(s.serviceId) as any;
      if (svc?.categoryId) categories.add(svc.categoryId);
      if (svc?.isInflatable) inflatables += Number(s.quantity) || 1;
    }
  }
  // Fall back to the booked line items (converted / manual bookings).
  if (!cart.services?.length || !packageKey) {
    const es = await pool.query(`SELECT label, service_id FROM event_services WHERE event_id = $1`, [eventId]);
    for (const row of es.rows) {
      if (row.service_id) {
        serviceIds.add(row.service_id);
        const svc = cfg.services.get(row.service_id) as any;
        if (svc?.categoryId) categories.add(svc.categoryId);
        if (svc?.isInflatable) inflatables += 1;
      }
      if (!packageKey) packageKey = packageKeyOf(String(row.label ?? ''));
    }
  }

  const ctx: Ctx = {
    packageKey,
    isDesignPackage: !!packageKey,
    customTheme: !!ev.custom_theme,
    serviceIds,
    categories,
    has: (id) => serviceIds.has(id),
    cat: (c) => categories.has(c),
    inflatables,
  };

  const needed = TEMPLATES.filter((t) => t.when(ctx));
  if (needed.length === 0) return { eventId, created: 0 };

  const staff = await roster();
  // Current workload = open prep tasks already assigned + day-of crew slots.
  const wlRes = await pool.query(
    `SELECT member_id, count(*)::int c FROM (
        SELECT pts.member_id FROM prep_task_staff pts JOIN prep_tasks pt ON pt.id = pts.task_id
          WHERE pt.status <> 'completed' AND pt.event_id <> $1
        UNION ALL
        SELECT assignee_id AS member_id FROM event_staff WHERE assignee_id IS NOT NULL AND event_id <> $1
     ) w GROUP BY member_id`,
    [eventId],
  );
  const workload = new Map<string, number>(wlRes.rows.map((r: any) => [r.member_id, r.c]));

  // Staff on an approved day off anywhere in the prep window (event day and the
  // two days before) can't be given prep for this event.
  const offRes = await pool.query(
    `SELECT DISTINCT member_id FROM staff_days_off
      WHERE status = 'approved'
        AND start_date <= $1::date AND end_date >= ($1::date - interval '2 days')`,
    [ev.date],
  );
  const off = new Set<string>(offRes.rows.map((r: any) => r.member_id));

  const dueOf = (cat: 'design' | 'physical') => {
    const d = new Date(`${ev.date}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - (cat === 'design' ? DESIGN_DUE_DAYS : PHYSICAL_DUE_DAYS));
    return d.toISOString().slice(0, 10);
  };

  // Rebuild: drop the event's non-completed tasks (keep completed work), then
  // recreate what's needed. Preserve status/notes/photo for tasks that survive.
  const existing = await pool.query<{ key: string; status: string }>(
    `SELECT key, status FROM prep_tasks WHERE event_id = $1`,
    [eventId],
  );
  const completedKeys = new Set(existing.rows.filter((r) => r.status === 'completed').map((r) => r.key));
  await pool.query(
    `DELETE FROM prep_task_staff WHERE task_id IN (SELECT id FROM prep_tasks WHERE event_id = $1 AND status <> 'completed')`,
    [eventId],
  );
  await pool.query(`DELETE FROM prep_tasks WHERE event_id = $1 AND status <> 'completed'`, [eventId]);

  let created = 0;
  for (const t of needed) {
    if (completedKeys.has(t.key)) continue; // already done — leave it
    // A physical task that waits on a design task starts as 'waiting_design'
    // only if that design task is actually part of this order.
    const dep = t.dependsOnKey && needed.some((n) => n.key === t.dependsOnKey) ? t.dependsOnKey : null;
    const status = dep ? 'waiting_design' : 'not_started';
    const checklist = t.checklist ? JSON.stringify(t.checklist.map((label) => ({ label, done: false }))) : null;

    const ins = await pool.query<{ id: string }>(
      `INSERT INTO prep_tasks (event_id, key, title, category, skill, people_needed, depends_on_key, due_date, status, checklist)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
      [eventId, t.key, t.title, t.category, t.skill, t.people, dep, dueOf(t.category), status, checklist],
    );
    const taskId = ins.rows[0].id;
    created++;

    // Fair assignment: qualified, not on day-off, lowest workload first. Assign
    // as many distinct people as the task needs (two-person tasks get two).
    const cands = staff
      .filter((s) => s.skills.has(t.skill) && !off.has(s.id))
      .sort((a, b) => (workload.get(a.id) ?? 0) - (workload.get(b.id) ?? 0));
    for (let i = 0; i < t.people && i < cands.length; i++) {
      const pick = cands[i];
      await pool.query(`INSERT INTO prep_task_staff (task_id, member_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [taskId, pick.id]);
      workload.set(pick.id, (workload.get(pick.id) ?? 0) + 1); // keep it fair within this event too
    }
  }

  await pool.query(
    `INSERT INTO prep_task_log (event_id, action, detail, actor) VALUES ($1,'generated',$2,'system')`,
    [eventId, `Generated ${created} prep task(s)`],
  );
  return { eventId, created };
}

async function logTask(taskId: string, eventId: string | null, action: string, detail: string, actor: string) {
  await pool.query(
    `INSERT INTO prep_task_log (task_id, event_id, action, detail, actor) VALUES ($1,$2,$3,$4,$5)`,
    [taskId, eventId, action, detail, actor],
  ).catch(() => {});
}

/** Mark a task complete with the person who did it, the time, and proof photo. */
export async function completePrepTask(taskId: string, opts: { completedBy?: string; photoUrl?: string; actor?: string }) {
  // Completing a task RESOLVES any issue on it: clear the red issue note so a
  // finished task never keeps showing as a problem (an issue reported then fixed
  // must not stay red once the work is done).
  const { rows } = await pool.query(
    `UPDATE prep_tasks SET status='completed', completed_by=$2, completed_at=now(),
            photo_url=COALESCE($3,photo_url), notes=NULL
      WHERE id=$1 RETURNING event_id, title, depends_on_key`,
    [taskId, opts.completedBy ?? null, opts.photoUrl ?? null],
  );
  const t = rows[0];
  if (!t) return null;
  // If this completion resolved a reported issue, clear its standing ops-alert so
  // owner/manager stop seeing it as open. Match by taskId ALONE — the task id is a
  // unique primary key, so adding event_id could only ever cause a real alert to
  // be missed (e.g. a legacy alert whose event link differs).
  await pool.query(`DELETE FROM notifications WHERE template='prep_issue' AND (payload->>'taskId')=$1`, [String(taskId)]).catch(() => {});
  // Completing a DESIGN task unlocks the physical tasks that were waiting on it.
  await pool.query(
    `UPDATE prep_tasks SET status='ready'
      WHERE event_id=$1 AND status='waiting_design'
        AND depends_on_key = (SELECT key FROM prep_tasks WHERE id=$2)`,
    [t.event_id, taskId],
  );
  await logTask(taskId, t.event_id, 'completed', `${t.title}${opts.completedBy ? ' by ' + opts.completedBy : ''}`, opts.actor ?? 'staff');
  return { eventId: t.event_id };
}

/** Set a task's status (in_progress / issue / etc.) + optional note. */
export async function setPrepTaskStatus(taskId: string, status: string, note: string | null, actor: string) {
  const allowed = ['not_started', 'in_progress', 'waiting_design', 'ready', 'completed', 'issue'];
  if (!allowed.includes(status)) return null;
  const { rows } = await pool.query(
    `UPDATE prep_tasks SET status=$2, notes=COALESCE($3,notes) WHERE id=$1 RETURNING event_id, title`,
    [taskId, status, note],
  );
  const t = rows[0];
  if (!t) return null;
  await logTask(taskId, t.event_id, status === 'issue' ? 'issue' : 'status', `${t.title} → ${status}${note ? ' · ' + note : ''}`, actor);
  // An issue / missing item is surfaced to the Owner + Manager immediately.
  if (status === 'issue') {
    await pool.query(
      `INSERT INTO notifications (event_id, channel, template, scheduled_for, payload)
       VALUES ($1,'ops_alert','prep_issue', now(), $2)`,
      [t.event_id, JSON.stringify({ eventId: t.event_id, taskId, title: t.title, note })],
    ).catch(() => {});
  } else {
    // Moving a task OFF 'issue' (resolved without completing) clears its alert too.
    await pool.query(`DELETE FROM notifications WHERE template='prep_issue' AND (payload->>'taskId')=$1`, [String(taskId)]).catch(() => {});
  }
  return { eventId: t.event_id };
}

/**
 * Self-heal: delete every prep_issue ops-alert whose task is no longer flagged
 * as an issue (completed, moved on, or deleted). Makes the "problem" always
 * vanish once the work is resolved, and cleans up any legacy orphan the older
 * (event_id-scoped) delete missed. Idempotent; safe to run on every boot.
 */
export async function clearResolvedPrepIssueAlerts(): Promise<number> {
  const { rowCount } = await pool.query(
    `DELETE FROM notifications n
      WHERE n.template = 'prep_issue'
        AND NOT EXISTS (
          SELECT 1 FROM prep_tasks pt
           WHERE pt.id::text = n.payload->>'taskId' AND pt.status = 'issue'
        )`,
  );
  return rowCount ?? 0;
}

/** Toggle one checklist item on a task. */
export async function togglePrepChecklist(taskId: string, index: number, done: boolean) {
  const { rows } = await pool.query<{ checklist: any }>(`SELECT checklist FROM prep_tasks WHERE id=$1`, [taskId]);
  const list = (rows[0]?.checklist ?? []) as Array<{ label: string; done: boolean }>;
  if (!list[index]) return null;
  list[index].done = done;
  await pool.query(`UPDATE prep_tasks SET checklist=$2 WHERE id=$1`, [taskId, JSON.stringify(list)]);
  return { ok: true };
}

/** Owner/Manager override: set the exact assignees for a task. */
export async function setPrepAssignees(taskId: string, memberIds: string[], actor: string) {
  const { rows } = await pool.query<{ event_id: string; title: string }>(`SELECT event_id, title FROM prep_tasks WHERE id=$1`, [taskId]);
  const t = rows[0];
  if (!t) return null;
  await pool.query(`DELETE FROM prep_task_staff WHERE task_id=$1`, [taskId]);
  for (const m of memberIds) {
    await pool.query(`INSERT INTO prep_task_staff (task_id, member_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [taskId, m]);
  }
  await logTask(taskId, t.event_id, 'reassigned', `${t.title} → ${memberIds.length} assignee(s)`, actor);
  return { eventId: t.event_id };
}

/** Every prep task assigned to one staff member (their personal work list). */
export async function getPrepTasksForMember(memberId: string) {
  const { rows } = await pool.query(
    `SELECT pt.*, to_char(pt.due_date,'YYYY-MM-DD') AS due, e.event_date, to_char(e.event_date,'YYYY-MM-DD') AS event_date_str,
            c.name AS customer, e.emirate
       FROM prep_tasks pt
       JOIN prep_task_staff pts ON pts.task_id = pt.id
       JOIN events e ON e.id = pt.event_id
       JOIN customers c ON c.id = e.customer_id
      WHERE pts.member_id = $1 AND pt.status <> 'completed'
      ORDER BY pt.due_date, pt.id`,
    [memberId],
  );
  return rows;
}

/** Board grouped by person: every staff member with their open prep tasks. */
export async function getPrepByPerson() {
  const { rows } = await pool.query(
    `SELECT tm.id, tm.name, tm.color,
            COALESCE(json_agg(json_build_object(
              'id', pt.id, 'title', pt.title, 'status', pt.status, 'category', pt.category,
              'eventId', pt.event_id, 'due', to_char(pt.due_date,'YYYY-MM-DD'), 'customer', c.name
            ) ORDER BY pt.due_date) FILTER (WHERE pt.id IS NOT NULL), '[]') AS tasks,
            count(pt.id) FILTER (WHERE pt.status NOT IN ('completed'))::int AS open_count
       FROM team_members tm
       LEFT JOIN prep_task_staff pts ON pts.member_id = tm.id
       LEFT JOIN prep_tasks pt ON pt.id = pts.task_id AND pt.status <> 'completed'
       LEFT JOIN events e ON e.id = pt.event_id
       LEFT JOIN customers c ON c.id = e.customer_id
      WHERE tm.active AND tm.name = ANY($1)
      GROUP BY tm.id, tm.name, tm.color
      ORDER BY open_count DESC, tm.name`,
    [Object.keys(PREP_SKILLS)],
  );
  return rows;
}

/**
 * Alert the Owner + Manager about any event within 3 days whose preparation
 * isn't finished ("Event Preparation At Risk"). One alert per event; runs from
 * the reconciliation sweep. Internal only.
 */
export async function sweepPrepAtRisk(): Promise<number> {
  const { rows } = await pool.query<{ event_id: string; total: number; done: number }>(
    `SELECT pt.event_id,
            count(*)::int AS total,
            count(*) FILTER (WHERE pt.status = 'completed')::int AS done
       FROM prep_tasks pt
       JOIN events e ON e.id = pt.event_id
      WHERE e.phase <> 'Cancelled'
        AND e.event_date >= CURRENT_DATE
        AND e.event_date <= CURRENT_DATE + interval '3 days'
      GROUP BY pt.event_id
      HAVING count(*) FILTER (WHERE pt.status = 'completed') < count(*)`,
  );
  let alerted = 0;
  for (const r of rows) {
    const res = await pool.query(
      `INSERT INTO notifications (event_id, channel, template, scheduled_for, payload)
       SELECT $1,'ops_alert','prep_at_risk', now(), $2
        WHERE NOT EXISTS (SELECT 1 FROM notifications WHERE template='prep_at_risk' AND event_id=$1)`,
      [r.event_id, JSON.stringify({ eventId: r.event_id, done: Number(r.done), total: Number(r.total) })],
    );
    if (res.rowCount) alerted++;
  }
  return alerted;
}

/** Per-event preparation progress summaries (upcoming events with prep tasks). */
export async function getPrepEvents() {
  const { rows } = await pool.query(
    `SELECT pt.event_id, to_char(e.event_date,'YYYY-MM-DD') AS event_date, c.name AS customer, e.emirate,
            count(*)::int AS total,
            count(*) FILTER (WHERE pt.status = 'completed')::int AS completed,
            count(*) FILTER (WHERE pt.status = 'issue')::int AS issues,
            count(*) FILTER (WHERE pt.status = 'waiting_design')::int AS waiting
       FROM prep_tasks pt
       JOIN events e ON e.id = pt.event_id
       JOIN customers c ON c.id = e.customer_id
      WHERE e.phase <> 'Cancelled' AND e.event_date >= CURRENT_DATE - interval '1 day'
      GROUP BY pt.event_id, e.event_date, c.name, e.emirate
      ORDER BY e.event_date`,
  );
  const today = Date.now();
  return rows.map((r: any) => {
    const total = Number(r.total); const done = Number(r.completed);
    const pct = total ? Math.round((done / total) * 100) : 0;
    const daysToEvent = Math.ceil((Date.parse(`${r.event_date}T00:00:00+04:00`) - today) / 86_400_000);
    // "At risk" when the event is within 3 days and prep isn't finished.
    const atRisk = daysToEvent <= 3 && done < total;
    return { ...r, total, completed: done, issues: Number(r.issues), waiting: Number(r.waiting), progressPct: pct, daysToEvent, atRisk };
  });
}

/** Read an event's prep plan with assignees + progress. Internal only. */
export async function getPrepPlan(eventId: string) {
  const { rows } = await pool.query(
    `SELECT pt.*, to_char(pt.due_date,'YYYY-MM-DD') AS due,
            COALESCE(json_agg(json_build_object('id', tm.id, 'name', tm.name)) FILTER (WHERE tm.id IS NOT NULL), '[]') AS assignees
       FROM prep_tasks pt
       LEFT JOIN prep_task_staff pts ON pts.task_id = pt.id
       LEFT JOIN team_members tm ON tm.id = pts.member_id
      WHERE pt.event_id = $1
      GROUP BY pt.id
      ORDER BY (pt.category = 'design') DESC, pt.due_date, pt.id`,
    [eventId],
  );
  const total = rows.length;
  const done = rows.filter((r) => r.status === 'completed').length;
  const issues = rows.filter((r) => r.status === 'issue').length;
  return {
    eventId,
    tasks: rows,
    total,
    completed: done,
    issues,
    progressPct: total ? Math.round((done / total) * 100) : 0,
  };
}
