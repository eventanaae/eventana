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
           name = EXCLUDED.name,
           short_description = EXCLUDED.short_description, detail = EXCLUDED.detail,
           pricing = EXCLUDED.pricing, requires_assets = EXCLUDED.requires_assets,
           is_inflatable = EXCLUDED.is_inflatable, is_food_station = EXCLUDED.is_food_station,
           needs_admin_review = EXCLUDED.needs_admin_review,
           celebration_types = EXCLUDED.celebration_types, badge = EXCLUDED.badge,
           gradient = EXCLUDED.gradient`,
        // NOTE: price_fils and extra_serving_fils are deliberately NOT overwritten
        // on conflict — a price the owner set in the dashboard is the source of
        // truth and must survive a redeploy. New services still take the code
        // price on first insert.
        [
          s.id, s.name, s.categoryId, s.priceFils, s.shortDescription, s.detail,
          JSON.stringify(s.pricing), s.requiresAssets, s.isInflatable, s.isFoodStation,
          s.extraServingFils, s.needsAdminReview, s.celebrationTypes, s.badge, s.gradient,
        ],
      );
    }

    // Package ROWS: insert any package that doesn't exist yet (e.g. a new
    // celebration's packages) and refresh the code-authoritative fields. Name IS
    // refreshed (same as services + the seed) so a code rename goes live; only
    // price_fils is left to the dashboard owner and survives a redeploy.
    for (const p of PACKAGES) {
      await pool.query(
        `INSERT INTO packages
           (id, name, price_fils, capacity, duration_hours, tag, gradient, has_castle_choice, celebration_type, active)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,TRUE)
         ON CONFLICT (id) DO UPDATE SET
           name = EXCLUDED.name,
           celebration_type = EXCLUDED.celebration_type,
           capacity = EXCLUDED.capacity, duration_hours = EXCLUDED.duration_hours,
           tag = EXCLUDED.tag, gradient = EXCLUDED.gradient,
           has_castle_choice = EXCLUDED.has_castle_choice`,
        [p.id, p.name, p.priceFils, p.capacity, p.durationHours, p.tag, p.gradient, p.hasCastleChoice, p.celebrationType],
      );
    }

    // Package item lists are derived content — rebuild them from the catalogue
    // (same DELETE + INSERT the seed uses) so splits/renames/description edits
    // go live.
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
