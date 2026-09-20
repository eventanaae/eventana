/**
 * Owner: employees don't belong in the suppliers directory. Deactivate every
 * supplier whose final account is Salaries or Part Timers (staff/part-timers),
 * plus a few clear non-suppliers, so the Suppliers list is only real vendors.
 * Expenses keep their names/accounts untouched. One-shot guarded.
 */
import { pool } from './pool.js';
import { SUPPLIER_MAP } from './supplierMapping.js';

export async function supplierRemoveEmployeesFromEnv(): Promise<void> {
  if (String(process.env.RUN_MIGRATIONS_ON_BOOT ?? '').toLowerCase() !== 'true') return;
  const guard = await pool.query(`SELECT 1 FROM app_kv WHERE k = 'sup_rm_employees_v1'`).catch(() => ({ rowCount: 0 }));
  if (guard.rowCount) return;

  // Employee / non-supplier final names, derived from the approved mapping.
  const names = new Set<string>();
  for (const m of SUPPLIER_MAP) {
    if (m.a === 'Salaries' || m.a === 'Part Timers') names.add(m.f.trim().toLowerCase());
  }
  // Also Marsha (staff) even though one ride was tagged transport.
  ['marsha kulsum'].forEach((n) => names.add(n));

  const list = [...names];
  if (!list.length) { console.log('[sup-rm] no employee names found'); return; }
  const res = await pool.query(
    `UPDATE suppliers SET active = false WHERE lower(btrim(name)) = ANY($1::text[]) AND COALESCE(active,true) = true`,
    [list],
  );
  console.log(`[sup-rm] deactivated ${res.rowCount} employee/staff entries from suppliers (of ${list.length} names)`);
  await pool.query(`INSERT INTO app_kv (k, v) VALUES ('sup_rm_employees_v1', now()) ON CONFLICT (k) DO NOTHING`).catch(() => {});
}
