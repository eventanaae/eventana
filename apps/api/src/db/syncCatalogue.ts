/**
 * Re-syncs catalogue CONTENT — service categories, services and the fixed
 * packages' item lists — from the shared catalogue on every boot.
 *
 * The owner edits the catalogue in code (`packages/shared/src/catalogue.ts`),
 * so this makes those edits go live on the next deploy without needing an
 * empty database. Only catalogue content is touched here; delivery zones,
 * themes, inventory and pricing rules are left to the seed and the dashboard.
 */
import { PACKAGES, SERVICES, SERVICE_CATEGORIES } from '@eventana/shared';
import { pool } from './pool.js';

export async function syncCatalogueContent(): Promise<void> {
  try {
    for (const c of SERVICE_CATEGORIES) {
      await pool.query(
        `INSERT INTO service_categories (id, name, note, celebration_types, sort_order)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (id) DO UPDATE SET
           name = EXCLUDED.name, note = EXCLUDED.note,
           celebration_types = EXCLUDED.celebration_types, sort_order = EXCLUDED.sort_order`,
        [c.id, c.name, c.note, c.celebrationTypes, c.sortOrder],
      );
    }

    for (const s of SERVICES) {
      await pool.query(
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

    // Package item lists are derived content — rebuild them from the catalogue
    // (same DELETE + INSERT the seed uses) so splits/renames/description edits
    // go live. The packages' own rows (price, name) are left to seed/admin.
    for (const p of PACKAGES) {
      await pool.query('DELETE FROM package_items WHERE package_id = $1', [p.id]);
      for (const [i, it] of p.items.entries()) {
        await pool.query(
          `INSERT INTO package_items (package_id, name, detail, assets, sort_order)
           VALUES ($1,$2,$3,$4,$5)`,
          [p.id, it.name, it.detail, it.assets, i],
        );
      }
    }

    console.log(`[catalogue] content synced: ${SERVICES.length} services, ${PACKAGES.length} packages`);
  } catch (err) {
    console.error('[catalogue] content sync failed (non-fatal):', err);
  }
}
