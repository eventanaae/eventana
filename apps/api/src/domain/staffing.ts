import { randomBytes } from 'node:crypto';
import { pool } from '../db/pool.js';

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
