/**
 * The Eventana pricing engine.
 *
 * Pure and deterministic: same cart + same rules -> same quote. The API
 * runs it at checkout and treats its total as authoritative; the customer
 * app runs the identical code only to DISPLAY a live total. A total that
 * arrives from a device is never trusted (Tabby spec §1.1) — it is
 * recomputed here and compared.
 *
 * Rule order matters and is fixed:
 *   1. eligible service lines are summed
 *   2. the 15% discount applies to that sum, and only when it reaches the
 *      AED 2,500 threshold
 *   3. the AED 800 custom theme fee is added AFTER the discount — it is
 *      never discounted and never counts toward the threshold
 *   4. delivery is added last — never discounted, never counts toward the
 *      threshold
 */
import { percentOf } from './money.js';
import { SERVICE_BY_ID } from './catalogue.js';
import {
  DEFAULT_PRICING_RULES,
  endsBeforeCutoff,
  eventEndHour,
  formatHour,
  parseHour,
  type PricingRules,
} from './rules.js';

/** Categories whose Build-Your-Own booking needs a 6-hour window. */
const SIX_HOUR_CATEGORIES = new Set(['backdrop', 'inflatables', 'machines']);

/**
 * Online/digital deliverables: emailed to the customer within a few days, never
 * set up at the party. They can be ordered at any lead time and never carry the
 * urgent (rush) surcharge.
 */
export const DIGITAL_SERVICE_IDS = new Set(['invite-image', 'invite-video', 'drawing']);

/**
 * Effective event length in hours. Packages ALWAYS run the standard 4 hours,
 * even with add-ons. Build-Your-Own runs 6 hours when it includes decor/stands,
 * inflatables or machines (which need a longer window); otherwise 4.
 */
export function effectiveEventHours(
  cart: { packageId: string | null; services: Array<{ serviceId: string; quantity: number }> },
  rules: PricingRules,
): number {
  if (cart.packageId) return rules.standardEventHours;
  const needsLong = cart.services.some((line) => {
    if (line.quantity <= 0) return false;
    const svc = SERVICE_BY_ID.get(line.serviceId);
    return svc ? SIX_HOUR_CATEGORIES.has(svc.categoryId) : false;
  });
  return needsLong ? 6 : rules.standardEventHours;
}
import type {
  AddonRequest,
  CartInput,
  DeliveryZone,
  PackageDefinition,
  Quote,
  QuoteLine,
  QuoteProblem,
  ServiceDefinition,
} from './types.js';

export interface PricingContext {
  rules: PricingRules;
  services: Map<string, ServiceDefinition>;
  packages: Map<string, PackageDefinition>;
  zones: DeliveryZone[];
  /** Asset codes that are already taken for the requested window. */
  unavailableAssets?: Set<string>;
  /**
   * Wall-clock "now" in epoch ms, supplied by the caller so the pure engine
   * can price the lead-time rush surcharge without reading the clock itself.
   * Omitted on unit tests and any context that does not care about lead time.
   */
  nowMs?: number;
}

/**
 * The billable quantity for a line, after the catalogue's own minimums.
 * Activity sessions bill a floor of 20 children; t-shirts a floor of 10
 * pieces. Asking for fewer does not lower the price — it raises the
 * quantity to the minimum, which is what the operator's rule means.
 */
export function billableQuantity(
  service: ServiceDefinition,
  requested: number,
  childrenCount: number,
): number {
  switch (service.pricing.kind) {
    case 'per_child': {
      const asked = requested > 0 ? requested : childrenCount;
      return Math.max(service.pricing.minChildren, asked);
    }
    case 'per_piece':
      return Math.max(service.pricing.minQuantity, requested > 0 ? requested : 0);
    case 'flat':
    default:
      return 1;
  }
}

/** The delivery zone for an emirate, or undefined when unknown. */
export function zoneFor(zones: DeliveryZone[], emirate: string | null) {
  if (!emirate) return undefined;
  return zones.find((z) => z.emirate === emirate);
}

export function quote(cart: CartInput, ctx: PricingContext): Quote {
  const rules = ctx.rules ?? DEFAULT_PRICING_RULES;
  const problems: QuoteProblem[] = [];
  const lines: QuoteLine[] = [];

  const pkg = cart.packageId ? ctx.packages.get(cart.packageId) : null;
  if (cart.packageId && !pkg) {
    problems.push({
      code: 'unknown_service',
      message: `Unknown package ${cart.packageId}`,
      refId: cart.packageId,
    });
  }

  const mode: 'package' | 'byo' = pkg ? 'package' : 'byo';

  if (pkg) {
    lines.push({
      kind: 'package',
      refId: pkg.id,
      label: pkg.name,
      quantity: 1,
      unitFils: pkg.priceFils,
      amountFils: pkg.priceFils,
      // A fixed package is already priced; it never feeds the
      // Build-Your-Own discount.
      discountEligible: false,
    });
  }

  for (const line of cart.services) {
    const service = ctx.services.get(line.serviceId);
    if (!service) {
      problems.push({
        code: 'unknown_service',
        message: `Unknown service ${line.serviceId}`,
        refId: line.serviceId,
      });
      continue;
    }

    const qty = billableQuantity(service, line.quantity, cart.childrenCount);

    if (service.pricing.kind === 'per_piece' && line.quantity > 0 && line.quantity < service.pricing.minQuantity) {
      problems.push({
        code: 'below_minimum',
        message: `${service.name} has a minimum order of ${service.pricing.minQuantity}.`,
        refId: service.id,
      });
    }
    if (service.pricing.kind === 'per_child' && line.quantity > 0 && line.quantity < service.pricing.minChildren) {
      problems.push({
        code: 'below_minimum',
        message: `${service.name} requires a minimum of ${service.pricing.minChildren} children.`,
        refId: service.id,
      });
    }

    for (const asset of service.requiresAssets) {
      if (ctx.unavailableAssets?.has(asset)) {
        problems.push({
          code: 'unavailable',
          message: `${service.name} is no longer available for your date and time.`,
          refId: service.id,
        });
      }
    }

    lines.push({
      // On a package booking these are paid extras, not the BYO build.
      kind: mode === 'package' ? 'addon' : 'service',
      refId: service.id,
      label: service.name,
      quantity: qty,
      unitFils: service.priceFils,
      amountFils: service.priceFils * qty,
      // Only a Build-Your-Own build earns the 15%.
      discountEligible: mode === 'byo',
    });
  }

  const eligibleSubtotalFils = lines
    .filter((l) => l.discountEligible)
    .reduce((sum, l) => sum + l.amountFils, 0);

  const discountUnlocked =
    mode === 'byo' && eligibleSubtotalFils >= rules.byoDiscountThresholdFils;
  const discountFils = discountUnlocked
    ? percentOf(eligibleSubtotalFils, rules.byoDiscountPercent)
    : 0;

  if (discountFils > 0) {
    lines.push({
      kind: 'discount',
      refId: null,
      label: `${rules.byoDiscountPercent}% Build Your Own discount`,
      quantity: 1,
      unitFils: -discountFils,
      amountFils: -discountFils,
      discountEligible: false,
    });
  }

  // The custom theme fee sits outside the discount entirely. It applies only
  // to kids parties, which have a full library of ready themes as the free
  // option — every other celebration has no ready themes, so a custom design
  // is included at no extra charge.
  const customThemeFeeFils =
    cart.customTheme && cart.celebrationType === 'kids' ? rules.customThemeFeeFils : 0;
  if (customThemeFeeFils > 0) {
    lines.push({
      kind: 'custom_theme',
      refId: null,
      label: 'Custom Theme Design',
      quantity: 1,
      unitFils: customThemeFeeFils,
      amountFils: customThemeFeeFils,
      discountEligible: false,
    });
  }

  // Lead time. A booking is expected at least a week out. A rush booking made
  // inside that week is allowed — down to a hard 48-hour floor — but pays a
  // surcharge on the party value (everything except delivery, which is added
  // next). Closer than the floor is refused: the crew needs time to prepare.
  if (
    cart.eventDate &&
    cart.startTime &&
    Number.isFinite(parseHour(cart.startTime)) &&
    typeof ctx.nowMs === 'number'
  ) {
    const eventStartMs = Date.parse(`${cart.eventDate}T${cart.startTime}:00+04:00`);
    if (Number.isFinite(eventStartMs)) {
      const hoursToEvent = (eventStartMs - ctx.nowMs) / 3_600_000;
      if (hoursToEvent < rules.minLeadHours) {
        problems.push({
          code: 'too_soon',
          message: `Bookings must be made at least ${rules.minLeadHours} hours before the event. Please choose a later date.`,
        });
      } else if (hoursToEvent < rules.urgentWindowHours) {
        const partyNetFils = lines
          .filter((l) => l.kind !== 'delivery' && !(l.refId && DIGITAL_SERVICE_IDS.has(l.refId)))
          .reduce((sum, l) => sum + l.amountFils, 0);
        const rushFils = percentOf(partyNetFils, rules.rushSurchargePercent);
        if (rushFils > 0) {
          lines.push({
            kind: 'surcharge',
            refId: null,
            label: `Urgent booking (within ${rules.urgentWindowHours} hours) +${rules.rushSurchargePercent}%`,
            quantity: 1,
            unitFils: rushFils,
            amountFils: rushFils,
            discountEligible: false,
          });
        }
      }
    }
  }

  // Delivery: automatic from the event location, never chosen by the
  // customer, never discounted, never counted toward the threshold.
  let deliveryFils = 0;
  const zone = zoneFor(ctx.zones, cart.emirate);
  if (!cart.emirate) {
    problems.push({ code: 'missing_emirate', message: 'Select your event location.' });
  } else if (!zone) {
    problems.push({
      code: 'not_serviced',
      message: `Eventana does not currently deliver to ${cart.emirate}.`,
    });
  } else if (!zone.available || zone.feeFils === null) {
    problems.push({
      code: 'not_serviced',
      message:
        zone.specialConditions ??
        `We’re sorry, Eventana currently does not provide delivery to the ${zone.zoneName} region.`,
    });
  } else {
    deliveryFils = zone.feeFils;
    lines.push({
      kind: 'delivery',
      refId: null,
      label: `Delivery — ${zone.zoneName}`,
      quantity: 1,
      unitFils: deliveryFils,
      amountFils: deliveryFils,
      discountEligible: false,
    });
  }

  // Time: 4-hour event (6 for Build-Your-Own with decor/inflatables/machines)
  // that must finish by midnight.
  const baseHours = effectiveEventHours(cart, rules);
  let endTime: string | null = null;
  if (!cart.startTime) {
    problems.push({ code: 'missing_time', message: 'Pick a start time for your event.' });
  } else if (!Number.isFinite(parseHour(cart.startTime))) {
    problems.push({ code: 'missing_time', message: 'That start time is not valid.' });
  } else {
    endTime = formatHour(eventEndHour(cart.startTime, rules, 0, baseHours));
    if (!endsBeforeCutoff(cart.startTime, rules, 0, baseHours)) {
      problems.push({
        code: 'end_after_midnight',
        message: `Your ${baseHours}-hour event must finish by 12:00 AM. Please select an earlier start time.`,
      });
    }
  }

  if (!pkg && cart.services.length === 0) {
    problems.push({ code: 'empty_cart', message: 'Add at least one service to continue.' });
  }

  const totalFils = lines.reduce((sum, l) => sum + l.amountFils, 0);

  return {
    lines,
    eligibleSubtotalFils,
    discountUnlocked,
    discountFils,
    customThemeFeeFils,
    deliveryFils,
    totalFils,
    remainingToUnlockFils:
      mode === 'byo' && !discountUnlocked
        ? Math.max(0, rules.byoDiscountThresholdFils - eligibleSubtotalFils)
        : 0,
    startTime: cart.startTime,
    endTime,
    problems,
    bookable: problems.length === 0 && totalFils > 0,
  };
}

/* ------------------------------------------------------------------ */
/* Post-booking add-ons                                                */
/* ------------------------------------------------------------------ */

export interface AddonQuote {
  lines: QuoteLine[];
  totalFils: number;
  problems: QuoteProblem[];
  /** The event's new end time if these extra hours are paid for. */
  newEndTime: string | null;
  bookable: boolean;
}

/**
 * Prices an "Add More to My Event" basket. Add-ons never re-open the
 * Build-Your-Own discount and never change the original order — they
 * become a NEW order against the same Event ID (Tabby spec §8).
 */
export function quoteAddons(
  request: AddonRequest,
  opts: {
    rules: PricingRules;
    services: Map<string, ServiceDefinition>;
    startTime: string;
    /** Extra hours already paid for on this event. */
    hoursAlreadyPurchased: number;
  },
): AddonQuote {
  const { rules, services, startTime, hoursAlreadyPurchased } = opts;
  const lines: QuoteLine[] = [];
  const problems: QuoteProblem[] = [];

  const hours = Math.max(0, Math.floor(request.additionalHours));
  if (hours > 0) {
    const endWithNew = eventEndHour(startTime, rules, hoursAlreadyPurchased + hours);
    if (endWithNew > rules.latestEndHour) {
      problems.push({
        code: 'end_after_midnight',
        message: 'Additional hours are unavailable — events must finish by 12:00 AM.',
      });
    } else {
      lines.push({
        kind: 'addon',
        refId: 'additional_hour',
        label: `Additional Hour × ${hours}`,
        quantity: hours,
        unitFils: rules.additionalHourFils,
        amountFils: rules.additionalHourFils * hours,
        discountEligible: false,
      });
    }
  }

  const socks = Math.max(0, Math.floor(request.socksPairs));
  if (socks > 0) {
    lines.push({
      kind: 'addon',
      refId: 'kids_socks',
      label: `Kids Socks × ${socks} pairs`,
      quantity: socks,
      unitFils: rules.socksPerPairFils,
      amountFils: rules.socksPerPairFils * socks,
      discountEligible: false,
    });
  }

  for (const [serviceId, blocks] of Object.entries(request.extraServings ?? {})) {
    const count = Math.max(0, Math.floor(blocks));
    if (count === 0) continue;
    const service = services.get(serviceId);
    if (!service || service.extraServingFils === null) {
      problems.push({
        code: 'unknown_service',
        message: `Extra servings are not available for ${serviceId}.`,
        refId: serviceId,
      });
      continue;
    }
    lines.push({
      kind: 'addon',
      refId: serviceId,
      label: `${service.name} — ${count * rules.extraServingBlock} extra servings`,
      quantity: count,
      unitFils: service.extraServingFils,
      amountFils: service.extraServingFils * count,
      discountEligible: false,
    });
  }

  const totalFils = lines.reduce((sum, l) => sum + l.amountFils, 0);
  const newEndTime =
    hours > 0 && problems.length === 0
      ? formatHour(eventEndHour(startTime, rules, hoursAlreadyPurchased + hours))
      : null;

  return {
    lines,
    totalFils,
    problems,
    newEndTime,
    bookable: problems.length === 0 && totalFils > 0,
  };
}

/** Suggested socks quantity for a booking — one pair per attending child. */
export function suggestedSocksPairs(childrenCount: number): number {
  return Math.max(0, Math.floor(childrenCount));
}
