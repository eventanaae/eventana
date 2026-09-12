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
import { randomUUID } from 'node:crypto';
import { pool } from '../db/pool.js';
import { celebrationLabel } from '@eventana/shared';

// ── Prep skills per employee (from the owner's spec) ─────────────────────────
// Distinct from the day-of performer skills in staff_skills: these are the
// behind-the-scenes preparation abilities.
export const PREP_SKILLS: Record<string, string[]> = {
  Marsha: ['design'],
  Dindo: ['backdrop', 'cake_stand', 'inflatable', 'foam', 'ice_cream_machine', 'braid_corner', 'balloons'],
  Diana: ['inflatable', 'popcorn', 'cotton_candy', 'table_setup', 'robes', 'braid_corner', 'food_station', 'balloons'],
  Gloria: ['entertainer_costume', 'inflatable', 'tables_chairs', 'speaker', 'foam', 'kids_pedicure', 'food_station', 'glam_dolls'],
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
  noEntranceStand: boolean;                 // summer/splash & offer bundles skip it
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
  // A Main Backdrop (in a package OR ordered on its own) needs a Cricut cut for
  // the guest-of-honour name + character cutouts — always a design task for Marsha.
  { key: 'design_cricut', title: 'Cricut', category: 'design', skill: 'design', people: 1, when: (c) => c.isDesignPackage || c.cat('backdrop') || c.has('backdrop') },
  { key: 'design_plate_papers', title: 'Plate Papers (design)', category: 'design', skill: 'design', people: 1, when: (c) => c.isDesignPackage },
  { key: 'design_water_labels', title: 'Water Labels', category: 'design', skill: 'design', people: 1, when: (c) => c.isDesignPackage && c.packageKey !== 'spa' },
  { key: 'design_entrance_stand', title: 'Entrance Stand Design', category: 'design', skill: 'design', people: 1, when: (c) => (c.isDesignPackage || c.has('entrance')) && !c.noEntranceStand },
  { key: 'design_new_backdrop', title: 'New Backdrop Design (New Theme)', category: 'design', skill: 'design', people: 1, when: (c) => c.customTheme },
  { key: 'design_giveaways', title: 'Giveaways Design + print', category: 'design', skill: 'design', people: 1, when: (c) => c.cat('giveaways') },

  // ── Physical preparation ──
  { key: 'prep_backdrop', title: 'Main Backdrop — clean & ready', category: 'physical', skill: 'backdrop', people: 1,
    dependsOnKey: 'design_new_backdrop', when: (c) => c.isDesignPackage || c.cat('backdrop') || c.has('backdrop') },
  { key: 'prep_cake_stand', title: 'Cake Stand — maintenance', category: 'physical', skill: 'cake_stand', people: 1,
    when: (c) => c.isDesignPackage || c.has('cakestand') },
  { key: 'prep_entrance_stand', title: 'Entrance Stand — prepare', category: 'physical', skill: 'entrance_stand', people: 1,
    dependsOnKey: 'design_entrance_stand', when: (c) => (c.isDesignPackage || c.has('entrance')) && !c.noEntranceStand },
  { key: 'prep_table_setup', title: 'Table Theme Setup', category: 'physical', skill: 'table_setup', people: 1,
    dependsOnKey: 'design_plate_papers', checklist: ['Plate Papers', 'Plates', 'Spoons / Forks', 'Cutlery Cards', 'Water with Theme'],
    when: (c) => c.isDesignPackage || c.has('tables') },
  { key: 'prep_tables_chairs', title: 'Tables & Chairs — clean & dress', category: 'physical', skill: 'tables_chairs', people: 1,
    checklist: ['Covers clean', 'Covers scented', 'Covers ironed', 'Tables clean', 'Chairs clean'],
    when: (c) => c.isDesignPackage || c.has('tables') },
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
    when: (c) => c.isDesignPackage || c.has('speaker') },
  { key: 'prep_entertainer', title: 'Entertainer costume — clean & ironed', category: 'physical', skill: 'entertainer_costume', people: 1,
    when: (c) => c.has('clown') || c.has('mascot') },
  { key: 'prep_instant_camera', title: 'Instant Camera — 10 photos/films ready', category: 'physical', skill: 'instant_camera', people: 1,
    when: (c) => c.has('camera') || c.has('instantcamera') },

  // ── Balloons ──
  { key: 'prep_balloons_box', title: 'Balloons Box — prepare', category: 'physical', skill: 'balloons', people: 1,
    when: (c) => c.has('balloons') },
  { key: 'prep_helium_tank', title: 'Helium Tank — prepare (if needed)', category: 'physical', skill: 'balloons', people: 1,
    when: (c) => c.has('balloons') },

  // ── Host ──
  { key: 'prep_host_costume', title: 'Host Costume — prepare', category: 'physical', skill: 'entertainer_costume', people: 1,
    when: (c) => c.has('host') },
  { key: 'prep_host_music', title: 'Music Box — prepare (Host)', category: 'physical', skill: 'speaker', people: 1,
    when: (c) => c.has('host') },

  // ── Glam Dolls ──
  { key: 'prep_glam_mascot', title: 'Glam Dolls Mascot — ensure it’s teddy & clean', category: 'physical', skill: 'entertainer_costume', people: 1,
    when: (c) => c.has('glamdolls') },
  { key: 'prep_glam_clothes', title: 'Glam Dolls Clothes — 2 outfits for each', category: 'physical', skill: 'glam_dolls', people: 1,
    when: (c) => c.has('glamdolls') },
  { key: 'prep_glam_music', title: 'Music Box — prepare (Glam Dolls)', category: 'physical', skill: 'speaker', people: 1,
    when: (c) => c.has('glamdolls') },
  { key: 'prep_glam_flash', title: 'Flash — ensure it’s there', category: 'physical', skill: 'instant_camera', people: 1,
    when: (c) => c.has('glamdolls') },

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
  // A generic "AED … Offer" bundle prepares like Bronze but without the
  // welcoming stand or instant photo (owner's rule).
  if (/offer/.test(n)) return 'offer';
  return null;
}

/**
 * Map a free-text line-item label (manual/converted bookings store products as
 * text, not catalogue ids) onto the same product flags the templates check, so a
 * text-only booking still gets its tasks. Mirrors the keyword approach used for
 * package names.
 */
function classifyLabel(label: string, serviceIds: Set<string>, categories: Set<string>): number {
  const n = (label ?? '').toLowerCase();
  let inflatable = 0;
  if (/popcorn/.test(n)) serviceIds.add('popcorn');
  if (/cotton/.test(n)) serviceIds.add('cotton');
  if (/face\s*paint/.test(n)) serviceIds.add('facepaint');
  if (/foam/.test(n)) serviceIds.add('foam');
  if (/ice\s*cream/.test(n)) serviceIds.add('icecream');
  if (/instant|camera|photograph/.test(n)) serviceIds.add('camera');
  if (/(entertainer|clown|mascot)/.test(n) && !/glam/.test(n)) serviceIds.add('clown');
  if (/giveaway/.test(n)) categories.add('giveaways');
  // Made-to-order shop goods (customized hat, face banner, wristband, t-shirt)
  // → 'giveaways', which fires design_giveaways (Marsha designs) then
  // prep_giveaways (Jane prepares, waits on the design). This is the owner's
  // rule for anything from the Shop: Marsha designs it, then Jane prepares it.
  // ("hat painting" is an activity, not a shop hat — the 'custom' guard skips it.)
  if (/custom\w*\s*hat|face\s*banner|\bbanner\b|wrist\s*band|wristband|t[-\s]?shirt|tee\s*shirt|vip\s*band/.test(n)) categories.add('giveaways');
  if (/backdrop/.test(n)) serviceIds.add('backdrop');
  if (/inflatable|bouncy|bouncer|castle|jumping|jumper/.test(n)) inflatable += 1;
  if (/wave\s*slide|amwaj|blue\s*water/.test(n)) serviceIds.add('amwaj');
  if (/cake\s*stand/.test(n)) serviceIds.add('cakestand');
  if (/speaker/.test(n)) serviceIds.add('speaker');
  if (/table|chair/.test(n)) serviceIds.add('tables');
  if (/entrance|welcoming\s*stand|welcome\s*stand/.test(n)) serviceIds.add('entrance');
  if (/balloon/.test(n)) serviceIds.add('balloons');
  if (/\bhost\b/.test(n)) serviceIds.add('host');
  if (/glam\s*doll/.test(n)) serviceIds.add('glamdolls');
  return inflatable;
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
  // No real date (TBD/unset) → no prep plan yet. Guards dueOf against building
  // `new Date("nullT00:00:00Z")` (Invalid Date → toISOString throws). Prep is
  // regenerated once the date is finalised.
  if (!ev.date || !/^\d{4}-\d{2}-\d{2}$/.test(String(ev.date))) return null;

  // Load the catalogue lazily so we can classify services by id/category.
  const { loadConfig } = await import('./settings.js');
  const cfg = await loadConfig();

  const cart = (ev.cart ?? {}) as { services?: Array<{ serviceId: string; quantity: number }> };
  const serviceIds = new Set<string>();
  const categories = new Set<string>();
  let inflatables = 0;
  let packageKey = packageKeyOf(ev.package_name);
  let newThemeLine = false; // a "New Theme" line means a custom backdrop to design

  if (Array.isArray(cart.services)) {
    for (const s of cart.services) {
      serviceIds.add(s.serviceId);
      const svc = cfg.services.get(s.serviceId) as any;
      if (svc?.categoryId) categories.add(svc.categoryId);
      if (svc?.isInflatable) inflatables += Number(s.quantity) || 1;
    }
  }
  // Always read the booked line items. Manual & converted bookings store every
  // product as free text (no catalogue id), so classifyLabel derives the product
  // flags from the label text — otherwise these bookings generate no tasks.
  const es = await pool.query(`SELECT label, service_id FROM event_services WHERE event_id = $1`, [eventId]);
  for (const row of es.rows) {
    if (row.service_id) {
      serviceIds.add(row.service_id);
      const svc = cfg.services.get(row.service_id) as any;
      if (svc?.categoryId) categories.add(svc.categoryId);
      if (svc?.isInflatable) inflatables += 1;
    }
    inflatables += classifyLabel(String(row.label ?? ''), serviceIds, categories);
    if (!packageKey) packageKey = packageKeyOf(String(row.label ?? ''));
    // A "New Theme" line = the customer wants a brand-new theme designed. Converted
    // receipts don't set the event's custom_theme flag, so read it from the line
    // here → fires the New-Backdrop design task for Marsha (instead of the line
    // being escalated as an unknown item).
    if (/new\s*theme/i.test(String(row.label ?? ''))) newThemeLine = true;
  }

  const ctx: Ctx = {
    packageKey,
    isDesignPackage: !!packageKey,
    customTheme: !!ev.custom_theme || newThemeLine,
    serviceIds,
    categories,
    has: (id) => serviceIds.has(id),
    cat: (c) => categories.has(c),
    inflatables,
    // Summer/Splash and the generic Offer bundle don't include a welcoming stand.
    noEntranceStand: packageKey === 'summer' || packageKey === 'offer',
  };

  const needed = TEMPLATES.filter((t) => t.when(ctx));
  // NOTE: we deliberately do NOT bail when no template matches. A booking can be
  // entirely items the templates don't recognise (e.g. a bespoke "Customized
  // Hat"); those still have to reach backfillUncoveredPrep below so every paid
  // line becomes a task or an escalation — never a silent drop.

  const staff = await roster();
  // Current workload = open prep tasks already assigned + day-of crew slots.
  const wlRes = await pool.query(
    `SELECT member_id, count(*)::int c FROM (
        SELECT pts.member_id FROM prep_task_staff pts JOIN prep_tasks pt ON pt.id = pts.task_id
          WHERE pt.status <> 'completed' AND pt.event_id <> $1
        UNION ALL
        SELECT es.assignee_id AS member_id FROM event_staff es JOIN events e ON e.id = es.event_id
          WHERE es.assignee_id IS NOT NULL AND es.event_id <> $1
            AND es.is_leader IS NOT TRUE AND e.phase <> 'Cancelled'
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
  // Manually-logged customer extras (key 'extra_…', from addExtraPrepTask) are
  // ALSO preserved — they have no template to recreate them, so deleting them on
  // a regenerate would silently drop a customer request that was already tasked.
  const existing = await pool.query<{ key: string; status: string }>(
    `SELECT key, status FROM prep_tasks WHERE event_id = $1`,
    [eventId],
  );
  const completedKeys = new Set(existing.rows.filter((r) => r.status === 'completed').map((r) => r.key));
  await pool.query(
    `DELETE FROM prep_task_staff WHERE task_id IN (
       SELECT id FROM prep_tasks WHERE event_id = $1 AND status <> 'completed' AND left(key,6) <> 'extra_')`,
    [eventId],
  );
  await pool.query(
    `DELETE FROM prep_tasks WHERE event_id = $1 AND status <> 'completed' AND left(key,6) <> 'extra_'`,
    [eventId],
  );

  let created = 0;
  for (const t of needed) {
    if (completedKeys.has(t.key)) continue; // already done — leave it
    // A physical task that waits on a design task starts as 'waiting_design'
    // only if that design task is actually part of this order AND isn't already
    // finished. If the design was completed on an earlier pass (regenerate /
    // add-on), the physical task is born ready — otherwise it would sit on
    // 'waiting_design' forever, since the one-time release fired before it existed.
    const dep = t.dependsOnKey && needed.some((n) => n.key === t.dependsOnKey) ? t.dependsOnKey : null;
    const status = dep && !completedKeys.has(dep) ? 'waiting_design' : 'not_started';
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

  // Catch-all: any booked line the templates/staffing don't recognise still
  // becomes a task (or an escalation) — this is what closes the systemic
  // silent-drop for bespoke/novel items. Additive; never wipes other tasks.
  const extra = await backfillUncoveredPrep(eventId).catch((e) => {
    console.error('[prep] uncovered backfill failed:', (e as Error).message);
    return { created: [] as string[], escalated: [] as string[] };
  });
  created += extra.created.length + extra.escalated.length;

  await pool.query(
    `INSERT INTO prep_task_log (event_id, action, detail, actor) VALUES ($1,'generated',$2,'system')`,
    [eventId, `Generated ${created} prep task(s)`],
  );
  // The owner's rule: nothing sits silent. Recompute the standing alert from the
  // actual task state — anything with nobody assigned OR fewer people than it
  // needs is surfaced to the owner/Marsha; it self-clears once filled.
  await refreshPrepAssignmentAlert(eventId, ev.date);
  return { eventId, created };
}

/**
 * Recompute the standing "prep needs assigning" alert for an event from the
 * ACTUAL task state: any non-completed task with nobody assigned, OR fewer
 * people than it needs (a 2-person task with 1 person used to go out silently).
 * Deletes the alert when nothing is outstanding, so it self-clears once the
 * owner/Marsha fill the gaps. Safe to call after any task change; recomputing
 * from the DB means two callers in one pass can't clobber each other's list.
 */
export async function refreshPrepAssignmentAlert(eventId: string, date: string): Promise<void> {
  try {
    const gaps = await pool.query<{ title: string; people_needed: number; assigned: number }>(
      `SELECT pt.title, pt.people_needed, count(pts.member_id)::int assigned
         FROM prep_tasks pt LEFT JOIN prep_task_staff pts ON pts.task_id = pt.id
        WHERE pt.event_id = $1 AND pt.status <> 'completed'
        GROUP BY pt.id, pt.title, pt.people_needed
       HAVING count(pts.member_id) < pt.people_needed
        ORDER BY count(pts.member_id), pt.title`,
      [eventId]);
    // Always clear the prior open alert first — if nothing's outstanding now, the
    // event drops off the bell/home brief automatically.
    await pool.query(
      `DELETE FROM notifications WHERE channel='ops_alert' AND template='prep_unassigned'
        AND (payload->>'eventId') = $1 AND cancelled_at IS NULL`, [eventId]).catch(() => {});
    if (gaps.rows.length === 0) return;
    const titles = gaps.rows.map((r) =>
      r.assigned === 0 ? r.title : `${r.title} (needs ${r.people_needed}, has ${r.assigned})`);
    await pool.query(
      `INSERT INTO notifications (event_id, channel, template, scheduled_for, payload)
       VALUES ($1,'ops_alert','prep_unassigned', now(), $2)`,
      [eventId, JSON.stringify({ eventId, date, titles: titles.slice(0, 8), count: titles.length })]).catch(() => {});
    const { pushToOwner } = await import('../integrations/push.js');
    const mgrs = await pool.query<{ id: string }>(
      `SELECT id FROM team_members WHERE active AND access_level IN ('owner','manager')`);
    const body = `${titles.length} prep task(s) for the ${date} event need someone assigned — open the event and pick who does them.`;
    for (const m of mgrs.rows) void pushToOwner('staff', m.id, '⚠️ Prep needs assigning', body, { eventId });
  } catch (err) {
    console.error('[prep] assignment alert refresh failed:', (err as Error).message);
  }
}

// Booked lines that legitimately need NO prep task: day-of performers (staffed
// via staffing.ts) and pure consumables / non-item charge lines. Everything else
// that the templates don't recognise is treated as a bespoke item that must be
// prepared — so it can never be silently dropped.
const PERFORMER_RE = /clown|mascot|acrobat|entertainer|\bcharacter\b|puppet|magician|\bmc\b|\bdj\b|singer|\bhost\b|glam|face\s*paint|twist|performer|dancer|stilt/;
const CONSUMABLE_RE = /\bsocks?\b|water\s*bottle|\bplates?\b|\bcups?\b|napkin|cutlery|spoon|\bfork\b|candle|invitation|sticker|straw|tattoo|\bbadge\b|goodie\s*bag|\bsash\b/;
const NONITEM_RE = /discount|deliver|shipping|\bfee\b|\bvat\b|\btax\b|deposit|\btip\b|additional\s*hour|extra\s*hour|\bhours?\b|\bcharge\b|surcharge|\bbalance\b|down\s*payment|installment|round\s*ing/;

/** True when a booked line already has a home (a prep template via classifyLabel,
 *  a package, day-of staffing, or is a consumable / non-item charge / theme line). */
function recognizedPrepLabel(label: string): boolean {
  const n = (label ?? '').trim().toLowerCase();
  if (!n) return true; // blank line — nothing to prepare
  // Theme lines are metadata, not a physical prep item: a "New Theme" drives the
  // New-Backdrop design task (Marsha) via the custom_theme flag in
  // generatePrepTasks; any other named theme uses its existing backdrop.
  if (/\btheme\b/.test(n)) return true;
  const sid = new Set<string>(); const cat = new Set<string>();
  const inf = classifyLabel(label, sid, cat);
  if (inf > 0 || sid.size > 0 || cat.size > 0 || packageKeyOf(label) !== null) return true;
  return PERFORMER_RE.test(n) || CONSUMABLE_RE.test(n) || NONITEM_RE.test(n);
}

/** Stable per-label key for a catch-all prep task (so re-runs never duplicate). */
function xtraKey(label: string): string {
  const slug = label.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 48);
  return `xtra_${slug || 'item'}`;
}

/**
 * Catch-all guard — the heart of "nothing a customer ordered is ever silently
 * dropped". For every booked line the templates/staffing don't recognise, make
 * sure a prep task exists: assign the lowest-workload person whose skill we can
 * guess (e.g. a "Chocolate fountain" → the food-station person), otherwise leave
 * it unassigned for the owner/Marsha (the refresh alert then surfaces it).
 *
 * ADDITIVE and idempotent (keyed by label) — it never deletes or resets other
 * tasks, so it's safe to run on an event whose prep is already in progress, and
 * safe to call standalone (the repair sweep) or from generatePrepTasks.
 */
export async function backfillUncoveredPrep(
  eventId: string,
): Promise<{ created: string[]; escalated: string[] }> {
  const created: string[] = [];
  const escalated: string[] = [];
  const evRes = await pool.query<{ d: string | null }>(
    `SELECT to_char(event_date,'YYYY-MM-DD') d FROM events WHERE id = $1`, [eventId]);
  if (!evRes.rows[0]) return { created, escalated };
  const date = evRes.rows[0].d;
  const due = date
    ? (() => { const dd = new Date(`${date}T00:00:00Z`); dd.setUTCDate(dd.getUTCDate() - PHYSICAL_DUE_DAYS); return dd.toISOString().slice(0, 10); })()
    : null;

  // FREE-TEXT paid/booked lines only (service_id IS NULL). A row with a real
  // catalogue service_id is already classified by generatePrepTasks via the
  // catalogue (category / isInflatable) — tasking it here too would double it up.
  // 'request' rows are the manually-logged customer extras that addExtraPrepTask
  // already owns, so we skip those as well (never two tasks for one item).
  const es = await pool.query<{ label: string }>(
    `SELECT label FROM event_services
      WHERE event_id = $1 AND service_id IS NULL AND COALESCE(source,'') <> 'request'`, [eventId]);
  // Distinct uncovered labels, keeping original casing for the task title.
  const labels = new Map<string, string>();
  for (const r of es.rows) {
    const label = String(r.label ?? '').trim();
    if (!label || recognizedPrepLabel(label)) continue;
    const k = label.toLowerCase();
    if (!labels.has(k)) labels.set(k, label);
  }
  if (labels.size === 0) return { created, escalated };

  const existing = await pool.query<{ key: string }>(
    `SELECT key FROM prep_tasks WHERE event_id = $1`, [eventId]);
  const haveKeys = new Set(existing.rows.map((r) => r.key));

  const staff = await roster();
  const wlRes = await pool.query<{ member_id: string; c: number }>(
    `SELECT member_id, count(*)::int c FROM prep_task_staff pts JOIN prep_tasks pt ON pt.id = pts.task_id
      WHERE pt.status <> 'completed' GROUP BY member_id`);
  const wl = new Map<string, number>(wlRes.rows.map((r) => [r.member_id, r.c]));

  for (const [, label] of labels) {
    const key = xtraKey(label);
    if (haveKeys.has(key)) continue; // already has its task (or it's completed) — leave it
    haveKeys.add(key); // guard distinct labels that slug to the same key within this pass
    const skill = guessSkill(label);
    // ON CONFLICT guards the UNIQUE(event_id,key) so a slug collision can't throw
    // and abandon the rest of the loop — the item is simply left to its existing task.
    const ins = await pool.query<{ id: string }>(
      `INSERT INTO prep_tasks (event_id, key, title, category, skill, people_needed, due_date, status)
       VALUES ($1,$2,$3,'physical',$4,1,$5,'not_started')
       ON CONFLICT (event_id, key) DO NOTHING RETURNING id`,
      [eventId, key, `Prepare: ${label}`, skill, due]);
    if (!ins.rows[0]) continue; // a task with this key already existed
    const taskId = ins.rows[0].id;
    let assignedTo: string | null = null;
    if (skill) {
      const cand = staff.filter((s) => s.skills.has(skill))
        .sort((a, b) => (wl.get(a.id) ?? 0) - (wl.get(b.id) ?? 0))[0];
      if (cand) {
        await pool.query(`INSERT INTO prep_task_staff (task_id, member_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [taskId, cand.id]);
        wl.set(cand.id, (wl.get(cand.id) ?? 0) + 1);
        assignedTo = cand.name;
      }
    }
    await logTask(taskId, eventId, 'extra', `Auto prep task for booked item: ${label}`, 'system');
    if (assignedTo) created.push(`${label} → ${assignedTo}`);
    else escalated.push(`Prepare: ${label}`);
  }
  return { created, escalated };
}

/** Skill best-guess for a free-typed customer extra. null → leave unassigned. */
function guessSkill(label: string): string | null {
  const s = label.toLowerCase();
  if (/table|chair|seat/.test(s)) return 'tables_chairs';
  if (/backdrop/.test(s)) return 'backdrop';
  if (/balloon/.test(s)) return 'balloons';
  if (/popcorn/.test(s)) return 'popcorn';
  if (/cotton\s*candy/.test(s)) return 'cotton_candy';
  if (/braid/.test(s)) return 'braid_corner';
  // \bcorn\b so "corner" (e.g. "Braiding Corner") doesn't match the corn snack.
  if (/food|station|chocolate|slush|\bcorn\b|candy|ice\s*cream|fountain/.test(s)) return 'food_station';
  if (/face\s*paint/.test(s)) return 'face_painting_prep';
  if (/entrance|welcom/.test(s)) return 'entrance_stand';
  if (/inflatable|bounc|castle|slide|foam/.test(s)) return 'inflatable';
  if (/spa|pedicure|manicure|robe/.test(s)) return 'spa_tables';
  if (/giveaway/.test(s)) return 'giveaways';
  if (/cake\s*stand/.test(s)) return 'cake_stand';
  return null;
}

/**
 * Log ANY customer request / extra on an event: record it as a line so it shows
 * on the event page, create a prep task so it can't be forgotten, assign the
 * lowest-workload qualified person if we can tell who — otherwise leave it for
 * the owner/managers and alert them (the owner's rule: ask, never guess/drop).
 */
export async function addExtraPrepTask(
  eventId: string, label: string, opts: { quantity?: number; note?: string; actor?: string },
): Promise<{ ok: boolean; taskId?: string; assigned: boolean; assignedTo?: string }> {
  const name = label.trim();
  if (!name) return { ok: false, assigned: false };
  const evRes = await pool.query<{ d: string | null }>(`SELECT to_char(event_date,'YYYY-MM-DD') d FROM events WHERE id = $1`, [eventId]);
  if (!evRes.rows[0]) return { ok: false, assigned: false };
  const date = evRes.rows[0].d;
  const qty = Math.max(1, Math.round(opts.quantity ?? 1));

  // 1. Record it as an event line — so it shows in the event's items & is counted.
  await pool.query(
    `INSERT INTO event_services (event_id, service_id, label, quantity, amount_fils, source)
     VALUES ($1, NULL, $2, $3, 0, 'request')`,
    [eventId, name, qty]);

  // 2. A prep task — so it can never be forgotten.
  const skill = guessSkill(name);
  const due = date ? (() => { const dd = new Date(`${date}T00:00:00Z`); dd.setUTCDate(dd.getUTCDate() - PHYSICAL_DUE_DAYS); return dd.toISOString().slice(0, 10); })() : null;
  const title = `Customer extra: ${name}${qty > 1 ? ` ×${qty}` : ''}`;
  const key = `extra_${randomUUID()}`;
  const ins = await pool.query<{ id: string }>(
    `INSERT INTO prep_tasks (event_id, key, title, category, skill, people_needed, due_date, status, notes)
     VALUES ($1,$2,$3,'physical',$4,1,$5,'not_started',$6) RETURNING id`,
    [eventId, key, title, skill, due, opts.note?.trim() || null]);
  const taskId = ins.rows[0].id;

  // 3. Assign the lowest-workload qualified person if the item is recognisable —
  //    e.g. tables & chairs goes to whoever sets up tables & chairs. Automatic.
  let assigned = false;
  let assignedTo: string | undefined;
  if (skill) {
    const staff = await roster();
    const wlRes = await pool.query<{ member_id: string; c: number }>(
      `SELECT member_id, count(*)::int c FROM prep_task_staff pts JOIN prep_tasks pt ON pt.id = pts.task_id
        WHERE pt.status <> 'completed' GROUP BY member_id`);
    const wl = new Map<string, number>(wlRes.rows.map((r) => [r.member_id, r.c]));
    const cand = staff.filter((s) => s.skills.has(skill)).sort((a, b) => (wl.get(a.id) ?? 0) - (wl.get(b.id) ?? 0))[0];
    if (cand) { await pool.query(`INSERT INTO prep_task_staff (task_id, member_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [taskId, cand.id]); assigned = true; assignedTo = cand.name; }
  }
  await pool.query(`INSERT INTO prep_task_log (task_id, event_id, action, detail, actor) VALUES ($1,$2,'extra',$3,$4)`, [taskId, eventId, title, opts.actor ?? 'staff']).catch(() => {});

  // 4. Always tell the owner/managers a customer extra came in; alert hard if we
  //    couldn't assign it.
  if (assigned) {
    await pool.query(
      `INSERT INTO notifications (event_id, channel, template, scheduled_for, payload)
       VALUES ($1,'ops_alert','extra_added', now(), $2)`,
      [eventId, JSON.stringify({ eventId, date, label: name })]).catch(() => {});
    const { pushToOwner } = await import('../integrations/push.js');
    const mgrs = await pool.query<{ id: string }>(`SELECT id FROM team_members WHERE active AND access_level IN ('owner','manager')`);
    for (const m of mgrs.rows) void pushToOwner('staff', m.id, '➕ Customer extra', `${name} added to the ${date ?? ''} event — a prep task was created & assigned.`, { eventId });
  } else {
    await refreshPrepAssignmentAlert(eventId, date ?? '');
  }
  return { ok: true, taskId, assigned, assignedTo };
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
    // One open alert per task — re-flagging or re-saving the same issue must not
    // stack duplicate ops-alerts (same NOT-EXISTS guard the other alerts use).
    await pool.query(
      `INSERT INTO notifications (event_id, channel, template, scheduled_for, payload)
       SELECT $1,'ops_alert','prep_issue', now(), $2
        WHERE NOT EXISTS (
          SELECT 1 FROM notifications
           WHERE template='prep_issue' AND (payload->>'taskId')=$3 AND cancelled_at IS NULL)`,
      [t.event_id, JSON.stringify({ eventId: t.event_id, taskId, title: t.title, note }), String(taskId)],
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

/**
 * Manual task: the owner/manager assigns a standalone to-do to one or more staff
 * members (title + optional deadline + note), with NO event. It shows up in that
 * member's "My tasks" and (for the prep crew) the By-person board, and notifies
 * them. Reuses the prep_tasks machinery (completion, issues, checklist, proof).
 */
export async function createManualTask(opts: {
  title: string; memberIds: string[]; dueDate?: string | null; note?: string | null;
  actor?: string; notify?: boolean;
}): Promise<{ id: string } | null> {
  const title = (opts.title ?? '').trim();
  const members = (opts.memberIds ?? []).filter(Boolean);
  if (!title || members.length === 0) return null;
  const key = `manual_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO prep_tasks (event_id, key, title, category, people_needed, due_date, status, notes)
     VALUES (NULL, $1, $2, 'manual', $3, $4, 'not_started', $5) RETURNING id`,
    [key, title, members.length, opts.dueDate || null, (opts.note ?? '').trim() || null],
  );
  const taskId = rows[0].id;
  for (const m of members) {
    await pool.query(`INSERT INTO prep_task_staff (task_id, member_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [taskId, m]);
  }
  await logTask(taskId, null as any, 'manual_created', `${title} → ${members.length} assignee(s)`, opts.actor ?? 'owner');
  // Notify each assignee (in-app push + WhatsApp), unless seeding silently.
  if (opts.notify !== false) {
    const { pushToOwner } = await import('../integrations/push.js');
    const due = opts.dueDate ? ` · Deadline ${opts.dueDate}` : '';
    for (const m of members) {
      await pushToOwner('staff', m, '📌 New task assigned to you', `${title}${due}`, { taskId: String(taskId), manual: 'true' })
        .catch(() => {});
    }
  }
  return { id: String(taskId) };
}

/** Every prep task assigned to one staff member (their personal work list). */
export async function getPrepTasksForMember(memberId: string) {
  const { rows } = await pool.query(
    `SELECT pt.*, to_char(pt.due_date,'YYYY-MM-DD') AS due, e.event_date, to_char(e.event_date,'YYYY-MM-DD') AS event_date_str,
            c.name AS customer, e.emirate
       FROM prep_tasks pt
       JOIN prep_task_staff pts ON pts.task_id = pt.id
       LEFT JOIN events e ON e.id = pt.event_id
       LEFT JOIN customers c ON c.id = e.customer_id
      WHERE pts.member_id = $1
        -- Manual tasks (no event) always show — INCLUDING completed ones, so the
        -- "Assigned by Sheem" card can show a real completion %. Event prep shows
        -- for events still ahead (or date-TBD) and not cancelled — INCLUDING
        -- completed tasks, so a member can reopen a finished task or re-upload its
        -- design after marking it done (a past event's tasks are done business).
        AND (pt.event_id IS NULL OR (
             e.phase IS DISTINCT FROM 'Cancelled'
             AND (COALESCE(e.date_tbd, false) OR e.event_date >= CURRENT_DATE)))
      ORDER BY pt.due_date NULLS LAST, pt.id`,
    [memberId],
  );
  // Attach the party meta (reference, date, baby, type, theme) so the employee
  // reads the party, not an internal id + customer name. Manual tasks (no event)
  // read "General task".
  const meta = await eventMetaFor(rows.map((r: any) => r.event_id));
  for (const t of rows) { const m = meta.get(t.event_id); if (m) Object.assign(t, m); else t.reference = t.event_id ?? 'General task'; }
  return rows;
}

/** Board grouped by person: every staff member with their open prep tasks. */
export type EventMeta = {
  reference: string;        // EV-<receipt number> (falls back to internal id)
  eventDate: string | null; // YYYY-MM-DD of the party
  babyName: string | null;  // the celebrant / baby the party is for
  celebrationType: string | null; // human label (Birthday, Baby shower, …)
  theme: string | null;     // theme name (custom or catalogue)
};

/**
 * Party meta for a set of events — the same values every other screen shows: the
 * unified booking reference (EV-<receipt number>, NOT the internal EV-YYYY-NNNN
 * id), the party date, who it's for, the celebration type and the theme. The
 * team should read the party, not an internal id, on every prep screen.
 */
async function eventMetaFor(eventIds: string[]): Promise<Map<string, EventMeta>> {
  const ids = Array.from(new Set(eventIds.filter(Boolean)));
  if (ids.length === 0) return new Map();
  const { rows } = await pool.query<{
    id: string; receipt_number: string | null; event_date: string | null;
    baby_name: string | null; celebration_type: string | null; theme_name: string | null;
  }>(
    // custom_theme is a BOOLEAN flag, never the theme text — the real theme name is
    // the catalogue theme (th.name) or, for a new/custom theme, cart->>'customTheme'.
    `SELECT e.id,
            to_char(e.event_date,'YYYY-MM-DD') AS event_date,
            e.celebration_type, COALESCE(th.name, initcap(o.cart->>'customTheme')) AS theme_name,
            initcap(o.cart->>'eventFor') AS baby_name,
            (SELECT fr.number FROM finance_receipts fr
              WHERE fr.event_id = e.id OR (e.order_id IS NOT NULL AND fr.order_id = e.order_id)
              ORDER BY (fr.event_id = e.id) DESC, fr.id LIMIT 1) AS receipt_number
       FROM events e
       LEFT JOIN orders o ON o.id = e.order_id
       LEFT JOIN themes th ON th.id = e.theme_id
      WHERE e.id = ANY($1)`,
    [ids],
  );
  const m = new Map<string, EventMeta>();
  for (const r of rows) {
    m.set(r.id, {
      reference: r.receipt_number ? `EV-${r.receipt_number}` : r.id,
      eventDate: r.event_date,
      babyName: r.baby_name || null,
      celebrationType: r.celebration_type ? celebrationLabel(r.celebration_type) : null,
      theme: r.theme_name || null,
    });
  }
  return m;
}

export async function getPrepByPerson() {
  // Only surface prep for events that are still ahead of us (or date-TBD) and not
  // cancelled — a past event's leftover tasks are done business and only clutter
  // the person board; "By event" already covers history. `upcoming` is the guard.
  const { rows } = await pool.query(
    `SELECT tm.id, tm.name, tm.color,
            COALESCE(json_agg(json_build_object(
              'id', pt.id, 'title', pt.title, 'status', pt.status, 'category', pt.category,
              'eventId', pt.event_id, 'due', to_char(pt.due_date,'YYYY-MM-DD'), 'customer', c.name
            ) ORDER BY pt.due_date) FILTER (WHERE pt.id IS NOT NULL AND (upcoming OR pt.event_id IS NULL)), '[]') AS tasks,
            count(pt.id) FILTER (WHERE pt.status NOT IN ('completed') AND (upcoming OR pt.event_id IS NULL))::int AS open_count,
            -- Completion of the owner-assigned MANUAL tasks (all statuses, incl. done).
            (SELECT count(*) FROM prep_task_staff x JOIN prep_tasks p ON p.id = x.task_id
               WHERE x.member_id = tm.id AND p.category = 'manual')::int AS manual_total,
            (SELECT count(*) FILTER (WHERE p.status = 'completed') FROM prep_task_staff x JOIN prep_tasks p ON p.id = x.task_id
               WHERE x.member_id = tm.id AND p.category = 'manual')::int AS manual_done
       FROM team_members tm
       LEFT JOIN prep_task_staff pts ON pts.member_id = tm.id
       LEFT JOIN prep_tasks pt ON pt.id = pts.task_id AND pt.status <> 'completed'
       LEFT JOIN LATERAL (
         SELECT e.customer_id,
                (e.phase IS DISTINCT FROM 'Cancelled'
                 AND (COALESCE(e.date_tbd, false) OR e.event_date >= CURRENT_DATE)) AS upcoming
           FROM events e WHERE e.id = pt.event_id
       ) e ON true
       LEFT JOIN customers c ON c.id = e.customer_id
      WHERE tm.active AND (
              tm.name = ANY($1)
              -- Also anyone who has a MANUAL task assigned to them, even if they
              -- aren't on the prep crew (e.g. the owner assigns Shan a to-do) —
              -- otherwise their manual tasks never show on the by-person board.
              OR EXISTS (
                SELECT 1 FROM prep_task_staff x JOIN prep_tasks p ON p.id = x.task_id
                 WHERE x.member_id = tm.id AND p.category = 'manual'
              )
            )
      GROUP BY tm.id, tm.name, tm.color
      ORDER BY open_count DESC, tm.name`,
    [Object.keys(PREP_SKILLS)],
  );
  // Stamp each task with the party meta (reference, date, baby, type, theme) the
  // team should read, instead of the internal event id + customer name.
  const meta = await eventMetaFor(rows.flatMap((p: any) => (p.tasks ?? []).map((t: any) => t.eventId)));
  for (const p of rows) for (const t of (p.tasks ?? [])) {
    const m = meta.get(t.eventId);
    if (m) Object.assign(t, m); else t.reference = t.eventId ?? 'General task';
  }
  return rows;
}

/**
 * Self-heal the design→physical dependency: release any physical task stuck on
 * 'waiting_design' once the design task it waits on is completed (or no longer
 * exists for the event). Completing a design task already releases its
 * dependents immediately (completePrepTask); this is the safety net that catches
 * any that slipped through — a design completed before the dependency was linked,
 * a regenerate, or an old glitch — so a task can never stay "Waiting for design"
 * after the design is actually done. Idempotent; runs from the reconcile sweep.
 */
export async function releaseSatisfiedWaitingDesign(): Promise<number> {
  const { rowCount } = await pool.query(
    `UPDATE prep_tasks p SET status='ready'
      WHERE p.status='waiting_design'
        AND NOT EXISTS (
          SELECT 1 FROM prep_tasks d
           WHERE d.event_id = p.event_id
             AND d.key = p.depends_on_key
             AND d.status <> 'completed'
        )`,
  );
  return rowCount ?? 0;
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
  const meta = await eventMetaFor(rows.map((r: any) => r.event_id));
  const today = Date.now();
  return rows.map((r: any) => {
    const total = Number(r.total); const done = Number(r.completed);
    const pct = total ? Math.round((done / total) * 100) : 0;
    const daysToEvent = Math.ceil((Date.parse(`${r.event_date}T00:00:00+04:00`) - today) / 86_400_000);
    // "At risk" when the event is within 3 days and prep isn't finished.
    const atRisk = daysToEvent <= 3 && done < total;
    const m = meta.get(r.event_id);
    return { ...r, reference: m?.reference ?? r.event_id, babyName: m?.babyName ?? null, celebrationType: m?.celebrationType ?? null, theme: m?.theme ?? null, total, completed: done, issues: Number(r.issues), waiting: Number(r.waiting), progressPct: pct, daysToEvent, atRisk };
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
  const meta = (await eventMetaFor([eventId])).get(eventId);
  // A short brief of what the customer actually ordered: the package + every
  // booked line item (services/add-ons), so the team sees the order at a glance.
  const pkg = (await pool.query<{ package_name: string | null }>(
    `SELECT p.name AS package_name FROM events e LEFT JOIN packages p ON p.id = e.package_id WHERE e.id=$1`,
    [eventId],
  )).rows[0];
  const items = (await pool.query<{ label: string | null }>(`SELECT label FROM event_services WHERE event_id=$1 ORDER BY id`, [eventId]))
    .rows.map((r) => (r.label ?? '').trim()).filter(Boolean);
  return {
    eventId,
    reference: meta?.reference ?? eventId,
    event: {
      reference: meta?.reference ?? eventId,
      eventDate: meta?.eventDate ?? null,
      babyName: meta?.babyName ?? null,
      celebrationType: meta?.celebrationType ?? null,
      theme: meta?.theme ?? null,
      packageName: pkg?.package_name ?? null,
      items,
    },
    tasks: rows,
    total,
    completed: done,
    issues,
    progressPct: total ? Math.round((done / total) * 100) : 0,
  };
}
