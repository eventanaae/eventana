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
    const cid = Buffer.from(body, 'base64url').toString('utf8').split('.')[0];
    return cid || null;
  } catch {
    return null;
  }
}

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
