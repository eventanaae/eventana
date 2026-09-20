/**
 * Diagnostic: dump every active supplier with everything the owner wants for a
 * review spreadsheet — name · what they supply · the account they're classified
 * under · phone · email · location · #expenses · total spent. Read-only.
 *
 * The account is the most-common expenses.category tied to that supplier, found
 * first via the receipt→expense link (receipt_ocr.supplier_name), then falling
 * back to matching the expense vendor name.
 *
 * Runs once on boot (when RUN_MIGRATIONS_ON_BOOT is on) — self-disables via an
 * app_kv guard so it doesn't re-dump every deploy. No env var to toggle.
 */
import { pool } from './pool.js';

export async function dumpSupplierSheetFromEnv(): Promise<void> {
  if (String(process.env.RUN_MIGRATIONS_ON_BOOT ?? '').toLowerCase() !== 'true') return;
  const guard = await pool
    .query(`SELECT 1 FROM app_kv WHERE k = 'supplier_sheet_dumped_v1'`)
    .catch(() => ({ rowCount: 0 }));
  if (guard.rowCount) return;

  const { rows } = await pool.query<{
    name: string; supplies: string | null; phone: string | null; email: string | null;
    location: string | null; account: string | null; expense_count: number; spent_aed: number;
  }>(
    `WITH acct AS (
       SELECT lower(btrim(ro.supplier_name)) k,
              mode() WITHIN GROUP (ORDER BY e.category) cat,
              count(*) n, sum(e.amount_fils) fils
         FROM receipt_ocr ro JOIN expenses e ON e.id = ro.expense_id
        WHERE COALESCE(btrim(ro.supplier_name),'') <> ''
        GROUP BY 1
     ),
     vacct AS (
       SELECT lower(btrim(vendor)) k, mode() WITHIN GROUP (ORDER BY category) cat,
              count(*) n, sum(amount_fils) fils
         FROM expenses WHERE COALESCE(btrim(vendor),'') <> '' GROUP BY 1
     )
     SELECT s.name, s.supplies, s.phone, s.email, s.location,
            COALESCE(a.cat, v.cat) AS account,
            COALESCE(a.n, v.n, 0)::int AS expense_count,
            round(COALESCE(a.fils, v.fils, 0)/100.0)::int AS spent_aed
       FROM suppliers s
       LEFT JOIN acct  a ON a.k = lower(btrim(s.name))
       LEFT JOIN vacct v ON v.k = lower(btrim(s.name))
      WHERE COALESCE(s.active, true) = true
      ORDER BY lower(btrim(s.name))`,
  );

  const clean = (v: string | null) => (v ?? '').replace(/\s+/g, ' ').trim();
  const data = rows.map((r) => ({
    n: clean(r.name), s: clean(r.supplies), a: clean(r.account),
    p: clean(r.phone), e: clean(r.email), l: clean(r.location),
    c: r.expense_count, aed: r.spent_aed,
  }));
  console.log(`[sheet-dump] BEGIN ${data.length} active suppliers`);
  const CHUNK = 25;
  for (let c = 0; c * CHUNK < data.length; c++) {
    const part = data.slice(c * CHUNK, (c + 1) * CHUNK);
    console.log(`[sheet-json] ${String(c).padStart(2, '0')} ${JSON.stringify(part)}`);
  }
  console.log(`[sheet-dump] END ${data.length}`);

  await pool
    .query(`INSERT INTO app_kv (k, v) VALUES ('supplier_sheet_dumped_v1', now()) ON CONFLICT (k) DO NOTHING`)
    .catch(() => {});
}
