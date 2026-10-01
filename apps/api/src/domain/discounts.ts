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
  /** When stacking is off and a reward out-valued the Build-Your-Own 15%, the
   *  caller must strip the BYO discount line (only one discount may apply). */
  droppedByo: boolean;
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
  customerId: string | null,
  subtotalFils: number,
  /**
   * Base a PERCENT code is computed on — the PARTY value only (service/package
   * lines + custom theme, less the BYO discount), EXCLUDING delivery and the
   * urgent (rush) surcharge, matching how the engine applies the BYO discount.
   * Defaults to subtotalFils for callers (e.g. the live promo preview) that
   * don't separate it out. Fixed-amount codes and min-spend always use the full
   * subtotal; the discount is still capped at the subtotal so it can't exceed
   * what's payable.
   */
  percentBaseFils: number = subtotalFils,
): Promise<{ ok: true; amountFils: number; code: string; freeDelivery: boolean } | { ok: false; reason: string }> {
  const norm = code.trim().toUpperCase();
  if (!norm) return { ok: false, reason: 'Enter a code.' };
  const { rows } = await db.query(`SELECT * FROM promo_codes WHERE code = $1`, [norm]);
  const p = rows[0];
  if (!p || !p.active) {
    // Not a customer promo — it may be a STAFF referral code (e.g. DIANASALE).
    // Those are valid to enter but give the customer NO discount; they credit
    // the crew member who brought the booking. Accept it (amount 0) so the app
    // shows it applied instead of an error; the staff credit happens at confirm.
    const staff = await db.query(`SELECT 1 FROM staff_referral_codes WHERE code = $1 AND active`, [norm]);
    if (staff.rowCount) return { ok: true, amountFils: 0, code: norm, freeDelivery: false };
    return { ok: false, reason: 'This code isn’t valid.' };
  }
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
      ? Math.min(subtotalFils, Math.round((percentBaseFils * p.value) / 100))
      : Math.min(subtotalFils, p.value);
  // The win-back "come back" code also makes delivery free (owner's rule).
  return { ok: true, amountFils, code: norm, freeDelivery: p.campaign === 'winback' };
}

/**
 * Compute every discount that applies to this checkout, in priority order
 * (promo → store credit → points), each capped so the order stays payable.
 */
export async function computeDiscounts(
  db: Pool | PoolClient,
  args: {
    customerId: string;
    subtotalFils: number;
    input: DiscountInput;
    deliveryFils?: number;
    /** PARTY value a PERCENT promo is computed on (ex delivery, ex rush).
     *  Defaults to subtotalFils. See validatePromo. */
    percentBaseFils?: number;
    /** When false, only the single highest-value discount applies — promo,
     *  points, store credit and the Build-Your-Own 15% never stack. Default true
     *  (callers that don't pass a rule keep the old stacking behaviour). */
    allowStacking?: boolean;
    /** The Build-Your-Own 15% already applied in the engine quote, so the
     *  no-stacking comparison can weigh it against the rewards. */
    byoDiscountFils?: number;
  },
): Promise<AppliedDiscounts> {
  const out: AppliedDiscounts = { lines: [], totalFils: 0, promo: null, creditFils: 0, points: null, droppedByo: false };
  const { rows } = await db.query(
    `SELECT loyalty_points, referral_credit_fils FROM customers WHERE id = $1`,
    [args.customerId],
  );
  const cust = rows[0] ?? { loyalty_points: 0, referral_credit_fils: 0 };
  const percentBase = args.percentBaseFils ?? args.subtotalFils;

  const room = () => Math.max(0, args.subtotalFils - out.totalFils - MIN_PAYABLE_FILS);

  // Stacking allowed (default): apply promo → store credit → loyalty points, each
  // capped so the order stays payable. This is the original behaviour.
  if (args.allowStacking !== false) {
    // 1) promo code
    if (args.input.promoCode) {
      const v = await validatePromo(db, args.input.promoCode, args.customerId, args.subtotalFils, percentBase);
      if (v.ok && v.amountFils > 0) {
        const amt = Math.min(v.amountFils, room());
        if (amt > 0) {
          out.promo = { code: v.code, amountFils: amt };
          out.lines.push(line(`Promo ${v.code}`, amt));
          out.totalFils += amt;
        }
      }
      // The win-back code also waives delivery: an extra discount line equal to the
      // delivery fee, on top of the AED 600. Capped by room() like every discount.
      if (v.ok && v.freeDelivery && (args.deliveryFils ?? 0) > 0) {
        const amt = Math.min(args.deliveryFils!, room());
        if (amt > 0) {
          out.lines.push(line('Free delivery', amt));
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
      const cap = Math.min(maxByPoints, maxByRoom);
      // Spend only WHOLE points, and make the discount exactly equal what those
      // points are worth. Flooring (not ceil) means an odd-fils room() cap can
      // never charge the customer an extra point for value they didn't receive.
      const used = Math.floor(cap / REDEEM_FILS_PER_POINT);
      const amt = used * REDEEM_FILS_PER_POINT;
      if (used > 0 && amt > 0) {
        out.points = { used, amountFils: amt };
        out.lines.push(line(`${used.toLocaleString('en-US')} points redeemed`, amt));
        out.totalFils += amt;
      }
    }

    return out;
  }

  // Stacking OFF: only ONE discount may apply — the single highest-value of the
  // Build-Your-Own 15%, the promo code, loyalty points and store credit. Each
  // reward's value is measured on its own against the full room, then compared;
  // the winner is applied and everything else is left off. If a reward beats the
  // BYO discount, we flag droppedByo so the caller removes the BYO line.
  const byo = Math.max(0, args.byoDiscountFils ?? 0);
  const fullRoom = Math.max(0, args.subtotalFils - MIN_PAYABLE_FILS);

  // Promo candidate (+ its free-delivery waiver, which rides with the promo).
  let promoCand: { code: string; amountFils: number; deliveryFils: number } | null = null;
  if (args.input.promoCode) {
    const v = await validatePromo(db, args.input.promoCode, args.customerId, args.subtotalFils, percentBase);
    if (v.ok && v.amountFils > 0) {
      const amt = Math.min(v.amountFils, fullRoom);
      const del =
        v.freeDelivery && (args.deliveryFils ?? 0) > 0
          ? Math.min(args.deliveryFils!, Math.max(0, fullRoom - amt))
          : 0;
      if (amt > 0) promoCand = { code: v.code, amountFils: amt, deliveryFils: del };
    }
  }

  // Loyalty-points candidate (whole points only).
  let pointsCand: { used: number; amountFils: number } | null = null;
  if (args.input.redeemPoints && cust.loyalty_points > 0) {
    const cap = Math.min(cust.loyalty_points * REDEEM_FILS_PER_POINT, fullRoom);
    const used = Math.floor(cap / REDEEM_FILS_PER_POINT);
    if (used > 0) pointsCand = { used, amountFils: used * REDEEM_FILS_PER_POINT };
  }

  // Store-credit candidate.
  let creditCand = 0;
  if (args.input.useCredit && cust.referral_credit_fils > 0) {
    creditCand = Math.min(cust.referral_credit_fils, fullRoom);
  }

  const promoValue = promoCand ? promoCand.amountFils + promoCand.deliveryFils : 0;
  const pointsValue = pointsCand ? pointsCand.amountFils : 0;
  const best = Math.max(byo, promoValue, pointsValue, creditCand);

  // BYO wins (or ties, or nothing applies): keep the BYO line, apply no reward.
  if (best <= 0 || best === byo) {
    return out;
  }
  if (promoCand && promoValue === best) {
    out.promo = { code: promoCand.code, amountFils: promoCand.amountFils };
    out.lines.push(line(`Promo ${promoCand.code}`, promoCand.amountFils));
    out.totalFils += promoCand.amountFils;
    if (promoCand.deliveryFils > 0) {
      out.lines.push(line('Free delivery', promoCand.deliveryFils));
      out.totalFils += promoCand.deliveryFils;
    }
  } else if (pointsCand && pointsValue === best) {
    out.points = { used: pointsCand.used, amountFils: pointsCand.amountFils };
    out.lines.push(line(`${pointsCand.used.toLocaleString('en-US')} points redeemed`, pointsCand.amountFils));
    out.totalFils += pointsCand.amountFils;
  } else if (creditCand === best) {
    out.creditFils = creditCand;
    out.lines.push(line('Eventana credit', creditCand));
    out.totalFils += creditCand;
  }
  out.droppedByo = byo > 0 && out.totalFils > 0;
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
