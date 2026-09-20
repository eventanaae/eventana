/**
 * Diagnostic: dump the receipt image URL for every expense that has one, keyed by
 * the OCR supplier name + the real expense vendor, so we can pull up the actual
 * receipt image for any supplier the owner flags during her review. Read-only.
 *
 * Runs once on boot (RUN_MIGRATIONS_ON_BOOT on) — self-disables via app_kv guard.
 */
import { pool } from './pool.js';

export async function dumpReceiptUrlsFromEnv(): Promise<void> {
  if (String(process.env.RUN_MIGRATIONS_ON_BOOT ?? '').toLowerCase() !== 'true') return;
  const guard = await pool
    .query(`SELECT 1 FROM app_kv WHERE k = 'receipt_urls_dumped_v1'`)
    .catch(() => ({ rowCount: 0 }));
  if (guard.rowCount) return;

  const { rows } = await pool.query<{
    id: string; supplier_name: string | null; vendor: string | null;
    description: string | null; url: string; spent_on: string; aed: number;
  }>(
    `SELECT ro.expense_id AS id, ro.supplier_name, e.vendor, e.description,
            e.receipt_url AS url, to_char(e.spent_on,'YYYY-MM-DD') AS spent_on,
            round(e.amount_fils/100.0)::int AS aed
       FROM receipt_ocr ro JOIN expenses e ON e.id = ro.expense_id
      WHERE COALESCE(btrim(e.receipt_url),'') <> ''
      ORDER BY lower(btrim(ro.supplier_name))`,
  );

  const clean = (v: string | null) => (v ?? '').replace(/\s+/g, ' ').trim();
  const data = rows.map((r) => ({
    id: r.id, s: clean(r.supplier_name), v: clean(r.vendor),
    d: clean(r.description).slice(0, 60), u: r.url, t: r.spent_on, aed: r.aed,
  }));
  console.log(`[rcpt-dump] BEGIN ${data.length} receipts with images`);
  const CHUNK = 20;
  for (let c = 0; c * CHUNK < data.length; c++) {
    const part = data.slice(c * CHUNK, (c + 1) * CHUNK);
    console.log(`[rcpt-json] ${String(c).padStart(3, '0')} ${JSON.stringify(part)}`);
  }
  console.log(`[rcpt-dump] END ${data.length}`);

  await pool
    .query(`INSERT INTO app_kv (k, v) VALUES ('receipt_urls_dumped_v1', now()) ON CONFLICT (k) DO NOTHING`)
    .catch(() => {});
}
