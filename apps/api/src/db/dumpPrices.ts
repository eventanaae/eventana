/**
 * READ-ONLY price list (SET_SHAN_LEADER=prices). Logs every live price the
 * customer site sells at — services, packages, delivery zones, pricing rules —
 * straight from the database (the owner edits prices in Ops, so the DB, not the
 * code catalogue, is the truth). Changes nothing.
 */
import { pool } from './pool.js';

const aed = (f: unknown) => (f == null ? '—' : (Number(f) / 100).toFixed(2));

export async function dumpPricesFromEnv(): Promise<void> {
  try {
    const sv = await pool.query(
      `SELECT s.id, s.name, s.category_id, c.name AS cat, s.price_fils, s.pricing, s.extra_serving_fils, s.active, s.celebration_types
         FROM services s LEFT JOIN service_categories c ON c.id = s.category_id
        ORDER BY s.active DESC, s.category_id, s.name`);
    for (const r of sv.rows) {
      const p = r.pricing ?? {};
      console.log(`PRICE|svc|${r.active ? 'on' : 'OFF'}|${r.cat ?? r.category_id}|${r.id}|${r.name}|${aed(r.price_fils)}|${p.kind ?? ''}${p.minChildren ? ` min${p.minChildren}` : ''}${p.minQuantity ? ` minQty${p.minQuantity}` : ''}|extra:${aed(r.extra_serving_fils)}|${(r.celebration_types ?? []).join('/')}`);
    }
    const pk = await pool.query(`SELECT id, name, price_fils, capacity, duration_hours, celebration_type, active FROM packages ORDER BY active DESC, price_fils`);
    for (const r of pk.rows) console.log(`PRICE|pkg|${r.active ? 'on' : 'OFF'}|${r.celebration_type}|${r.id}|${r.name}|${aed(r.price_fils)}|${r.capacity} · ${r.duration_hours}h`);
    const dz = await pool.query(`SELECT zone_name, emirate, fee_fils, available FROM delivery_zones ORDER BY emirate, zone_name`);
    for (const r of dz.rows) console.log(`PRICE|zone|${r.available ? 'on' : 'OFF'}|${r.emirate}|${r.zone_name}|${aed(r.fee_fils)}`);
    const st = await pool.query(`SELECT value, updated_by, updated_at FROM settings WHERE key = 'pricing_rules'`);
    console.log(`PRICE|rules|${JSON.stringify(st.rows[0]?.value ?? {})}|by ${st.rows[0]?.updated_by ?? '-'} at ${st.rows[0]?.updated_at ?? '-'}`);
    console.log(`PRICE|done|services=${sv.rowCount} packages=${pk.rowCount} zones=${dz.rowCount}`);
  } catch (e) { console.error('[prices] failed:', (e as Error).message); }
}
