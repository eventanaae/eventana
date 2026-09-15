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
  // Overall: how many expenses have a receipt IMAGE we could actually read.
  const stat = await pool.query<{ total: number; withimg: number }>(
    `SELECT count(*)::int total, count(*) FILTER (WHERE COALESCE(btrim(receipt_url),'') <> '')::int withimg FROM expenses`,
  );
  console.log(`[receipts] OVERALL expenses=${stat.rows[0].total} · with image=${stat.rows[0].withimg} · no image=${stat.rows[0].total - stat.rows[0].withimg}`);
  const byCat = await pool.query<{ category: string; n: number; img: number }>(
    `SELECT category, count(*)::int n, count(*) FILTER (WHERE COALESCE(btrim(receipt_url),'') <> '')::int img
       FROM expenses GROUP BY category HAVING count(*) FILTER (WHERE COALESCE(btrim(receipt_url),'') <> '') > 0 ORDER BY img DESC LIMIT 30`,
  );
  for (const c of byCat.rows) console.log(`[receipts] with-image: ${c.img}/${c.n} · "${c.category}"`);
  const catsEnv = (process.env.DIAG_RECEIPTS_CATS ?? 'Uncategorised Expense,other').split(',').map((s) => s.trim()).filter(Boolean);
  if (catsEnv.length === 1 && catsEnv[0] === 'NONE') return;
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
