/**
 * READ-ONLY one-shot: dump EVERY expense that has a receipt image — id, date,
 * vendor, amount, category, description, receipt URL — plus whatever the receipt
 * OCR already read (supplier, line items). Lets the owner review all receipts to
 * rebuild the list of what was bought (machines, bouncy/bubble houses, supplies).
 * JSON → base64 → ~8KB chunks (RCPTB64 lines) so it comes back in one log read.
 * Gated by SET_SHAN_LEADER='rcptall' (reuses the one-shot key). Blank it after.
 */
import { pool } from './pool.js';

export async function dumpReceiptsAllFromEnv(): Promise<void> {
  if (String(process.env.SET_SHAN_LEADER ?? '').toLowerCase() !== 'rcptall') return;
  try {
    const { rows } = await pool.query(
      `SELECT e.id::text AS id, to_char(e.spent_on,'YYYY-MM-DD') AS d, COALESCE(e.vendor,'') AS v,
              e.amount_fils::bigint AS f, COALESCE(e.category,'') AS c, COALESCE(e.description,'') AS ds,
              COALESCE(e.source,'') AS src, btrim(e.receipt_url) AS u,
              ro.supplier_name AS os, ro.items AS oi, ro.total_fils AS ot, ro.payment_type AS op, ro.recipient AS orc
         FROM expenses e LEFT JOIN receipt_ocr ro ON ro.expense_id = e.id
        WHERE COALESCE(btrim(e.receipt_url),'') <> ''
        ORDER BY e.spent_on, e.id`,
    );
    console.log(`RCPTMETA|${JSON.stringify({ count: rows.length })}`);
    // One readable line per receipt (so it can be reviewed straight from the logs).
    const clean = (v: unknown) => String(v ?? '').replace(/[\s|]+/g, ' ').trim();
    rows.forEach((r, i) => {
      const items = Array.isArray(r.oi)
        ? r.oi.map((x: { name?: string; qty?: number; unit_price?: number }) => `${clean(x.name)} x${x.qty ?? '?'}@${x.unit_price ?? '?'}`).join('; ')
        : '';
      console.log(`RCPT|${String(i + 1).padStart(4, '0')}|${r.d}|EXP-${r.id}|AED ${(Number(r.f) / 100).toFixed(2)}|${clean(r.c)}|${clean(r.v)}|${clean(r.ds).slice(0, 80)}|ocr:${clean(r.os)}|${items.slice(0, 400)}|${r.u}`);
    });
    console.log(`RCPTDONE|${rows.length}`);
  } catch (err) {
    console.error('[rcptall] failed:', (err as Error).message);
  }
}
