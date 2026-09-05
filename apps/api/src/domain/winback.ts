/**
 * Win-back: a personal "come back and celebrate again" code worth AED 600 off the
 * customer's NEXT booking, on any order over AED 3,000. Single-use, valid three
 * months, named after the customer. Reuses the existing promo-code engine
 * (promo_codes + validatePromo + checkout), so nothing new is needed to redeem —
 * this module only MINTS the codes and is the single source of the campaign's
 * fixed values.
 *
 * Two ways a customer gets one (both mint the same code): three days after their
 * event, and the one-off campaign to existing customers. The code is delivered by
 * email + WhatsApp with a link to the site; using it requires an account, and
 * registering with the email already on file links their past events + points.
 */
import type { Pool, PoolClient } from 'pg';

/** AED 600 off, in fils. */
export const WINBACK_AMOUNT_FILS = 60_000;
/** Only on an order over AED 3,000 (subtotal in fils). */
export const WINBACK_MIN_SPEND_FILS = 300_000;
/** How long the code stays valid. */
export const WINBACK_VALID_MONTHS = 3;
/** The site link that goes in every win-back message. */
export const WINBACK_SITE_URL = 'https://eventanauae.com';

/** A personal code that carries the customer's FIRST name, e.g. MARYAM600-K2P. */
export function makeWinbackCode(name: string): string {
  const first = (name.trim().split(/\s+/)[0] ?? '').replace(/[^A-Za-z]/g, '');
  const base = (first.slice(0, 10) || 'GUEST').toUpperCase();
  const rand = Array.from({ length: 3 }, () =>
    'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(Math.random() * 32)],
  ).join('');
  return `${base}600-${rand}`;
}

/**
 * Mint (or reuse) the win-back code for a customer. Idempotent: if the customer
 * already has an unused, unexpired win-back code we return that one instead of
 * piling up codes. Returns null only when the customer id doesn't resolve.
 */
export async function issueWinbackCode(
  db: Pool | PoolClient,
  customerId: string,
): Promise<{ code: string; reused: boolean } | null> {
  const cust = await db.query<{ name: string }>(`SELECT name FROM customers WHERE id = $1`, [customerId]);
  if (!cust.rowCount) return null;
  const name = cust.rows[0].name ?? '';

  // Reuse an existing live win-back code (unused, active, not expired) so a
  // customer is never issued two.
  const existing = await db.query<{ code: string }>(
    `SELECT p.code FROM promo_codes p
      WHERE p.customer_id = $1 AND p.campaign = 'winback' AND p.active
        AND (p.expires_at IS NULL OR p.expires_at > now())
        AND (p.max_uses IS NULL OR p.uses < p.max_uses)
        AND NOT EXISTS (SELECT 1 FROM promo_redemptions r WHERE r.code = p.code)
      ORDER BY p.created_at DESC LIMIT 1`,
    [customerId],
  );
  if (existing.rowCount) return { code: existing.rows[0].code, reused: true };

  // Insert a fresh one, retrying on the tiny chance of a code collision.
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = makeWinbackCode(name);
    const ins = await db.query(
      `INSERT INTO promo_codes
         (code, kind, value, min_spend_fils, max_uses, active, expires_at, customer_id, auto_reminder, campaign)
       VALUES ($1, 'fixed', $2, $3, 1, TRUE, now() + interval '${WINBACK_VALID_MONTHS} months', $4, TRUE, 'winback')
       ON CONFLICT (code) DO NOTHING
       RETURNING code`,
      [code, WINBACK_AMOUNT_FILS, WINBACK_MIN_SPEND_FILS, customerId],
    );
    if (ins.rowCount) return { code, reused: false };
  }
  return null;
}
