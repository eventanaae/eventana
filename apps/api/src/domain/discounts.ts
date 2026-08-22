/**
 * Checkout discounts: promo codes, referral/store credit, and loyalty-point
 * redemption. All three reduce the server-computed total the same way — as
 * negative quote lines — and are validated here so the device can never
 * invent a discount.
 *
 * Owner-chosen values (tunable): 100 points = AED 2 (2% back); referral gives
 * AED 250 to both the new customer and the referrer.
 */
import type { PoolClient } from 'pg';
import type { Pool } from 'pg';
import type { QuoteLine } from '@eventana/shared';

/** 1 loyalty point is worth this many fils when redeemed. */
export const REDEEM_FILS_PER_POINT = 2;
/** Welcome credit for a new customer who used a referral code, and the
 *  referrer's reward when that customer's first booking is confirmed. */
export const REFERRAL_CREDIT_FILS = 25_000;
/** Never let stacked discounts drop a payable order below this (fils). */
const MIN_PAYABLE_FILS = 500;

export interface DiscountInput {
  promoCode?: string | null;
  useCredit?: boolean;
  redeemPoints?: boolean;
}

export interface AppliedDiscounts {
  lines: QuoteLine[];
  totalFils: number; // sum of all discounts (positive number)
  promo: { code: string; amountFils: number } | null;
  creditFils: number;
  points: { used: number; amountFils: number } | null;
}

function line(label: string, amountFils: number): QuoteLine {
  return { kind: 'discount', refId: null, label, quantity: 1, unitFils: -amountFils, amountFils: -amountFils, discountEligible: false };
}

/**
 * Validate a promo code for a customer and a subtotal. Returns the discount in
 * fils (0 if not applicable) and a reason when rejected.
 */
export async function validatePromo(
  db: Pool | PoolClient,
  code: string,
  customerId: string,
  subtotalFils: number,
): Promise<{ ok: true; amountFils: number; code: string } | { ok: false; reason: string }> {
  const norm = code.trim().toUpperCase();
  if (!norm) return { ok: false, reason: 'Enter a code.' };
  const { rows } = await db.query(`SELECT * FROM promo_codes WHERE code = $1`, [norm]);
  const p = rows[0];
  if (!p || !p.active) return { ok: false, reason: 'This code isn’t valid.' };
  // A personal voucher (e.g. a next-booking reward) belongs to one customer.
  if (p.customer_id && p.customer_id !== customerId) return { ok: false, reason: 'This code isn’t valid.' };
  if (p.expires_at && new Date(p.expires_at).getTime() < Date.now()) return { ok: false, reason: 'This code has expired.' };
  if (p.max_uses != null && p.uses >= p.max_uses) return { ok: false, reason: 'This code has been fully redeemed.' };
  if (subtotalFils < p.min_spend_fils) {
    return { ok: false, reason: `Spend at least AED ${Math.round(p.min_spend_fils / 100)} to use this code.` };
  }
  const used = await db.query(`SELECT 1 FROM promo_redemptions WHERE code = $1 AND customer_id = $2`, [norm, customerId]);
  if (used.rowCount) return { ok: false, reason: 'You’ve already used this code.' };

  const amountFils =
    p.kind === 'percent'
      ? Math.min(subtotalFils, Math.round((subtotalFils * p.value) / 100))
      : Math.min(subtotalFils, p.value);
  return { ok: true, amountFils, code: norm };
}

/**
 * Compute every discount that applies to this checkout, in priority order
 * (promo → store credit → points), each capped so the order stays payable.
 */
export async function computeDiscounts(
  db: Pool | PoolClient,
  args: { customerId: string; subtotalFils: number; input: DiscountInput },
): Promise<AppliedDiscounts> {
  const out: AppliedDiscounts = { lines: [], totalFils: 0, promo: null, creditFils: 0, points: null };
  const { rows } = await db.query(
    `SELECT loyalty_points, referral_credit_fils FROM customers WHERE id = $1`,
    [args.customerId],
  );
  const cust = rows[0] ?? { loyalty_points: 0, referral_credit_fils: 0 };

  const room = () => Math.max(0, args.subtotalFils - out.totalFils - MIN_PAYABLE_FILS);

  // 1) promo code
  if (args.input.promoCode) {
    const v = await validatePromo(db, args.input.promoCode, args.customerId, args.subtotalFils);
    if (v.ok && v.amountFils > 0) {
      const amt = Math.min(v.amountFils, room());
      if (amt > 0) {
        out.promo = { code: v.code, amountFils: amt };
        out.lines.push(line(`Promo ${v.code}`, amt));
        out.totalFils += amt;
      }
    }
  }

  // 2) store / referral credit
  if (args.input.useCredit && cust.referral_credit_fils > 0) {
    const amt = Math.min(cust.referral_credit_fils, room());
    if (amt > 0) {
      out.creditFils = amt;
      out.lines.push(line('Eventana credit', amt));
      out.totalFils += amt;
    }
  }

  // 3) loyalty points
  if (args.input.redeemPoints && cust.loyalty_points > 0) {
    const maxByRoom = room();
    const maxByPoints = cust.loyalty_points * REDEEM_FILS_PER_POINT;
    const amt = Math.min(maxByPoints, maxByRoom);
    if (amt > 0) {
      const used = Math.ceil(amt / REDEEM_FILS_PER_POINT);
      out.points = { used, amountFils: amt };
      out.lines.push(line(`${used.toLocaleString('en-US')} points redeemed`, amt));
      out.totalFils += amt;
    }
  }

  return out;
}

/** Percentage off the customer's NEXT booking, granted on every confirmation. */
export const NEXT_BOOKING_VOUCHER_PERCENT = 20;

/** A unique personal voucher code, e.g. NEXT20-7QK4ZP. */
export function makeVoucherCode(): string {
  const rand = Array.from({ length: 6 }, () =>
    'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(Math.random() * 32)],
  ).join('');
  return `NEXT${NEXT_BOOKING_VOUCHER_PERCENT}-${rand}`;
}

/** A short, unambiguous referral code (no easily-confused characters). */
export function makeReferralCode(name: string): string {
  const base = (name.replace(/[^A-Za-z]/g, '').slice(0, 4) || 'EVNT').toUpperCase();
  const rand = Math.random().toString(36).replace(/[^a-z0-9]/gi, '').slice(0, 4).toUpperCase();
  return `${base}${rand}`;
}
