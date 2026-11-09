/**
 * READ-ONLY one-shot: the full impact of the 35 duplicate receipts (2124–2158)
 * the sale backfill posted on 10 Nov 01:29 Dubai. Shows: money totals with/without
 * them (all-time cash, Nov sales), whether they created events, notifications or
 * loyalty points, which customer profiles they touched, and the original receipt
 * each one duplicates (number, created when, booked_on, linked event).
 * Gated by SET_SHAN_LEADER='bfimpact'. Blank it after.
 */
import { pool } from './pool.js';

const DUPS = `(SELECT g::text FROM generate_series(2124,2158) g)`;

export async function dumpBackfillImpactFromEnv(): Promise<void> {
  if (String(process.env.SET_SHAN_LEADER ?? '').toLowerCase() !== 'bfimpact') return;
  const aed = (f: unknown) => (Number(f) / 100).toFixed(2);
  try {
    const m = (await pool.query(
      `SELECT
         (SELECT COALESCE(SUM(total_fils),0) FROM finance_receipts) all_total,
         (SELECT COALESCE(SUM(total_fils),0) FROM finance_receipts WHERE number IN ${DUPS}) dup_total,
         (SELECT COALESCE(SUM(total_fils),0) FROM finance_receipts WHERE COALESCE(booked_on,date) >= '2026-11-01' AND COALESCE(booked_on,date) < '2026-12-01') nov_total,
         (SELECT COUNT(*) FROM finance_receipts WHERE COALESCE(booked_on,date) >= '2026-11-01' AND COALESCE(booked_on,date) < '2026-12-01') nov_n,
         (SELECT COUNT(*) FROM finance_receipts WHERE number IN ${DUPS} AND event_id IS NOT NULL) dup_with_event,
         (SELECT COUNT(*) FROM finance_receipts WHERE number IN ${DUPS} AND customer_id IS NOT NULL) dup_with_customer`,
    )).rows[0];
    console.log(`BFI|money|all receipts AED ${aed(m.all_total)} incl. duplicates AED ${aed(m.dup_total)} → real AED ${aed(Number(m.all_total) - Number(m.dup_total))}`);
    console.log(`BFI|nov|November sales AED ${aed(m.nov_total)} in ${m.nov_n} receipts → real AED ${aed(Number(m.nov_total) - Number(m.dup_total))} in ${Number(m.nov_n) - 35}`);
    console.log(`BFI|links|duplicates linked to an event: ${m.dup_with_event}|linked to a customer profile: ${m.dup_with_customer}`);
    const ev = await pool.query(`SELECT COUNT(*)::int n FROM events WHERE (created_at AT TIME ZONE 'Asia/Dubai') BETWEEN '2026-11-10 01:20' AND '2026-11-10 01:40'`).catch(() => ({ rows: [{ n: -1 }] }));
    console.log(`BFI|events created 01:20–01:40|${ev.rows[0].n}`);
    const nt = await pool.query(
      `SELECT template, channel, COUNT(*)::int n, COUNT(*) FILTER (WHERE sent_at IS NOT NULL)::int sent
         FROM notifications WHERE (created_at AT TIME ZONE 'Asia/Dubai') BETWEEN '2026-11-10 01:20' AND '2026-11-10 01:40'
        GROUP BY 1,2 ORDER BY 3 DESC`);
    for (const r of nt.rows) console.log(`BFI|notification|${r.template}|${r.channel}|${r.n} created|${r.sent} sent`);
    if (!nt.rows.length) console.log('BFI|notification|none created 01:20–01:40');
    const lt = await pool.query(
      `SELECT COUNT(*)::int n FROM loyalty_transactions WHERE (created_at AT TIME ZONE 'Asia/Dubai') BETWEEN '2026-11-10 01:20' AND '2026-11-10 01:40'`).catch(() => ({ rows: [{ n: -1 }] }));
    console.log(`BFI|loyalty rows 01:20–01:40|${lt.rows[0].n}`);
    const hc = await pool.query(
      `SELECT COUNT(*)::int n, COUNT(*) FILTER (WHERE source='checkout')::int ck FROM historical_customers
        WHERE id IN (SELECT customer_id FROM finance_receipts WHERE number IN ${DUPS})`);
    console.log(`BFI|customer profiles touched|${hc.rows[0].n} (source checkout ${hc.rows[0].ck})`);
    const orig = await pool.query(
      `SELECT d.number dn, o.number onum, COALESCE(o.source,'') osrc, o.booked_on::text obk, o.date::text odt,
              to_char(o.created_at AT TIME ZONE 'Asia/Dubai','YYYY-MM-DD') ocr, COALESCE(o.event_id,'-') oev,
              COALESCE(o.order_id,'-') ooid, o.customer_id IS NOT NULL ocust
         FROM finance_receipts d
         JOIN finance_receipts o ON o.id <> d.id AND lower(btrim(o.customer_name)) = lower(btrim(d.customer_name)) AND o.date = d.date AND o.total_fils = d.total_fils
        WHERE d.number IN ${DUPS} ORDER BY d.number LIMIT 40`);
    for (const r of orig.rows) console.log(`BFI|orig|dup ${r.dn} ↔ original ${r.onum}|${r.osrc}|event ${r.odt}|booked ${r.obk}|created ${r.ocr}|event link ${r.oev}|order link ${r.ooid}|customer ${r.ocust}`);
    const srcs = await pool.query(`SELECT COALESCE(source,'(none)') s, COUNT(*)::int n, SUM(total_fils)::bigint v FROM finance_receipts GROUP BY 1 ORDER BY 2 DESC`);
    for (const r of srcs.rows) console.log(`BFI|source|${r.s}|${r.n} receipts|AED ${aed(r.v)}`);
    console.log('BFI|END');
  } catch (err) {
    console.error('[bfimpact] failed:', (err as Error).message);
  }
}
