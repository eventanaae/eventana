/** Owner: name the blank-vendor rows from their receipts (approved names/accounts). One-shot guarded. */
import { pool } from './pool.js';
const M: { ids: number[]; v: string; a: string }[] = [
  { ids: [27000], v: 'Champion Textiles & Readymade Garments LLC', a: 'Fabric' },
  { ids: [520], v: 'Public Cook', a: 'Meals and Entertainment' },
  { ids: [824], v: 'Petrol Station', a: 'Shipping and Delivery' },
  { ids: [218, 213, 211, 212, 219, 220, 222, 221, 215, 217], v: 'Grocery', a: 'Supplies/Purchase' },
  { ids: [216], v: 'Gulf Salt', a: 'Supplies/Purchase' },
  { ids: [223], v: 'Euston Furniture', a: 'Supplies/Purchase' },
  { ids: [1131], v: 'Calicut Restaurant', a: 'Meals and Entertainment' },
  { ids: [2834], v: 'KFC', a: 'Meals and Entertainment' },
  { ids: [2862], v: 'Taxi/ Uber', a: 'Shipping and Delivery' },
];
export async function blankFix2FromEnv(): Promise<void> {
  if (String(process.env.RUN_MIGRATIONS_ON_BOOT ?? '').toLowerCase() !== 'true') return;
  const g = await pool.query(`SELECT 1 FROM app_kv WHERE k='blank_fix2_v1'`).catch(() => ({ rowCount: 0 }));
  if (g.rowCount) return;
  let n = 0;
  for (const m of M) {
    const r = await pool.query(`UPDATE expenses SET vendor=$2, category=$3 WHERE id = ANY($1::bigint[])`, [m.ids, m.v, m.a]);
    n += r.rowCount ?? 0;
  }
  console.log(`[blankfix2] named ${n} rows from receipts`);
  await pool.query(`INSERT INTO app_kv (k,v) VALUES ('blank_fix2_v1', now()) ON CONFLICT (k) DO NOTHING`).catch(() => {});
}
