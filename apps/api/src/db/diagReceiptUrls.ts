/**
 * Diagnostic: dump the individual expenses (date, vendor, amount, receipt image
 * URL) for one or more categories, so their receipts can be opened and read.
 * Gated DIAG_RECEIPTS=true; DIAG_RECEIPTS_CATS = comma-separated category names
 * (default: the uncategorised ones). Read-only.
 */
import { pool } from './pool.js';
import { formatAed } from '@eventana/shared';

export async function diagReceiptUrlsFromEnv(): Promise<void> {
  if (String(process.env.DIAG_RECEIPTS ?? '').toLowerCase() !== 'true') return;
  const catsEnv = (process.env.DIAG_RECEIPTS_CATS ?? 'Uncategorised Expense,other').split(',').map((s) => s.trim()).filter(Boolean);
  const { rows } = await pool.query<{ id: string; d: string; vendor: string; fils: string; receipt_url: string; category: string; description: string }>(
    `SELECT id, to_char(spent_on,'YYYY-MM-DD') d, vendor, amount_fils AS fils, receipt_url, category, description
       FROM expenses
      WHERE category = ANY($1)
      ORDER BY amount_fils DESC`,
    [catsEnv],
  );
  console.log(`[receipts] ${rows.length} expenses in [${catsEnv.join(', ')}]`);
  for (const r of rows) {
    console.log(`[receipts] #${r.id} · ${r.d} · ${r.vendor ?? '-'} · AED ${formatAed(Number(r.fils))} · "${(r.description ?? '').slice(0, 40)}" · ${r.receipt_url ? r.receipt_url : 'NO IMAGE'}`);
  }
}
