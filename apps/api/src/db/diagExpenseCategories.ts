/**
 * Diagnostic: for each expense category (account), list ALL its distinct
 * suppliers/vendors (no amounts) so the owner can reorganize which supplier
 * belongs to which category. Read-only. Gated DIAG_EXP_CATS=true.
 */
import { pool } from './pool.js';

export async function diagExpenseCategoriesFromEnv(): Promise<void> {
  if (String(process.env.DIAG_EXP_CATS ?? '').toLowerCase() !== 'true') return;
  const { rows } = await pool.query<{ category: string; vendors: string[] }>(
    `SELECT COALESCE(NULLIF(btrim(category),''),'(blank)') AS category,
            array_agg(DISTINCT btrim(vendor) ORDER BY btrim(vendor))
              FILTER (WHERE NULLIF(btrim(vendor),'') IS NOT NULL) AS vendors
       FROM expenses
      GROUP BY 1
      ORDER BY 1`,
  );
  console.log(`[exp-cats] ${rows.length} categories`);
  for (const r of rows) {
    const v = r.vendors ?? [];
    console.log(`[exp-cats] ===== ${r.category} (${v.length} suppliers) =====`);
    // chunk the vendor list so no single log line is too long
    const CHUNK = 20;
    for (let i = 0; i < v.length; i += CHUNK) {
      console.log(`[exp-cats]   ${v.slice(i, i + CHUNK).join(' · ')}`);
    }
    if (v.length === 0) console.log('[exp-cats]   (no named suppliers)');
  }
}
