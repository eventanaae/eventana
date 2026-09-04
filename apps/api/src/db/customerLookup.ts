/**
 * Read-only CUSTOMER LOOKUP, logged to the boot log (no DB console needed).
 * Gated by CUSTOMER_LOOKUP=<search term>. Sends NOTHING, changes NOTHING.
 *
 * Answers "did this person actually book, and is their receipt right?" — matches
 * the term against customer name/phone/email (live + QuickBooks) and prints every
 * order, sales receipt and event attached to them.
 */
import { pool } from './pool.js';
import { formatAed } from '@eventana/shared';

const P = (s: string) => console.log(`[cust-lookup] ${s}`);
const aed = (f: any) => formatAed(Number(f ?? 0));

export async function customerLookupFromEnv(): Promise<void> {
  const term = String(process.env.CUSTOMER_LOOKUP ?? '').trim();
  if (!term) return;
  const like = `%${term.toLowerCase()}%`;
  try {
    P(`searching for "${term}" ...`);
    // Live customers.
    const custs = await pool.query(
      `SELECT id, name, phone, email, to_char(registered_at,'YYYY-MM-DD') reg,
              (password_hash IS NOT NULL) AS has_account
         FROM customers
        WHERE lower(name) LIKE $1 OR lower(COALESCE(email,'')) LIKE $1
           OR regexp_replace(COALESCE(phone,''),'[^0-9]','','g') LIKE $2
        ORDER BY registered_at DESC LIMIT 20`,
      [like, `%${term.replace(/[^0-9]/g, '')}%`],
    );
    P(`live customers matched: ${custs.rowCount}`);
    for (const c of custs.rows) {
      P(`— ${c.name} (${c.id}) · ${c.phone ?? ''} · ${c.email ?? ''} · account=${c.has_account} · joined ${c.reg}`);
      const orders = await pool.query(
        `SELECT id, kind, COALESCE(source,'app') source, status, total_fils, to_char(created_at,'YYYY-MM-DD') d
           FROM orders WHERE customer_id = $1 ORDER BY created_at`,
        [c.id],
      );
      P(`   orders: ${orders.rowCount || 'none'}`);
      for (const o of orders.rows) P(`     • ${o.id} [${o.status}/${o.kind}/${o.source}] AED ${aed(o.total_fils)} · ${o.d}`);
      const events = await pool.query(
        `SELECT id, to_char(event_date,'YYYY-MM-DD') d, phase FROM events WHERE customer_id = $1 ORDER BY event_date`,
        [c.id],
      );
      P(`   events: ${events.rowCount || 'none'}`);
      for (const e of events.rows) P(`     • ${e.id} · ${e.d} · ${e.phase}`);
      const recs = await pool.query(
        `SELECT number, to_char(date,'YYYY-MM-DD') d, total_fils, paid_with, source FROM finance_receipts
          WHERE customer_id = $1 OR order_id IN (SELECT id FROM orders WHERE customer_id = $1)
          ORDER BY date`,
        [c.id],
      );
      P(`   receipts: ${recs.rowCount || 'none'}`);
      for (const r of recs.rows) P(`     • #${r.number} · ${r.d} · AED ${aed(r.total_fils)} · ${r.paid_with} · ${r.source}`);
    }
    // QuickBooks / historical receipts by name (for people with no live account).
    const qb = await pool.query(
      `SELECT number, customer_name, to_char(date,'YYYY-MM-DD') d, total_fils, source
         FROM finance_receipts WHERE lower(customer_name) LIKE $1 ORDER BY date LIMIT 20`,
      [like],
    );
    P(`receipts matching name (any source): ${qb.rowCount}`);
    for (const r of qb.rows) P(`   • #${r.number} · ${r.customer_name} · ${r.d} · AED ${aed(r.total_fils)} · ${r.source}`);
    P('done.');
  } catch (err) {
    console.error('[cust-lookup] failed:', (err as Error).message);
  }
}
