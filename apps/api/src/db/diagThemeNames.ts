/**
 * Diagnostic: list every distinct theme value in sale_themes with its count,
 * plus a "normalized key" (emoji/space/case-stripped) so variants of the same
 * theme cluster together. Read-only. Gated DIAG_THEME_NAMES=true.
 */
import { pool } from './pool.js';

const normKey = (s: string): string =>
  String(s ?? '')
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}️‍]/gu, '')
    .replace(/\btheme\b/gi, '')
    .replace(/[^a-z0-9]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

export async function diagThemeNamesFromEnv(): Promise<void> {
  if (String(process.env.DIAG_THEME_NAMES ?? '').toLowerCase() !== 'true') return;
  const { rows } = await pool.query<{ theme: string; n: number }>(
    `SELECT theme, count(*)::int n FROM sale_themes WHERE COALESCE(btrim(theme),'') <> '' GROUP BY theme`,
  );
  // group by normalized key
  const groups = new Map<string, Array<{ theme: string; n: number }>>();
  for (const r of rows) {
    const k = normKey(r.theme);
    (groups.get(k) ?? (groups.set(k, []), groups.get(k)!)).push(r);
  }
  const keys = [...groups.keys()].sort();
  const dupes = keys.filter((k) => groups.get(k)!.length > 1);
  console.log(`[theme-names] distinct themes=${rows.length} · normalized groups=${keys.length} · groups-with-variants=${dupes.length}`);
  for (const k of keys) {
    const g = groups.get(k)!.sort((a, b) => b.n - a.n);
    const total = g.reduce((s, x) => s + x.n, 0);
    const variants = g.map((x) => `"${x.theme}"×${x.n}`).join('  |  ');
    console.log(`[theme-names] [${total}] ${variants}`);
  }
}
