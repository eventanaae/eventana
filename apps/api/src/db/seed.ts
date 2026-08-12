/**
 * Seeds the database from the shared catalogue.
 *
 * Everything written here is EDITABLE afterwards from the Internal
 * Dashboard. The seed is the starting configuration, not a hard-coded
 * runtime source — the engine reads prices, zones and rules from these
 * tables on every request.
 */
import {
  DEFAULT_PRICING_RULES,
  DELIVERY_ZONES,
  INVENTORY_ASSETS,
  PACKAGES,
  SERVICE_CATEGORIES,
  SERVICES,
  THEMES,
} from '@eventana/shared';
import { closePool, pool, withTransaction } from './pool.js';
import { isMain } from './is-main.js';

const TEAM = [
  { id: 'stf-ahmed', name: 'Ahmed', role: 'Setup Lead', color: '#F06CA8' },
  { id: 'stf-maryam', name: 'Maryam', role: 'Designer', color: '#5BCFC5' },
  { id: 'stf-yousef', name: 'Yousef', role: 'Driver', color: '#F7C948' },
  { id: 'stf-layla', name: 'Layla', role: 'Entertainer', color: '#D9B8E8' },
  { id: 'stf-omar', name: 'Omar', role: 'Operations Manager', color: '#7A8AC8' },
];

export async function seed(): Promise<void> {
  await withTransaction(async (db) => {
    await db.query(
      `INSERT INTO settings (key, value) VALUES ('pricing_rules', $1)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
      [JSON.stringify(DEFAULT_PRICING_RULES)],
    );

    for (const z of DELIVERY_ZONES) {
      await db.query(
        `INSERT INTO delivery_zones
           (zone_name, emirate, areas, fee_fils, available, special_conditions, effective_date)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (emirate) DO UPDATE SET
           zone_name = EXCLUDED.zone_name,
           fee_fils = EXCLUDED.fee_fils,
           available = EXCLUDED.available,
           special_conditions = EXCLUDED.special_conditions`,
        [z.zoneName, z.emirate, z.areas, z.feeFils, z.available, z.specialConditions, z.effectiveDate],
      );
    }

    for (const c of SERVICE_CATEGORIES) {
      await db.query(
        `INSERT INTO service_categories (id, name, note, celebration_types, sort_order)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (id) DO UPDATE SET
           name = EXCLUDED.name, note = EXCLUDED.note,
           celebration_types = EXCLUDED.celebration_types,
           sort_order = EXCLUDED.sort_order`,
        [c.id, c.name, c.note, c.celebrationTypes, c.sortOrder],
      );
    }

    for (const s of SERVICES) {
      await db.query(
        `INSERT INTO services
           (id, name, category_id, price_fils, short_description, detail, pricing,
            requires_assets, is_inflatable, is_food_station, extra_serving_fils,
            needs_admin_review, celebration_types, badge, gradient)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
         ON CONFLICT (id) DO UPDATE SET
           name = EXCLUDED.name, price_fils = EXCLUDED.price_fils,
           short_description = EXCLUDED.short_description, detail = EXCLUDED.detail,
           pricing = EXCLUDED.pricing, requires_assets = EXCLUDED.requires_assets,
           is_inflatable = EXCLUDED.is_inflatable, is_food_station = EXCLUDED.is_food_station,
           extra_serving_fils = EXCLUDED.extra_serving_fils,
           needs_admin_review = EXCLUDED.needs_admin_review,
           celebration_types = EXCLUDED.celebration_types, badge = EXCLUDED.badge,
           gradient = EXCLUDED.gradient`,
        [
          s.id, s.name, s.categoryId, s.priceFils, s.shortDescription, s.detail,
          JSON.stringify(s.pricing), s.requiresAssets, s.isInflatable, s.isFoodStation,
          s.extraServingFils, s.needsAdminReview, s.celebrationTypes, s.badge, s.gradient,
        ],
      );
    }

    for (const p of PACKAGES) {
      await db.query(
        `INSERT INTO packages (id, name, price_fils, capacity, duration_hours, tag, gradient, has_castle_choice)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (id) DO UPDATE SET
           name = EXCLUDED.name, price_fils = EXCLUDED.price_fils,
           capacity = EXCLUDED.capacity, tag = EXCLUDED.tag,
           gradient = EXCLUDED.gradient, has_castle_choice = EXCLUDED.has_castle_choice`,
        [p.id, p.name, p.priceFils, p.capacity, p.durationHours, p.tag, p.gradient, p.hasCastleChoice],
      );
      await db.query('DELETE FROM package_items WHERE package_id = $1', [p.id]);
      for (const [i, it] of p.items.entries()) {
        await db.query(
          `INSERT INTO package_items (package_id, name, detail, assets, sort_order)
           VALUES ($1,$2,$3,$4,$5)`,
          [p.id, it.name, it.detail, it.assets, i],
        );
      }
    }

    for (const t of THEMES) {
      await db.query(
        `INSERT INTO themes (id, name, tags, colors, gradient, popular, featured, active, celebration_type, sort_order)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         ON CONFLICT (id) DO UPDATE SET
           name = EXCLUDED.name, tags = EXCLUDED.tags, colors = EXCLUDED.colors,
           gradient = EXCLUDED.gradient, popular = EXCLUDED.popular,
           featured = EXCLUDED.featured, celebration_type = EXCLUDED.celebration_type,
           sort_order = EXCLUDED.sort_order`,
        [t.id, t.name, t.tags, t.colors, t.gradient, t.popular, t.featured, t.active, t.celebrationType, t.sortOrder],
      );
    }

    for (const a of INVENTORY_ASSETS) {
      await db.query(
        `INSERT INTO inventory_assets (code, name, variant, units, buffer_before_minutes, buffer_after_minutes)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (code) DO UPDATE SET
           name = EXCLUDED.name, variant = EXCLUDED.variant, units = EXCLUDED.units,
           buffer_before_minutes = EXCLUDED.buffer_before_minutes,
           buffer_after_minutes = EXCLUDED.buffer_after_minutes`,
        [a.code, a.name, a.variant, a.units, a.bufferBeforeMinutes, a.bufferAfterMinutes],
      );
    }

    for (const m of TEAM) {
      await db.query(
        `INSERT INTO team_members (id, name, role, color) VALUES ($1,$2,$3,$4)
         ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, role = EXCLUDED.role`,
        [m.id, m.name, m.role, m.color],
      );
    }

    // A demo customer so the apps have someone to sign in as until real
    // authentication is wired up.
    await db.query(
      `INSERT INTO customers (id, name, phone, email, loyalty_points, loyalty_tier)
       VALUES ('CUST-4471', 'Sara Al Mansoori', '+971504500042', 'sara@example.com', 1250, 'GOLD')
       ON CONFLICT (id) DO NOTHING`,
    );
  });
}

/**
 * Seeds only when the catalogue is empty.
 *
 * This is what deployments run. `seed()` itself upserts, which would
 * silently undo every price, fee and delivery-zone change Eventana admin
 * has made on the dashboard the next time the service redeploys. A
 * deployment must never rewrite live business data.
 */
export async function seedIfEmpty(): Promise<boolean> {
  const { rows } = await pool.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM services`,
  );
  if (rows[0].n > 0) {
    console.log(`Catalogue already present (${rows[0].n} services) — leaving it untouched.`);
    return false;
  }
  await seed();
  console.log('Empty catalogue — seeded initial Eventana data.');
  return true;
}

if (isMain(import.meta.url)) {
  const onlyIfEmpty = process.argv.includes('--if-empty');
  (onlyIfEmpty ? seedIfEmpty() : seed())
    .then(async () => {
      const { rows } = await pool.query(
        `SELECT
           (SELECT count(*) FROM services) AS services,
           (SELECT count(*) FROM packages) AS packages,
           (SELECT count(*) FROM themes) AS themes,
           (SELECT count(*) FROM inventory_assets) AS assets,
           (SELECT count(*) FROM delivery_zones) AS zones`,
      );
      // Say what the catalogue CONTAINS, not that it was written — with
      // --if-empty an existing catalogue is deliberately left alone, and
      // a log line reading "Seeded" during a redeploy would look like
      // the live prices had just been overwritten.
      console.log('Catalogue now holds:', rows[0]);
      await closePool();
    })
    .catch(async (err) => {
      console.error('Seed failed:', err);
      await closePool();
      process.exit(1);
    });
}
