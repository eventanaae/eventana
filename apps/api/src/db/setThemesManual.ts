/**
 * One-shot: set party themes for specific sales by hand. Reads MANUAL_THEMES as
 * a JSON array [{ saleKey, theme }] and upserts each into sale_themes. Gated
 * SET_MANUAL_THEMES=true. Idempotent. Turn the flag off after it runs.
 */
import { pool } from './pool.js';

export async function setThemesManualFromEnv(): Promise<void> {
  if (String(process.env.SET_MANUAL_THEMES ?? '').toLowerCase() !== 'true') return;
  const raw = process.env.MANUAL_THEMES;
  if (!raw) { console.log('[manual-themes] MANUAL_THEMES not set'); return; }
  let rows: Array<{ saleKey: string; theme: string }>;
  try { rows = JSON.parse(raw); } catch { console.log('[manual-themes] invalid JSON'); return; }
  if (!Array.isArray(rows) || !rows.length) { console.log('[manual-themes] no rows'); return; }
  let done = 0;
  for (const r of rows) {
    const saleKey = String(r?.saleKey ?? '').trim();
    const theme = String(r?.theme ?? '').trim().slice(0, 120);
    if (!saleKey || !theme) { console.log(`[manual-themes] skip invalid ${JSON.stringify(r)}`); continue; }
    await pool.query(
      `INSERT INTO sale_themes (sale_key, theme, updated_by) VALUES ($1,$2,'Manual (owner)')
       ON CONFLICT (sale_key) DO UPDATE SET theme = EXCLUDED.theme, updated_by = EXCLUDED.updated_by, updated_at = now()`,
      [saleKey, theme],
    ).then(() => { done++; console.log(`[manual-themes] SET ${saleKey} → ${theme}`); })
     .catch((e) => console.error('[manual-themes] failed', saleKey, (e as Error).message));
  }
  console.log(`[manual-themes] DONE ${done}/${rows.length}`);
}
