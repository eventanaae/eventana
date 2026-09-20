/**
 * Diagnostic: for every expense vendor, dump the distinct descriptions written on
 * its expenses (what's on the receipts / in the books), with how many times each
 * appears — so the owner can see what each supplier actually was. Read-only.
 *
 * Runs once on boot (RUN_MIGRATIONS_ON_BOOT on) — self-disables via app_kv guard.
 */
import { pool } from './pool.js';

export async function dumpVendorDescsFromEnv(): Promise<void> {
  if (String(process.env.RUN_MIGRATIONS_ON_BOOT ?? '').toLowerCase() !== 'true') return;
  const guard = await pool
    .query(`SELECT 1 FROM app_kv WHERE k = 'vendor_descs_v1'`)
    .catch(() => ({ rowCount: 0 }));
  if (guard.rowCount) return;

  const { rows } = await pool.query<{ vendor: string; descs: string }>(
    `WITH d AS (
       SELECT btrim(vendor) vendor, btrim(COALESCE(description,'')) descr, count(*) n
         FROM expenses
        WHERE COALESCE(btrim(vendor),'') <> '' AND COALESCE(btrim(description),'') <> ''
        GROUP BY btrim(vendor), btrim(COALESCE(description,''))
     ),
     r AS (
       SELECT vendor, descr, n, row_number() OVER (PARTITION BY lower(vendor) ORDER BY n DESC) rn
         FROM d
     )
     SELECT vendor, string_agg(descr || ' (' || n || ')', ' | ' ORDER BY n DESC) descs
       FROM r WHERE rn <= 4
      GROUP BY vendor`,
  );
  const clean = (v: string) => (v ?? '').replace(/\s+/g, ' ').trim();
  const data = rows.map((r) => ({ v: clean(r.vendor), d: clean(r.descs).slice(0, 160) }));
  console.log(`[vdesc] BEGIN ${data.length}`);
  const CHUNK = 22;
  for (let c = 0; c * CHUNK < data.length; c++) {
    console.log(`[vdesc-json] ${String(c).padStart(3, '0')} ${JSON.stringify(data.slice(c * CHUNK, (c + 1) * CHUNK))}`);
  }
  console.log(`[vdesc] END ${data.length}`);
  await pool
    .query(`INSERT INTO app_kv (k, v) VALUES ('vendor_descs_v1', now()) ON CONFLICT (k) DO NOTHING`)
    .catch(() => {});
}
