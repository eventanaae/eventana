/**
 * Merge duplicate vendor spellings that survived (e.g. "Blue Rhine General
 * Tradind LLC" typo → "…Trading LLC"), and LOG any remaining near-duplicate
 * vendor names (same normalized form) so the owner can spot more. One-shot.
 */
import { pool } from './pool.js';

// Explicit merges: [canonical, [variants...]]
const MERGES: [string, string[]][] = [
  ['Blue Rhine General Trading LLC', [
    'blue rhine general tradind llc',
    'blue rhine general trading llc (deleted)',
    'blue rhine general trading l.l.c',
    'blue rhine general trading l.l.c.',
    'blue rhine general trading llc',
  ]],
];

export async function mergeDupVendorsFromEnv(): Promise<void> {
  if (String(process.env.RUN_MIGRATIONS_ON_BOOT ?? '').toLowerCase() !== 'true') return;
  const guard = await pool.query(`SELECT 1 FROM app_kv WHERE k = 'merge_dup_vendors_v1'`).catch(() => ({ rowCount: 0 }));
  if (guard.rowCount) return;

  for (const [canon, variants] of MERGES) {
    const res = await pool.query(
      `UPDATE expenses SET vendor = $1 WHERE lower(btrim(vendor)) = ANY($2::text[]) AND vendor <> $1`,
      [canon, variants],
    );
    console.log(`[merge-vend] ${canon}: ${res.rowCount} rows unified`);
  }

  // Owner account corrections spotted in the Chart of Accounts.
  const ACCT_FIX: [string, string][] = [
    ['al yafi style gen trd', 'Flowers'],   // owner: this vendor is flowers, not fabric
  ];
  for (const [v, acct] of ACCT_FIX) {
    const r = await pool.query(`UPDATE expenses SET category = $2 WHERE lower(btrim(vendor)) = $1`, [v, acct]);
    console.log(`[merge-vend] account fix "${v}" -> ${acct}: ${r.rowCount} rows`);
  }

  // Report remaining normalized-duplicate vendor names.
  const { rows } = await pool.query<{ norm: string; names: string[]; total: number }>(
    `SELECT regexp_replace(lower(btrim(vendor)), '[^a-z0-9]', '', 'g') AS norm,
            array_agg(DISTINCT btrim(vendor)) AS names, count(*)::int AS total
       FROM expenses
      WHERE COALESCE(btrim(vendor),'') <> ''
      GROUP BY 1
     HAVING count(DISTINCT btrim(vendor)) > 1
      ORDER BY count(*) DESC`,
  );
  console.log(`[merge-vend] remaining near-duplicate vendor groups: ${rows.length}`);
  for (const r of rows.slice(0, 40)) console.log(`[merge-vend] DUP: ${r.names.join('  |  ')}`);

  await pool.query(`INSERT INTO app_kv (k, v) VALUES ('merge_dup_vendors_v1', now()) ON CONFLICT (k) DO NOTHING`).catch(() => {});
}
