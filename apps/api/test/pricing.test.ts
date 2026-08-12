/**
 * The Eventana pricing rules, as the operator stated them.
 * Pure functions — no database, no network.
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PRICING_RULES,
  DELIVERY_ZONES,
  PACKAGES,
  SERVICES,
  aed,
  billableQuantity,
  endsBeforeCutoff,
  eventEndHour,
  formatAed,
  percentOf,
  providerAmount,
  purchasableExtraHours,
  quote,
  quoteAddons,
  type CartInput,
  type PricingContext,
} from '@eventana/shared';

const ctx: PricingContext = {
  rules: DEFAULT_PRICING_RULES,
  services: new Map(SERVICES.map((s) => [s.id, s])),
  packages: new Map(PACKAGES.map((p) => [p.id, p])),
  zones: DELIVERY_ZONES,
};

const base = (over: Partial<CartInput> = {}): CartInput => ({
  celebrationType: 'kids',
  packageId: null,
  services: [],
  themeId: null,
  customTheme: false,
  emirate: 'Dubai',
  startTime: '17:00',
  eventDate: '2026-09-19',
  childrenCount: 25,
  ...over,
});

describe('money', () => {
  it('keeps amounts exact in fils', () => {
    expect(aed(780)).toBe(78_000);
    // 15% of AED 2,599 is 389.85 — exact in fils, lossy in floats.
    expect(percentOf(aed(2599), 15)).toBe(38_985);
    expect(formatAed(38_985)).toBe('389.85');
    expect(providerAmount(722_900)).toBe('7229.00');
    expect(providerAmount(38_985)).toBe('389.85');
  });
});

describe('Build Your Own discount', () => {
  it('stays locked below AED 2,500 of eligible services', () => {
    const q = quote(base({ services: [{ serviceId: 'backdropM', quantity: 1 }] }), ctx);
    expect(q.eligibleSubtotalFils).toBe(aed(1650));
    expect(q.discountUnlocked).toBe(false);
    expect(q.discountFils).toBe(0);
    expect(q.remainingToUnlockFils).toBe(aed(850));
  });

  it('unlocks at exactly AED 2,500', () => {
    // 1,650 + 850 worth of services: backdrop + snow (250) + bubbles (400) + ... use two items
    const q = quote(
      base({
        services: [
          { serviceId: 'backdropM', quantity: 1 }, // 1650
          { serviceId: 'hotdog', quantity: 1 }, // 1200 -> 2850
        ],
      }),
      ctx,
    );
    expect(q.eligibleSubtotalFils).toBe(aed(2850));
    expect(q.discountUnlocked).toBe(true);
    expect(q.discountFils).toBe(aed(427.5));
  });

  it('never discounts the AED 800 custom theme fee, and never counts it to the threshold', () => {
    const q = quote(
      base({ services: [{ serviceId: 'backdropM', quantity: 1 }], customTheme: true }),
      ctx,
    );
    // 1,650 of services + an 800 fee is 2,450 — still locked, because the
    // fee does not count toward the AED 2,500 minimum.
    expect(q.eligibleSubtotalFils).toBe(aed(1650));
    expect(q.discountUnlocked).toBe(false);
    expect(q.customThemeFeeFils).toBe(aed(800));
    expect(q.totalFils).toBe(aed(1650 + 800 + 280));
  });

  it('never discounts delivery, and never counts it to the threshold', () => {
    // The operator's own worked example: 3,000 eligible, -450, +280 Dubai.
    const q = quote(
      base({
        services: [
          { serviceId: 'chocfountain', quantity: 1 }, // 2200
          { serviceId: 'hotdog', quantity: 1 }, // 1200 -> 3400
        ],
      }),
      ctx,
    );
    expect(q.discountFils).toBe(percentOf(aed(3400), 15));
    expect(q.deliveryFils).toBe(aed(280));
    expect(q.totalFils).toBe(aed(3400) - percentOf(aed(3400), 15) + aed(280));
  });

  it('does not apply the Build-Your-Own discount to a fixed package', () => {
    const q = quote(base({ packageId: 'golden' }), ctx);
    expect(q.discountUnlocked).toBe(false);
    expect(q.totalFils).toBe(aed(5999 + 280));
  });
});

describe('delivery zones', () => {
  it('prices each emirate from the zone table', () => {
    const fee = (emirate: string) =>
      quote(base({ emirate: emirate as CartInput['emirate'], packageId: 'movie' }), ctx).deliveryFils;
    expect(fee('Dubai')).toBe(aed(280));
    expect(fee('Sharjah')).toBe(aed(380));
    expect(fee('Ajman')).toBe(aed(380));
    expect(fee('Abu Dhabi')).toBe(aed(420));
    expect(fee('Umm Al Quwain')).toBe(aed(480));
    expect(fee('Al Ain')).toBe(aed(530));
    expect(fee('Ras Al Khaimah')).toBe(aed(530));
    expect(fee('Fujairah')).toBe(aed(660));
  });

  it('blocks Al Gharbia and charges nothing for it', () => {
    const q = quote(base({ emirate: 'Al Gharbia', packageId: 'movie' }), ctx);
    expect(q.bookable).toBe(false);
    expect(q.deliveryFils).toBe(0);
    expect(q.problems.some((p) => p.code === 'not_serviced')).toBe(true);
    // Explicitly: no Abu Dhabi fee is substituted.
    expect(q.totalFils).toBe(aed(2199));
  });
});

describe('event timing', () => {
  it('ends four hours after the start', () => {
    expect(eventEndHour('17:00', DEFAULT_PRICING_RULES)).toBe(21);
  });

  it('allows an 8 PM start (ends exactly at midnight)', () => {
    expect(endsBeforeCutoff('20:00', DEFAULT_PRICING_RULES)).toBe(true);
  });

  it('rejects a 9 PM start (would end at 1 AM)', () => {
    expect(endsBeforeCutoff('21:00', DEFAULT_PRICING_RULES)).toBe(false);
    const q = quote(base({ startTime: '21:00', packageId: 'movie' }), ctx);
    expect(q.bookable).toBe(false);
    expect(q.problems.some((p) => p.code === 'end_after_midnight')).toBe(true);
  });

  it('offers additional hours only up to midnight', () => {
    expect(purchasableExtraHours('17:00', DEFAULT_PRICING_RULES)).toBe(3);
    expect(purchasableExtraHours('19:00', DEFAULT_PRICING_RULES)).toBe(1);
    // Already 8 PM – 12 AM: no additional hour is offered at all.
    expect(purchasableExtraHours('20:00', DEFAULT_PRICING_RULES)).toBe(0);
    expect(purchasableExtraHours('17:00', DEFAULT_PRICING_RULES, 3)).toBe(0);
  });
});

describe('catalogue minimums', () => {
  it('bills activity sessions for at least 20 children', () => {
    const cupcake = SERVICES.find((s) => s.id === 'cupcake')!;
    expect(billableQuantity(cupcake, 12, 12)).toBe(20);
    expect(billableQuantity(cupcake, 30, 30)).toBe(30);

    const q = quote(base({ services: [{ serviceId: 'cupcake', quantity: 12 }] }), ctx);
    expect(q.lines[0].quantity).toBe(20);
    expect(q.lines[0].amountFils).toBe(aed(95) * 20);
    expect(q.problems.some((p) => p.code === 'below_minimum')).toBe(true);
  });

  it('bills customized t-shirts for at least 10 pieces', () => {
    const q = quote(base({ services: [{ serviceId: 'tshirt10', quantity: 4 }] }), ctx);
    expect(q.lines[0].quantity).toBe(10);
    expect(q.lines[0].amountFils).toBe(aed(39) * 10);
  });
});

describe('post-booking add-ons', () => {
  const services = new Map(SERVICES.map((s) => [s.id, s]));

  it('prices an additional hour at AED 800 and moves the end time', () => {
    const q = quoteAddons(
      { additionalHours: 1, socksPairs: 0, extraServings: {} },
      { rules: DEFAULT_PRICING_RULES, services, startTime: '18:00', hoursAlreadyPurchased: 0 },
    );
    expect(q.totalFils).toBe(aed(800));
    expect(q.newEndTime).toBe('11:00 PM');
  });

  it('refuses an additional hour that would run past midnight', () => {
    const q = quoteAddons(
      { additionalHours: 1, socksPairs: 0, extraServings: {} },
      { rules: DEFAULT_PRICING_RULES, services, startTime: '20:00', hoursAlreadyPurchased: 0 },
    );
    expect(q.bookable).toBe(false);
    expect(q.problems[0].code).toBe('end_after_midnight');
  });

  it('prices socks at AED 12 a pair', () => {
    const q = quoteAddons(
      { additionalHours: 0, socksPairs: 25, extraServings: {} },
      { rules: DEFAULT_PRICING_RULES, services, startTime: '17:00', hoursAlreadyPurchased: 0 },
    );
    expect(q.totalFils).toBe(aed(300));
  });

  it('prices extra servings in blocks of ten at the catalogue rates', () => {
    const q = quoteAddons(
      {
        additionalHours: 0,
        socksPairs: 0,
        extraServings: { popcorn: 2, chocfountain: 1, nachos: 1 },
      },
      { rules: DEFAULT_PRICING_RULES, services, startTime: '17:00', hoursAlreadyPurchased: 0 },
    );
    // 2×195 + 550 + 400
    expect(q.totalFils).toBe(aed(195 * 2 + 550 + 400));
    expect(q.lines.find((l) => l.refId === 'popcorn')!.label).toContain('20 extra servings');
  });
});
