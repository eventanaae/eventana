/** Owner: resolve remaining blank-vendor rows; flag the 3 for Marsha. One-shot guarded. */
import { pool } from './pool.js';
export async function blankFix3FromEnv(): Promise<void> {
  if (String(process.env.RUN_MIGRATIONS_ON_BOOT ?? '').toLowerCase() !== 'true') return;
  const g = await pool.query(`SELECT 1 FROM app_kv WHERE k='blank_fix3_v1'`).catch(() => ({ rowCount: 0 }));
  if (g.rowCount) return;
  await pool.query(`UPDATE expenses SET vendor='Taxi/ Uber', category='Shipping and Delivery' WHERE id = ANY($1::bigint[])`, [[1009, 2730]]);
  await pool.query(`UPDATE expenses SET vendor='Uncategorized', category='Supplies/Purchase' WHERE id = ANY($1::bigint[])`, [[3761, 602]]);
  // flag the 3 that Marsha must name
  await pool.query(`UPDATE expenses SET vendor='⚠️ Needs supplier name (Marsha)' WHERE id = ANY($1::bigint[])`, [[27005, 214, 2]]);
  console.log('[blankfix3] applied shipping/purchase + flagged 3 for Marsha');
  await pool.query(`INSERT INTO app_kv (k,v) VALUES ('blank_fix3_v1', now()) ON CONFLICT (k) DO NOTHING`).catch(() => {});
}
