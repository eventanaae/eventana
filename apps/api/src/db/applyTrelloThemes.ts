/**
 * One-shot: fill party themes from the Trello "Events Calendar" board.
 *
 * The Trello data (theme + customer phone + event date, from every card incl.
 * archived, this year and last) is passed in TRELLO_THEMES as a JSON array of
 * { t: theme, d: 'YYYY-MM-DD', ph: [phones] }. We match each SALE in the system
 * (live app events + QuickBooks history) to a Trello card by the customer's
 * phone (last 9 digits) AND the exact event date — verifying the customer — and
 * write the theme to sale_themes, but ONLY when:
 *   • exactly ONE Trello card matches that phone+date (no ambiguity), and
 *   • the sale has no theme yet (never overwrite an existing one).
 *
 * APPLY_TRELLO_THEMES = 'dry'  → report only (default), writes nothing.
 *                     = 'apply' → actually write the matched themes.
 * Everything else is logged for manual review. Idempotent.
 */
import { pool } from './pool.js';

const last9 = (raw: unknown): string => String(raw ?? '').replace(/\D/g, '').slice(-9);
const cleanTheme = (t: string): string => t.replace(/\s+/g, ' ').trim().slice(0, 120);

interface TrelloEntry { t: string; d: string; ph: string[] }

export async function applyTrelloThemesFromEnv(): Promise<void> {
  const mode = String(process.env.APPLY_TRELLO_THEMES ?? '').toLowerCase();
  if (mode !== 'dry' && mode !== 'apply') return;
  const raw = process.env.TRELLO_THEMES;
  if (!raw) { console.log('[trello-themes] TRELLO_THEMES env not set'); return; }
  let entries: TrelloEntry[];
  try { entries = JSON.parse(raw); } catch { console.log('[trello-themes] TRELLO_THEMES is not valid JSON'); return; }
  if (!Array.isArray(entries) || !entries.length) { console.log('[trello-themes] no entries'); return; }

  // Index Trello cards by "<last9phone>|<date>" → set of themes.
  const idx = new Map<string, Set<string>>();
  let indexed = 0;
  for (const e of entries) {
    const theme = cleanTheme(String(e.t ?? ''));
    if (!theme || !e.d) continue;
    for (const p of (e.ph ?? [])) {
      const key = `${last9(p)}|${e.d}`;
      if (last9(p).length < 8) continue;
      (idx.get(key) ?? (idx.set(key, new Set()), idx.get(key)!)).add(theme);
      indexed++;
    }
  }
  console.log(`[trello-themes] ${entries.length} cards → ${idx.size} phone+date keys (${indexed} phone rows)`);

  // Build the same sale list the Themes screen uses (live events + QB history),
  // for 2025–2026, with the customer phone and any theme already recorded.
  const [live, qb, saved] = await Promise.all([
    pool.query(
      `SELECT 'app:' || e.id AS sale_key, to_char(e.event_date,'YYYY-MM-DD') d, c.phone,
              COALESCE(th.name, CASE WHEN e.custom_theme THEN 'Custom theme' ELSE '' END) current_theme
         FROM events e JOIN customers c ON c.id = e.customer_id
         LEFT JOIN themes th ON th.id = e.theme_id
        WHERE e.phase <> 'Cancelled' AND e.source IS DISTINCT FROM 'quickbooks_import'
          AND e.event_date >= '2025-01-01' AND e.event_date < '2027-01-01'`,
    ),
    pool.query(
      `SELECT 'qb:' || ho.doc_number AS sale_key, to_char(min(ho.txn_date),'YYYY-MM-DD') d, max(hc.phone) phone
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

  const sales = [
    ...live.rows.map((r: any) => ({ saleKey: r.sale_key, d: r.d, phone: r.phone, current: r.current_theme })),
    ...qb.rows.map((r: any) => ({ saleKey: r.sale_key, d: r.d, phone: r.phone, current: '' })),
  ];

  let toSet: Array<{ saleKey: string; theme: string }> = [];
  let alreadyHad = 0, noPhone = 0, noMatch = 0, ambiguous = 0;
  for (const s of sales) {
    const l9 = last9(s.phone);
    if (l9.length < 8 || !s.d) { noPhone++; continue; }
    const themes = idx.get(`${l9}|${s.d}`);
    if (!themes || themes.size === 0) { noMatch++; continue; }
    if (themes.size > 1) { ambiguous++; continue; }              // don't guess
    const theme = [...themes][0];
    const existing = savedMap.get(s.saleKey) || s.current || '';
    if (existing) { alreadyHad++; continue; }                     // never overwrite
    toSet.push({ saleKey: s.saleKey, theme });
  }

  console.log(`[trello-themes] sales=${sales.length} · matched&empty=${toSet.length} · alreadyHad=${alreadyHad} · noMatch=${noMatch} · noPhone/date=${noPhone} · ambiguous=${ambiguous}`);
  for (const m of toSet.slice(0, 60)) console.log(`[trello-themes]   ${mode === 'apply' ? 'SET' : 'would set'} ${m.saleKey} → ${m.theme}`);
  if (toSet.length > 60) console.log(`[trello-themes]   …and ${toSet.length - 60} more`);

  if (mode === 'apply') {
    let done = 0;
    for (const m of toSet) {
      await pool.query(
        `INSERT INTO sale_themes (sale_key, theme, updated_by) VALUES ($1,$2,'Trello import')
         ON CONFLICT (sale_key) DO UPDATE SET theme = EXCLUDED.theme, updated_by = EXCLUDED.updated_by, updated_at = now()`,
        [m.saleKey, m.theme],
      ).then(() => { done++; }).catch((e) => console.error('[trello-themes] set failed', m.saleKey, (e as Error).message));
    }
    console.log(`[trello-themes] APPLIED ${done}/${toSet.length} themes`);
  } else {
    console.log('[trello-themes] DRY RUN — nothing written. Set APPLY_TRELLO_THEMES=apply to write.');
  }
}
