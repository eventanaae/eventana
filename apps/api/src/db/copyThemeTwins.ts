/**
 * One-shot: fill the theme on a sale that is the DUPLICATE of an already-themed
 * event. Real parties often appear twice (a live booking row + a historical
 * record row); we filled one side, the twin stayed empty. For every sale with
 * NO theme, find another sale for the SAME customer on the SAME date that DOES
 * have a theme, and copy it. Matches by phone (last 9) + date; if the empty row
 * has no phone, falls back to exact customer name + date — in both cases only
 * when the themed side is unambiguous (one distinct theme). This fills only real
 * parties whose theme we already know, and never touches standalone services
 * (they have no themed twin).
 *
 * COPY_THEME_TWINS = 'dry' (report) | 'apply' (write). Idempotent.
 */
import { pool } from './pool.js';

const last9 = (raw: unknown): string => String(raw ?? '').replace(/\D/g, '').slice(-9);
const nkey = (raw: unknown): string => String(raw ?? '').toLowerCase().replace(/\s+/g, ' ').trim();

export async function copyThemeTwinsFromEnv(): Promise<void> {
  const mode = String(process.env.COPY_THEME_TWINS ?? '').toLowerCase();
  if (mode !== 'dry' && mode !== 'apply') return;

  const [live, hist, saved] = await Promise.all([
    pool.query(
      `SELECT 'app:' || e.id AS sale_key, to_char(e.event_date,'YYYY-MM-DD') d, c.name, c.phone,
              COALESCE(th.name, CASE WHEN e.custom_theme THEN 'Custom theme' ELSE '' END) current_theme
         FROM events e JOIN customers c ON c.id = e.customer_id
         LEFT JOIN themes th ON th.id = e.theme_id
        WHERE e.phase <> 'Cancelled' AND e.source IS DISTINCT FROM 'quickbooks_import'
          AND e.event_date >= '2025-01-01' AND e.event_date < '2027-01-01'`,
    ),
    pool.query(
      `SELECT 'qb:' || ho.doc_number AS sale_key, to_char(min(ho.txn_date),'YYYY-MM-DD') d,
              max(ho.customer_name) name, max(hc.phone) phone, '' current_theme
         FROM historical_orders ho
         LEFT JOIN (
           SELECT DISTINCT ON (lower(btrim(full_name))) lower(btrim(full_name)) k, phone
             FROM historical_customers ORDER BY lower(btrim(full_name)), (phone IS NOT NULL) DESC, id
         ) hc ON hc.k = lower(btrim(ho.customer_name))
        WHERE ho.txn_date >= '2025-01-01' AND ho.txn_date < '2027-01-01'
          AND COALESCE(ho.txn_type,'') <> 'Payment' AND ho.doc_number IS NOT NULL
        GROUP BY ho.doc_number`,
    ),
    pool.query(`SELECT sale_key, theme FROM sale_themes`),
  ]);
  const savedMap = new Map<string, string>((saved.rows as any[]).map((r) => [r.sale_key, r.theme]));
  const sales = [...(live.rows as any[]), ...(hist.rows as any[])].map((r: any) => ({
    saleKey: r.sale_key, d: r.d, name: r.name, phone: r.phone,
    theme: savedMap.get(r.sale_key) || r.current_theme || '',
  }));

  // Index the THEMED sales by phone+date and name+date, tracking whether the
  // theme is unambiguous for that key.
  const byPhone = new Map<string, Set<string>>();
  const byName = new Map<string, Set<string>>();
  for (const s of sales) {
    if (!s.theme || !s.d) continue;
    if (last9(s.phone).length >= 8) (byPhone.get(`${last9(s.phone)}|${s.d}`) ?? (byPhone.set(`${last9(s.phone)}|${s.d}`, new Set()), byPhone.get(`${last9(s.phone)}|${s.d}`)!)).add(s.theme);
    if (nkey(s.name)) (byName.get(`${nkey(s.name)}|${s.d}`) ?? (byName.set(`${nkey(s.name)}|${s.d}`, new Set()), byName.get(`${nkey(s.name)}|${s.d}`)!)).add(s.theme);
  }

  const toSet: Array<{ saleKey: string; theme: string; via: string }> = [];
  for (const s of sales) {
    if (s.theme || !s.d) continue; // already themed, or no date
    let themes: Set<string> | undefined; let via = '';
    if (last9(s.phone).length >= 8) { themes = byPhone.get(`${last9(s.phone)}|${s.d}`); via = 'phone+date'; }
    if ((!themes || themes.size === 0) && nkey(s.name)) { themes = byName.get(`${nkey(s.name)}|${s.d}`); via = 'name+date'; }
    if (!themes || themes.size !== 1) continue; // none or ambiguous
    toSet.push({ saleKey: s.saleKey, theme: [...themes][0], via });
  }

  console.log(`[theme-twins] empty sales scanned; twins to fill=${toSet.length}`);
  for (const m of toSet.slice(0, 80)) console.log(`[theme-twins]   ${mode === 'apply' ? 'SET' : 'would set'} ${m.saleKey} → ${m.theme} (${m.via})`);
  if (toSet.length > 80) console.log(`[theme-twins]   …and ${toSet.length - 80} more`);

  if (mode === 'apply') {
    let done = 0;
    for (const m of toSet) {
      await pool.query(
        `INSERT INTO sale_themes (sale_key, theme, updated_by) VALUES ($1,$2,'Twin copy')
         ON CONFLICT (sale_key) DO UPDATE SET theme = EXCLUDED.theme, updated_by = EXCLUDED.updated_by, updated_at = now()`,
        [m.saleKey, m.theme],
      ).then(() => { done++; }).catch((e) => console.error('[theme-twins] failed', m.saleKey, (e as Error).message));
    }
    console.log(`[theme-twins] APPLIED ${done}/${toSet.length}`);
  } else {
    console.log('[theme-twins] DRY RUN — nothing written.');
  }
}
