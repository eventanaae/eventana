/**
 * Customer session tokens.
 *
 * A booking's data must only be reachable by the customer who owns it. The
 * app previously identified the customer with a plain `x-customer-id` header
 * the client could set to anything — so any device could read any customer's
 * events. These stateless, HMAC-signed tokens fix that: the server issues one
 * at register/login and trusts only its own signature, never a raw id.
 *
 * The token is `base64url("<customerId>.<issuedAt>").<signature>` — no DB
 * lookup, no session table. It reuses the server-side staff secret so no new
 * key needs provisioning.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { config } from '../config.js';

function sign(body: string): string {
  return createHmac('sha256', config.staffToken).update(body).digest('base64url');
}

/** Issue a signed session token for a customer id. */
export function issueCustomerToken(customerId: string): string {
  const body = Buffer.from(`${customerId}.${Date.now()}`).toString('base64url');
  return `${body}.${sign(body)}`;
}

/** Return the customer id iff the token's signature verifies, else null. */
export function verifyCustomerToken(token: string | undefined | null): string | null {
  if (!token) return null;
  const value = token.startsWith('Bearer ') ? token.slice(7) : token;
  const dot = value.lastIndexOf('.');
  if (dot < 1) return null;
  const body = value.slice(0, dot);
  const sig = value.slice(dot + 1);
  const expected = sign(body);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const [cid, issuedAtRaw] = Buffer.from(body, 'base64url').toString('utf8').split('.');
    // Bound a session's (and any leaked token's) lifetime: expire after 90 days,
    // after which the customer signs in again.
    const issuedAt = Number(issuedAtRaw);
    if (Number.isFinite(issuedAt) && Date.now() - issuedAt > SESSION_TTL_MS) return null;
    return cid || null;
  } catch {
    return null;
  }
}

/** How long a signed-in session stays valid before re-login. */
const SESSION_TTL_MS = 90 * 24 * 60 * 60 * 1000;

/**
 * The customer id for a request, from its signed token. Empty string when
 * unauthenticated — scoped queries then simply match no rows, so a signed-out
 * device sees nothing rather than another customer's (or the demo) data.
 */
export function customerFromRequest(request: {
  headers: Record<string, unknown>;
}): string {
  const header =
    (request.headers['authorization'] as string | undefined) ??
    (request.headers['x-customer-token'] as string | undefined);
  return verifyCustomerToken(header) ?? '';
}

/** How long a password-reset link stays valid. */
const RESET_TTL_MS = 30 * 60_000;

/** A short-lived, signed password-reset token (distinct from a session token). */
export function issueResetToken(customerId: string): string {
  const body = Buffer.from(`reset:${customerId}:${Date.now()}`).toString('base64url');
  return `${body}.${sign(body)}`;
}

/** Return the customer id iff the reset token verifies and hasn't expired. */
export function verifyResetToken(token: string | undefined | null): string | null {
  if (!token) return null;
  const dot = token.lastIndexOf('.');
  if (dot < 1) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const a = Buffer.from(sig);
  const b = Buffer.from(sign(body));
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const [kind, cid, issued] = Buffer.from(body, 'base64url').toString('utf8').split(':');
    if (kind !== 'reset' || !cid) return null;
    if (Date.now() - Number(issued) > RESET_TTL_MS) return null;
    return cid;
  } catch {
    return null;
  }
}
