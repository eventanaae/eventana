/** Diagnostic: for the blank-vendor rows, pull any receipt image + OCR supplier name that exists. Read-only, one-shot. */
import { pool } from './pool.js';
const IDS = [27005,27000,2,520,1009,824,223,218,212,215,214,219,211,222,221,213,220,217,216,1131,2730,2834,2862,3761,602];
export async function dumpBlankReceiptsFromEnv(): Promise<void> {
  if (String(process.env.RUN_MIGRATIONS_ON_BOOT ?? '').toLowerCase() !== 'true') return;
  const g = await pool.query(`SELECT 1 FROM app_kv WHERE k='blank_rcpt_v1'`).catch(() => ({ rowCount: 0 }));
  if (g.rowCount) return;
  const { rows } = await pool.query<{ id: string; d: string; aed: number; url: string; sup: string; items: string }>(
    `SELECT e.id, to_char(e.spent_on,'YYYY-MM-DD') d, round(e.amount_fils/100.0)::int aed,
            CASE WHEN COALESCE(btrim(e.receipt_url),'')='' THEN '' ELSE e.receipt_url END url,
            COALESCE(ro.supplier_name,'') sup,
            COALESCE(left(ro.raw,0),'') || COALESCE((SELECT string_agg(it->>'name',', ') FROM jsonb_array_elements(COALESCE(ro.items,'[]'::jsonb)) it),'') items
       FROM expenses e LEFT JOIN receipt_ocr ro ON ro.expense_id = e.id
      WHERE e.id = ANY($1::bigint[]) ORDER BY e.spent_on DESC`,
    [IDS],
  );
  let withUrl = 0, withName = 0;
  for (const r of rows) {
    if (r.url) withUrl++; if (r.sup) withName++;
    console.log(`[blankr] #${r.id} | ${r.d} | AED ${r.aed} | ocrName="${r.sup}" | items="${(r.items||'').slice(0,50)}" | url=${r.url || 'no'}`);
  }
  console.log(`[blankr] total ${rows.length} · with receipt ${withUrl} · with OCR name ${withName}`);
  await pool.query(`INSERT INTO app_kv (k,v) VALUES ('blank_rcpt_v1', now()) ON CONFLICT (k) DO NOTHING`).catch(() => {});
}
