/**
 * One-off name formatting: Title Case every name across the whole system so
 * nothing is ALL-CAPS or all-lowercase — customers, children (event_for),
 * suppliers, staff, and every name on receipts / invoices / expenses.
 *
 * Uses Postgres initcap() (first letter of each word up, the rest down), which
 * leaves Arabic-script names untouched (they have no case). Only rows that would
 * actually change are written. Gated by NORMALIZE_NAMES=true; idempotent.
 */
import { pool } from './pool.js';

const P = (s: string) => console.log(`[names] ${s}`);

const TARGETS: Array<[string, string]> = [
  ['customers', 'name'],
  ['historical_customers', 'full_name'],
  ['team_members', 'name'],
  ['finance_receipts', 'customer_name'],
  ['finance_receipts', 'event_for'],
  ['finance_invoices', 'customer_name'],
  ['finance_invoices', 'event_for'],
  ['finance_receipts', 'theme'],
  ['finance_invoices', 'theme'],
  ['event_staff', 'part_time_name'],
  ['historical_orders', 'customer_name'],
  ['expenses', 'vendor'],
  ['suppliers', 'name'],
];

export async function normalizeNamesFromEnv(): Promise<void> {
  if (String(process.env.NORMALIZE_NAMES ?? '').toLowerCase() !== 'true') return;
  try {
    let total = 0;
    for (const [table, col] of TARGETS) {
      const res = await pool.query(
        `UPDATE ${table} SET ${col} = initcap(${col})
          WHERE ${col} IS NOT NULL AND btrim(${col}) <> '' AND ${col} <> initcap(${col})`,
      ).catch((e) => { P(`${table}.${col}: skipped (${(e as Error).message.slice(0, 60)})`); return { rowCount: 0 }; });
      P(`${table}.${col}: ${res.rowCount ?? 0} name(s) title-cased`);
      total += res.rowCount ?? 0;
    }
    // The guest-of-honour name + custom theme live INSIDE the order cart JSON
    // (not a column), so the loop above can't reach them. Title-case them in
    // place — this is what fixes titles like "mohammed's Birthday" / "JOUDI's
    // Birthday" in the Events list and everywhere else that reads eventFor.
    for (const key of ['eventFor', 'customTheme']) {
      const res = await pool.query(
        `UPDATE orders
            SET cart = jsonb_set(cart, $1, to_jsonb(initcap(cart->>$2)))
          WHERE cart ? $2 AND btrim(cart->>$2) <> '' AND cart->>$2 <> initcap(cart->>$2)`,
        [`{${key}}`, key],
      ).catch((e) => { P(`orders.cart.${key}: skipped (${(e as Error).message.slice(0, 60)})`); return { rowCount: 0 }; });
      P(`orders.cart.${key}: ${res.rowCount ?? 0} title-cased`);
      total += res.rowCount ?? 0;
    }
    P(`done — ${total} name(s) reformatted.`);
  } catch (err) {
    console.error('[names] failed:', (err as Error).message);
  }
}
