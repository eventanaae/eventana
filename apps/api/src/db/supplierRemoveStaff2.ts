/**
 * Owner: part-timers & staff are NOT vendors. Comprehensive removal from the
 * suppliers directory — match against the part_timers roster, the team_members
 * roster, and the Salaries/Part-Timers final names from the approved mapping.
 * One-shot guarded.
 */
import { pool } from './pool.js';
import { SUPPLIER_MAP } from './supplierMapping.js';

export async function supplierRemoveStaff2FromEnv(): Promise<void> {
  if (String(process.env.RUN_MIGRATIONS_ON_BOOT ?? '').toLowerCase() !== 'true') return;
  const guard = await pool.query(`SELECT 1 FROM app_kv WHERE k = 'sup_rm_staff2_v1'`).catch(() => ({ rowCount: 0 }));
  if (guard.rowCount) return;

  const names = new Set<string>();
  for (const m of SUPPLIER_MAP) if (m.a === 'Salaries' || m.a === 'Part Timers') names.add(m.f.trim().toLowerCase());
  ['part timers', 'marsha kulsum'].forEach((n) => names.add(n));

  const res = await pool.query(
    `UPDATE suppliers SET active = false
      WHERE COALESCE(active, true) = true
        AND ( lower(btrim(name)) = ANY($1::text[])
           OR lower(btrim(name)) IN (SELECT lower(btrim(name)) FROM part_timers)
           OR lower(btrim(name)) IN (SELECT lower(btrim(name)) FROM team_members) )`,
    [[...names]],
  );
  console.log(`[sup-rm2] deactivated ${res.rowCount} part-timer/staff entries from suppliers`);
  const left = await pool.query<{ n: number }>(`SELECT count(*)::int n FROM suppliers WHERE active`);
  console.log(`[sup-rm2] active suppliers now: ${left.rows[0].n}`);
  await pool.query(`INSERT INTO app_kv (k, v) VALUES ('sup_rm_staff2_v1', now()) ON CONFLICT (k) DO NOTHING`).catch(() => {});
}
