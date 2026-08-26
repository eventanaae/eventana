import type { PoolClient } from 'pg';
import { randomBytes } from 'node:crypto';
import { quote as computeQuote, formatAed, type CartInput, type Quote, type QuoteLine } from '@eventana/shared';
import { pool } from '../db/pool.js';
import { loadConfig, toPricingContext } from './settings.js';

/**
 * Manual-order "offers".
 *
 * The team builds WHAT the customer is buying — catalogue items (package +
 * add-on services), any ad-hoc custom products they type in, an optional manual
 * discount, a manual delivery value, a manual custom-theme charge, and reference
 * images for the design team. The customer opens a unique link, completes ALL
 * their own details on the normal checkout, and pays. The booking is a normal
 * order (source 'manual'); the offer flips to 'used' the moment it is paid, so
 * one link can never produce two bookings.
 *
 * Pricing: the catalogue items are priced by the engine (so the customer's
 * emirate still drives automatic delivery when no manual value is set); the
 * manual pieces are layered on top by `applyOfferToQuote`, used identically by
 * the live quote and the final checkout so the customer always sees exactly
 * what they will be charged.
 */

export type CustomItem = { name: string; priceFils: number; qty: number };

export interface OfferInput {
  celebrationType: string;
  packageId?: string | null;
  services?: Array<{ serviceId: string; quantity: number }>;
  themeId?: string | null;
  customItems?: CustomItem[];
  discountFils?: number;
  /** Fixed delivery that overrides the emirate-based calc. null/undefined = auto. */
  deliveryFils?: number | null;
  customThemeFils?: number;
  refImages?: string[];
  createdBy?: string;
}

export interface OfferAdjustments {
  customItems: CustomItem[];
  discountFils: number;
  deliveryFils: number | null;
  customThemeFils: number;
}

const line = (o: Partial<QuoteLine> & { kind: QuoteLine['kind']; label: string; amountFils: number }): QuoteLine => ({
  kind: o.kind,
  refId: o.refId ?? null,
  label: o.label,
  quantity: o.quantity ?? 1,
  unitFils: o.unitFils ?? o.amountFils,
  amountFils: o.amountFils,
  discountEligible: false,
});

/** Layer the manual pieces of an offer onto an engine quote. Pure + idempotent
 *  in the sense that it takes a fresh quote each call. Recomputes the total. */
export function applyOfferToQuote(quote: Quote, adj: OfferAdjustments): Quote {
  for (const ci of adj.customItems) {
    const qty = Number(ci.qty) > 0 ? Number(ci.qty) : 1;
    const unit = Number(ci.priceFils) || 0;
    quote.lines.push(line({ kind: 'addon', label: ci.name || 'Item', quantity: qty, unitFils: unit, amountFils: unit * qty }));
  }
  if (adj.customThemeFils > 0) {
    quote.lines.push(line({ kind: 'custom_theme', refId: 'custom_theme', label: 'Custom theme', amountFils: adj.customThemeFils }));
  }
  if (adj.deliveryFils != null) {
    // Manual delivery replaces the automatic delivery line entirely.
    quote.lines = quote.lines.filter((l) => l.kind !== 'delivery');
    if (adj.deliveryFils > 0) {
      quote.lines.push(line({ kind: 'delivery', refId: 'delivery', label: 'Delivery', amountFils: adj.deliveryFils }));
    }
    quote.deliveryFils = adj.deliveryFils;
  }
  if (adj.discountFils > 0) {
    quote.lines.push(line({ kind: 'discount', refId: 'manual_discount', label: 'Discount', unitFils: -adj.discountFils, amountFils: -adj.discountFils }));
    quote.discountFils = (quote.discountFils || 0) + adj.discountFils;
  }
  quote.totalFils = quote.lines.reduce((s, l) => s + l.amountFils, 0);
  quote.bookable = quote.totalFils > 0 && quote.problems.length === 0;
  return quote;
}

function baseCart(sel: { celebrationType: string; packageId?: string | null; services?: any[]; themeId?: string | null }): CartInput {
  return {
    celebrationType: sel.celebrationType,
    packageId: sel.packageId ?? null,
    services: (sel.services ?? []).filter((s: any) => Number(s.quantity) > 0),
    themeId: sel.themeId ?? null,
    customTheme: false,
    startTime: '17:00',
    childrenCount: 15,
  } as unknown as CartInput;
}

/** Build the priced, display-ready line list for a whole offer (catalogue +
 *  manual), plus the subtotal/total for the team and the customer to see. */
function priceOffer(
  cfg: Awaited<ReturnType<typeof loadConfig>>,
  o: {
    celebration_type?: string; celebrationType?: string;
    package_id?: string | null; packageId?: string | null;
    services?: any[]; theme_id?: string | null; themeId?: string | null;
    custom_items?: CustomItem[]; customItems?: CustomItem[];
    discount_fils?: number; discountFils?: number;
    delivery_fils?: number | null; deliveryFils?: number | null;
    custom_theme_fils?: number; customThemeFils?: number;
  },
) {
  const q = computeQuote(baseCart({
    celebrationType: o.celebration_type ?? o.celebrationType ?? 'kids',
    packageId: o.package_id ?? o.packageId ?? null,
    services: o.services,
    themeId: o.theme_id ?? o.themeId ?? null,
  }), { ...toPricingContext(cfg), nowMs: Date.now() });

  const adj: OfferAdjustments = {
    customItems: (o.custom_items ?? o.customItems ?? []) as CustomItem[],
    discountFils: Number(o.discount_fils ?? o.discountFils ?? 0),
    deliveryFils: (o.delivery_fils ?? o.deliveryFils) == null ? null : Number(o.delivery_fils ?? o.deliveryFils),
    customThemeFils: Number(o.custom_theme_fils ?? o.customThemeFils ?? 0),
  };
  applyOfferToQuote(q, adj);

  const items = q.lines
    .filter((l) => l.kind !== 'discount' && l.kind !== 'delivery')
    .map((l) => ({ label: l.label, quantity: l.quantity, amountFils: Number(l.amountFils), amountDisplay: formatAed(Number(l.amountFils)) }));
  const productsFils = items.reduce((s, l) => s + l.amountFils, 0);
  const deliveryFils = adj.deliveryFils ?? Number(q.deliveryFils || 0);
  const discountFils = adj.discountFils;
  const totalFils = productsFils - discountFils + deliveryFils;
  return { items, productsFils, discountFils, deliveryFils, deliveryAuto: adj.deliveryFils == null, totalFils };
}

export async function createOffer(input: OfferInput) {
  const cfg = await loadConfig(pool, { fresh: true });
  const priced = priceOffer(cfg, input);
  const token = randomBytes(9).toString('base64url'); // ~12 url-safe chars
  await pool.query(
    `INSERT INTO manual_offers
       (token, celebration_type, package_id, services, theme_id, subtotal_fils, created_by,
        discount_fils, delivery_fils, custom_theme_fils, custom_items, ref_images)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [
      token,
      input.celebrationType,
      input.packageId ?? null,
      JSON.stringify(input.services ?? []),
      input.themeId ?? null,
      priced.productsFils,
      input.createdBy ?? null,
      Math.max(0, Math.round(input.discountFils ?? 0)),
      input.deliveryFils == null ? null : Math.max(0, Math.round(input.deliveryFils)),
      Math.max(0, Math.round(input.customThemeFils ?? 0)),
      JSON.stringify((input.customItems ?? []).filter((c) => c.name && c.priceFils >= 0)),
      JSON.stringify((input.refImages ?? []).filter(Boolean).slice(0, 8)),
    ],
  );
  return {
    token,
    items: priced.items,
    productsDisplay: formatAed(priced.productsFils),
    discountDisplay: formatAed(priced.discountFils),
    deliveryDisplay: formatAed(priced.deliveryFils),
    deliveryAuto: priced.deliveryAuto,
    totalFils: priced.totalFils,
    totalDisplay: formatAed(priced.totalFils),
  };
}

/** Load an offer for the customer app to preload into the normal checkout. */
export async function getOffer(token: string) {
  const { rows } = await pool.query(`SELECT * FROM manual_offers WHERE token = $1`, [token]);
  const o = rows[0];
  if (!o) return null;
  const cfg = await loadConfig(pool, { fresh: true });
  const services = Array.isArray(o.services) ? o.services : [];
  const priced = priceOffer(cfg, { ...o, services });
  return {
    status: o.status as 'open' | 'used',
    celebrationType: o.celebration_type,
    packageId: o.package_id,
    services,
    themeId: o.theme_id,
    refImages: Array.isArray(o.ref_images) ? o.ref_images : [],
    items: priced.items.map((i) => ({ label: i.label, quantity: i.quantity, amountDisplay: i.amountDisplay })),
    deliveryDisplay: formatAed(priced.deliveryFils),
    deliveryAuto: priced.deliveryAuto,
    discountDisplay: formatAed(priced.discountFils),
    totalDisplay: formatAed(priced.totalFils),
  };
}

/** The manual pieces alone, for `applyOfferToQuote` at quote + checkout time. */
export async function getOfferAdjustments(token: string): Promise<(OfferAdjustments & { refImages: string[] }) | null> {
  const { rows } = await pool.query(
    `SELECT discount_fils, delivery_fils, custom_theme_fils, custom_items, ref_images
       FROM manual_offers WHERE token = $1`,
    [token],
  );
  const o = rows[0];
  if (!o) return null;
  return {
    customItems: Array.isArray(o.custom_items) ? o.custom_items : [],
    discountFils: Number(o.discount_fils || 0),
    deliveryFils: o.delivery_fils == null ? null : Number(o.delivery_fils),
    customThemeFils: Number(o.custom_theme_fils || 0),
    refImages: Array.isArray(o.ref_images) ? o.ref_images : [],
  };
}

/** True when this offer can still be booked (open, exists). */
export async function offerIsOpen(token: string): Promise<boolean> {
  const { rows } = await pool.query(`SELECT status FROM manual_offers WHERE token = $1`, [token]);
  return rows[0]?.status === 'open';
}

/** Consume an offer once its booking is paid — called from confirmBooking,
 *  inside that transaction. Idempotent. */
export async function markOfferUsed(db: PoolClient, token: string, orderId: string): Promise<void> {
  await db.query(
    `UPDATE manual_offers SET status = 'used', order_id = COALESCE(order_id, $2)
      WHERE token = $1 AND status <> 'used'`,
    [token, orderId],
  );
}
