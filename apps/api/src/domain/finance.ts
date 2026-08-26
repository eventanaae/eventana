import type { PoolClient } from 'pg';
import { randomBytes } from 'node:crypto';
import { pool, withTransaction } from '../db/pool.js';
import { formatAed } from '@eventana/shared';
import { sendEmail, emailEnabled } from '../integrations/email.js';
import { renderFinanceDocEmail } from './notify.js';
import { nextOrderId, nextEventId } from './orders.js';

/**
 * The dashboard's simple QuickBooks-style finance module: customers, items,
 * invoices (billed → Accounts Receivable), sales receipts (paid → Cash on hand),
 * and the account balances that fall out of them. Kept deliberately lean — one
 * short form per document, Cash on hand as the only account.
 */

/**
 * Normalise a free-typed / imported emirate value to one of Eventana's canonical
 * delivery zones. Al Ain, Khor Fakkan and Kalba are kept as their OWN zones (per
 * the owner) rather than folded into Abu Dhabi / Sharjah. Order matters: the more
 * specific city is matched before its parent emirate. Returns null when nothing
 * recognisable is present (caller leaves the value untouched).
 */
const CANON_EMIRATES = [
  'Abu Dhabi', 'Al Ain', 'Dubai', 'Sharjah', 'Ajman',
  'Umm Al Quwain', 'Ras Al Khaimah', 'Fujairah',
] as const;

export function normalizeEmirate(raw: string | null | undefined): string | null {
  const s = String(raw ?? '')
    .replace(/[‎‏‪-‮]/g, '') // strip bidi marks (‏ etc.)
    .replace(/[\r\n]+/g, ' ')
    .toLowerCase()
    .trim();
  if (!s) return null;
  const has = (...ks: string[]) => ks.some((k) => s.includes(k));
  // City-level zones first (they sit inside a parent emirate).
  if (has('alain', 'al ain', 'al alain')) return 'Al Ain';
  // Khor Fakkan & Kalba (east coast) are grouped with Fujairah per the owner.
  if (has('khor fakkan', 'khorfakkan', 'khor fakan', 'khorfakan', 'khour fakkan', 'kalba', 'khalba')) return 'Fujairah';
  // Parent emirates.
  if (has('abu dhabi', 'abudhabi', 'abu dhbai', 'abudhbai', 'shakbout', 'baniyas', 'khalifa city', 'blue resort', 'rahbah', 'rahba', 'mussafah', 'mussaffah')) return 'Abu Dhabi';
  if (has('dubai', 'dubay')) return 'Dubai';
  if (has('sharjah', 'sharjha', 'sharja', 'shariah', 'shrjah')) return 'Sharjah';
  if (has('ajman')) return 'Ajman';
  if (has('umm al', 'um al', 'umalq', 'um alq', 'quwain', 'qaiwain', 'qeween', 'quween', 'qaween', 'qiwain', 'qaiwan', 'qaween')) return 'Umm Al Quwain';
  if (has('ras al', 'rasal', 'raz al', 'rak al', 'ras l')) return 'Ras Al Khaimah';
  if (has('fujairah', 'fujaira', 'fujeirah', 'fujayrah')) return 'Fujairah';
  return null;
}

/**
 * One-time data hygiene: rewrite every recognisable emirate value to its
 * canonical zone across the customer book, live customers and events. The
 * receipt "city" reads from historical_customers.emirate, so cleaning that
 * column tidies the whole Sales page. Idempotent — re-running changes nothing.
 */
export async function normalizeAllEmirates(): Promise<{ tables: Record<string, number>; canonical: string[] }> {
  const tables: Record<string, number> = {};
  for (const [table, col] of [['historical_customers', 'emirate'], ['events', 'emirate']] as const) {
    const { rows } = await pool.query<{ id: string; v: string }>(
      `SELECT id, ${col} AS v FROM ${table} WHERE ${col} IS NOT NULL AND ${col} <> ''`,
    );
    let updated = 0;
    for (const r of rows) {
      const canon = normalizeEmirate(r.v);
      if (canon && canon !== r.v) {
        await pool.query(`UPDATE ${table} SET ${col} = $2 WHERE id = $1`, [r.id, canon]);
        updated++;
      }
    }
    tables[table] = updated;
  }
  return { tables, canonical: [...CANON_EMIRATES] };
}

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

/** Full profile for one customer — for the view/edit panel opened from a receipt. */
export async function getCustomer(id: number) {
  const { rows } = await pool.query(
    `SELECT id, full_name, phone, phone_alt, email, emirate, bill_address, ship_address FROM historical_customers WHERE id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

/** Find a customer by name — used to resolve the profile behind a receipt whose
 *  customer_id is null (the migrated QuickBooks history). */
export async function findCustomerByName(name: string) {
  const { rows } = await pool.query(
    `SELECT id, full_name, phone, phone_alt, email, emirate, bill_address, ship_address
       FROM historical_customers WHERE lower(full_name) = lower($1) ORDER BY id LIMIT 1`,
    [name],
  );
  return rows[0] ?? null;
}

/** Edit a customer's details (name, phones, email, emirate/city). */
export async function updateCustomer(
  id: number,
  d: { fullName?: string; phone?: string; backupPhone?: string; email?: string; emirate?: string },
) {
  const { rows } = await pool.query(
    `UPDATE historical_customers SET
        full_name = COALESCE(NULLIF($2,''), full_name),
        phone     = COALESCE($3, phone),
        phone_alt = COALESCE($4, phone_alt),
        email     = COALESCE($5, email),
        emirate   = COALESCE($6, emirate)
      WHERE id = $1
      RETURNING id, full_name, phone, phone_alt, email, emirate`,
    [id, (d.fullName ?? '').trim(), d.phone ?? null, d.backupPhone ?? null, d.email ?? null, d.emirate ?? null],
  );
  return rows[0] ?? null;
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
  // Party details echoed on the receipt (guest-of-honour / baby name + theme + age).
  eventFor?: string | null; theme?: string | null; age?: string | null;
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
    `INSERT INTO finance_receipts (number, customer_id, customer_name, date, line_items, subtotal_fils, discount_fils, shipping_fils, total_fils, paid_with, message, event_for, theme, age)
     VALUES ($1,$2,$3,COALESCE($4,current_date),$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
    [number, d.customerId ?? null, d.customerName, d.date ?? null, JSON.stringify(d.items), subtotal, d.discountFils ?? 0, d.shippingFils ?? 0, total, d.paidWith ?? 'Cash', d.message ?? null, d.eventFor ?? null, d.theme ?? null, d.age ?? null],
  );
  // An upcoming sale becomes an operational event automatically, so it shows on
  // the schedule/board. No-op for past-dated receipts. Never blocks the receipt.
  void ensureEventForReceipt(rows[0].id).catch(() => {});
  return decorateReceipt(rows[0]);
}

/**
 * Record a paid order as a sales receipt on the Sales page, so every order —
 * from the website, the app, the shop, or a manual pay-link — shows up here as
 * a sale the moment it is paid. Called from inside the confirmation transaction;
 * wrapped in a SAVEPOINT so a finance hiccup can never roll back a paid booking.
 * Idempotent by order_id (a replayed webhook adds no second sale). Tips are not
 * sales and are skipped by the caller.
 */
export async function recordSaleFromOrder(
  db: PoolClient,
  order: {
    id: string; kind?: string; source?: string | null;
    cart?: any; quote?: any; total_fils?: unknown; customer_id?: string | null;
  },
): Promise<void> {
  await db.query('SAVEPOINT fin_sale');
  try {
    const exists = await db.query(`SELECT 1 FROM finance_receipts WHERE order_id = $1`, [order.id]);
    if (exists.rows[0]) { await db.query('RELEASE SAVEPOINT fin_sale'); return; }

    const cart = (order.cart ?? {}) as Record<string, any>;
    const quote = (order.quote ?? {}) as Record<string, any>;

    const cust = order.customer_id
      ? (await db.query(`SELECT name, phone, email FROM customers WHERE id = $1`, [order.customer_id])).rows[0]
      : null;
    const customerName = cust?.name || 'Customer';

    // Mirror the paying customer into the finance customer book, deduped by phone
    // (or email/name), so they appear in the dashboard Customers list like any
    // stored customer — and link this receipt to that profile. Never duplicated.
    let financeCustomerId: number | null = null;
    if (cust) {
      const dedupe = (
        String(cust.phone ?? '').replace(/\D/g, '') ||
        String(cust.email ?? '').toLowerCase() ||
        customerName.toLowerCase()
      ).slice(0, 200);
      const up = await db.query(
        `INSERT INTO historical_customers (full_name, phone, email, dedupe_key, source)
         VALUES ($1,$2,$3,$4,'checkout')
         ON CONFLICT (dedupe_key) DO UPDATE SET
           full_name = EXCLUDED.full_name,
           email = COALESCE(EXCLUDED.email, historical_customers.email)
         RETURNING id`,
        [customerName, cust.phone ?? null, cust.email ?? null, dedupe],
      );
      financeCustomerId = up.rows[0]?.id ?? null;
    }

    // Theme as a readable name (or "Custom theme" when the customer asked for one).
    let theme: string | null = null;
    if (cart.themeId) {
      const th = await db.query(`SELECT name FROM themes WHERE id = $1`, [cart.themeId]);
      theme = th.rows[0]?.name ?? null;
    } else if (cart.customTheme) {
      theme = 'Custom theme';
    }

    // Split the priced lines into items / discount / shipping so the receipt
    // mirrors the order exactly. Falls back to shop cart items when there is no
    // booking quote.
    const items: LineItem[] = [];
    let discount = 0, shipping = 0;
    if (Array.isArray(quote.lines) && quote.lines.length) {
      // Two quote shapes flow through here: the booking quote (label / amountFils
      // / kind, with delivery & discount as their own lines) and the shop quote
      // (name / unitFils, with delivery & discount carried as separate totals).
      for (const l of quote.lines) {
        const qty = Number(l.quantity ?? 1) || 1;
        const label = l.label ?? l.name ?? 'Item';
        const amt = l.amountFils != null ? Number(l.amountFils) : Number(l.unitFils ?? 0) * qty;
        if (l.kind === 'discount') discount += Math.abs(amt);
        else if (l.kind === 'delivery') shipping += amt;
        else items.push({ name: String(label).slice(0, 200), qty, priceFils: Math.round(amt / qty) });
      }
      // Shop quotes keep delivery / discount as totals rather than lines — fold
      // them in only when there was no such line (never double-count a booking).
      const hasLine = (k: string) => quote.lines.some((l: any) => l.kind === k);
      if (!hasLine('delivery') && Number(quote.deliveryFils) > 0) shipping += Number(quote.deliveryFils);
      if (!hasLine('discount') && Number(quote.discountFils) > 0) discount += Number(quote.discountFils);
    } else if (Array.isArray(cart.items)) {
      for (const it of cart.items) {
        const qty = Number(it.quantity ?? 1) || 1;
        items.push({
          name: String(it.name ?? it.title ?? 'Item').slice(0, 200),
          qty,
          priceFils: Number(it.unitPriceFils ?? it.priceFils ?? 0),
        });
      }
    }
    const subtotal = items.reduce((s, i) => s + Math.round(i.qty * i.priceFils), 0);
    const total = Number(order.total_fils ?? subtotal - discount + shipping);

    const source =
      order.source === 'manual' ? 'manual' : order.kind === 'shop' ? 'shop' : 'app';
    const number = String(
      (await db.query(`SELECT nextval('finance_doc_seq')::bigint AS n`)).rows[0].n,
    );

    await db.query(
      `INSERT INTO finance_receipts
         (number, customer_id, customer_name, date, line_items, subtotal_fils, discount_fils,
          shipping_fils, total_fils, paid_with, source, order_id, event_for, theme, age)
       VALUES ($1,$2,$3,COALESCE($4::date,current_date),$5,$6,$7,$8,$9,'Card',$10,$11,$12,$13,$14)
       ON CONFLICT (order_id) DO NOTHING`,
      [
        number, financeCustomerId, customerName, cart.eventDate ?? null, JSON.stringify(items),
        subtotal, discount, shipping, total, source, order.id,
        cart.eventFor ?? null, theme, cart.ageBand ?? null,
      ],
    );
    await db.query('RELEASE SAVEPOINT fin_sale');
  } catch {
    // A finance failure must never abort a paid booking — roll back just this
    // sale and let the confirmation carry on.
    await db.query('ROLLBACK TO SAVEPOINT fin_sale').catch(() => {});
  }
}

/**
 * Turn a sale into an operational Event so it shows on the schedule/board.
 *
 * Only for a receipt dated today or later (an upcoming booking) that isn't
 * already linked to an event. Builds the customer + a booking order (tagged
 * source 'converted' so it never double-counts against CEO revenue — the money
 * already lives in the receipt) + the event + its booked-item lines. Location &
 * exact time start as placeholders the team completes on the job. Idempotent.
 * Returns the new event id, or null when nothing was created.
 */
export async function ensureEventForReceipt(receiptId: number): Promise<string | null> {
  const { rows } = await pool.query(
    `SELECT r.*, to_char(r.date,'YYYY-MM-DD') AS date_str,
            hc.phone AS hc_phone, hc.email AS hc_email, hc.emirate AS hc_emirate
       FROM finance_receipts r
       LEFT JOIN historical_customers hc
         ON hc.id = r.customer_id OR (r.customer_id IS NULL AND lower(hc.full_name) = lower(r.customer_name))
      WHERE r.id = $1`,
    [receiptId],
  );
  const r = rows[0];
  if (!r) return null;
  if (r.event_id) return r.event_id; // already converted
  const dateStr: string | null = r.date_str ?? null;
  const today = new Date().toISOString().slice(0, 10);
  if (!dateStr || dateStr < today) return null; // only upcoming sales become events

  return withTransaction(async (db) => {
    // Customer in the app customers table (find by phone/name, else create).
    const phone = String(r.hc_phone ?? '').trim() || '00000000';
    const name = String(r.customer_name ?? 'Customer').trim() || 'Customer';
    const email = r.hc_email ?? null;
    let customerId: string;
    const found = await db.query(
      `SELECT id FROM customers WHERE (phone = $1 AND phone <> '00000000') OR lower(name) = lower($2) LIMIT 1`,
      [phone, name],
    );
    if (found.rows[0]) customerId = found.rows[0].id;
    else {
      customerId = `CUST-${randomBytes(4).toString('hex').toUpperCase()}`;
      await db.query(`INSERT INTO customers (id, name, phone, email) VALUES ($1,$2,$3,$4)`, [customerId, name, phone, email]);
    }

    // Best-effort match of package + theme from the sale.
    const items = Array.isArray(r.line_items) ? r.line_items : [];
    let packageId: string | null = null;
    for (const it of items) {
      const pk = await db.query(`SELECT id FROM packages WHERE lower(name) = lower($1) LIMIT 1`, [String(it.name ?? '')]);
      if (pk.rows[0]) { packageId = pk.rows[0].id; break; }
    }
    let themeId: string | null = null;
    if (r.theme) {
      const th = await db.query(`SELECT id FROM themes WHERE lower(name) = lower($1) LIMIT 1`, [String(r.theme)]);
      themeId = th.rows[0]?.id ?? null;
    }
    const emirate = String(r.city ?? r.hc_emirate ?? 'Dubai').trim() || 'Dubai';
    const total = Number(r.total_fils) || 0;

    const orderId = await nextOrderId(db);
    await db.query(
      `INSERT INTO orders (id, kind, customer_id, status, total_fils, cart, quote, source)
       VALUES ($1,'booking',$2,'paid',$3,$4,'{}'::jsonb,'converted')`,
      [orderId, customerId, total, JSON.stringify({ converted: true, eventDate: dateStr, emirate, eventFor: r.event_for ?? null, themeId })],
    );

    const eventId = await nextEventId(db);
    await db.query(
      `INSERT INTO events
         (id, order_id, customer_id, celebration_type, package_id, theme_id, custom_theme,
          event_date, start_time, base_end_time, extra_hours, children_count, emirate,
          address, map_lat, map_lng, phase)
       VALUES ($1,$2,$3,'kids',$4,$5,false,$6,'17:00','21:00',0,0,$7,'{}'::jsonb,0,0,'Booking Confirmed')`,
      [eventId, orderId, customerId, packageId, themeId, dateStr, emirate],
    );

    // Booked items → event_services so the job shows what's going out.
    for (const it of items) {
      await db.query(
        `INSERT INTO event_services (event_id, service_id, label, quantity, amount_fils, source, order_id)
         VALUES ($1,NULL,$2,$3,$4,'converted',$5)`,
        [eventId, String(it.name ?? 'Item').slice(0, 200), Number(it.qty ?? 1) || 1, Number(it.priceFils ?? 0), orderId],
      );
    }
    await db.query(`UPDATE finance_receipts SET event_id = $2 WHERE id = $1`, [receiptId, eventId]);
    return eventId;
  }).catch(() => null);
}

/** One-time (and safe to re-run): convert every upcoming sale that has no event yet. */
export async function convertUpcomingReceiptsToEvents(): Promise<{ created: string[]; considered: number }> {
  const today = new Date().toISOString().slice(0, 10);
  const { rows } = await pool.query(
    `SELECT id FROM finance_receipts WHERE event_id IS NULL AND date >= $1 ORDER BY date`,
    [today],
  );
  const created: string[] = [];
  for (const row of rows) {
    const ev = await ensureEventForReceipt(row.id);
    if (ev) created.push(ev);
  }
  return { created, considered: rows.length };
}

/**
 * One-time: turn the migrated QuickBooks sale lines (historical_orders) into
 * real sales-receipt records grouped by document number, so the whole sales
 * history shows in the Sales receipts list. Marked source='quickbooks' so it
 * does NOT double-count against the Cash on hand opening balance. Idempotent.
 */
export async function importReceiptsFromHistory() {
  const { rows } = await pool.query(
    `SELECT doc_number, customer_name, to_char(txn_date, 'YYYY-MM-DD') AS txn_date, product, memo, total_fils
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
       ON CONFLICT (number) DO UPDATE SET customer_name = EXCLUDED.customer_name`,
      [doc, g.customer, g.date, JSON.stringify(items), subtotal, discount, shipping, total],
    );
    inserted += res.rowCount ?? 0;
  }
  return { receipts: inserted, groups: groups.size };
}

export async function listReceipts(role?: string) {
  // The Owner sees the whole book with the collected total. A Manager sees only
  // the recent + upcoming sales (from the start of last month) and NO income
  // total — money totals are the Owner's alone.
  const ownerView = role === 'owner' || role === undefined;
  const dateFilter = ownerView ? '' : `WHERE r.date >= date_trunc('month', now()) - interval '1 month'`;
  const { rows } = await pool.query(
    `SELECT r.*, hc.id AS hc_id, hc.emirate AS city, hc.phone AS customer_phone, hc.email AS customer_email
       FROM finance_receipts r
       LEFT JOIN LATERAL (
         SELECT id, emirate, phone, email FROM historical_customers h
          WHERE h.id = r.customer_id
             OR (r.customer_id IS NULL AND lower(h.full_name) = lower(r.customer_name))
          ORDER BY (h.id = r.customer_id) DESC NULLS LAST
          LIMIT 1
       ) hc ON true
      ${dateFilter}
      ORDER BY r.date DESC, r.id DESC`,
  );
  const list = rows.map(decorateReceipt);
  if (!ownerView) return { receipts: list, totalFils: null, totalDisplay: null };
  const total = list.reduce((s, r) => s + r.total_fils, 0);
  return { receipts: list, totalFils: total, totalDisplay: formatAed(total) };
}

export async function deleteReceipt(id: number) {
  await pool.query(`DELETE FROM finance_receipts WHERE id = $1`, [id]);
  return { deleted: true };
}

export async function updateReceipt(id: number, d: DocInput & { date?: string | null; paidWith?: string }) {
  const { subtotal, total } = computeTotals(d.items, d.discountFils ?? 0, d.shippingFils ?? 0);
  const { rows } = await pool.query(
    `UPDATE finance_receipts SET customer_id=$2, customer_name=$3, date=COALESCE($4,date), line_items=$5,
       subtotal_fils=$6, discount_fils=$7, shipping_fils=$8, total_fils=$9, paid_with=COALESCE($10,paid_with), message=$11,
       event_for=$12, theme=$13, age=$14
     WHERE id=$1 RETURNING *`,
    [id, d.customerId ?? null, d.customerName, d.date ?? null, JSON.stringify(d.items), subtotal, d.discountFils ?? 0, d.shippingFils ?? 0, total, d.paidWith ?? null, d.message ?? null, d.eventFor ?? null, d.theme ?? null, d.age ?? null],
  );
  const saved = rows[0];
  if (saved && d.date) {
    if (saved.event_id) {
      // The receipt was converted to an operational Event — keep the calendar
      // and schedule in sync by moving the linked event's date too (times are
      // preserved). Uses the raw YYYY-MM-DD to avoid any timezone drift.
      await pool.query(`UPDATE events SET event_date = $2::date WHERE id = $1`, [saved.event_id, d.date]).catch(() => {});
    } else {
      // No event yet (was past-dated): if it's now upcoming, convert it so it
      // appears on the board. No-op when still past-dated.
      void ensureEventForReceipt(saved.id).catch(() => {});
    }
  }
  return saved ? decorateReceipt(saved) : null;
}

export async function updateInvoice(id: number, d: DocInput & { dueDate?: string | null; issueDate?: string | null }) {
  const { subtotal, total } = computeTotals(d.items, d.discountFils ?? 0, d.shippingFils ?? 0);
  const { rows } = await pool.query(
    `UPDATE finance_invoices SET customer_id=$2, customer_name=$3, issue_date=COALESCE($4,issue_date), due_date=$5, line_items=$6,
       subtotal_fils=$7, discount_fils=$8, shipping_fils=$9, total_fils=$10, message=$11
     WHERE id=$1 RETURNING *`,
    [id, d.customerId ?? null, d.customerName, d.issueDate ?? null, d.dueDate ?? null, JSON.stringify(d.items), subtotal, d.discountFils ?? 0, d.shippingFils ?? 0, total, d.message ?? null],
  );
  return rows[0] ? decorateInvoice(rows[0]) : null;
}

export async function deleteInvoice(id: number) {
  await pool.query(`DELETE FROM finance_invoices WHERE id = $1`, [id]);
  return { deleted: true };
}

/** A clean, branded receipt/invoice HTML — used for the email body and print. */
export function renderDocHtml(doc: any, kind: 'receipt' | 'invoice'): string {
  const rows = (doc.lineItems ?? []).map((l: any) =>
    `<tr><td style="padding:8px 0;border-bottom:1px solid #eee">${escapeHtml(l.name)}<br><span style="color:#999;font-size:12px">${l.qty} × AED ${money(l.priceFils)}</span></td><td style="padding:8px 0;border-bottom:1px solid #eee;text-align:right;font-weight:700">AED ${l.amountDisplay}</td></tr>`).join('');
  const title = kind === 'receipt' ? 'Sales Receipt' : 'Invoice';
  const dateStr = String(doc.date ?? doc.issue_date ?? '').slice(0, 10);
  return `<!doctype html><html><body style="font-family:'Quicksand',Arial,sans-serif;color:#3B3641;max-width:560px;margin:0 auto;padding:24px">
    <div style="background:linear-gradient(135deg,#F06CA8,#E94F9C);color:#fff;border-radius:18px;padding:22px 24px;text-align:center;margin-bottom:20px">
      <div style="font-size:22px;font-weight:800;letter-spacing:.5px">Eventana</div>
      <div style="font-size:13px;opacity:.9;margin-top:2px">${title} · ${escapeHtml(String(doc.number ?? ''))}</div>
      <div style="font-size:30px;font-weight:800;margin-top:10px">AED ${doc.totalDisplay}</div>
      ${kind === 'receipt' ? '<div style="margin-top:6px;font-weight:800;letter-spacing:1px">PAID</div>' : ''}
    </div>
    <div style="font-size:14px;margin-bottom:14px"><b>${escapeHtml(doc.customer_name ?? '')}</b><br><span style="color:#999">${dateStr}</span></div>
    ${doc.event_for || doc.theme || doc.age ? `<table style="width:100%;font-size:13px;margin-bottom:12px;color:#3B3641">
      ${doc.event_for ? `<tr><td style="color:#999;padding:2px 0">Celebration for</td><td style="text-align:right;font-weight:700">${escapeHtml(doc.event_for)}</td></tr>` : ''}
      ${doc.age ? `<tr><td style="color:#999;padding:2px 0">Age</td><td style="text-align:right;font-weight:700">${escapeHtml(doc.age)}</td></tr>` : ''}
      ${doc.theme ? `<tr><td style="color:#999;padding:2px 0">Theme</td><td style="text-align:right;font-weight:700">${escapeHtml(doc.theme)}</td></tr>` : ''}
    </table>` : ''}
    <table style="width:100%;border-collapse:collapse;font-size:14px">${rows}</table>
    <table style="width:100%;margin-top:12px;font-size:14px">
      <tr><td style="color:#777">Subtotal</td><td style="text-align:right">AED ${money(doc.subtotal_fils)}</td></tr>
      ${doc.discount_fils > 0 ? `<tr><td style="color:#777">Discount</td><td style="text-align:right">− AED ${money(doc.discount_fils)}</td></tr>` : ''}
      ${doc.shipping_fils > 0 ? `<tr><td style="color:#777">Shipping</td><td style="text-align:right">AED ${money(doc.shipping_fils)}</td></tr>` : ''}
      <tr><td style="font-weight:800;padding-top:8px">Total</td><td style="text-align:right;font-weight:800;color:#E94F9C;padding-top:8px">AED ${doc.totalDisplay}</td></tr>
    </table>
    ${doc.message ? `<div style="margin-top:18px;color:#777;font-size:13px">${escapeHtml(doc.message)}</div>` : ''}
    <div style="margin-top:24px;color:#bbb;font-size:12px;text-align:center">Thank you for choosing Eventana 🎉</div>
  </body></html>`;
}

const money = (fils: number) => (Number(fils) / 100).toLocaleString('en-US', { maximumFractionDigits: 2 });
const escapeHtml = (s: string) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));

/** Email a receipt/invoice to the customer (found by id or name). */
export async function emailDoc(kind: 'receipt' | 'invoice', id: number): Promise<{ sent: boolean; to?: string; reason?: string }> {
  if (!emailEnabled()) return { sent: false, reason: 'email_disabled' };
  const table = kind === 'receipt' ? 'finance_receipts' : 'finance_invoices';
  const { rows } = await pool.query(`SELECT * FROM ${table} WHERE id = $1`, [id]);
  if (!rows[0]) return { sent: false, reason: 'not_found' };
  const doc = kind === 'receipt' ? decorateReceipt(rows[0]) : decorateInvoice(rows[0]);
  const em = await pool.query(
    `SELECT email FROM historical_customers WHERE (id = $1 OR lower(full_name) = lower($2)) AND email IS NOT NULL AND email <> '' LIMIT 1`,
    [doc.customer_id ?? -1, doc.customer_name ?? ''],
  );
  const to = em.rows[0]?.email;
  if (!to) return { sent: false, reason: 'no_email' };
  const { subject, html } = renderFinanceDocEmail(doc, kind);
  await sendEmail({ to, subject, html });
  return { sent: true, to };
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
