/**
 * Standalone shop for custom printed & digital goods — ordered on their own,
 * with no party (no date, time, venue or map pin). Digital goods are emailed;
 * printed goods are made to order (~2 weeks) and shipped for a flat fee.
 *
 * Pricing is pure and deterministic, mirroring the main engine: the client may
 * show a live figure, but the server recomputes from the cart at checkout.
 */
import type { ServiceDefinition } from './types.js';

/** Digital deliverables — emailed, no address, no delivery fee. */
export const SHOP_DIGITAL_IDS = new Set(['invite-image', 'invite-video', 'drawing']);
/** Made-to-order printed goods — shipped, ~2 weeks to make. */
export const SHOP_PRINTED_IDS = new Set(['wrist', 'tshirt10', 'hat', 'banner']);
/** Everything the standalone shop sells. */
export const SHOP_SERVICE_IDS: string[] = [...SHOP_DIGITAL_IDS, ...SHOP_PRINTED_IDS];

/** Printed goods need the guest's drawing (or a professional one we make). */
export const SHOP_DRAWING_IDS = new Set(['tshirt10', 'hat', 'banner', 'drawing']);

/** Made-to-order production time for printed goods, in days. */
export const SHOP_READY_DAYS = 14;

/** Turnaround for digital goods (invitations, drawings), in days. */
export const SHOP_DIGITAL_READY_DAYS = 3;

/**
 * Flat delivery for standalone printed orders, in AED. Al Gharbia (the Western
 * Region) is deliberately absent — we don't deliver there.
 */
export const SHOP_DELIVERY_AED: Record<string, number> = {
  Dubai: 30,
  Sharjah: 30,
  Ajman: 30,
  'Abu Dhabi': 50,
  Fujairah: 50,
  'Ras Al Khaimah': 50,
  'Umm Al Quwain': 50,
};

/** Emirates offered in the shop address picker (Al Gharbia included, to tell the customer we can't deliver there). */
export const SHOP_EMIRATES = [
  'Dubai', 'Sharjah', 'Ajman', 'Abu Dhabi', 'Fujairah', 'Ras Al Khaimah', 'Umm Al Quwain', 'Al Gharbia',
];

export interface ShopItem {
  serviceId: string;
  quantity: number;
}

export interface ShopLine {
  serviceId: string;
  name: string;
  quantity: number;
  unitFils: number;
  amountFils: number;
}

export interface ShopQuote {
  lines: ShopLine[];
  itemsFils: number;
  deliveryFils: number;
  totalFils: number;
  hasPrinted: boolean;
  hasDigital: boolean;
  problems: Array<{ code: string; message: string; refId?: string }>;
  bookable: boolean;
}

/** Prices a standalone shop cart. `services` is the catalogue service map. */
export function quoteShop(
  items: ShopItem[],
  emirate: string | null,
  services: Map<string, ServiceDefinition>,
): ShopQuote {
  const lines: ShopLine[] = [];
  const problems: ShopQuote['problems'] = [];
  let hasPrinted = false;
  let hasDigital = false;

  for (const it of items) {
    if (!it || it.quantity <= 0) continue;
    if (!SHOP_SERVICE_IDS.includes(it.serviceId)) {
      problems.push({ code: 'unknown_service', message: `This item can’t be ordered here.`, refId: it.serviceId });
      continue;
    }
    const s = services.get(it.serviceId);
    if (!s) {
      problems.push({ code: 'unknown_service', message: `Unknown item.`, refId: it.serviceId });
      continue;
    }
    if (SHOP_PRINTED_IDS.has(it.serviceId)) hasPrinted = true;
    if (SHOP_DIGITAL_IDS.has(it.serviceId)) hasDigital = true;

    if (s.pricing.kind === 'per_piece' && it.quantity < s.pricing.minQuantity) {
      problems.push({
        code: 'below_minimum',
        message: `${s.name} has a minimum order of ${s.pricing.minQuantity}.`,
        refId: s.id,
      });
    }

    lines.push({
      serviceId: s.id,
      name: s.name,
      quantity: it.quantity,
      unitFils: s.priceFils,
      amountFils: s.priceFils * it.quantity,
    });
  }

  // Delivery: only for printed goods, and only once (flat, by emirate).
  let deliveryFils = 0;
  if (hasPrinted) {
    if (!emirate) {
      problems.push({ code: 'missing_emirate', message: 'Choose your emirate for delivery.' });
    } else if (emirate === 'Al Gharbia' || SHOP_DELIVERY_AED[emirate] == null) {
      problems.push({
        code: 'no_delivery',
        message: `We’re sorry — Eventana doesn’t deliver printed items to ${emirate}.`,
      });
    } else {
      deliveryFils = SHOP_DELIVERY_AED[emirate] * 100;
    }
  }

  const itemsFils = lines.reduce((sum, l) => sum + l.amountFils, 0);
  const totalFils = itemsFils + deliveryFils;

  return {
    lines,
    itemsFils,
    deliveryFils,
    totalFils,
    hasPrinted,
    hasDigital,
    problems,
    bookable: problems.length === 0 && totalFils > 0,
  };
}
