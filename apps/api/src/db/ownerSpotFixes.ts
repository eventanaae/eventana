/**
 * Ongoing owner corrections spotted while reviewing the Chart of Accounts.
 * Each entry re-points a vendor's name and/or account. Idempotent. Bump the
 * guard version (owner_spot_fixes_vN) whenever new corrections are added so the
 * full (idempotent) list re-applies on the next deploy.
 */
import { pool } from './pool.js';

// match (lower vendor)  ->  { vendor?, account? }
const FIXES: { match: string; vendor?: string; account?: string }[] = [
  { match: 'ahmed faraz ghulam', vendor: 'Ahmed Faraz Ghulam', account: 'Shipping and Delivery' }, // part-time driver
  { match: 'zufer', vendor: 'Zufer', account: 'Shipping and Delivery' },                            // part-time driver
];

export async function ownerSpotFixesFromEnv(): Promise<void> {
  if (String(process.env.RUN_MIGRATIONS_ON_BOOT ?? '').toLowerCase() !== 'true') return;
  const guard = await pool.query(`SELECT 1 FROM app_kv WHERE k = 'owner_spot_fixes_v1'`).catch(() => ({ rowCount: 0 }));
  if (guard.rowCount) return;
  for (const f of FIXES) {
    const sets: string[] = []; const vals: any[] = [f.match];
    if (f.vendor) { vals.push(f.vendor); sets.push(`vendor = $${vals.length}`); }
    if (f.account) { vals.push(f.account); sets.push(`category = $${vals.length}`); }
    if (!sets.length) continue;
    const r = await pool.query(`UPDATE expenses SET ${sets.join(', ')} WHERE lower(btrim(vendor)) = $1`, vals);
    console.log(`[spot-fix] "${f.match}" -> ${f.vendor ?? ''}/${f.account ?? ''}: ${r.rowCount} rows`);
  }
  await pool.query(`INSERT INTO app_kv (k, v) VALUES ('owner_spot_fixes_v1', now()) ON CONFLICT (k) DO NOTHING`).catch(() => {});
}
