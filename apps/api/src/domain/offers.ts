import type { PoolClient } from 'pg';
import { randomBytes } from 'node:crypto';
import { quote as computeQuote, formatAed, type CartInput } from '@eventana/shared';
import { pool } from '../db/pool.js';
import { loadConfig, toPricingContext } from './settings.js';

/**
 * Manual-order "offers".
 *
 * The team picks only the products (package + add-on services + optional theme);
 * the customer opens a unique link, completes ALL their own details on the normal
 * checkout, and pays. So an offer is just the chosen items + their price behind a
 * token — never a customer or an event. The booking is a normal order the customer
 * creates (source 'manual'); the offer flips to 'used' the moment that booking is
 * paid, so one link can never produce two bookings.
 */

export interface OfferInput {
  celebrationType: string;
  packageId?: string | null;
  services?: Array<{ serviceId: string; quantity: number }>;
  themeId?: string | null;
  createdBy?: string;
}

/** Build the priced item lines for a selection (no delivery/date — those come
 *  from the customer at checkout). */
function priceItems(
  cfg: Awaited<ReturnType<typeof loadConfig>>,
  sel: { celebrationType: string; packageId?: string | null; services?: any[]; themeId?: string | null },
) {
  const cart = {
    celebrationType: sel.celebrationType,
    packageId: sel.packageId ?? null,
    services: (sel.services ?? []).filter((s: any) => Number(s.quantity) > 0),
    themeId: sel.themeId ?? null,
    customTheme: false,
    startTime: '17:00',
    childrenCount: 15,
  } as unknown as CartInput;
  const q = computeQuote(cart, { ...toPricingContext(cfg), nowMs: Date.now() });
  const items = q.lines
    .filter((l) => l.kind !== 'discount' && l.kind !== 'delivery')
    .map((l) => ({
      label: l.label,
      quantity: l.quantity,
      amountFils: Number(l.amountFils),
      amountDisplay: formatAed(Number(l.amountFils)),
    }));
  const subtotal = items.reduce((s, l) => s + l.amountFils, 0);
  return { items, subtotal, problems: q.problems };
}

export async function createOffer(input: OfferInput) {
  const cfg = await loadConfig(pool, { fresh: true });
  const { items, subtotal } = priceItems(cfg, input);
  const token = randomBytes(9).toString('base64url'); // ~12 url-safe chars
  await pool.query(
    `INSERT INTO manual_offers (token, celebration_type, package_id, services, theme_id, subtotal_fils, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [
      token,
      input.celebrationType,
      input.packageId ?? null,
      JSON.stringify(input.services ?? []),
      input.themeId ?? null,
      subtotal,
      input.createdBy ?? null,
    ],
  );
  return { token, subtotalFils: subtotal, subtotalDisplay: formatAed(subtotal), items };
}

/** Load an offer for the customer app to preload into the normal checkout. */
export async function getOffer(token: string) {
  const { rows } = await pool.query(`SELECT * FROM manual_offers WHERE token = $1`, [token]);
  const o = rows[0];
  if (!o) return null;
  const cfg = await loadConfig(pool, { fresh: true });
  const services = Array.isArray(o.services) ? o.services : [];
  const { items } = priceItems(cfg, {
    celebrationType: o.celebration_type,
    packageId: o.package_id,
    services,
    themeId: o.theme_id,
  });
  return {
    status: o.status as 'open' | 'used',
    celebrationType: o.celebration_type,
    packageId: o.package_id,
    services,
    themeId: o.theme_id,
    items,
    subtotalDisplay: formatAed(Number(o.subtotal_fils)),
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
