/** Diagnostic: list every expense with no supplier/vendor name, for owner to name. Read-only, one-shot guarded. */
import { pool } from './pool.js';
export async function dumpBlankVendorFromEnv(): Promise<void> {
  if (String(process.env.RUN_MIGRATIONS_ON_BOOT ?? '').toLowerCase() !== 'true') return;
  const g = await pool.query(`SELECT 1 FROM app_kv WHERE k='blank_vendor_v1'`).catch(() => ({ rowCount: 0 }));
  if (g.rowCount) return;
  const { rows } = await pool.query<{ id: string; d: string; aed: number; category: string; description: string; src: string }>(
    `SELECT id, to_char(spent_on,'YYYY-MM-DD') d, round(amount_fils/100.0)::int aed,
            COALESCE(category,'') category, COALESCE(description,'') description, COALESCE(source,'') src
       FROM expenses
      WHERE COALESCE(btrim(vendor),'') = '' OR lower(btrim(vendor)) IN ('uncategorized','(blank)')
      ORDER BY spent_on DESC`,
  );
  console.log(`[blankv] rows with no supplier name: ${rows.length}`);
  for (const r of rows) console.log(`[blankv] #${r.id} | ${r.d} | AED ${r.aed} | cat=${r.category} | src=${r.src} | "${r.description.slice(0,55)}"`);
  await pool.query(`INSERT INTO app_kv (k,v) VALUES ('blank_vendor_v1', now()) ON CONFLICT (k) DO NOTHING`).catch(() => {});
}
