/**
 * Staff referral codes.
 *
 * A crew member gives a personal code (their name + "SALE", e.g. DIANASALE) to a
 * client they bring in. The customer enters it in the checkout promo field. It
 * is NOT a customer discount — it credits the STAFF member a percentage (5% by
 * default) of the event value, excluding delivery, once the booking is paid.
 * The credit lands in staff_rewards (kind 'referral'), so it shows up in the
 * member's earnings just like any other reward, and the UNIQUE(kind, source_ref,
 * member_id) guard means a replayed webhook can never double-pay.
 *
 * Events only — standalone shop purchases go through a different checkout that
 * never touches this.
 */
import type { Pool, PoolClient } from 'pg';

/** The code we mint for a crew member: their first name, letters only, + SALE. */
export function makeStaffCode(name: string): string {
  const base = (name.replace(/[^A-Za-z]/g, '').toUpperCase() || 'CREW');
  return `${base}SALE`;
}

export interface StaffReferral {
  code: string;
  memberId: string;
  percent: number;
}

/** Resolve a checkout code to an active staff referral, or null. */
export async function resolveStaffCode(
  db: Pool | PoolClient,
  code: string | null | undefined,
): Promise<StaffReferral | null> {
  const norm = (code ?? '').trim().toUpperCase();
  if (!norm) return null;
  const { rows } = await db.query(
    `SELECT c.code, c.member_id, c.percent
       FROM staff_referral_codes c
       JOIN team_members tm ON tm.id = c.member_id AND tm.active
      WHERE c.code = $1 AND c.active`,
    [norm],
  );
  const r = rows[0];
  return r ? { code: r.code, memberId: r.member_id, percent: Number(r.percent) } : null;
}

/**
 * Credit a staff member their referral percentage of an event. Idempotent on
 * (order, member) via the staff_rewards UNIQUE key. `eventValueExclDeliveryFils`
 * is the paid event total minus delivery.
 */
export async function creditStaffReferral(
  db: PoolClient,
  args: {
    orderId: string;
    eventId: string;
    referral: StaffReferral;
    eventValueExclDeliveryFils: number;
  },
): Promise<void> {
  const amount = Math.round(Math.max(0, args.eventValueExclDeliveryFils) * (args.referral.percent / 100));
  if (amount <= 0) return;
  await db.query(
    `INSERT INTO staff_rewards (member_id, event_id, kind, amount_fils, note, source_ref)
     VALUES ($1,$2,'referral',$3,$4,$5)
     ON CONFLICT (kind, source_ref, member_id) DO NOTHING`,
    [
      args.referral.memberId,
      args.eventId,
      amount,
      `${args.referral.percent}% referral (code ${args.referral.code})`,
      args.orderId,
    ],
  );
}
