/**
 * READ-ONLY reconciliation report for the owner's review of the customer and
 * supplier lists against the QuickBooks-sourced finance data. Writes NOTHING —
 * it only SELECTs and logs, so it is completely safe to run. Gated by
 * CUSTOMER_SUPPLIER_RECON=true. Every merge/cleanup stays a manual decision.
 *
 * It surfaces exactly the two problems the owner flagged:
 *  (1) duplicate customers (same person, multiple rows) + receipts whose money is
 *      attributed only by NAME (the "wrong amounts" root), and
 *  (2) supplier spend per vendor + near-duplicate vendor spellings that split it.
 */
import { pool } from './pool.js';

const aed = (fils: number) => `AED ${(Number(fils || 0) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const digits = (col: string) => `regexp_replace(${col}, '[^0-9]', '', 'g')`;
// normalise a supplier/vendor name so spelling variants collapse together
const normVendor = (s: string) =>
  (s ?? '')
    .toLowerCase()
    .replace(/\b(llc|l\.l\.c|trading|general|est|establishment|co|company|store|shop|the)\b/g, '')
    .replace(/[^a-z0-9؀-ۿ]/g, '')
    .trim();

export async function customerSupplierReconFromEnv(): Promise<void> {
  if (String(process.env.CUSTOMER_SUPPLIER_RECON ?? '').toLowerCase() !== 'true') return;
  const L = (s: string) => console.log(`[recon] ${s}`);

  // ---------- CUSTOMERS: totals ----------
  const totals = await pool.query(
    `SELECT
       (SELECT COUNT(*) FROM customers)                                             AS live,
       (SELECT COUNT(*) FROM historical_customers)                                  AS hist,
       (SELECT COUNT(*) FROM finance_receipts)                                      AS receipts,
       (SELECT COUNT(*) FROM finance_receipts WHERE customer_id IS NULL)            AS receipts_unlinked,
       (SELECT COALESCE(SUM(total_fils),0) FROM finance_receipts WHERE customer_id IS NULL) AS unlinked_fils,
       (SELECT COALESCE(SUM(total_fils),0) FROM finance_receipts)                   AS all_fils`,
  );
  const t = totals.rows[0];
  L('===== CUSTOMER RECONCILIATION =====');
  L(`totals: live_customers=${t.live} historical_customers=${t.hist} receipts=${t.receipts}`);
  L(`receipts NOT linked to a customer id (money attributed by NAME only) = ${t.receipts_unlinked} worth ${aed(t.unlinked_fils)} of ${aed(t.all_fils)} total`);

  // ---------- CUSTOMERS: duplicate groups by last-9 phone digits ----------
  const keyed = await pool.query<{ book: string; id: string; name: string; phone: string; k: string }>(
    `WITH allc AS (
        SELECT 'live' AS book, id::text AS id, name AS name, phone FROM customers
        UNION ALL
        SELECT 'qb'   AS book, id::text,        full_name,     phone FROM historical_customers
      )
      SELECT book, id, name, phone, right(${digits('phone')}, 9) AS k
        FROM allc
       WHERE length(${digits('phone')}) >= 9`,
  );
  const byPhone = new Map<string, typeof keyed.rows>();
  for (const r of keyed.rows) {
    const g = byPhone.get(r.k) ?? [];
    g.push(r); byPhone.set(r.k, g);
  }
  // spend per historical customer id (linked receipts only)
  const spendRows = await pool.query<{ id: string; n: string; fils: string }>(
    `SELECT customer_id::text AS id, COUNT(*) n, COALESCE(SUM(total_fils),0) fils
       FROM finance_receipts WHERE customer_id IS NOT NULL GROUP BY customer_id`,
  );
  const spend = new Map<string, { n: number; fils: number }>();
  for (const r of spendRows.rows) spend.set(r.id, { n: Number(r.n), fils: Number(r.fils) });

  const dupGroups = [...byPhone.entries()].filter(([, g]) => g.length > 1)
    .sort((a, b) => b[1].length - a[1].length);
  L(`----- DUPLICATE CUSTOMERS by phone (same last-9 digits) = ${dupGroups.length} group(s) -----`);
  for (const [k, g] of dupGroups) {
    const parts = g.map((m) => {
      const s = m.book === 'qb' ? spend.get(m.id) : undefined;
      const money = s ? ` ${s.n}ord/${aed(s.fils)}` : '';
      return `${m.book}:${m.name}#${m.id}${money}`;
    });
    L(`DUP ...${k.slice(-4)} x${g.length} | ${parts.join(' | ')}`);
  }

  // ---------- CUSTOMERS: duplicate groups by normalised NAME (no/short phone) ----------
  const noPhone = await pool.query<{ book: string; id: string; name: string }>(
    `WITH allc AS (
        SELECT 'live' AS book, id::text AS id, name, phone FROM customers
        UNION ALL
        SELECT 'qb'   AS book, id::text,        full_name, phone FROM historical_customers
      )
      SELECT book, id, name FROM allc WHERE length(${digits('phone')}) < 9`,
  );
  const byName = new Map<string, { book: string; id: string; name: string }[]>();
  for (const r of noPhone.rows) {
    const key = (r.name ?? '').trim().toLowerCase();
    if (!key) continue;
    const g = byName.get(key) ?? []; g.push(r); byName.set(key, g);
  }
  const nameDups = [...byName.entries()].filter(([, g]) => g.length > 1).sort((a, b) => b[1].length - a[1].length);
  L(`----- DUPLICATE CUSTOMERS by name (missing/short phone) = ${nameDups.length} group(s) -----`);
  for (const [k, g] of nameDups) L(`DUPNAME "${k}" x${g.length} | ${g.map((m) => `${m.book}#${m.id}`).join(' | ')}`);

  // ---------- CUSTOMERS: names carrying unlinked receipt money ----------
  const unlinkedByName = await pool.query<{ name: string; n: string; fils: string }>(
    `SELECT COALESCE(NULLIF(btrim(customer_name),''),'(blank)') AS name, COUNT(*) n, COALESCE(SUM(total_fils),0) fils
       FROM finance_receipts WHERE customer_id IS NULL
       GROUP BY 1 ORDER BY SUM(total_fils) DESC LIMIT 40`,
  );
  L(`----- RECEIPTS with money attributed by NAME only (top ${unlinkedByName.rows.length}) -----`);
  for (const r of unlinkedByName.rows) L(`UNLINKED "${r.name}" ${r.n} receipt(s) ${aed(Number(r.fils))}`);

  // ---------- SUPPLIERS: spend per vendor ----------
  L('===== SUPPLIER RECONCILIATION =====');
  const dirCount = await pool.query(`SELECT COUNT(*) n FROM suppliers`);
  const vendors = await pool.query<{ vendor: string; n: string; fils: string; qb: string; manual: string }>(
    `SELECT COALESCE(NULLIF(btrim(vendor),''),'(no vendor)') AS vendor,
            COUNT(*) n, COALESCE(SUM(amount_fils),0) fils,
            COUNT(*) FILTER (WHERE source='quickbooks') qb,
            COUNT(*) FILTER (WHERE source<>'quickbooks' OR source IS NULL) manual
       FROM expenses GROUP BY 1 ORDER BY SUM(amount_fils) DESC`,
  );
  L(`suppliers directory rows=${dirCount.rows[0].n} · distinct vendors in expenses=${vendors.rows.length}`);
  L(`----- SPEND PER SUPPLIER (all, highest first) -----`);
  for (const v of vendors.rows) L(`SUP "${v.vendor}" ${aed(Number(v.fils))} over ${v.n} expense(s) [qb=${v.qb} manual=${v.manual}]`);

  // ---------- SUPPLIERS: near-duplicate vendor spellings ----------
  const vnorm = new Map<string, { vendor: string; fils: number }[]>();
  for (const v of vendors.rows) {
    if (v.vendor === '(no vendor)') continue;
    const key = normVendor(v.vendor);
    if (!key) continue;
    const g = vnorm.get(key) ?? []; g.push({ vendor: v.vendor, fils: Number(v.fils) }); vnorm.set(key, g);
  }
  const vendorDups = [...vnorm.values()].filter((g) => g.length > 1);
  L(`----- NEAR-DUPLICATE VENDOR SPELLINGS (split the same supplier's spend) = ${vendorDups.length} -----`);
  for (const g of vendorDups) {
    const total = g.reduce((s, x) => s + x.fils, 0);
    L(`NEARDUP ${aed(total)} combined | ${g.map((x) => `"${x.vendor}" ${aed(x.fils)}`).join(' | ')}`);
  }
  // ---------- CUSTOMERS: event / order / receipt linkage ----------
  L('===== CUSTOMER ↔ EVENT / ORDER LINKAGE =====');
  // NOTE finance_receipts.customer_id points at historical_customers (QB, bigint
  // id), NOT the live customers table (text id) — that mismatch is the "money
  // attributed by name" root — so linkage here uses events + orders only.
  const link = await pool.query(
    `SELECT
       COUNT(*) AS total,
       COUNT(*) FILTER (WHERE EXISTS(SELECT 1 FROM events e WHERE e.customer_id=c.id)) AS with_events,
       COUNT(*) FILTER (WHERE EXISTS(SELECT 1 FROM orders o WHERE o.customer_id=c.id)) AS with_orders,
       COUNT(*) FILTER (WHERE NOT EXISTS(SELECT 1 FROM events e WHERE e.customer_id=c.id)
                          AND NOT EXISTS(SELECT 1 FROM orders o WHERE o.customer_id=c.id)) AS empty_rows,
       COUNT(*) FILTER (WHERE lower(coalesce(origin,''))='quickbooks') AS qb_origin
     FROM customers c`,
  );
  const lk = link.rows[0];
  L(`customers=${lk.total} · with_events=${lk.with_events} · with_orders=${lk.with_orders} · with NO event/order=${lk.empty_rows} · qb_origin=${lk.qb_origin}`);

  // ---------- TEST-LIKE accounts, with what's attached (safe-to-delete check) ----------
  const tests = await pool.query<{ id: string; name: string; email: string; phone: string; ev: string; od: string; origin: string }>(
    `SELECT c.id::text, c.name, COALESCE(c.email,'') AS email, COALESCE(c.phone,'') AS phone, COALESCE(c.origin,'') AS origin,
            (SELECT COUNT(*) FROM events e WHERE e.customer_id=c.id) AS ev,
            (SELECT COUNT(*) FROM orders o WHERE o.customer_id=c.id) AS od
       FROM customers c
      WHERE c.name ILIKE '%test%' OR COALESCE(c.email,'') ILIKE '%test%'
      ORDER BY (SELECT COUNT(*) FROM events e WHERE e.customer_id=c.id) DESC, c.name`,
  );
  L(`----- TEST-LIKE accounts = ${tests.rows.length} (attached data shown; only 0 events/0 orders are safe to delete) -----`);
  for (const r of tests.rows) L(`TEST #${r.id} "${r.name}" <${r.email}> ${r.phone} [origin=${r.origin || '—'}] events=${r.ev} orders=${r.od}`);
  const safe = tests.rows.filter((r) => Number(r.ev) === 0 && Number(r.od) === 0);
  L(`TEST-SAFE (no event/order, safe to delete) = ${safe.length}: ${safe.map((r) => r.id).join(',') || '(none)'}`);

  L('===== END RECON =====');
}
