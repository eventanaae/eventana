/**
 * Convert the QuickBooks party backlog into first-class events.
 *
 * The owner's real history (hundreds of WhatsApp parties) lives in
 * `historical_orders`, not the app's `events` table — so those customers can't
 * be reached by anything event-driven (feedback, tracking, unified history).
 * This turns each past QuickBooks party into a real completed event with a
 * signed feedback link, matched to a live customer row (found by email/phone,
 * else created). Once converted, the feedback-reminder sweep reaches them like
 * any app booking.
 *
 * Scoped by the owner to July + August 2026 only. Reachable parties only (a
 * real email or phone) — an unreachable party can't be fed back to anyway.
 *
 * Gated QB_TO_EVENTS=list|apply:
 *   list  — prints exactly which parties WOULD convert + who they'd reach.
 *           Writes NOTHING. For owner approval before any data is created.
 *   apply — creates the customers/orders/events. Sends NOTHING itself; feedback
 *           still waits behind FEEDBACK_REMINDERS=send (its own preview gate).
 * Idempotent: a party that already has an event (same customer + date) is
 * skipped, so re-running never duplicates.
 */
import { randomBytes } from 'node:crypto';
import { pool } from './pool.js';
import { withTransaction } from './pool.js';
import { nextEventId, nextOrderId } from '../domain/orders.js';

const P = (s: string) => console.log(`[qb-to-events] ${s}`);

// The owner-approved window: July + August 2026 only.
const FROM = '2026-07-01';
const TO = '2026-09-01'; // exclusive upper bound

interface Party {
  customer_name: string;
  date_str: string;
  total_fils: number;
  products: string | null;
  email: string | null;
  phone: string | null;
  emirate: string | null;
}

function maskEmail(e: string | null): string {
  const [u, d] = String(e ?? '').split('@');
  if (!d) return '(no email)';
  return `${u.slice(0, 2)}•••@${d}`;
}
function digits(s: string | null): string {
  return String(s ?? '').replace(/\D+/g, '');
}
// Names that are clearly NOT an individual party customer — banks, merchant
// services, companies. Sending "how was your celebration?" to these is wrong,
// so they're excluded from conversion (and therefore from feedback).
const NON_CUSTOMER = /\bnbd\b|\bbank\b|merchant|settlement|\bpos\b|\bllc\b|\bco\.?\b|company|trading|holding|\bgroup\b|authority|municipality|government|corporation|\bcorp\b/i;
function isNonCustomer(name: string | null): boolean {
  return NON_CUSTOMER.test(String(name ?? ''));
}

/** Light celebration-type guess from the QuickBooks product/memo text. */
function celebrationFor(products: string | null): string {
  const t = String(products ?? '').toLowerCase();
  if (/\bgender\b/.test(t)) return 'gender';
  if (/newborn|\bbaby\b|baby ?shower/.test(t)) return 'baby';
  if (/grad(uation)?/.test(t)) return 'graduation';
  if (/brid(e|al)|wedding|zaffa|milcha|katb/.test(t)) return 'bride';
  return 'kids';
}

/** One row per real party (customer + date), reachable ones only. */
async function findBacklogParties(): Promise<Party[]> {
  const { rows } = await pool.query<Party>(
    `WITH parties AS (
       SELECT customer_name, txn_date,
              sum(total_fils) AS total_fils,
              string_agg(DISTINCT coalesce(product,''), ' | ') AS products
         FROM historical_orders
        WHERE txn_date >= date '${FROM}' AND txn_date < date '${TO}'
          AND (coalesce(txn_type,'') ILIKE '%Invoice%' OR coalesce(txn_type,'') ILIKE '%Receipt%')
          AND btrim(coalesce(customer_name,'')) <> ''
        GROUP BY customer_name, txn_date
     )
     SELECT p.customer_name, to_char(p.txn_date,'YYYY-MM-DD') AS date_str,
            p.total_fils, p.products,
            hc.email, hc.phone, hc.emirate
       FROM parties p
       LEFT JOIN LATERAL (
         SELECT email, phone, emirate
           FROM historical_customers hc
          WHERE hc.dedupe_key = lower(regexp_replace(coalesce(p.customer_name,''),'[^a-z0-9]','','g'))
             OR lower(hc.full_name) = lower(p.customer_name)
          ORDER BY (hc.email IS NOT NULL AND btrim(hc.email) <> '') DESC,
                   (hc.phone IS NOT NULL AND btrim(hc.phone) <> '') DESC
          LIMIT 1
       ) hc ON true
      ORDER BY p.txn_date, p.customer_name`,
  );
  // Reachable only (real email or usable phone), and a real individual — never
  // a bank/company account like "Emirates NBD Services".
  return rows.filter(
    (r) => !isNonCustomer(r.customer_name) && ((r.email && r.email.trim()) || digits(r.phone).length >= 7),
  );
}

interface ConvertResult { converted: number; skipped: number; reachable: number }

export async function qbBacklogToEventsFromEnv(): Promise<void> {
  const mode = String(process.env.QB_TO_EVENTS ?? '').toLowerCase();
  if (mode !== 'list' && mode !== 'apply') return;
  try {
    const parties = await findBacklogParties();
    P(`reachable QuickBooks parties in Jul–Aug 2026: ${parties.length}`);

    if (mode === 'list') {
      let byMonth: Record<string, number> = {};
      for (const p of parties) {
        const ym = p.date_str.slice(0, 7);
        byMonth[ym] = (byMonth[ym] ?? 0) + 1;
        P(`  ${p.date_str} · ${p.customer_name} · ${maskEmail(p.email)} · ${digits(p.phone).length >= 7 ? 'WhatsApp ✓' : 'no phone'} · ${celebrationFor(p.products)}`);
      }
      P(`by month: ${Object.entries(byMonth).map(([m, n]) => `${m}=${n}`).join(' · ')}`);
      P('list mode — nothing created. Set QB_TO_EVENTS=apply to convert (still no sends; feedback waits behind FEEDBACK_REMINDERS=send).');
      return;
    }

    const res: ConvertResult = { converted: 0, skipped: 0, reachable: parties.length };
    for (const p of parties) {
      try {
        const outcome = await convertOne(p);
        if (outcome === 'converted') res.converted++;
        else res.skipped++;
      } catch (err) {
        P(`  FAILED ${p.date_str} · ${p.customer_name}: ${(err as Error).message}`);
      }
    }
    P(`APPLY done — converted ${res.converted}, skipped ${res.skipped} (already had an event) of ${res.reachable} reachable.`);
    P('No messages sent. Preview recipients with FEEDBACK_REMINDERS=list, then FEEDBACK_REMINDERS=send.');
  } catch (err) {
    console.error('[qb-to-events] failed:', (err as Error).message);
  }
}

async function convertOne(p: Party): Promise<'converted' | 'skipped'> {
  return withTransaction(async (db) => {
    const name = p.customer_name.trim() || 'Customer';
    const email = p.email && p.email.trim() ? p.email.trim() : null;
    const phoneDigits = digits(p.phone);
    const phoneVal = phoneDigits.length >= 7 ? p.phone!.trim() : '';

    // Find a live customer by email or phone (never by name — a name collision
    // must not attach one person's party to another). Otherwise create one.
    let customerId: string | null = null;
    if (email) {
      const q = await db.query(`SELECT id FROM customers WHERE lower(email) = lower($1) LIMIT 1`, [email]);
      if (q.rows[0]) customerId = q.rows[0].id;
    }
    if (!customerId && phoneDigits.length >= 7) {
      const q = await db.query(
        `SELECT id FROM customers WHERE regexp_replace(phone,'\\D','','g') = $1 LIMIT 1`, [phoneDigits]);
      if (q.rows[0]) customerId = q.rows[0].id;
    }
    if (!customerId) {
      customerId = `CUST-${randomBytes(4).toString('hex').toUpperCase()}`;
      await db.query(
        `INSERT INTO customers (id, name, phone, email, source) VALUES ($1,$2,$3,$4,'quickbooks')`,
        [customerId, name, phoneVal, email]);
    } else {
      // Backfill contact if the matched record is missing it.
      await db.query(
        `UPDATE customers
            SET email = COALESCE(NULLIF(btrim(email),''), $2),
                phone = CASE WHEN btrim(coalesce(phone,'')) IN ('','00000000') AND $3 <> '' THEN $3 ELSE phone END
          WHERE id = $1`,
        [customerId, email, phoneVal]);
    }

    // Already have an event for this customer on this date? Then it's reachable
    // already (or a prior run made it) — skip, never duplicate.
    const exists = await db.query(
      `SELECT 1 FROM events
        WHERE customer_id = $1 AND event_date = $2::date
          AND lower(coalesce(phase,'')) NOT LIKE '%cancel%' LIMIT 1`,
      [customerId, p.date_str]);
    if (exists.rows[0]) return 'skipped';

    const orderId = await nextOrderId(db);
    await db.query(
      `INSERT INTO orders (id, kind, customer_id, status, total_fils, cart, quote, source)
       VALUES ($1,'booking',$2,'paid',$3,$4,'{}'::jsonb,'quickbooks_import')`,
      [orderId, customerId, Math.max(0, Number(p.total_fils) || 0),
       JSON.stringify({ quickbooks: true, eventDate: p.date_str, products: p.products ?? null })]);

    const eventId = await nextEventId(db, Number(p.date_str.slice(0, 4)));
    await db.query(
      `INSERT INTO events
         (id, order_id, customer_id, celebration_type, custom_theme, event_date, start_time,
          base_end_time, extra_hours, children_count, emirate, address, map_lat, map_lng, phase, source)
       VALUES ($1,$2,$3,$4,false,$5::date,'16:00','19:00',0,0,$6,'{}'::jsonb,0,0,'Event Completed','quickbooks_import')`,
      [eventId, orderId, customerId, celebrationFor(p.products), p.date_str, p.emirate?.trim() || 'Dubai']);

    return 'converted';
  });
}
