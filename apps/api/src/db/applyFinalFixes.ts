/** Final owner fixes for the 3 remaining uncategorised expenses. Backed up already. One-shot guarded. */
import { pool } from './pool.js';
export async function applyFinalFixesFromEnv(): Promise<void> {
  if (String(process.env.RUN_MIGRATIONS_ON_BOOT ?? '').toLowerCase() !== 'true') return;
  const g = await pool.query(`SELECT 1 FROM app_kv WHERE k='final_fixes_v1'`).catch(() => ({ rowCount: 0 }));
  if (g.rowCount) return;
  await pool.query(`UPDATE expenses SET vendor='Grand Al Barsha Department Store', category='Supplies/Purchase' WHERE id=3747`);
  await pool.query(`UPDATE expenses SET vendor='Uncategorized', category='Supplies/Purchase' WHERE id = ANY($1::bigint[])`, [[3784, 3825]]);
  const rem = await pool.query<{ n: number }>(
    `SELECT count(*)::int n FROM expenses WHERE lower(btrim(category)) LIKE 'uncategor%'`);
  console.log(`[final-fix] applied 3 fixes; remaining uncategorised categories: ${rem.rows[0].n}`);
  await pool.query(`INSERT INTO app_kv (k,v) VALUES ('final_fixes_v1', now()) ON CONFLICT (k) DO NOTHING`).catch(() => {});
}
