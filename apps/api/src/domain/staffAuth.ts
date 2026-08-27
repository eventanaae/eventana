/**
 * Staff authentication: email + password login with signed, stateless session
 * tokens (same HMAC scheme as the customer tokens, so no session table and no
 * new secret). A session token carries the member id and an issue time; the
 * server trusts only its own signature. Setup/reset tokens are a separate,
 * short-lived, single-purpose signature.
 *
 * SAFETY: this is ADDITIVE. The master owner token and the existing personal
 * access_tokens keep working in the auth middleware, so introducing password
 * login never locks anyone out. The baked master token is disabled only once
 * the owner has confirmed the new login works.
 */
import { createHmac, timingSafeEqual, randomBytes, scryptSync } from 'node:crypto';
import { config } from '../config.js';

function sign(body: string): string {
  return createHmac('sha256', config.staffToken).update(body).digest('base64url');
}
function verify(value: string): string | null {
  const dot = value.lastIndexOf('.');
  if (dot < 1) return null;
  const body = value.slice(0, dot);
  const sig = value.slice(dot + 1);
  const a = Buffer.from(sig);
  const b = Buffer.from(sign(body));
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return body;
}

// ── Passwords (scrypt salt:hash) ─────────────────────────────────────────────
export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
}
export function verifyPassword(password: string, stored: string | null): boolean {
  if (!stored || !stored.includes(':')) return false;
  const [salt, hash] = stored.split(':');
  const check = scryptSync(password, salt, 64).toString('hex');
  const a = Buffer.from(check, 'hex');
  const b = Buffer.from(hash, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

// ── Sessions ─────────────────────────────────────────────────────────────────
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

/** Issue a signed staff session token for a member id. */
export function issueStaffSession(memberId: string): string {
  const body = Buffer.from(`stfsess:${memberId}:${Date.now()}`).toString('base64url');
  return `${body}.${sign(body)}`;
}
/** Return the member id iff the session token verifies and hasn't expired. */
export function verifyStaffSession(token: string | undefined | null): string | null {
  if (!token) return null;
  const body = verify(token);
  if (!body) return null;
  try {
    const [kind, memberId, issued] = Buffer.from(body, 'base64url').toString('utf8').split(':');
    if (kind !== 'stfsess' || !memberId) return null;
    if (Date.now() - Number(issued) > SESSION_TTL_MS) return null;
    return memberId;
  } catch {
    return null;
  }
}

// ── Setup / reset tokens (set-a-password links) ──────────────────────────────
const SETUP_TTL_MS = 3 * 24 * 60 * 60 * 1000; // invite: 3 days
const RESET_TTL_MS = 30 * 60_000;             // forgot-password: 30 minutes

export function issueStaffSetupToken(memberId: string, kind: 'setup' | 'reset'): string {
  const body = Buffer.from(`${kind}:${memberId}:${Date.now()}`).toString('base64url');
  return `${body}.${sign(body)}`;
}
export function verifyStaffSetupToken(token: string | undefined | null): { memberId: string; kind: 'setup' | 'reset' } | null {
  if (!token) return null;
  const body = verify(token);
  if (!body) return null;
  try {
    const [kind, memberId, issued] = Buffer.from(body, 'base64url').toString('utf8').split(':');
    if ((kind !== 'setup' && kind !== 'reset') || !memberId) return null;
    const ttl = kind === 'setup' ? SETUP_TTL_MS : RESET_TTL_MS;
    if (Date.now() - Number(issued) > ttl) return null;
    return { memberId, kind };
  } catch {
    return null;
  }
}

/** Basic password policy — enough to be meaningful without frustrating staff. */
export function passwordProblem(pw: string): string | null {
  if (typeof pw !== 'string' || pw.length < 8) return 'Password must be at least 8 characters.';
  if (!/[a-zA-Z]/.test(pw) || !/[0-9]/.test(pw)) return 'Password must include a letter and a number.';
  return null;
}
