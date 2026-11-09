/**
 * OWNER-APPROVED apply: rewrite every expense's vendor (clean final supplier name)
 * and category (final account) from the reviewed mapping, split the lumped
 * "Drivers Payment - Check With Jane" rows to the real drivers, and rebuild the
 * suppliers directory (clean names, no email/phone/location).
 *
 * FULLY BACKED UP: expenses.vendor_bk / category_bk hold the pre-apply values, so
 * this is reversible. Runs once on boot (RUN_MIGRATIONS_ON_BOOT on); guarded.
 */
import { pool, withTransaction } from './pool.js';
import { SUPPLIER_MAP, DRIVER_SPLIT, REPAIRING_IDS } from './supplierMapping.js';

export async function applySupplierMappingFromEnv(): Promise<void> {
  if (String(process.env.RUN_MIGRATIONS_ON_BOOT ?? '').toLowerCase() !== 'true') return;
  // A failed marker read must NOT look like "never ran": a re-run wipes the
  // supplier directory's contact data the owner has re-entered since. Stop.
  let guard: { rowCount: number | null };
  try {
    guard = await pool.query(`SELECT 1 FROM app_kv WHERE k = 'supplier_mapping_applied_v1'`);
  } catch (err) {
    console.error('[map-apply] marker check failed — NOT running:', (err as Error).message);
    return;
  }
  if (guard.rowCount) return;

  // Everything below runs in ONE transaction that claims the marker FIRST: either
  // the whole apply commits together with its marker, or nothing changes. A
  // concurrent instance that already claimed it makes this one stop.
  await withTransaction(async (client) => {
    const claim = await client.query(
      `INSERT INTO app_kv (k, v) VALUES ('supplier_mapping_applied_v1', now()) ON CONFLICT (k) DO NOTHING`,
    );
    if (!claim.rowCount) { console.log('[map-apply] already applied — skipping'); return; }

    console.log('[map-apply] START');

    // 1) Backup columns (once).
    await client.query(`ALTER TABLE expenses ADD COLUMN IF NOT EXISTS vendor_bk TEXT`);
    await client.query(`ALTER TABLE expenses ADD COLUMN IF NOT EXISTS category_bk TEXT`);
    const bk = await client.query(`UPDATE expenses SET vendor_bk = COALESCE(vendor_bk, vendor), category_bk = COALESCE(category_bk, category)`);
    console.log(`[map-apply] backed up ${bk.rowCount} expense rows`);

    const before = await client.query<{ n: number }>(`SELECT count(*)::int n FROM expenses`);
    console.log(`[map-apply] total expenses: ${before.rows[0].n}`);

    // 2) Apply the mapping vendor+category by matching current vendor name.
    let changed = 0, matched = 0;
    for (const m of SUPPLIER_MAP) {
      const res = await client.query(
        `UPDATE expenses SET vendor = $2, category = $3
           WHERE lower(btrim(vendor)) = lower(btrim($1))`,
        [m.v, m.f, m.a],
      );
      matched += res.rowCount ?? 0;
      if (res.rowCount) changed++;
    }
    console.log(`[map-apply] mapping applied — ${matched} rows across ${changed}/${SUPPLIER_MAP.length} vendors`);

    // 3) Split the lumped driver payments to the real drivers (override by id).
    for (const s of DRIVER_SPLIT) {
      await client.query(`UPDATE expenses SET vendor = $2, category = 'Shipping and Delivery' WHERE id = $1`, [s.id, s.to]);
    }
    console.log(`[map-apply] driver split applied — ${DRIVER_SPLIT.length} rows`);

    // Repairing rows -> Abdul Muneeb / Balloons (belt-and-braces; also covered by map).
    await client.query(
      `UPDATE expenses SET vendor = 'Abdul Muneeb', category = 'Balloons' WHERE id = ANY($1::bigint[])`,
      [REPAIRING_IDS],
    );

    // 4) Rebuild suppliers directory: clear contacts, deactivate all, then
    //    reactivate/insert the final unique names with what-they-provide.
    await client.query(`UPDATE suppliers SET email = NULL, phone = NULL, location = NULL, active = false`);
    const finals = new Map<string, string>(); // lower(final) -> {name, provide}
    const provOf = new Map<string, string>();
    for (const m of SUPPLIER_MAP) {
      const key = m.f.trim().toLowerCase();
      if (!finals.has(key)) finals.set(key, m.f.trim());
      if (m.p && !provOf.get(key)) provOf.set(key, m.p.trim());
    }
    let supUpd = 0, supIns = 0;
    for (const [key, name] of finals) {
      const prov = provOf.get(key) ?? '';
      const u = await client.query(
        `UPDATE suppliers SET active = true, supplies = COALESCE(NULLIF($2,''), supplies) WHERE lower(btrim(name)) = $1`,
        [key, prov],
      );
      if (u.rowCount) { supUpd += u.rowCount; }
      else { await client.query(`INSERT INTO suppliers (name, supplies, active, created_by) VALUES ($1,$2,true,'Supplier Review')`, [name, prov]); supIns++; }
    }
    console.log(`[map-apply] suppliers — reactivated/updated ${supUpd}, inserted ${supIns}, total finals ${finals.size}`);

    // 5) Post-apply chart of accounts distribution (what the dashboard will show).
    const dist = await client.query<{ category: string; n: number; aed: number }>(
      `SELECT category, count(*)::int n, round(sum(amount_fils)/100.0)::int aed
         FROM expenses GROUP BY category ORDER BY sum(amount_fils) DESC`,
    );
    console.log('[map-apply] ── CHART OF ACCOUNTS (post-apply) ──');
    for (const d of dist.rows) console.log(`[map-apply] ${(d.category ?? '(none)').padEnd(28)} ${String(d.n).padStart(4)} · AED ${d.aed}`);

    console.log('[map-apply] DONE ✅');
  });
}
