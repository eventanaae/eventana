/**
 * Abandoned-cart recovery.
 *
 * A real customer who started a booking in the app but never paid gets a warm
 * "your celebration is waiting" email + app push, with a one-tap link back to
 * their saved checkout. Internal test accounts (the owner's / staff's own
 * try-outs) and manual pay-links are excluded — only genuine customer carts.
 *
 * Safe by construction:
 *  - only orders older than a short grace window (they had time to finish) and
 *    younger than 45 days (not ancient),
 *  - never more than a few nudges per order, and at most one every 3 days,
 *  - `list` mode sends NOTHING — it just returns who WOULD be contacted, so the
 *    owner can approve the recipients before a single email goes out.
 */
import { pool } from '../db/pool.js';
import { config } from '../config.js';
import { formatAed, celebrationLabel } from '@eventana/shared';
import { sendAbandonedCartReminder } from './notify.js';

// Names that are the team's own test accounts, never real customers.
const INTERNAL_NAME_PARTS = ['sheem', 'shaima', 'gloria', 'dindo', 'jane', 'diana', 'marsha', 'razan', 'noon', 'shan', 'test', 'qa', 'demo'];

function maskEmail(e: string): string {
  const [u, d] = String(e).split('@');
  if (!d) return '(none)';
  return `${u.slice(0, 2)}•••@${d}`;
}
function firstName(name: string | null): string {
  return String(name ?? '').trim().split(/\s+/)[0] || 'there';
}
function occasionOf(cart: any): string | null {
  const t = cart?.celebrationType ?? cart?.celebration_type;
  if (!t) return null;
  try { return celebrationLabel(t); } catch { return null; }
}

export interface CartCandidate {
  orderId: string;
  customerId: string;
  name: string | null;
  email: string;
  amountFils: number;
  amountDisplay: string;
  ageDays: number;
  occasion: string | null;
}

/**
 * Find genuine abandoned customer carts eligible for a reminder right now — ONE
 * per customer (their most recent attempt), so a customer with two unpaid carts
 * gets a single email, not two. Cadence: at most one email every 3 days, up to
 * 5 in total (≈ every 3 days for two weeks), only carts 3h–45d old.
 */
export async function findAbandonedCarts(): Promise<CartCandidate[]> {
  const { rows } = await pool.query(
    `SELECT DISTINCT ON (c.id)
            o.id, o.total_fils, o.cart, (now()::date - o.created_at::date) AS age_days,
            c.id AS customer_id, c.name, c.email
       FROM orders o JOIN customers c ON c.id = o.customer_id
      WHERE o.status = 'awaiting_payment'
        AND COALESCE(o.source,'app') = 'app'
        AND o.created_at < now() - interval '3 hours'
        AND o.created_at > now() - interval '45 days'
        AND o.total_fils > 0
        AND c.email IS NOT NULL AND btrim(c.email) <> ''
        AND (o.cart_reminded_at IS NULL OR o.cart_reminded_at < now() - interval '3 days')
        AND o.cart_reminder_count < 5
      ORDER BY c.id, o.created_at DESC`,
  );
  const staff = await pool.query<{ e: string }>(
    `SELECT lower(btrim(email)) e FROM team_members WHERE email IS NOT NULL AND btrim(email) <> ''`,
  );
  const staffEmails = new Set(staff.rows.map((r) => r.e));
  const ownerEmail = String(config.email.financeReportTo?.[0] ?? '').toLowerCase();
  const out: CartCandidate[] = [];
  for (const r of rows) {
    const name = String(r.name ?? '').toLowerCase();
    const email = String(r.email ?? '').toLowerCase();
    if (staffEmails.has(email)) continue;                    // a staff member's own try-out
    if (email && email === ownerEmail) continue;             // the owner's test account
    if (email.includes('test') || email.includes('example.')) continue;
    if (INTERNAL_NAME_PARTS.some((w) => name.includes(w))) continue;
    out.push({
      orderId: r.id,
      customerId: r.customer_id,
      name: r.name,
      email: r.email,
      amountFils: Number(r.total_fils),
      amountDisplay: formatAed(Number(r.total_fils)),
      ageDays: Number(r.age_days),
      occasion: occasionOf(r.cart),
    });
  }
  return out;
}

/** Send reminders to every eligible cart. Idempotent per order (stamps sent). */
export async function sendAbandonedCartReminders(): Promise<{ eligible: number; sent: number }> {
  const carts = await findAbandonedCarts();
  let sent = 0;
  for (const c of carts) {
    const ok = await sendAbandonedCartReminder({
      orderId: c.orderId,
      customerId: c.customerId,
      firstName: firstName(c.name),
      email: c.email,
      amountFils: c.amountFils,
      occasionPhrase: c.occasion,
    }).catch(() => false);
    if (ok) {
      sent++;
      // Stamp EVERY unpaid app cart this customer has, so a second cart doesn't
      // trigger another email and the 3-day cadence counts once per customer.
      await pool.query(
        `UPDATE orders SET cart_reminded_at = now(), cart_reminder_count = cart_reminder_count + 1
          WHERE customer_id = $1 AND status = 'awaiting_payment' AND COALESCE(source,'app') = 'app'`,
        [c.customerId],
      ).catch(() => {});
    }
  }
  return { eligible: carts.length, sent };
}

/**
 * Recurring sweep for the reconcile loop: delivers due reminders (every 3 days,
 * up to 5 per customer) but ONLY when the owner has switched reminders on with
 * CART_REMINDERS=send. Off otherwise, so nothing is sent by accident.
 */
export async function sweepAbandonedCartReminders(): Promise<void> {
  if (String(process.env.CART_REMINDERS ?? '').toLowerCase() !== 'send') return;
  const res = await sendAbandonedCartReminders();
  if (res.sent) console.log(`[cart-reminder] sweep sent ${res.sent} reminder(s)`);
}

/**
 * Boot entry. CART_REMINDERS=list logs who WOULD be contacted (sends nothing).
 * CART_REMINDERS=send actually sends once. Anything else is a no-op.
 */
export async function abandonedCartFromEnv(): Promise<void> {
  const mode = String(process.env.CART_REMINDERS ?? '').toLowerCase();
  if (mode !== 'list' && mode !== 'send') return;
  try {
    const carts = await findAbandonedCarts();
    console.log(`[cart-reminder] eligible real abandoned carts: ${carts.length}`);
    for (const c of carts) {
      console.log(`[cart-reminder]   ${c.orderId} · AED ${c.amountDisplay} · ${c.ageDays}d · ${c.name ?? '(no name)'} · ${maskEmail(c.email)} · ${c.occasion ?? 'celebration'}`);
    }
    if (mode === 'send') {
      const res = await sendAbandonedCartReminders();
      console.log(`[cart-reminder] SENT: ${res.sent} of ${res.eligible}`);
    } else {
      console.log('[cart-reminder] list mode — nothing sent. Set CART_REMINDERS=send to deliver.');
    }
  } catch (err) {
    console.error('[cart-reminder] failed:', (err as Error).message);
  }
}
