/** Owner: the blank-vendor Part-Timer rows -> vendor + account 'Part Timers'. One-shot guarded. */
import { pool } from './pool.js';
export async function blankFix1FromEnv(): Promise<void> {
  if (String(process.env.RUN_MIGRATIONS_ON_BOOT ?? '').toLowerCase() !== 'true') return;
  const g = await pool.query(`SELECT 1 FROM app_kv WHERE k='blank_fix1_v1'`).catch(() => ({ rowCount: 0 }));
  if (g.rowCount) return;
  const r = await pool.query(`UPDATE expenses SET vendor='Part Timers', category='Part Timers' WHERE id = ANY($1::bigint[])`, [[3812, 3848, 3814]]);
  console.log(`[blankfix1] part-timers set: ${r.rowCount}`);
  await pool.query(`INSERT INTO app_kv (k,v) VALUES ('blank_fix1_v1', now()) ON CONFLICT (k) DO NOTHING`).catch(() => {});
}
