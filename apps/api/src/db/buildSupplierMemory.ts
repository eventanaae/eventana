/**
 * Build "supplier memory" from the receipt OCR results:
 *   • supplier_items — every item we bought from each supplier, with how many
 *     times, and the avg / min / max / last unit price (fils). Powers the future
 *     Supplier Dashboard (type an item → supplier + average cost).
 *   • suppliers — fill in the phone / location learned from receipts (official
 *     name/phone/address), without duplicating existing suppliers.
 * Gated BUILD_SUPPLIER_MEMORY=true. Idempotent (rebuilds from receipt_ocr).
 */
import { pool } from './pool.js';

export async function buildSupplierMemoryFromEnv(): Promise<void> {
  if (String(process.env.BUILD_SUPPLIER_MEMORY ?? '').toLowerCase() !== 'true') return;

  // 1) Rebuild supplier_items (avg/min/max/last unit price per supplier+item).
  const items = await pool.query(
    `INSERT INTO supplier_items (supplier_name, item_name, times_bought, avg_price_fils, last_price_fils, min_price_fils, max_price_fils)
     SELECT s.supplier_name, s.item_name, s.n,
            round(s.avg_price*100)::bigint, round(s.last_price*100)::bigint,
            round(s.min_price*100)::bigint, round(s.max_price*100)::bigint
       FROM (
         SELECT max(ro.supplier_name) AS supplier_name,
                max(btrim(it->>'name')) AS item_name,
                count(*)::int AS n,
                avg((it->>'unit_price')::numeric) AS avg_price,
                min((it->>'unit_price')::numeric) AS min_price,
                max((it->>'unit_price')::numeric) AS max_price,
                (array_agg((it->>'unit_price')::numeric ORDER BY ro.created_at DESC))[1] AS last_price
           FROM receipt_ocr ro
                CROSS JOIN LATERAL jsonb_array_elements(COALESCE(ro.items,'[]'::jsonb)) it
          WHERE ro.status='ok'
            AND COALESCE(btrim(ro.supplier_name),'') <> ''
            AND COALESCE(btrim(it->>'name'),'') <> ''
            AND (it->>'unit_price') ~ '^[0-9]+(\\.[0-9]+)?$'
          GROUP BY lower(btrim(ro.supplier_name)), lower(btrim(it->>'name'))
       ) s
     ON CONFLICT (lower(supplier_name), lower(item_name)) DO UPDATE SET
       times_bought=EXCLUDED.times_bought, avg_price_fils=EXCLUDED.avg_price_fils,
       last_price_fils=EXCLUDED.last_price_fils, min_price_fils=EXCLUDED.min_price_fils,
       max_price_fils=EXCLUDED.max_price_fils, updated_at=now()`,
  );
  console.log(`[sup-memory] supplier_items upserted: ${items.rowCount}`);

  // 2) Fill phone/location on existing suppliers from receipts (only where missing).
  const upd = await pool.query(
    `UPDATE suppliers su SET
       phone = COALESCE(NULLIF(btrim(su.phone),''), o.phone),
       location = COALESCE(NULLIF(btrim(su.location),''), o.location)
     FROM (
       SELECT supplier_name, max(supplier_phone) phone, max(supplier_location) location
         FROM receipt_ocr WHERE COALESCE(btrim(supplier_name),'')<>'' AND COALESCE(payment_type,'purchase')<>'transfer'
         GROUP BY supplier_name
     ) o
     WHERE lower(btrim(su.name)) = lower(btrim(o.supplier_name))`,
  );
  console.log(`[sup-memory] existing suppliers enriched: ${upd.rowCount}`);

  // 3) Insert suppliers seen on receipts that we don't have yet (by name).
  const ins = await pool.query(
    `INSERT INTO suppliers (name, phone, location, created_by)
     SELECT o.supplier_name, o.phone, o.location, 'Receipt OCR'
       FROM (
         SELECT supplier_name, max(supplier_phone) phone, max(supplier_location) location
           FROM receipt_ocr WHERE COALESCE(btrim(supplier_name),'')<>'' AND COALESCE(payment_type,'purchase')<>'transfer'
           GROUP BY supplier_name
       ) o
      WHERE NOT EXISTS (SELECT 1 FROM suppliers s WHERE lower(btrim(s.name)) = lower(btrim(o.supplier_name)))`,
  );
  console.log(`[sup-memory] new suppliers added from receipts: ${ins.rowCount}`);

  // 4) Auto-describe each supplier from its most-common receipt category + its
  //    top items (by how often bought). Fills suppliers.supplies where empty.
  const desc = await pool.query(
    `WITH cat AS (
       SELECT lower(btrim(supplier_name)) k, mode() WITHIN GROUP (ORDER BY category_guess) AS c
         FROM receipt_ocr
        WHERE COALESCE(btrim(supplier_name),'') <> '' AND COALESCE(payment_type,'purchase') <> 'transfer'
          AND COALESCE(btrim(category_guess),'') <> ''
        GROUP BY 1
     ),
     top AS (
       SELECT k, string_agg(item_name, ', ') items FROM (
         SELECT lower(btrim(supplier_name)) k, item_name,
                row_number() OVER (PARTITION BY lower(btrim(supplier_name)) ORDER BY times_bought DESC, item_name) rn
           FROM supplier_items
       ) x WHERE rn <= 6 GROUP BY k
     )
     UPDATE suppliers su SET supplies = COALESCE(NULLIF(btrim(su.supplies),''),
        NULLIF(btrim(concat_ws(' — ', initcap(cat.c), top.items)), ''))
       FROM cat LEFT JOIN top ON top.k = cat.k
      WHERE lower(btrim(su.name)) = cat.k
        AND COALESCE(NULLIF(btrim(su.supplies),''), '') = ''`,
  );
  console.log(`[sup-memory] supplier descriptions written: ${desc.rowCount}`);

  const tot = await pool.query<{ items: number; sups: number }>(
    `SELECT (SELECT count(*) FROM supplier_items)::int items, (SELECT count(DISTINCT lower(supplier_name)) FROM supplier_items)::int sups`,
  );
  console.log(`[sup-memory] DONE — ${tot.rows[0].items} item rows across ${tot.rows[0].sups} suppliers`);
}
