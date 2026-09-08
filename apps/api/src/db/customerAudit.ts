/**
 * READ-ONLY: customer-list health — total, QuickBooks vs app, registered
 * (logged-in) count, duplicates, test accounts, order linkage, and the
 * past-customer email campaigns. Answers "did we clean the list / link orders /
 * how many past customers registered?" Gated by CUSTOMER_AUDIT=true.
 */
import { pool } from './pool.js';

export async function customerAuditFromEnv(): Promise<void> {
  if (String(process.env.CUSTOMER_AUDIT ?? '').toLowerCase() !== 'true') return;
  const P = (s: string) => console.log(`[customer-audit] ${s}`);
  try {
    const c = (await pool.query(
      `SELECT
         count(*) AS total,
         count(*) FILTER (WHERE lower(coalesce(origin,'')) = 'quickbooks') AS qb,
         count(*) FILTER (WHERE password_hash IS NOT NULL) AS registered,
         count(*) FILTER (WHERE password_hash IS NOT NULL AND lower(coalesce(origin,'')) = 'quickbooks') AS qb_registered,
         count(*) FILTER (WHERE name ILIKE '%test%' OR coalesce(email,'') ILIKE '%test%') AS test_like
       FROM customers`,
    )).rows[0];
    P(`customers: total=${c.total} · quickbooks-origin=${c.qb} · registered(has login)=${c.registered} · of-those-QB=${c.qb_registered} · test-like=${c.test_like}`);

    const d = (await pool.query(
      `SELECT
         (SELECT count(*) FROM (SELECT lower(btrim(phone)) p FROM customers WHERE coalesce(btrim(phone),'')<>'' GROUP BY 1 HAVING count(*)>1) x) AS dup_phone_groups,
         (SELECT coalesce(sum(n-1),0) FROM (SELECT count(*) n FROM customers WHERE coalesce(btrim(phone),'')<>'' GROUP BY lower(btrim(phone)) HAVING count(*)>1) y) AS dup_phone_extra,
         (SELECT count(*) FROM (SELECT lower(btrim(name)) nm FROM customers GROUP BY 1 HAVING count(*)>1) z) AS dup_name_groups`,
    )).rows[0];
    P(`duplicates: phone-groups=${d.dup_phone_groups} (≈${d.dup_phone_extra} extra rows) · name-groups=${d.dup_name_groups} — NOTE many phone "dupes" are the live↔QuickBooks mirror by design`);

    const o = (await pool.query(
      `SELECT (SELECT count(*) FROM orders) AS orders_total,
              (SELECT count(DISTINCT customer_id) FROM orders) AS customers_with_orders`,
    )).rows[0];
    P(`live orders: total=${o.orders_total} · linked to a customer by id=${o.orders_total} (orders.customer_id is NOT NULL) · distinct customers with an order=${o.customers_with_orders}`);

    const h = (await pool.query(
      `SELECT count(*) AS total,
              count(*) FILTER (WHERE EXISTS (SELECT 1 FROM customers c WHERE lower(btrim(c.name)) = lower(btrim(historical_orders.customer_name)))) AS matched
       FROM historical_orders`,
    )).rows[0];
    P(`QuickBooks history (historical_orders): total=${h.total} · matched to a customer by name=${h.matched}`);

    const camps = (await pool.query(
      `SELECT audience, status, recipient_count, sent_count, to_char(sent_at,'YYYY-MM-DD') AS sent
         FROM email_campaigns ORDER BY created_at DESC LIMIT 8`,
    )).rows;
    if (!camps.length) P('email campaigns: none recorded');
    for (const r of camps) P(`  campaign: audience=${r.audience} status=${r.status} recipients=${r.recipient_count} sent=${r.sent_count}${r.sent ? ` on ${r.sent}` : ''}`);
    P('DONE');
  } catch (e) {
    P(`error: ${(e as Error).message.slice(0, 200)}`);
  }
}
