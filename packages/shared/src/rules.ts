/**
 * Eventana business rules.
 *
 * These are the DEFAULTS the system is seeded with. At runtime the engine
 * reads them from the `settings` table so Eventana admin can change them
 * from the Internal Dashboard without an app release — the customer app
 * never hard-codes a price or a fee.
 */
import { aed } from './money.js';

export interface PricingRules {
  /** Build-Your-Own discount percentage. */
  byoDiscountPercent: number;
  /** Eligible services must reach this before the discount unlocks. */
  byoDiscountThresholdFils: number;
  /** Custom theme design fee. Never discounted, never counts to threshold. */
  customThemeFeeFils: number;
  /** Standard event length. */
  standardEventHours: number;
  /** No Eventana event may run past this hour (24 = midnight). */
  latestEndHour: number;
  /** An event within this many hours counts as an urgent (last-minute) booking. */
  urgentWindowHours: number;
  /** Bookings closer than this many hours to the event are refused outright. */
  minLeadHours: number;
  /** Surcharge (percent) added to an urgent booking. */
  rushSurchargePercent: number;
  additionalHourFils: number;
  socksPerPairFils: number;
  /** How long a checkout holds inventory before it is released. */
  inventoryHoldMinutes: number;
  /** Minimum billable children on a per-child activity session. */
  activityMinimumChildren: number;
  /** Minimum order on customized t-shirts. */
  customTshirtMinimum: number;
  /** Extra food servings are sold in blocks of this many. */
  extraServingBlock: number;
  /** Reward points per whole AED spent. */
  loyaltyPointsPerAed: number;
  /** Rewards/discount vouchers do not stack with the BYO discount. */
  allowDiscountStacking: boolean;
}

export const DEFAULT_PRICING_RULES: PricingRules = {
  byoDiscountPercent: 15,
  byoDiscountThresholdFils: aed(2500),
  customThemeFeeFils: aed(800),
  standardEventHours: 4,
  latestEndHour: 24,
  urgentWindowHours: 72,
  minLeadHours: 24,
  rushSurchargePercent: 25,
  additionalHourFils: aed(800),
  socksPerPairFils: aed(12),
  inventoryHoldMinutes: 15,
  activityMinimumChildren: 20,
  customTshirtMinimum: 10,
  extraServingBlock: 10,
  loyaltyPointsPerAed: 1,
  allowDiscountStacking: false,
};

/** Start times Eventana offers. The midnight rule prunes this per booking. */
export const START_TIMES = ['15:00', '16:00', '17:00', '18:00', '19:00', '20:00'] as const;

/** Safety and operating notes, shown once per context — never per item. */
export const NOTICES = {
  inflatableSocks:
    'Children must wear socks when using the inflatable. Kids socks are available from Eventana after booking (AED 12 per pair).',
  inflatableNoFood: 'No food or drinks are allowed inside the inflatable.',
  foodStationOperated:
    'The Eventana team operates and serves this station — children never run the machine themselves.',
  packageItemsFixed:
    'Package items are fixed and cannot be changed or exchanged. You can always add extra services.',
  alGharbia:
    'We’re sorry, Eventana currently does not provide delivery to the Al Gharbia region.',
  midnight:
    'Our standard 4-hour party packages must finish by 12:00 AM. Please select an earlier start time.',
  activityMinimum: 'Activity sessions are priced per guest with a minimum of 20 guests.',
  holdWindow: 'Inventory is held for 15 minutes while you complete payment.',
} as const;

/** "17:00" -> 17. Returns NaN on malformed input. */
export function parseHour(time: string | null): number {
  if (!time) return NaN;
  const m = /^(\d{1,2}):(\d{2})$/.exec(time);
  if (!m) return NaN;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h < 0 || h > 23 || min < 0 || min > 59) return NaN;
  return h + min / 60;
}

/** 21 -> "21:00", 24 -> "24:00". The storage format; never displayed. */
export function formatHour24(hour: number): string {
  const h = Math.floor(hour);
  const minutes = Math.round((hour - h) * 60);
  return `${String(h).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

/** 21 -> "9:00 PM", 24 -> "12:00 AM". Display only. */
export function formatHour(hour: number): string {
  const h = ((Math.floor(hour) % 24) + 24) % 24;
  const minutes = Math.round((hour - Math.floor(hour)) * 60);
  const suffix = h >= 12 ? 'PM' : 'AM';
  const display = h % 12 === 0 ? 12 : h % 12;
  return `${display}:${String(minutes).padStart(2, '0')} ${suffix}`;
}

/**
 * The event end time for a start time plus any purchased extra hours.
 * Returned as an hour number so the midnight comparison stays arithmetic
 * (24 = midnight, 25 would be 1 AM and is never allowed).
 */
export function eventEndHour(
  startTime: string,
  rules: PricingRules,
  extraHours = 0,
  baseHours: number = rules.standardEventHours,
): number {
  return parseHour(startTime) + baseHours + extraHours;
}

/** Whether an event with this start time and extra hours finishes in time. */
export function endsBeforeCutoff(
  startTime: string,
  rules: PricingRules,
  extraHours = 0,
  baseHours: number = rules.standardEventHours,
): boolean {
  const end = eventEndHour(startTime, rules, extraHours, baseHours);
  return Number.isFinite(end) && end <= rules.latestEndHour;
}

/**
 * How many additional hours a confirmed event may still buy.
 * An event already ending at midnight gets 0 — the UI hides the option.
 */
export function purchasableExtraHours(
  startTime: string,
  rules: PricingRules,
  alreadyPurchased = 0,
): number {
  const end = eventEndHour(startTime, rules, alreadyPurchased);
  if (!Number.isFinite(end)) return 0;
  return Math.max(0, Math.floor(rules.latestEndHour - end));
}
