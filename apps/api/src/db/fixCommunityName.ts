/** One-time: the Community Service account was created with an Arabic name; rename it
 *  to English "Community Service" to match every other account. Guarded. */
import { pool } from './pool.js';

export async function fixCommunityNameFromEnv(): Promise<void> {
  if (String(process.env.RUN_MIGRATIONS_ON_BOOT ?? '').toLowerCase() !== 'true') return;
  const gk = 'fix_community_name_v1';
  const guard = await pool.query(`SELECT 1 FROM app_kv WHERE k=$1`, [gk]).catch((e: unknown) => {
    // A failed marker read must not look like "never ran": stop instead of re-running.
    console.error('[boot] one-shot marker check failed — skipping (not re-running):', (e as Error)?.message);
    return { rowCount: 1 };
  });
  if (guard.rowCount) return;
  const res = await pool.query(`UPDATE expenses SET category = 'Community Service' WHERE category = 'خدمة مجتمعية'`);
  console.log(`[fix-community] renamed ${res.rowCount} row(s) → 'Community Service'`);
  await pool.query(`INSERT INTO app_kv (k,v) VALUES ($1, now()) ON CONFLICT (k) DO NOTHING`, [gk]).catch(() => {});
}
