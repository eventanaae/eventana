/**
 * One-shot (owner-approved 2026-11-10), gated SET_SHAN_LEADER='linkqb':
 *
 * 1. LINK every booking imported from the old books (orders.source =
 *    'quickbooks_import', each with its event) to its ORIGINAL receipt, exactly
 *    like a booking made in the app: receipt.order_id = order, receipt.event_id =
 *    event. Match = same event date + same amount + same customer name, and only
 *    when it is one-to-one (an order with 0 or 2+ candidate receipts, or a receipt
 *    claimed by 2+ orders, is LISTED and left alone). The receipt's 'quickbooks'
 *    label is kept on purpose (owner: so missing old info can be traced).
 * 2. FULL CHECK (read-only) of money ↔ bookings ↔ events after linking:
 *    paid orders with no receipt, duplicate receipts, receipts pointing at a
 *    missing/unpaid order, live events with no receipt, receipt vs order total.
 * Every line is logged (LINK|… / CHK|…). Idempotent — re-running links nothing new.
 */
import { pool, withTransaction } from './pool.js';

export async function linkImportedReceiptsFromEnv(): Promise<void> {
  if (String(process.env.SET_SHAN_LEADER ?? '').toLowerCase() !== 'linkqb') return;
  const clean = (v: unknown) => String(v ?? '').replace(/[\s|]+/g, ' ').trim();
  const aed = (f: unknown) => (Number(f) / 100).toFixed(2);
  try {
    // ── 1. Link ─────────────────────────────────────────────────────────────
    const cand = await pool.query(
      `SELECT o.id oid, e.id eid, fr.id rid, fr.number, fr.customer_name rc, c.name cn,
              e.event_date::text d, o.total_fils::bigint t
         FROM orders o
         JOIN events e ON e.order_id = o.id
         LEFT JOIN customers c ON c.id = o.customer_id
         JOIN finance_receipts fr
           ON fr.order_id IS NULL
          AND fr.date = e.event_date
          AND fr.total_fils = o.total_fils
          AND lower(btrim(fr.customer_name)) = lower(btrim(c.name))
        WHERE o.source = 'quickbooks_import'
          AND NOT EXISTS (SELECT 1 FROM finance_receipts x WHERE x.order_id = o.id)`,
    );
    const byOrder = new Map<string, any[]>(); const byRcpt = new Map<string, number>();
    for (const r of cand.rows) {
      byOrder.set(r.oid, [...(byOrder.get(r.oid) ?? []), r]);
      byRcpt.set(String(r.rid), (byRcpt.get(String(r.rid)) ?? 0) + 1);
    }
    let linked = 0; let ambiguous = 0;
    await withTransaction(async (db) => {
      for (const [oid, list] of byOrder) {
        if (list.length !== 1 || (byRcpt.get(String(list[0].rid)) ?? 0) !== 1) {
          ambiguous++;
          console.log(`LINK|AMBIGUOUS|order ${oid}|${list.length} candidate receipt(s): ${list.map((x) => x.number).join(', ')}`);
          continue;
        }
        const r = list[0];
        await db.query(
          `UPDATE finance_receipts SET order_id = $2, event_id = COALESCE(event_id, $3) WHERE id = $1 AND order_id IS NULL`,
          [r.rid, oid, r.eid],
        );
        linked++;
        console.log(`LINK|OK|order ${oid}|event ${r.eid}|receipt ${r.number}|${clean(r.cn)}|${r.d}|AED ${aed(r.t)}`);
      }
    });
    const left = await pool.query(
      `SELECT o.id, c.name cn, (SELECT e.event_date::text FROM events e WHERE e.order_id = o.id LIMIT 1) d, o.total_fils::bigint t
         FROM orders o LEFT JOIN customers c ON c.id = o.customer_id
        WHERE o.source = 'quickbooks_import' AND NOT EXISTS (SELECT 1 FROM finance_receipts x WHERE x.order_id = o.id)
        ORDER BY 3`);
    for (const r of left.rows) console.log(`LINK|UNMATCHED|order ${r.id}|${clean(r.cn)}|${r.d}|AED ${aed(r.t)}`);
    const tot = await pool.query(`SELECT COUNT(*)::int n FROM orders WHERE source='quickbooks_import'`);
    console.log(`LINKSUM|imported bookings ${tot.rows[0].n}|linked now ${linked}|ambiguous ${ambiguous}|still without a receipt ${left.rows.length}`);

    // ── 2. Full check ───────────────────────────────────────────────────────
    const show = (tag: string, rows: any[], fmt: (r: any) => string, max = 40) => {
      console.log(`CHK|${tag}|count ${rows.length}`);
      rows.slice(0, max).forEach((r) => console.log(`CHK|${tag}|${fmt(r)}`));
    };
    const noRcpt = await pool.query(
      `SELECT o.id, o.kind, COALESCE(o.source,'') src, o.total_fils::bigint t, to_char(o.created_at AT TIME ZONE 'Asia/Dubai','YYYY-MM-DD') cr, c.name cn
         FROM orders o LEFT JOIN customers c ON c.id = o.customer_id
        WHERE o.status = 'paid' AND o.kind IN ('booking','shop')
          AND NOT EXISTS (SELECT 1 FROM finance_receipts r WHERE r.order_id = o.id)
          AND NOT EXISTS (SELECT 1 FROM finance_receipts r JOIN events e ON e.id = r.event_id WHERE e.order_id = o.id)
        ORDER BY o.created_at`);
    show('paid order with NO receipt', noRcpt.rows, (r) => `${r.id}|${r.kind}|${r.src}|${clean(r.cn)}|created ${r.cr}|AED ${aed(r.t)}`);
    const dups = await pool.query(
      `SELECT lower(btrim(customer_name)) cn, date::text d, total_fils::bigint t, COUNT(*)::int n, string_agg(number || ':' || COALESCE(source,''), ', ') nums
         FROM finance_receipts WHERE total_fils > 0
        GROUP BY 1,2,3 HAVING COUNT(*) > 1 ORDER BY 2`);
    show('possible DUPLICATE receipts (same customer+date+amount)', dups.rows, (r) => `${clean(r.cn)}|${r.d}|AED ${aed(r.t)}|${r.n}×|${r.nums}`);
    const badOrder = await pool.query(
      `SELECT fr.number, fr.order_id, COALESCE(o.status,'(missing)') st, fr.total_fils::bigint t
         FROM finance_receipts fr LEFT JOIN orders o ON o.id = fr.order_id
        WHERE fr.order_id IS NOT NULL AND (o.id IS NULL OR o.status NOT IN ('paid','refunded','partially_refunded'))`);
    show('receipt linked to a missing/unpaid order', badOrder.rows, (r) => `receipt ${r.number}|order ${r.order_id}|${r.st}|AED ${aed(r.t)}`);
    const evNo = await pool.query(
      `SELECT e.id, e.event_date::text d, e.phase, COALESCE(e.source,'') src, c.name cn, o.status ost, COALESCE(o.source,'') osrc
         FROM events e JOIN orders o ON o.id = e.order_id LEFT JOIN customers c ON c.id = e.customer_id
        WHERE e.phase <> 'Cancelled' AND e.cancelled_at IS NULL AND o.status = 'paid'
          AND NOT EXISTS (SELECT 1 FROM finance_receipts r WHERE r.event_id = e.id OR r.order_id = e.order_id)
        ORDER BY e.event_date`);
    show('live paid EVENT with no receipt', evNo.rows, (r) => `${r.id}|${r.d}|${r.phase}|event src ${r.src}|order src ${r.osrc}|${clean(r.cn)}`);
    const mism = await pool.query(
      `SELECT fr.number, fr.order_id, fr.total_fils::bigint rt, o.total_fils::bigint ot, COALESCE(o.source,'') src
         FROM finance_receipts fr JOIN orders o ON o.id = fr.order_id
        WHERE o.kind = 'booking' AND fr.total_fils <> o.total_fils`);
    show('receipt total ≠ order total', mism.rows, (r) => `receipt ${r.number}|order ${r.order_id} (${r.src})|receipt AED ${aed(r.rt)} vs order AED ${aed(r.ot)}`);
    const orphan = await pool.query(
      `SELECT COUNT(*)::int n, COALESCE(SUM(total_fils),0)::bigint v FROM finance_receipts WHERE order_id IS NULL AND event_id IS NULL`);
    console.log(`CHK|receipts linked to NO order and NO event|${orphan.rows[0].n}|AED ${aed(orphan.rows[0].v)} (mostly old-books history with no booking record)`);
    const src = await pool.query(
      `SELECT COALESCE(source,'(none)') s, COUNT(*)::int n, COUNT(*) FILTER (WHERE order_id IS NOT NULL OR event_id IS NOT NULL)::int linked, SUM(total_fils)::bigint v
         FROM finance_receipts GROUP BY 1 ORDER BY 2 DESC`);
    for (const r of src.rows) console.log(`CHK|receipts by source|${r.s}|${r.n} (linked to a booking ${r.linked})|AED ${aed(r.v)}`);
    console.log('CHK|END');
  } catch (err) {
    console.error('[linkqb] failed:', (err as Error).message);
  }
}
