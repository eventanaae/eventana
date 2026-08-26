import { pool } from '../db/pool.js';

/**
 * Shared insert logic for the QuickBooks migration, used by both the public
 * ticket-authenticated sink (browser collector) and the authenticated admin
 * route (dashboard file upload). Idempotent upserts by dedupe key so a re-run
 * updates rather than duplicates.
 */

const digits = (s: unknown) => String(s ?? '').replace(/\D/g, '');
const EMIRATES = ['Abu Dhabi', 'Dubai', 'Sharjah', 'Ajman', 'Ras Al Khaimah', 'Ras Al Kaimah', 'Fujairah', 'Umm Al Quwain', 'Al Ain'];

function emirateFrom(bill: string): string {
  const b = bill.toLowerCase();
  for (const e of EMIRATES) if (b.includes(e.toLowerCase())) return e;
  return bill;
}

export async function importCustomers(rows: any[]): Promise<number> {
  let n = 0;
  for (const r of rows) {
    const fullName = String(r.fullName ?? r.name ?? r['Customer full name'] ?? '').trim();
    if (!fullName) continue;
    // Phone(s): accept a parsed value, or a raw "Phone:05.. Mobile:05.." string.
    const rawPhone = String(r.phone ?? r['Phone numbers'] ?? '');
    const phoneMatches = rawPhone.match(/\d[\d]{6,}/g) ?? [];
    const phone = digits(r.phone && !/\D.*\d.*\D.*\d/.test(String(r.phone)) ? r.phone : phoneMatches[0] ?? '');
    const phoneAlt = digits(r.phoneAlt ?? phoneMatches[1] ?? '');
    const email = String(r.email ?? r.Email ?? '').trim();
    const bill = String(r.billAddress ?? r['Bill address'] ?? '').trim();
    const emirate = String(r.emirate ?? '').trim() || (bill ? emirateFrom(bill) : '');
    const ship = String(r.shipAddress ?? r['Ship address'] ?? '').trim();
    const dedupe = (phone || fullName.toLowerCase()).slice(0, 200);
    await pool.query(
      `INSERT INTO historical_customers (full_name, phone, phone_alt, email, emirate, bill_address, ship_address, dedupe_key)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (dedupe_key) DO UPDATE SET
         full_name = EXCLUDED.full_name,
         phone = COALESCE(EXCLUDED.phone, historical_customers.phone),
         phone_alt = COALESCE(EXCLUDED.phone_alt, historical_customers.phone_alt),
         email = COALESCE(EXCLUDED.email, historical_customers.email),
         emirate = COALESCE(EXCLUDED.emirate, historical_customers.emirate),
         bill_address = COALESCE(EXCLUDED.bill_address, historical_customers.bill_address),
         ship_address = COALESCE(EXCLUDED.ship_address, historical_customers.ship_address)`,
      [fullName, phone || null, phoneAlt || null, email || null, emirate || null, bill || null, ship || null, dedupe],
    );
    n += 1;
  }
  return n;
}

const toFils = (v: unknown) => Math.round((Number(String(v ?? '').replace(/[^\d.-]/g, '')) || 0) * 100);

export async function importOrders(rows: any[]): Promise<number> {
  let n = 0;
  for (const r of rows) {
    const doc = String(r.docNumber ?? r['Num'] ?? r['No.'] ?? '').trim();
    const cust = String(r.customerName ?? r.Customer ?? r.Name ?? '').trim();
    const date = String(r.txnDate ?? r.Date ?? '').trim();
    const dedupe = (doc || `${cust}|${date}|${r.product ?? r['Product/Service'] ?? ''}`).slice(0, 200);
    if (!dedupe.trim()) continue;
    const dateVal = /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null;
    await pool.query(
      `INSERT INTO historical_orders (doc_number, txn_type, customer_name, txn_date, product, memo, subtotal_fils, discount_fils, tax_fils, total_fils, status, dedupe_key)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       ON CONFLICT (dedupe_key) DO UPDATE SET
         txn_type = EXCLUDED.txn_type, customer_name = EXCLUDED.customer_name, txn_date = EXCLUDED.txn_date,
         product = EXCLUDED.product, memo = EXCLUDED.memo, subtotal_fils = EXCLUDED.subtotal_fils,
         discount_fils = EXCLUDED.discount_fils, tax_fils = EXCLUDED.tax_fils, total_fils = EXCLUDED.total_fils,
         status = EXCLUDED.status`,
      [
        doc || null,
        String(r.txnType ?? r.Type ?? '').trim() || null,
        cust || null,
        dateVal,
        String(r.product ?? r['Product/Service'] ?? '').trim() || null,
        String(r.memo ?? r.Memo ?? r['Memo/Description'] ?? '').trim() || null,
        toFils(r.subtotal ?? r.Subtotal), toFils(r.discount ?? r.Discount),
        toFils(r.tax ?? r.Tax), toFils(r.total ?? r.Total ?? r.Amount),
        String(r.status ?? r.Status ?? '').trim() || null,
        dedupe,
      ],
    );
    n += 1;
  }
  return n;
}

export async function importRows(kind: string, rows: any[]): Promise<{ inserted: number }> {
  if (!Array.isArray(rows) || rows.length === 0) return { inserted: 0 };
  if (kind === 'customers') return { inserted: await importCustomers(rows) };
  if (kind === 'orders') return { inserted: await importOrders(rows) };
  throw new Error('unknown_kind');
}
