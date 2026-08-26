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

/** Normalise a QuickBooks date cell (MM/DD/YYYY or YYYY-MM-DD) to YYYY-MM-DD, else null. */
function toDate(v: unknown): string | null {
  const s = String(v ?? '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  return null;
}

const pick = (r: any, keys: string[]): string => {
  for (const k of keys) {
    const v = r[k];
    if (v !== undefined && v !== null && String(v).trim() !== '') return String(v).trim();
  }
  return '';
};

export async function importOrders(rows: any[]): Promise<number> {
  let n = 0;
  // The "Sales by Customer Detail" export is grouped: customer name rows and
  // "Total for …" rows sit between the actual line items. Track the current
  // customer as we walk, and keep only real line items (those with a date).
  let currentCustomer = '';
  for (const r of rows) {
    const date = toDate(pick(r, ['txnDate', 'Transaction date', 'Date']));
    const first = pick(r, ['Transaction date', 'Date', 'Customer full name', 'Name', 'Customer']);
    const amount = pick(r, ['total', 'Amount', 'Total']);

    // A group header ("Aaedha Al Ahmed (2)") — no date, no money, a bare name.
    if (!date && !amount && first && !/^total\b/i.test(first)) {
      currentCustomer = first.replace(/\s*\(\d+\)\s*$/, '').trim();
      continue;
    }
    // A subtotal / grand-total row — skip.
    if (!date) continue;

    const doc = pick(r, ['docNumber', 'Number', 'Num', 'No.']);
    const cust = pick(r, ['customerName', 'Customer', 'Name']) || currentCustomer;
    const product = pick(r, ['product', 'Product/Service full name', 'Product/Service']);
    const memo = pick(r, ['memo', 'Description', 'Memo', 'Memo/Description']);
    const total = toFils(pick(r, ['total', 'Amount', 'Total']));
    const isDiscount = /discount/i.test(memo) || /discount/i.test(product);
    const dedupe = `${doc}|${cust}|${date}|${product}|${memo}|${total}`.slice(0, 200);

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
        pick(r, ['txnType', 'Transaction type', 'Type']) || null,
        cust || null,
        date,
        product || null,
        memo || null,
        toFils(pick(r, ['subtotal', 'Sales price', 'Subtotal'])),
        isDiscount ? total : 0,
        toFils(pick(r, ['tax', 'Tax'])),
        total,
        pick(r, ['status', 'Status']) || null,
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
