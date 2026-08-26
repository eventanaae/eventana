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
  | 'balloon_twisting' | 'acrobat_clown' | 'design' | 'staff';

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
  Dindo: ['balloon_artist', 'clown'],
  Gloria: ['clown', 'helper'],
  Diana: ['clown', 'helper'],
  Marsha: ['design'],
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
        [id, name, name === 'Marsha' ? 'Design & Remote Lead' : 'Crew'],
      );
    }
    for (const skill of skills) {
      await pool.query(
        `INSERT INTO staff_skills (member_id, skill) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
        [id, skill],
      );
    }
  }
}

// Package → its performer crew (roles, not necessarily distinct people).
const PACKAGE_CREW: Record<string, Array<{ role: Skill; count: number }>> = {
  gold: [{ role: 'balloon_artist', count: 1 }, { role: 'clown', count: 3 }, { role: 'face_painting', count: 1 }],
  silver: [{ role: 'balloon_artist', count: 1 }, { role: 'clown', count: 2 }, { role: 'face_painting', count: 1 }],
  bronze: [{ role: 'balloon_artist', count: 1 }, { role: 'clown', count: 2 }],
  summer: [{ role: 'balloon_artist', count: 1 }, { role: 'clown', count: 3 }],
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
export function computeRequirements(input: { packageName?: string | null; services: ServiceInput[] }): RoleReq[] {
  const reqs: RoleReq[] = [];
  const pk = packageKey(input.packageName);
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
            o.cart, p.name AS package_name
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
  const reqs = computeRequirements({ packageName, services });

  // Internal staff + skills + current workload.
  const staffRows = await pool.query(
    `SELECT tm.id, tm.name, array_agg(ss.skill) AS skills
       FROM team_members tm JOIN staff_skills ss ON ss.member_id = tm.id
      WHERE tm.active GROUP BY tm.id, tm.name`,
  );
  const wl = await pool.query(`SELECT assignee_id, count(*)::int c FROM event_staff WHERE assignee_id IS NOT NULL AND event_id <> $1 GROUP BY assignee_id`, [eventId]);
  const wlMap = new Map<string, number>(wl.rows.map((r: any) => [r.assignee_id, r.c]));
  // Staff already booked on ANOTHER event on the same date → unavailable.
  const conf = await pool.query(
    `SELECT DISTINCT es.assignee_id FROM event_staff es JOIN events e2 ON e2.id = es.event_id
      WHERE es.assignee_id IS NOT NULL AND es.event_id <> $1 AND to_char(e2.event_date,'YYYY-MM-DD') = $2`,
    [eventId, ev.date],
  );
  const busy = new Set<string>(conf.rows.map((r: any) => r.assignee_id));

  const staff: StaffRow[] = staffRows.rows.map((r: any) => ({ id: r.id, name: r.name, skills: new Set(r.skills), workload: wlMap.get(r.id) ?? 0 }));
  const rolesByStaff = new Map<string, Set<Skill>>();

  const canTake = (st: StaffRow, role: Skill): boolean => {
    if (role === 'acrobat_clown') return false;      // part-time only
    if (role === 'design') return st.skills.has('design');
    if (st.name === 'Marsha') return false;          // remote only, no on-site work
    const held = rolesByStaff.get(st.id);
    const heldSize = held?.size ?? 0;
    if (role === 'staff') return heldSize === 0;      // generic on-site, no concurrent doubling
    if (!st.skills.has(role)) return false;
    if (heldSize > 0) {                                // only balloon_artist + clown may combine
      const combo = new Set<Skill>([...held!, role]);
      return combo.size === 2 && combo.has('balloon_artist') && combo.has('clown');
    }
    return true;
  };

  // Expand requirements into individual slots and fill the skilled ones first.
  const slots: Array<RoleReq & { slot: number }> = [];
  for (const req of reqs) for (let i = 0; i < req.count; i++) slots.push({ ...req, slot: i + 1 });
  const order: Skill[] = ['balloon_artist', 'face_painting', 'balloon_twisting', 'clown', 'helper', 'staff', 'acrobat_clown', 'design'];
  slots.sort((a, b) => order.indexOf(a.role) - order.indexOf(b.role));

  const assigned: AssignedSlot[] = [];
  for (const s of slots) {
    if (s.partTimeOnly) { assigned.push({ role: s.role, slot: s.slot, reason: s.reason, source: s.source, status: 'part_time_required' }); continue; }
    const cands = staff
      .filter((st) => !busy.has(st.id) && canTake(st, s.role))
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

  const shortages = assigned.filter((a) => a.status !== 'assigned').length;
  return { eventId, assigned, leader, shortages, staffingIncomplete: shortages > 0 };
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
