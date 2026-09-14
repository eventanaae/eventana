/**
 * Diagnostic: for a given year (default 2026), report which live events have a
 * party theme (from sale_themes or the event's own theme) and which are still
 * MISSING one. Lists the missing events (date, customer, phone tail, product).
 * Gated DIAG_THEMES=true (optionally DIAG_THEMES_YEAR=2026). Read-only.
 */
import { pool } from './pool.js';

export async function diagThemesFromEnv(): Promise<void> {
  if (String(process.env.DIAG_THEMES ?? '').toLowerCase() !== 'true') return;
  const year = /^\d{4}$/.test(process.env.DIAG_THEMES_YEAR ?? '') ? Number(process.env.DIAG_THEMES_YEAR) : 2026;
  const from = `${year}-01-01`, to = `${year + 1}-01-01`;
  const withQb = String(process.env.DIAG_THEMES_QB ?? '').toLowerCase() === 'true';
  const [live, qb, saved] = await Promise.all([
    pool.query(
      `SELECT 'app:' || e.id AS sale_key, to_char(e.event_date,'YYYY-MM-DD') d, c.name, c.phone,
              e.celebration_type product,
              COALESCE(th.name, CASE WHEN e.custom_theme THEN 'Custom theme' ELSE '' END) current_theme
         FROM events e JOIN customers c ON c.id = e.customer_id
         LEFT JOIN themes th ON th.id = e.theme_id
        WHERE e.phase <> 'Cancelled' AND e.source IS DISTINCT FROM 'quickbooks_import'
          AND e.event_date >= $1 AND e.event_date < $2
        ORDER BY e.event_date`,
      [from, to],
    ),
    withQb ? pool.query(
      `SELECT 'qb:' || ho.doc_number AS sale_key, to_char(min(ho.txn_date),'YYYY-MM-DD') d,
              max(ho.customer_name) name, max(hc.phone) phone,
              string_agg(DISTINCT NULLIF(btrim(ho.product),''), ', ') product, '' current_theme
         FROM historical_orders ho
         LEFT JOIN (
           SELECT DISTINCT ON (lower(btrim(full_name))) lower(btrim(full_name)) k, phone
             FROM historical_customers ORDER BY lower(btrim(full_name)), (phone IS NOT NULL) DESC, id
         ) hc ON hc.k = lower(btrim(ho.customer_name))
        WHERE ho.txn_date >= $1 AND ho.txn_date < $2 AND COALESCE(ho.txn_type,'') <> 'Payment'
          AND ho.doc_number IS NOT NULL
        GROUP BY ho.doc_number`,
      [from, to],
    ) : Promise.resolve({ rows: [] as any[] }),
    pool.query(`SELECT sale_key, theme FROM sale_themes`),
  ]);
  const savedMap = new Map<string, string>((saved.rows as any[]).map((r) => [r.sale_key, r.theme]));
  const rows = [...(live.rows as any[]), ...((qb as any).rows as any[])];
  rows.sort((a, b) => String(a.d).localeCompare(String(b.d)));
  const missing = rows.filter((r) => !(savedMap.get(r.sale_key) || r.current_theme));
  console.log(`[diag-themes] ${year}${withQb ? ' (live+QB)' : ' (live only)'}: sales=${rows.length} · withTheme=${rows.length - missing.length} · MISSING=${missing.length}`);
  const full = String(process.env.DIAG_THEMES_FULLPHONE ?? '').toLowerCase() === 'true';
  for (const r of missing) {
    const digits = String(r.phone ?? '').replace(/\D/g, '');
    const ph = full ? (digits || '----') : ('…' + (digits.slice(-4) || '----'));
    console.log(`[diag-themes] MISSING ${r.d} · ${String(r.name ?? '').slice(0, 24)} · ${ph} · ${String(r.product ?? '').slice(0, 20)} · ${r.sale_key}`);
  }
}
