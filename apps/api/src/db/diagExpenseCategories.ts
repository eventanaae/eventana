/**
 * Diagnostic: list every expense category (account) with its count and total
 * spend, plus a few sample vendors, so the owner can see and reorganize them.
 * Read-only. Gated DIAG_EXP_CATS=true.
 */
import { pool } from './pool.js';
import { formatAed } from '@eventana/shared';

export async function diagExpenseCategoriesFromEnv(): Promise<void> {
  if (String(process.env.DIAG_EXP_CATS ?? '').toLowerCase() !== 'true') return;
  const { rows } = await pool.query<{ category: string; n: number; fils: string; vendors: string }>(
    `SELECT COALESCE(NULLIF(btrim(category),''),'(blank)') AS category,
            count(*)::int AS n,
            COALESCE(SUM(amount_fils),0)::bigint AS fils,
            string_agg(DISTINCT NULLIF(btrim(vendor),''), ' · ' ORDER BY NULLIF(btrim(vendor),'')) AS vendors
       FROM expenses
      GROUP BY 1
      ORDER BY SUM(amount_fils) DESC NULLS LAST`,
  );
  console.log(`[exp-cats] ${rows.length} categories`);
  for (const r of rows) {
    const vend = (r.vendors ?? '').split(' · ').filter(Boolean).slice(0, 4).join(' · ');
    console.log(`[exp-cats] AED ${formatAed(Number(r.fils))} · ${r.n}x · "${r.category}"${vend ? `  [${vend}${(r.vendors ?? '').split(' · ').filter(Boolean).length > 4 ? ' …' : ''}]` : ''}`);
  }
}
