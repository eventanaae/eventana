/**
 * Diagnostic: dump every active supplier as tab-separated rows so we can build a
 * clean supplier sheet (name · what they supply · phone · location). Read-only.
 * Gated DUMP_SUPPLIERS=true.
 */
import { pool } from './pool.js';

export async function dumpSuppliersFromEnv(): Promise<void> {
  if (String(process.env.DUMP_SUPPLIERS ?? '').toLowerCase() !== 'true') return;
  const { rows } = await pool.query<{ name: string; phone: string | null; location: string | null; supplies: string | null; items: number }>(
    `SELECT s.name, s.phone, s.location, s.supplies, COALESCE(si.n,0)::int items
       FROM suppliers s
       LEFT JOIN (SELECT lower(btrim(supplier_name)) k, count(*) n FROM supplier_items GROUP BY 1) si
              ON si.k = lower(btrim(s.name))
      WHERE COALESCE(s.active, true) = true
      ORDER BY lower(btrim(s.name))`,
  );
  console.log(`[sup-dump] BEGIN ${rows.length} active suppliers`);
  for (const r of rows) {
    const clean = (v: string | null) => (v ?? '').replace(/\s+/g, ' ').replace(/\t/g, ' ').trim();
    console.log(`[sup-dump]\t${clean(r.name)}\t${clean(r.phone)}\t${clean(r.location)}\t${r.items}\t${clean(r.supplies)}`);
  }
  console.log(`[sup-dump] END ${rows.length}`);
}
