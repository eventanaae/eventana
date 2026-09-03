import { randomBytes } from 'node:crypto';
import { pool } from '../db/pool.js';
import { loadConfig } from './settings.js';

/**
 * Smart Automatic Staff Assignment — Phase 1: the requirements engine.
 *
 * Turns an order (package + services) into a list of ROLE requirements, per the
 * owner's mandatory staffing rules. Internal-staff matching, conflicts, leader
 * and part-time flow are later phases; this file computes WHAT is needed.
 * The rules live in the eventana-staff-assignment memory.
 */

export type Skill =
  | 'balloon_artist' | 'clown' | 'face_painting' | 'helper'
  | 'balloon_twisting' | 'acrobat_clown' | 'design' | 'staff' | 'driver'
  // A part-time (external) driver other than Shan — always filled by a typed
  // name, never auto-assigned internally.
  | 'pt_driver';

export interface RoleReq {
  role: Skill;
  count: number;
  reason: string;
  source: string;               // service/package that created it
  partTimeOnly?: boolean;        // e.g. acrobat clown
  noPartTime?: boolean;          // e.g. customized hat prep
  needsDesign?: boolean;         // routed to Marsha first
  optional?: boolean;            // e.g. an extra backdrop helper
}

// Internal staff → their skills (see the staffing memo). Marsha is design +
// remote leader only, never an on-site performer/helper.
export const STAFF_SKILLS: Record<string, Skill[]> = {
  Jane: ['balloon_artist', 'clown', 'face_painting', 'helper', 'balloon_twisting'],
  Dindo: ['balloon_artist'],
  Gloria: ['clown', 'helper'],
  Diana: ['clown', 'helper'],
  Marsha: ['design'],
  Shan: ['driver'],
};
// Who can lead an event on-site (Marsha leads remotely as a fallback).
export const ONSITE_LEADERS = ['Jane', 'Dindo'];

/** Seed the internal roster + skills. Idempotent; safe to run on every boot. */
export async function seedStaffSkills(): Promise<void> {
  for (const [name, skills] of Object.entries(STAFF_SKILLS)) {
    const found = await pool.query<{ id: string }>(
      `SELECT id FROM team_members WHERE lower(name) = lower($1) LIMIT 1`,
      [name],
    );
    let id = found.rows[0]?.id;
    if (!id) {
      id = `TM-${randomBytes(3).toString('hex').toUpperCase()}`;
      await pool.query(
        `INSERT INTO team_members (id, name, role, active) VALUES ($1,$2,$3,true)
         ON CONFLICT (id) DO NOTHING`,
        [id, name, name === 'Marsha' ? 'Design & Remote Lead' : name === 'Shan' ? 'Driver' : 'Crew'],
      );
    }
    for (const skill of skills) {
      await pool.query(
        `INSERT INTO staff_skills (member_id, skill) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
        [id, skill],
      );
    }
    // Prune any skill that's no longer in the definition (e.g. Dindo is not a
    // clown), so a corrected roster takes effect on the next boot.
    await pool.query(`DELETE FROM staff_skills WHERE member_id = $1 AND skill <> ALL($2::text[])`, [id, skills]);
  }
}

// Package → its performer crew (roles, not necessarily distinct people).
const PACKAGE_CREW: Record<string, Array<{ role: Skill; count: number }>> = {
  gold: [{ role: 'balloon_artist', count: 1 }, { role: 'clown', count: 3 }, { role: 'face_painting', count: 1 }],
  silver: [{ role: 'balloon_artist', count: 1 }, { role: 'clown', count: 2 }, { role: 'face_painting', count: 1 }],
  bronze: [{ role: 'balloon_artist', count: 1 }, { role: 'clown', count: 2 }],
  summer: [{ role: 'balloon_artist', count: 1 }, { role: 'clown', count: 2 }],
};
function packageKey(name?: string | null): keyof typeof PACKAGE_CREW | null {
  const n = (name ?? '').toLowerCase();
  if (/gold/.test(n)) return 'gold';
  if (/silver/.test(n)) return 'silver';
  if (/bronze/.test(n)) return 'bronze';
  if (/summer/.test(n)) return 'summer';
  return null;
}

export interface ServiceInput {
  serviceId: string;
  name: string;
  categoryId?: string | null;
  isInflatable?: boolean;
  isFoodStation?: boolean;
  quantity?: number;
  fromPackage?: boolean;   // true for a package's own expanded item
}

/** Operational + entertainment staff a single booked service needs. */
function serviceReqs(s: ServiceInput): RoleReq[] {
  const qty = Math.max(1, Number(s.quantity) || 1);
  const id = s.serviceId;
  const cat = s.categoryId;
  const out: RoleReq[] = [];
  const push = (role: Skill, count: number, reason: string, extra: Partial<RoleReq> = {}) =>
    out.push({ role, count, reason, source: s.name, ...extra });

  // Entertainment — by specific service.
  if (id === 'facepaint' || /face\s*paint/i.test(s.name)) push('face_painting', 1, 'Face Painting service');
  else if (id === 'clown' || /acrobat/i.test(s.name)) push('acrobat_clown', 1, 'Acrobat Clown (part-time only)', { partTimeOnly: true });
  else if (id === 'twisting' || /twist/i.test(s.name)) push('balloon_twisting', 1, 'Balloon Twisting service');
  else if (id === 'mascot' || /mascot/i.test(s.name)) push('helper', 1, 'Mascot character needs a helper');
  // Food stations — one helper each, running concurrently.
  else if (s.isFoodStation || cat === 'food') push('helper', qty, `${qty} food station(s) — 1 helper each`);
  // Inflatables — two staff each.
  else if (s.isInflatable || cat === 'inflatables') push('staff', 2 * qty, `${qty} inflatable(s) — 2 staff each`);
  // Machines — 1 staff, Foam = 2.
  else if (cat === 'machines') {
    const isFoam = id === 'foam' || /foam/i.test(s.name);
    push('staff', (isFoam ? 2 : 1) * qty, isFoam ? 'Foam Machine — 2 staff' : 'Machine — 1 staff');
  }
  // Games — 1 staff each.
  else if (cat === 'games') push('staff', qty, `${qty} game(s) — 1 staff each`);
  // Backdrop — a balloon artist (+ optional helper).
  else if (cat === 'backdrop') {
    push('balloon_artist', 1, 'Main backdrop & decoration');
    push('helper', 1, 'Backdrop helper (optional)', { optional: true });
  }
  // Activity sessions — 1 helper each.
  else if (cat === 'activities') push('helper', qty, `${qty} activity session(s) — 1 helper each`);
  // Giveaways / extras — design goes to Marsha; the Customized Hat also needs
  // internal prep (never part-time).
  else if (cat === 'giveaways' || cat === 'extras') {
    push('design', 1, 'Design & print (Marsha)', { needsDesign: true });
    if (id === 'hat' || /hat/i.test(s.name)) push('helper', 1, 'Customized hat preparation (no part-time)', { noPartTime: true });
  }
  return out;
}

/** Compute the full role requirement list for an order. */
export function computeRequirements(input: { packageName?: string | null; services: ServiceInput[]; customTheme?: boolean }): RoleReq[] {
  const reqs: RoleReq[] = [];
  const pk = packageKey(input.packageName);
  // Custom theme designed by the customer → Marsha designs/visualises the event
  // (an internal, back-office task; never shown to the customer).
  if (input.customTheme) {
    reqs.push({ role: 'design', count: 1, reason: 'Design & visualise the custom theme', source: 'Custom theme', needsDesign: true });
  }
  if (pk) {
    for (const c of PACKAGE_CREW[pk]) {
      reqs.push({ role: c.role, count: c.count, reason: `${input.packageName} package crew`, source: input.packageName ?? 'Package' });
    }
  }
  for (const s of input.services) {
    // A package's own entertainment items are already covered by the package
    // crew above — don't double-count them. Operational items still need staff.
    if (s.fromPackage && (s.categoryId === 'entertainment')) continue;
    reqs.push(...serviceReqs(s));
  }
  // Delivery & collection — any event with physical equipment/setup (a package,
  // backdrop, inflatable, machine, food station, games or giveaways) needs a
  // driver to transport and collect the gear. Shan handles this.
  const EQUIP_CATS = new Set(['backdrop', 'inflatables', 'machines', 'food', 'games', 'giveaways', 'extras', 'activities']);
  const needsDriver = !!pk || input.services.some(
    (s) => s.isInflatable || s.isFoodStation || (s.categoryId ? EQUIP_CATS.has(s.categoryId) : false),
  );
  if (needsDriver) {
    reqs.push({ role: 'driver', count: 1, reason: 'Equipment delivery & collection', source: 'Logistics' });
  }
  return reqs;
}

// ── Phase 2: the assignment engine ──────────────────────────────────────────

interface StaffRow { id: string; name: string; skills: Set<Skill>; workload: number; }

export interface AssignedSlot {
  role: Skill; slot: number; reason: string; source: string;
  status: 'assigned' | 'part_time_required' | 'to_confirm';
  assignee?: { id: string; name: string } | null;
  partTimeName?: string | null;
  noPartTime?: boolean; needsDesign?: boolean;
}

export interface StaffingPlan {
  eventId: string;
  assigned: AssignedSlot[];
  leader: { id: string; name: string; remote: boolean } | null;
  shortages: number;
  staffingIncomplete: boolean;
}

/**
 * Assign internal staff to an event per the mandatory rules, and flag any slot
 * that needs a part-timer. Internal-first, conflict-checked (no double booking
 * across events on the same date), multi-role aware (Jane may be
 * balloon-artist + clown, never face-painter + clown), fairness by workload.
 * Rebuilds the event's plan each run. Idempotent.
 */
export async function assignStaffForEvent(eventId: string): Promise<StaffingPlan | null> {
  const evRes = await pool.query(
    `SELECT e.id, to_char(e.event_date,'YYYY-MM-DD') AS date, e.start_time, e.base_end_time,
            e.custom_theme, o.cart, p.name AS package_name
       FROM events e JOIN orders o ON o.id = e.order_id
       LEFT JOIN packages p ON p.id = e.package_id
      WHERE e.id = $1`,
    [eventId],
  );
  const ev = evRes.rows[0];
  if (!ev) return null;

  const cfg = await loadConfig();
  const isPkgLabel = (s: string) => /\b(gold|golden|silver|bronze|summer)\b/i.test(s) && /package|birthday|splash|silver|bronze|gold/i.test(s);
  // Prefer the structured cart; fall back to the booked line items (event_services)
  // so converted/imported bookings are staffed from what was actually sold.
  const cart = (ev.cart ?? {}) as { services?: Array<{ serviceId: string; quantity: number }> };
  let packageName: string | null = ev.package_name ?? null;
  const services: ServiceInput[] = [];
  if (Array.isArray(cart.services) && cart.services.length) {
    for (const s of cart.services) {
      const svc = cfg.services.get(s.serviceId);
      services.push({ serviceId: s.serviceId, name: svc?.name ?? s.serviceId, categoryId: (svc as any)?.categoryId, isInflatable: (svc as any)?.isInflatable, isFoodStation: (svc as any)?.isFoodStation, quantity: s.quantity, fromPackage: false });
    }
  } else {
    const es = await pool.query(`SELECT label, service_id, quantity FROM event_services WHERE event_id = $1`, [eventId]);
    for (const row of es.rows) {
      const label = String(row.label ?? '');
      if (!packageName && isPkgLabel(label)) { packageName = label; continue; }
      const svc = row.service_id ? cfg.services.get(row.service_id) : null;
      services.push({ serviceId: row.service_id ?? '', name: svc?.name ?? label, categoryId: (svc as any)?.categoryId, isInflatable: (svc as any)?.isInflatable, isFoodStation: (svc as any)?.isFoodStation, quantity: Number(row.quantity) || 1, fromPackage: false });
    }
  }
  const reqs = computeRequirements({ packageName, services, customTheme: !!ev.custom_theme });
  // Manual requirements the owner/manager added for this event (e.g. a custom
  // offer the engine can't read) are layered on top of whatever we derived.
  const manual = await pool.query<{ role: string; count: number }>(
    `SELECT role, count FROM event_manual_staff WHERE event_id = $1`,
    [eventId],
  );
  for (const m of manual.rows) {
    const role = m.role as Skill;
    // A part-time driver (and the acrobat clown) is never staffed internally —
    // it's emitted as a part-time slot for the team to fill with a typed name.
    const partTimeOnly = role === 'pt_driver' || role === 'acrobat_clown';
    reqs.push({
      role,
      count: Number(m.count) || 1,
      reason: partTimeOnly ? 'Part-time driver (external)' : 'Added by the team',
      source: 'Manual',
      ...(partTimeOnly ? { partTimeOnly: true } : {}),
    });
  }

  // Internal staff + skills + current workload.
  const staffRows = await pool.query(
    `SELECT tm.id, tm.name, array_agg(ss.skill) AS skills
       FROM team_members tm JOIN staff_skills ss ON ss.member_id = tm.id
      WHERE tm.active GROUP BY tm.id, tm.name`,
  );
  const wl = await pool.query(`SELECT assignee_id, count(*)::int c FROM event_staff WHERE assignee_id IS NOT NULL AND event_id <> $1 GROUP BY assignee_id`, [eventId]);
  const wlMap = new Map<string, number>(wl.rows.map((r: any) => [r.assignee_id, r.c]));
  // Staff already booked on another event whose time window OVERLAPS this one on
  // the same date → unavailable (a person can't be in two places at once). Two
  // same-day events at NON-overlapping times are fine, so the same person can
  // work both. Times are "HH:MM" text, comparable lexicographically same-day.
  const conf = await pool.query(
    `SELECT DISTINCT es.assignee_id FROM event_staff es JOIN events e2 ON e2.id = es.event_id
      WHERE es.assignee_id IS NOT NULL AND es.event_id <> $1
        AND to_char(e2.event_date,'YYYY-MM-DD') = $2
        AND e2.phase <> 'Cancelled'
        AND $3 < COALESCE(e2.base_end_time,'23:59') AND COALESCE($4::text,'23:59') > e2.start_time`,
    [eventId, ev.date, ev.start_time, ev.base_end_time],
  );
  const busy = new Set<string>(conf.rows.map((r: any) => r.assignee_id));
  // Staff on an approved day off / annual leave covering the event date are
  // unavailable too (approved leave drops a staff_days_off row — see leave.ts).
  const offRows = await pool.query(
    `SELECT DISTINCT member_id FROM staff_days_off
      WHERE status = 'approved' AND start_date <= $1 AND end_date >= $1`,
    [ev.date],
  );
  for (const r of offRows.rows as any[]) busy.add(r.member_id);
  // Members whose recurring WEEKLY day off falls on the event's weekday are off.
  const evWeekday = new Date(`${ev.date}T00:00:00Z`).getUTCDay(); // 0=Sun … 6=Sat
  const weeklyOff = await pool.query(
    `SELECT id FROM team_members WHERE active AND weekly_day_off = $1`,
    [evWeekday],
  );
  for (const r of weeklyOff.rows as any[]) busy.add(r.id);

  const staff: StaffRow[] = staffRows.rows.map((r: any) => ({ id: r.id, name: r.name, skills: new Set(r.skills), workload: wlMap.get(r.id) ?? 0 }));
  const rolesByStaff = new Map<string, Set<Skill>>();

  const canTake = (st: StaffRow, role: Skill): boolean => {
    if (role === 'acrobat_clown') return false;      // part-time only
    if (role === 'design') return st.skills.has('design');
    if (st.name === 'Marsha') return false;          // remote only, no on-site work
    const held = rolesByStaff.get(st.id);
    const heldSize = held?.size ?? 0;
    // Generic on-site body — anyone with a real on-site skill (not the driver,
    // whose job is transport), and no concurrent doubling.
    if (role === 'staff') return heldSize === 0 && [...st.skills].some((s) => s !== 'driver');
    if (role === 'driver') return st.skills.has('driver');
    if (!st.skills.has(role)) return false;
    if (heldSize > 0) {                                // only balloon_artist + clown may combine
      const combo = new Set<Skill>([...held!, role]);
      return combo.size === 2 && combo.has('balloon_artist') && combo.has('clown');
    }
    return true;
  };

  // Expand requirements into individual slots and fill the SCARCEST skills
  // first. Face painting (only Jane) and balloon twisting (only Jane) must be
  // assigned before balloon artist (Jane OR Dindo) — otherwise Jane gets taken
  // for balloons and the only face painter falls to part-time. Supply = how
  // many internal on-site staff hold the skill; fewer → filled earlier.
  const slots: Array<RoleReq & { slot: number }> = [];
  for (const req of reqs) for (let i = 0; i < req.count; i++) slots.push({ ...req, slot: i + 1 });
  const onsite = staff.filter((st) => st.name !== 'Marsha');
  const supplyOf = (role: Skill): number => {
    if (role === 'acrobat_clown') return 0;                         // part-time only
    if (role === 'design') return staff.filter((st) => st.skills.has('design')).length;
    if (role === 'staff') return onsite.filter((st) => [...st.skills].some((s) => s !== 'driver')).length;
    return onsite.filter((st) => st.skills.has(role)).length;
  };
  const tie: Skill[] = ['face_painting', 'balloon_twisting', 'balloon_artist', 'clown', 'helper', 'staff', 'driver', 'acrobat_clown', 'design'];
  slots.sort((a, b) => (supplyOf(a.role) - supplyOf(b.role)) || (tie.indexOf(a.role) - tie.indexOf(b.role)));

  const assigned: AssignedSlot[] = [];
  for (const s of slots) {
    if (s.partTimeOnly) { assigned.push({ role: s.role, slot: s.slot, reason: s.reason, source: s.source, status: 'part_time_required' }); continue; }
    const cands = staff
      // The driver runs multiple deliveries a day, so same-date booking doesn't
      // make him unavailable; every other role is exclusive per date.
      .filter((st) => (s.role === 'driver' || !busy.has(st.id)) && canTake(st, s.role))
      .sort((a, b) => (a.workload + (rolesByStaff.get(a.id)?.size ?? 0)) - (b.workload + (rolesByStaff.get(b.id)?.size ?? 0)));
    const pick = cands[0];
    if (pick) {
      const held = rolesByStaff.get(pick.id) ?? new Set<Skill>();
      held.add(s.role); rolesByStaff.set(pick.id, held);
      assigned.push({ role: s.role, slot: s.slot, reason: s.reason, source: s.source, status: 'assigned', assignee: { id: pick.id, name: pick.name }, needsDesign: s.needsDesign });
    } else {
      assigned.push({ role: s.role, slot: s.slot, reason: s.reason, source: s.source, status: s.noPartTime ? 'to_confirm' : 'part_time_required', noPartTime: s.noPartTime, needsDesign: s.needsDesign });
    }
  }

  // Event leader — Jane/Dindo on-site if working the event, else Marsha remote.
  let leader: StaffingPlan['leader'] = null;
  for (const name of ONSITE_LEADERS) {
    const st = staff.find((x) => x.name === name && rolesByStaff.has(x.id));
    if (st) { leader = { id: st.id, name: st.name, remote: false }; break; }
  }
  if (!leader) {
    const marsha = staff.find((x) => x.name === 'Marsha');
    if (marsha) leader = { id: marsha.id, name: 'Marsha', remote: true };
  }

  // Persist the plan.
  await pool.query(`DELETE FROM event_staff WHERE event_id = $1`, [eventId]);
  for (const a of assigned) {
    await pool.query(
      `INSERT INTO event_staff (event_id, role, slot, assignee_id, is_leader, status, reason, source, needs_design)
       VALUES ($1,$2,$3,$4,false,$5,$6,$7,$8)`,
      [eventId, a.role, a.slot, a.assignee?.id ?? null, a.status, a.reason, a.source, !!a.needsDesign],
    );
  }
  if (leader) {
    await pool.query(
      `INSERT INTO event_staff (event_id, role, slot, assignee_id, is_leader, status, reason, source)
       VALUES ($1,'leader',1,$2,true,'assigned',$3,'Leader')`,
      [eventId, leader.id, leader.remote ? 'Remote event leader' : 'Event leader'],
    );
  }

  // Keep event_team (what employees read for "My jobs", and what feedback rewards
  // / alerts use) in sync with the REAL assigned crew from event_staff. Without
  // this, employees saw the stale "first 3 members" placeholder from checkout.
  await pool.query(
    `DELETE FROM event_team WHERE event_id = $1
       AND member_id NOT IN (SELECT assignee_id FROM event_staff WHERE event_id = $1 AND assignee_id IS NOT NULL)`,
    [eventId],
  ).catch(() => {});
  await pool.query(
    `INSERT INTO event_team (event_id, member_id)
     SELECT DISTINCT $1, assignee_id FROM event_staff WHERE event_id = $1 AND assignee_id IS NOT NULL
     ON CONFLICT DO NOTHING`,
    [eventId],
  ).catch(() => {});

  // ── Delivery-conflict guard ────────────────────────────────────────────────
  // The driver runs several deliveries a day, but two whose time windows OVERLAP
  // can't both be served — alert management (dashboard ops-alert + push) so they
  // can move a slot. Idempotent per event.
  const driverAssign = assigned.find((a) => a.role === 'driver' && a.assignee?.id);
  if (driverAssign?.assignee) {
    const { rows: clash } = await pool.query<{ id: string; d: string; start_time: string; base_end_time: string }>(
      `SELECT e2.id, to_char(e2.event_date,'YYYY-MM-DD') AS d, e2.start_time, e2.base_end_time
         FROM events e1
         JOIN events e2 ON e2.event_date = e1.event_date AND e2.id <> e1.id
         JOIN event_staff es2 ON es2.event_id = e2.id AND es2.role = 'driver' AND es2.assignee_id = $2
        WHERE e1.id = $1 AND e2.phase <> 'Cancelled'
          AND e1.start_time < e2.base_end_time AND e1.base_end_time > e2.start_time`,
      [eventId, driverAssign.assignee.id],
    );
    if (clash.length) {
      const driverName = driverAssign.assignee.name;
      await pool.query(
        `INSERT INTO notifications (event_id, channel, template, scheduled_for, payload)
         SELECT $1,'ops_alert','driver_conflict', now(), $2
          WHERE NOT EXISTS (SELECT 1 FROM notifications WHERE template = 'driver_conflict' AND event_id = $1 AND cancelled_at IS NULL)`,
        [eventId, JSON.stringify({ eventId, driver: driverName, conflicts: clash.map((c) => ({ eventId: c.id, date: c.d, start: c.start_time, end: c.base_end_time })) })],
      ).catch(() => {});
      try {
        const { pushToStaff } = await import('../integrations/push.js');
        void pushToStaff('⚠️ Delivery conflict', `${driverName} has overlapping deliveries on ${clash[0].d}`, { eventId });
      } catch { /* push optional */ }
    } else {
      // No overlap now — clear any stale conflict alert for this event.
      await pool.query(`DELETE FROM notifications WHERE template = 'driver_conflict' AND event_id = $1`, [eventId]).catch(() => {});
    }
  }

  const shortages = assigned.filter((a) => a.status !== 'assigned').length;
  // Raise a single ops alert for the Owner/Manager when we can't fully staff
  // internally (part-time / prep needed). Not repeated if one already stands.
  if (shortages > 0) {
    await pool.query(
      `INSERT INTO notifications (event_id, channel, template, scheduled_for, payload)
       SELECT $1,'ops_alert','staffing_required', now(), $2
        WHERE NOT EXISTS (SELECT 1 FROM notifications WHERE template = 'staffing_required' AND event_id = $1)`,
      [eventId, JSON.stringify({ eventId, shortages, roles: assigned.filter((a) => a.status !== 'assigned').map((a) => ({ role: a.role, reason: a.reason, source: a.source, noPartTime: a.noPartTime })) })],
    ).catch(() => {});
  } else {
    // Fully staffed now — clear any stale staffing alert.
    await pool.query(`DELETE FROM notifications WHERE template = 'staffing_required' AND event_id = $1`, [eventId]).catch(() => {});
  }
  return { eventId, assigned, leader, shortages, staffingIncomplete: shortages > 0 };
}

/**
 * Backfill: make event_team mirror the REAL roster (event_staff assignees) for
 * every event that has been staffed. Fixes historical events whose event_team
 * still holds the crude "first 3 members" placeholder from checkout, so every
 * consumer that reads event_team (incentive KPIs, alerts, notifications, feedback
 * rewards, the customer crew card) is correct. Idempotent — safe to run on boot.
 */
export async function syncAllEventTeams(): Promise<{ synced: number }> {
  // Drop stale members that aren't on the real roster (only for staffed events).
  await pool.query(
    `DELETE FROM event_team et
      WHERE EXISTS (SELECT 1 FROM event_staff es WHERE es.event_id = et.event_id AND es.assignee_id IS NOT NULL)
        AND NOT EXISTS (SELECT 1 FROM event_staff es WHERE es.event_id = et.event_id AND es.assignee_id = et.member_id)`,
  ).catch(() => {});
  const r = await pool.query(
    `INSERT INTO event_team (event_id, member_id)
     SELECT DISTINCT event_id, assignee_id FROM event_staff WHERE assignee_id IS NOT NULL
     ON CONFLICT DO NOTHING`,
  ).catch(() => ({ rowCount: 0 }));
  return { synced: r?.rowCount ?? 0 };
}

/**
 * Manager/Owner confirms a part-timer for an open slot: records the name and
 * flips the slot to "confirmed". If every slot on the event is now filled, the
 * staffing alert is cleared. Returns the event id so the plan can be reloaded.
 */
export async function confirmPartTimeSlot(slotId: string, name: string): Promise<{ eventId: string } | null> {
  const { rows } = await pool.query<{ event_id: string }>(
    `UPDATE event_staff
        SET part_time_name = $2, status = 'confirmed', assignee_id = NULL
      WHERE id = $1 AND is_leader = false
      RETURNING event_id`,
    [slotId, name.trim()],
  );
  const eventId = rows[0]?.event_id;
  if (!eventId) return null;
  const open = await pool.query(
    `SELECT count(*)::int c FROM event_staff WHERE event_id = $1 AND status IN ('part_time_required','to_confirm')`,
    [eventId],
  );
  if ((open.rows[0]?.c ?? 0) === 0) {
    await pool.query(`DELETE FROM notifications WHERE template = 'staffing_required' AND event_id = $1`, [eventId]).catch(() => {});
  }
  return { eventId };
}

/** Manually assign an internal staff member to a slot (owner/manager override). */
export async function overrideSlotAssignee(slotId: string, assigneeId: string): Promise<{ eventId: string } | null> {
  const { rows } = await pool.query<{ event_id: string }>(
    `UPDATE event_staff
        SET assignee_id = $2, part_time_name = NULL, status = 'assigned'
      WHERE id = $1 RETURNING event_id`,
    [slotId, assigneeId],
  );
  return rows[0] ? { eventId: rows[0].event_id } : null;
}

/** Add/replace a manual staffing requirement for an event, then re-run the plan. */
export async function setManualRequirement(eventId: string, role: string, count: number) {
  if (count <= 0) {
    await pool.query(`DELETE FROM event_manual_staff WHERE event_id = $1 AND role = $2`, [eventId, role]);
  } else {
    await pool.query(
      `INSERT INTO event_manual_staff (event_id, role, count) VALUES ($1,$2,$3)
       ON CONFLICT (event_id, role) DO UPDATE SET count = EXCLUDED.count`,
      [eventId, role, count],
    );
  }
  return assignStaffForEvent(eventId);
}

/** The manual requirements currently set for an event. */
export async function getManualRequirements(eventId: string) {
  const { rows } = await pool.query(`SELECT role, count FROM event_manual_staff WHERE event_id = $1 ORDER BY role`, [eventId]);
  return rows;
}

/**
 * The internal crew for the manual-override picker. When an `eventId` is given,
 * each member is flagged `busy` (with a reason) if they are unavailable for THAT
 * event — booked on a time-overlapping event the same day (drivers exempt, they
 * run several deliveries), on approved leave, or on their weekly day off — so
 * the UI can hide them and a manager can't double-book someone by hand. Computed
 * live, so it always reflects the current times and assignments.
 */
export async function listInternalStaff(eventId?: string) {
  const { rows } = await pool.query(
    `SELECT tm.id, tm.name, tm.role, array_agg(ss.skill) FILTER (WHERE ss.skill IS NOT NULL) AS skills
       FROM team_members tm LEFT JOIN staff_skills ss ON ss.member_id = tm.id
      WHERE tm.active GROUP BY tm.id, tm.name, tm.role ORDER BY tm.name`,
  );
  const plain = rows.map((r: any) => ({ ...r, skills: r.skills ?? [], busy: false, busyReason: null as string | null }));
  if (!eventId) return plain;

  const evRes = await pool.query(
    `SELECT to_char(event_date,'YYYY-MM-DD') AS date, start_time, base_end_time FROM events WHERE id = $1`,
    [eventId],
  );
  const ev = evRes.rows[0];
  if (!ev) return plain;

  const reason = new Map<string, string>();
  const conf = await pool.query(
    `SELECT DISTINCT es.assignee_id FROM event_staff es JOIN events e2 ON e2.id = es.event_id
      WHERE es.assignee_id IS NOT NULL AND es.event_id <> $1
        AND to_char(e2.event_date,'YYYY-MM-DD') = $2 AND e2.phase <> 'Cancelled'
        AND $3 < COALESCE(e2.base_end_time,'23:59') AND COALESCE($4::text,'23:59') > e2.start_time`,
    [eventId, ev.date, ev.start_time, ev.base_end_time],
  );
  for (const r of conf.rows as any[]) reason.set(r.assignee_id, 'On another event at this time');
  const offRows = await pool.query(
    `SELECT DISTINCT member_id FROM staff_days_off WHERE status = 'approved' AND start_date <= $1 AND end_date >= $1`,
    [ev.date],
  );
  for (const r of offRows.rows as any[]) reason.set(r.member_id, 'On leave');
  const evWeekday = new Date(`${ev.date}T00:00:00Z`).getUTCDay();
  const weeklyOff = await pool.query(`SELECT id FROM team_members WHERE active AND weekly_day_off = $1`, [evWeekday]);
  for (const r of weeklyOff.rows as any[]) reason.set(r.id, 'Weekly day off');

  return plain.map((m) => {
    const isDriver = (m.skills as string[]).includes('driver');
    const why = reason.get(m.id) ?? null;
    // A driver is never "busy" merely for an overlapping delivery — but leave and
    // day off still apply to them.
    const busy = !!why && !(isDriver && why === 'On another event at this time');
    return { ...m, busy, busyReason: busy ? why : null };
  });
}

/** Read the saved staffing plan for an event (with staff names). */
export async function getStaffingPlan(eventId: string) {
  const { rows } = await pool.query(
    `SELECT es.*, tm.name AS assignee_name FROM event_staff es
        LEFT JOIN team_members tm ON tm.id = es.assignee_id
       WHERE es.event_id = $1 ORDER BY es.is_leader DESC, es.role, es.slot`,
    [eventId],
  );
  return rows;
}
