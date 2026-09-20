/**
 * Diagnostic: dump EVERY distinct vendor that actually appears in the expenses
 * ledger (with count, total, date range, and how it's split manual vs imported),
 * so the owner can see the complete supplier picture — including ones missing
 * from the supplier directory. Read-only.
 *
 * Runs once on boot (RUN_MIGRATIONS_ON_BOOT on) — self-disables via app_kv guard.
 */
import { pool } from './pool.js';

export async function dumpAllVendorsFromEnv(): Promise<void> {
  if (String(process.env.RUN_MIGRATIONS_ON_BOOT ?? '').toLowerCase() !== 'true') return;
  const guard = await pool
    .query(`SELECT 1 FROM app_kv WHERE k = 'all_vendors_dumped_v1'`)
    .catch(() => ({ rowCount: 0 }));
  if (guard.rowCount) return;

  const tot = await pool.query<{ vend: number; rows: number; blank: number }>(
    `SELECT count(DISTINCT lower(btrim(vendor))) FILTER (WHERE COALESCE(btrim(vendor),'')<>'')::int vend,
            count(*)::int rows,
            count(*) FILTER (WHERE COALESCE(btrim(vendor),'')='')::int blank
       FROM expenses`,
  );
  console.log(`[vend-dump] distinct vendors=${tot.rows[0].vend} · total expense rows=${tot.rows[0].rows} · blank-vendor rows=${tot.rows[0].blank}`);

  const { rows } = await pool.query<{ vendor: string; n: number; aed: number; mn: number; qb: number; first: string; last: string }>(
    `SELECT btrim(vendor) vendor, count(*)::int n, round(sum(amount_fils)/100.0)::int aed,
            round(sum(amount_fils) FILTER (WHERE COALESCE(source,'manual')='manual')/100.0)::int mn,
            round(sum(amount_fils) FILTER (WHERE source<>'manual')/100.0)::int qb,
            min(to_char(spent_on,'YYYY-MM-DD')) first, max(to_char(spent_on,'YYYY-MM-DD')) last
       FROM expenses
      WHERE COALESCE(btrim(vendor),'') <> ''
      GROUP BY btrim(vendor)
      ORDER BY sum(amount_fils) DESC`,
  );
  const data = rows.map((r) => ({ v: r.vendor, n: r.n, aed: r.aed, mn: r.mn || 0, qb: r.qb || 0, f: r.first, l: r.last }));
  console.log(`[vend-dump] BEGIN ${data.length} vendors`);
  const CHUNK = 25;
  for (let c = 0; c * CHUNK < data.length; c++) {
    console.log(`[vend-json] ${String(c).padStart(3, '0')} ${JSON.stringify(data.slice(c * CHUNK, (c + 1) * CHUNK))}`);
  }
  console.log(`[vend-dump] END ${data.length}`);

  await pool
    .query(`INSERT INTO app_kv (k, v) VALUES ('all_vendors_dumped_v1', now()) ON CONFLICT (k) DO NOTHING`)
    .catch(() => {});
}
