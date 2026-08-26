import { pool } from '../db/pool.js';
import { formatAed } from '@eventana/shared';

/**
 * The dashboard's simple QuickBooks-style finance module: customers, items,
 * invoices (billed → Accounts Receivable), sales receipts (paid → Cash on hand),
 * and the account balances that fall out of them. Kept deliberately lean — one
 * short form per document, Cash on hand as the only account.
 */

export type LineItem = { name: string; qty: number; priceFils: number };

function computeTotals(items: LineItem[], discountFils: number, shippingFils: number) {
  const subtotal = items.reduce((s, l) => s + Math.round(l.qty * l.priceFils), 0);
  const total = subtotal - (discountFils || 0) + (shippingFils || 0);
  return { subtotal, total };
}

const itemsWithAmount = (items: LineItem[]) =>
  items.map((l) => ({ ...l, amountFils: Math.round(l.qty * l.priceFils), amountDisplay: formatAed(Math.round(l.qty * l.priceFils)) }));

// ── Customers (the migrated book, plus new ones) ─────────────────────────────
export async function listCustomers(search?: string) {
  const s = (search ?? '').trim();
  const { rows } = await pool.query(
    s
      ? `SELECT id, full_name, email, phone, emirate, bill_address, ship_address FROM historical_customers
           WHERE full_name ILIKE $1 OR phone ILIKE $1 OR email ILIKE $1 ORDER BY lower(full_name) LIMIT 100`
      : `SELECT id, full_name, email, phone, emirate, bill_address, ship_address FROM historical_customers
           ORDER BY lower(full_name) LIMIT 500`,
    s ? [`%${s}%`] : [],
  );
  return rows;
}

export async function addCustomer(d: { fullName: string; email?: string; phone?: string; backupPhone?: string; emirate?: string }) {
  const dedupe = ((d.phone ?? '').replace(/\D/g, '') || d.fullName.toLowerCase()).slice(0, 200);
  const { rows } = await pool.query(
    `INSERT INTO historical_customers (full_name, phone, phone_alt, email, emirate, dedupe_key, source)
     VALUES ($1,$2,$3,$4,$5,$6,'dashboard')
     ON CONFLICT (dedupe_key) DO UPDATE SET
       full_name = EXCLUDED.full_name,
       phone_alt = COALESCE(EXCLUDED.phone_alt, historical_customers.phone_alt),
       email = COALESCE(EXCLUDED.email, historical_customers.email),
       emirate = COALESCE(EXCLUDED.emirate, historical_customers.emirate)
     RETURNING id, full_name, email, phone, phone_alt, emirate`,
    [d.fullName.trim(), (d.phone ?? '').trim() || null, (d.backupPhone ?? '').trim() || null, (d.email ?? '').trim() || null, (d.emirate ?? '').trim() || null, dedupe],
  );
  return rows[0];
}

// ── Items (packages + services from the catalogue) ───────────────────────────
export async function listItems() {
  const [pkgs, svcs] = await Promise.all([
    pool.query(`SELECT name, price_fils FROM packages WHERE active ORDER BY price_fils DESC`),
    pool.query(`SELECT name, price_fils FROM services WHERE active ORDER BY name`),
  ]);
  return [
    ...pkgs.rows.map((r) => ({ name: r.name, priceFils: Number(r.price_fils), kind: 'package' })),
    ...svcs.rows.map((r) => ({ name: r.name, priceFils: Number(r.price_fils), kind: 'service' })),
  ];
}

async function nextNumber(): Promise<string> {
  const { rows } = await pool.query(`SELECT nextval('finance_doc_seq')::bigint AS n`);
  return String(rows[0].n);
}

// ── Invoices ─────────────────────────────────────────────────────────────────
type DocInput = {
  customerId?: number | null; customerName: string;
  items: LineItem[]; discountFils?: number; shippingFils?: number;
  message?: string;
};

export async function createInvoice(d: DocInput & { dueDate?: string | null; issueDate?: string | null; status?: string }) {
  const { subtotal, total } = computeTotals(d.items, d.discountFils ?? 0, d.shippingFils ?? 0);
  const number = await nextNumber();
  const { rows } = await pool.query(
    `INSERT INTO finance_invoices (number, customer_id, customer_name, issue_date, due_date, line_items, subtotal_fils, discount_fils, shipping_fils, total_fils, status, message)
     VALUES ($1,$2,$3,COALESCE($4,current_date),$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
    [number, d.customerId ?? null, d.customerName, d.issueDate ?? null, d.dueDate ?? null, JSON.stringify(d.items), subtotal, d.discountFils ?? 0, d.shippingFils ?? 0, total, d.status ?? 'sent', d.message ?? null],
  );
  return decorateInvoice(rows[0]);
}

export async function listInvoices() {
  const { rows } = await pool.query(`SELECT * FROM finance_invoices ORDER BY issue_date DESC, id DESC`);
  const list = rows.map(decorateInvoice);
  const paid = list.filter((i) => i.status === 'paid').reduce((s, i) => s + i.total_fils, 0);
  const unpaid = list.filter((i) => i.status !== 'paid').reduce((s, i) => s + i.total_fils, 0);
  return { invoices: list, paidFils: paid, paidDisplay: formatAed(paid), unpaidFils: unpaid, unpaidDisplay: formatAed(unpaid) };
}

export async function setInvoiceStatus(id: number, status: string) {
  const paidAt = status === 'paid' ? 'now()' : 'NULL';
  const { rows } = await pool.query(
    `UPDATE finance_invoices SET status = $2, paid_at = ${paidAt} WHERE id = $1 RETURNING *`,
    [id, status],
  );
  return rows[0] ? decorateInvoice(rows[0]) : null;
}

function decorateInvoice(r: any) {
  const total = Number(r.total_fils);
  // Overdue if past due date and not paid.
  const today = new Date().toISOString().slice(0, 10);
  let status = r.status as string;
  const due = r.due_date ? String(r.due_date).slice(0, 10) : null;
  if (status !== 'paid' && due && due < today) status = 'overdue';
  return {
    ...r,
    subtotal_fils: Number(r.subtotal_fils), discount_fils: Number(r.discount_fils), shipping_fils: Number(r.shipping_fils),
    total_fils: total, totalDisplay: formatAed(total),
    lineItems: itemsWithAmount(Array.isArray(r.line_items) ? r.line_items : []),
    status,
    overdueDays: status === 'overdue' && due ? Math.floor((Date.parse(today) - Date.parse(due)) / 86_400_000) : 0,
  };
}

// ── Sales receipts (paid → Cash on hand) ─────────────────────────────────────
export async function createReceipt(d: DocInput & { date?: string | null; paidWith?: string }) {
  const { subtotal, total } = computeTotals(d.items, d.discountFils ?? 0, d.shippingFils ?? 0);
  const number = await nextNumber();
  const { rows } = await pool.query(
    `INSERT INTO finance_receipts (number, customer_id, customer_name, date, line_items, subtotal_fils, discount_fils, shipping_fils, total_fils, paid_with, message)
     VALUES ($1,$2,$3,COALESCE($4,current_date),$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
    [number, d.customerId ?? null, d.customerName, d.date ?? null, JSON.stringify(d.items), subtotal, d.discountFils ?? 0, d.shippingFils ?? 0, total, d.paidWith ?? 'Cash', d.message ?? null],
  );
  return decorateReceipt(rows[0]);
}

/**
 * One-time: turn the migrated QuickBooks sale lines (historical_orders) into
 * real sales-receipt records grouped by document number, so the whole sales
 * history shows in the Sales receipts list. Marked source='quickbooks' so it
 * does NOT double-count against the Cash on hand opening balance. Idempotent.
 */
export async function importReceiptsFromHistory() {
  const { rows } = await pool.query(
    `SELECT doc_number, customer_name, txn_date, product, memo, total_fils
       FROM historical_orders
      WHERE doc_number IS NOT NULL AND doc_number <> '' AND txn_date IS NOT NULL
      ORDER BY doc_number, id`,
  );
  const groups = new Map<string, { customer: string; date: string; lines: any[] }>();
  for (const r of rows) {
    const key = String(r.doc_number);
    if (!groups.has(key)) groups.set(key, { customer: r.customer_name || 'Customer', date: String(r.txn_date).slice(0, 10), lines: [] });
    groups.get(key)!.lines.push(r);
  }
  let inserted = 0;
  for (const [doc, g] of groups) {
    const items: LineItem[] = [];
    let discount = 0, shipping = 0;
    for (const l of g.lines) {
      const text = `${l.product ?? ''} ${l.memo ?? ''}`.toLowerCase();
      const amt = Number(l.total_fils);
      if (/discount/.test(text)) discount += Math.abs(amt);
      else if (/shipping|delivery/.test(text)) shipping += amt;
      else items.push({ name: (l.product || l.memo || 'Item').slice(0, 200), qty: 1, priceFils: amt });
    }
    const subtotal = items.reduce((s, i) => s + i.priceFils, 0);
    const total = subtotal - discount + shipping;
    const res = await pool.query(
      `INSERT INTO finance_receipts (number, customer_name, date, line_items, subtotal_fils, discount_fils, shipping_fils, total_fils, paid_with, source)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'Cash','quickbooks')
       ON CONFLICT (number) DO NOTHING`,
      [doc, g.customer, g.date, JSON.stringify(items), subtotal, discount, shipping, total],
    );
    inserted += res.rowCount ?? 0;
  }
  return { receipts: inserted, groups: groups.size };
}

export async function listReceipts() {
  const { rows } = await pool.query(`SELECT * FROM finance_receipts ORDER BY date DESC, id DESC`);
  const list = rows.map(decorateReceipt);
  const total = list.reduce((s, r) => s + r.total_fils, 0);
  return { receipts: list, totalFils: total, totalDisplay: formatAed(total) };
}

export async function deleteReceipt(id: number) {
  await pool.query(`DELETE FROM finance_receipts WHERE id = $1`, [id]);
  return { deleted: true };
}

function decorateReceipt(r: any) {
  const total = Number(r.total_fils);
  return {
    ...r,
    subtotal_fils: Number(r.subtotal_fils), discount_fils: Number(r.discount_fils), shipping_fils: Number(r.shipping_fils),
    total_fils: total, totalDisplay: formatAed(total),
    lineItems: itemsWithAmount(Array.isArray(r.line_items) ? r.line_items : []),
  };
}

// ── Accounting (the accounts we actually use, with balances) ─────────────────
export async function accountingSummary() {
  const [opening, receipts, paidInv, unpaidInv, expenses] = await Promise.all([
    pool.query(`SELECT value FROM settings WHERE key = 'finance.cashOpeningFils'`),
    pool.query(`SELECT COALESCE(sum(total_fils),0)::bigint v FROM finance_receipts WHERE source <> 'quickbooks'`),
    pool.query(`SELECT COALESCE(sum(total_fils),0)::bigint v FROM finance_invoices WHERE status = 'paid'`),
    pool.query(`SELECT COALESCE(sum(total_fils),0)::bigint v, count(*)::int c FROM finance_invoices WHERE status <> 'paid'`),
    pool.query(`SELECT COALESCE(sum(amount_fils),0)::bigint v FROM expenses`),
  ]);
  const open = Number(opening.rows[0]?.value ?? 0);
  const cashOnHand = open + Number(receipts.rows[0].v) + Number(paidInv.rows[0].v) - Number(expenses.rows[0].v);
  const ar = Number(unpaidInv.rows[0].v);
  return {
    accounts: [
      { group: 'Bank', name: 'Cash on hand', balanceFils: cashOnHand, balanceDisplay: formatAed(cashOnHand) },
      { group: 'Accounts receivable', name: 'Accounts Receivable (A/R)', balanceFils: ar, balanceDisplay: formatAed(ar), note: `${unpaidInv.rows[0].c} unpaid invoice(s)` },
    ],
    cashOnHandFils: cashOnHand, arFils: ar,
  };
}
