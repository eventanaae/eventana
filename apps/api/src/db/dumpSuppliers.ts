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
  const clean = (v: string | null) => (v ?? '').replace(/\s+/g, ' ').trim();
  const data = rows.map((r) => ({ n: clean(r.name), p: clean(r.phone), l: clean(r.location), i: r.items, s: clean(r.supplies) }));
  console.log(`[sup-dump] BEGIN ${data.length} active suppliers`);
  // Emit as JSON chunks (small enough per log line to avoid truncation).
  const CHUNK = 35;
  for (let c = 0; c * CHUNK < data.length; c++) {
    const part = data.slice(c * CHUNK, (c + 1) * CHUNK);
    console.log(`[sup-json] ${String(c).padStart(2, '0')} ${JSON.stringify(part)}`);
  }
  console.log(`[sup-dump] END ${data.length}`);
}
