/**
 * Cancellation refund policy — the single, deterministic source of truth.
 *
 * The percentages and exclusions are Eventana's APPROVED policy, taken verbatim
 * from the customer Terms & Conditions §7:
 *
 *   • More than 7 days before the event  → 80% refunded (20% cancellation fee)
 *   • 3 to 7 days before                 → 50% refunded
 *   • Less than 72 hours before          → 0% (no refund)
 *   • The AED 800 custom-theme design fee and any made-to-order items
 *     (VIP wristbands, customized t-shirts, hats, face banners) are
 *     NON-REFUNDABLE regardless of when the customer cancels.
 *
 * The percentage applies to the PARTY VALUE only — i.e. the total actually
 * paid, minus delivery, minus the custom-theme fee, minus made-to-order items
 * (owner decision). This runs on the server so the amount cannot be tampered
 * with from the client; the app only ever displays what the server returns.
 */
import type { QuoteLine } from './types.js';
import { MADE_TO_ORDER_SERVICE_IDS } from './pricing.js';

export interface RefundTier {
  /** Refund applies when the event is at least this many hours away. */
  minHoursBefore: number;
  percent: number;
  label: string;
}

/** Ordered high → low. The first tier whose threshold is met wins. */
export const REFUND_TIERS: RefundTier[] = [
  { minHoursBefore: 168, percent: 80, label: 'More than 7 days before' },
  { minHoursBefore: 72, percent: 50, label: '3 to 7 days before' },
  { minHoursBefore: 0, percent: 0, label: 'Less than 72 hours before' },
];

export interface RefundBreakdown {
  /** Whole-hours until the event start (negative if already passed). */
  hoursToEvent: number;
  tierLabel: string;
  percent: number;
  /** The amount the customer actually paid (net of any discount), fils. */
  totalPaidFils: number;
  /** Delivery charged — never refunded, never part of the party value. */
  deliveryFils: number;
  /** Custom-theme fee + made-to-order items — never refunded. */
  nonRefundableExtrasFils: number;
  /** The base the percentage is applied to = party value, fils. */
  partyValueFils: number;
  /** What the customer gets back, fils. */
  refundFils: number;
  /** What Eventana keeps = total paid − refund, fils. */
  deductionFils: number;
}

function tierFor(hoursToEvent: number): RefundTier {
  return REFUND_TIERS.find((t) => hoursToEvent >= t.minHoursBefore) ?? REFUND_TIERS[REFUND_TIERS.length - 1];
}

/**
 * Compute the refund for a cancellation, from the order's stored quote lines
 * and the hours remaining until the event.
 */
export function computeRefund(args: {
  lines: QuoteLine[];
  totalPaidFils: number;
  hoursToEvent: number;
}): RefundBreakdown {
  const lines = Array.isArray(args.lines) ? args.lines : [];
  const sum = (pred: (l: QuoteLine) => boolean) =>
    lines.filter(pred).reduce((s, l) => s + (Number(l.amountFils) || 0), 0);

  const deliveryFils = sum((l) => l.kind === 'delivery');
  const themeFeeFils = sum((l) => l.kind === 'custom_theme');
  const madeToOrderFils = sum((l) => Boolean(l.refId) && MADE_TO_ORDER_SERVICE_IDS.has(l.refId as string));
  const nonRefundableExtrasFils = themeFeeFils + madeToOrderFils;

  const totalPaidFils = Math.max(0, Math.round(args.totalPaidFils));
  // Party value = everything paid except delivery and the non-refundable
  // extras. Clamped so odd carts can never produce a negative base.
  const partyValueFils = Math.max(0, totalPaidFils - deliveryFils - nonRefundableExtrasFils);

  const tier = tierFor(args.hoursToEvent);
  const refundFils = Math.min(totalPaidFils, Math.round((partyValueFils * tier.percent) / 100));

  return {
    hoursToEvent: Math.floor(args.hoursToEvent),
    tierLabel: tier.label,
    percent: tier.percent,
    totalPaidFils,
    deliveryFils,
    nonRefundableExtrasFils,
    partyValueFils,
    refundFils,
    deductionFils: Math.max(0, totalPaidFils - refundFils),
  };
}
