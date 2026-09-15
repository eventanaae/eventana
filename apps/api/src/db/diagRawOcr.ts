/**
 * Diagnostic: dump the RAW OCR reading for specific supplier names, so we can
 * recover the real merchant name hidden inside card-machine ("Network") slips
 * and transfer confirmations. Read-only.
 * Gated DIAG_RAW_OCR=true; DIAG_RAW_OCR_NAMES = comma-separated supplier names
 * (matched case-insensitively, substring). Prints expense id, vendor, items and
 * the model's raw reply per receipt.
 */
import { pool } from './pool.js';

export async function diagRawOcrFromEnv(): Promise<void> {
  if (String(process.env.DIAG_RAW_OCR ?? '').toLowerCase() !== 'true') return;
  const names = (process.env.DIAG_RAW_OCR_NAMES ??
    'network,adib,botim,eventana,sheem,blue rhine,included events,insurance')
    .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);

  const { rows } = await pool.query<{
    expense_id: string; vendor: string; supplier_name: string; payment_type: string;
    recipient: string; total_fils: string; category_guess: string; items: any; raw: string;
    d: string; receipt_url: string;
  }>(
    `SELECT ro.expense_id, e.vendor, ro.supplier_name, ro.payment_type, ro.recipient,
            ro.total_fils, ro.category_guess, ro.items, ro.raw,
            to_char(e.spent_on,'YYYY-MM-DD') d, e.receipt_url
       FROM receipt_ocr ro JOIN expenses e ON e.id = ro.expense_id
      WHERE lower(COALESCE(ro.supplier_name,'')) = ANY($1)
         OR EXISTS (SELECT 1 FROM unnest($1::text[]) n WHERE lower(COALESCE(ro.supplier_name,'')) LIKE '%'||n||'%')
      ORDER BY ro.supplier_name, ro.expense_id`,
    [names],
  );
  console.log(`[raw-ocr] ${rows.length} receipts matching [${names.join(', ')}]`);
  for (const r of rows) {
    const items = Array.isArray(r.items)
      ? r.items.map((i: any) => `${i.name}${i.unit_price != null ? ' @' + i.unit_price : ''}`).join('; ')
      : '';
    console.log(`\n[raw-ocr] ── #${r.expense_id} · ${r.d} · vendor="${r.vendor ?? '-'}" · sup="${r.supplier_name ?? '-'}" · ${r.payment_type ?? '-'}${r.recipient ? ' →' + r.recipient : ''} · AED ${(Number(r.total_fils) / 100).toFixed(2)} · cat=${r.category_guess ?? '-'}`);
    if (items) console.log(`[raw-ocr]    items: ${items.slice(0, 300)}`);
    console.log(`[raw-ocr]    RAW: ${(r.raw ?? '').replace(/\s+/g, ' ').slice(0, 600)}`);
  }
  console.log(`\n[raw-ocr] DONE — ${rows.length} receipts`);
}
