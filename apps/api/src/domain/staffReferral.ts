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
 * Record an event a crew member brought in, storing its value (excl. delivery)
 * so the KPIs endpoint can award them value-based POINTS (AED 0.5 per AED —
 * a 4,000 AED event = 2,000 points). Idempotent on (order, member).
 */
export async function recordReferralEvent(
  db: PoolClient,
  args: {
    orderId: string;
    eventId: string;
    referral: StaffReferral;
    eventValueExclDeliveryFils: number;
  },
): Promise<void> {
  const value = Math.max(0, Math.round(args.eventValueExclDeliveryFils));
  if (value <= 0) return;
  await db.query(
    `INSERT INTO staff_referral_events (order_id, event_id, member_id, event_value_fils)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (order_id, member_id) DO NOTHING`,
    [args.orderId, args.eventId, args.referral.memberId, value],
  );
}
