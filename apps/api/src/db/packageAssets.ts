/**
 * Applies package cover images + the Spa inspiration gallery ONCE (app_kv
 * marker, non-fatal). Every package cover is a real event photo chosen per tier
 * (Golden→Barbie, Silver→Princess, Bronze→Bow, Summer→Lilo, Movie→K-Pop stage,
 * Spa→Spa Party); the Spa gallery is currently empty.
 *
 * This used to run on EVERY boot and first cleared every package cover, which
 * reverted any cover the owner set in the dashboard. It now runs at most once
 * per database (marker PACKAGE_ASSETS_MARKER), only fills covers that are still
 * empty, and never clears anything. If the marker is missing but covers already
 * exist (every pre-existing deployment), the marker is set and nothing changes.
 */
import { pool } from './pool.js';
import { PACKAGE_COVERS, SPA_GALLERY } from './packageAssetsData.js';

const PACKAGE_ASSETS_MARKER = 'package_assets_applied_v1';

export async function applyPackageAssets(): Promise<void> {
  try {
    // A failed marker read must NOT look like "never ran" — stop instead.
    let done: { rowCount: number | null };
    try {
      done = await pool.query(`SELECT 1 FROM app_kv WHERE k = $1`, [PACKAGE_ASSETS_MARKER]);
    } catch (err) {
      console.error('[packages] marker check failed — skipping assets apply:', (err as Error).message);
      return;
    }
    if (done.rowCount) return;

    const existing = await pool.query(`SELECT 1 FROM packages WHERE cover_image_url IS NOT NULL LIMIT 1`);
    if (existing.rowCount) {
      await pool.query(`INSERT INTO app_kv (k) VALUES ($1) ON CONFLICT (k) DO NOTHING`, [PACKAGE_ASSETS_MARKER]);
      console.log('[packages] covers already present — marker set, nothing changed');
      return;
    }

    // Insert-only: fill a cover only where none is set.
    for (const [pkgId, url] of Object.entries(PACKAGE_COVERS)) {
      await pool.query(
        `UPDATE packages SET cover_image_url = $2 WHERE id = $1 AND cover_image_url IS NULL`,
        [pkgId, url],
      );
    }
    for (const url of SPA_GALLERY) {
      await pool.query(
        `INSERT INTO package_inspiration (package_id, image_url)
         SELECT 'spa', $1 WHERE NOT EXISTS (
           SELECT 1 FROM package_inspiration WHERE package_id = 'spa' AND image_url = $1)`,
        [url],
      );
    }
    await pool.query(`INSERT INTO app_kv (k) VALUES ($1) ON CONFLICT (k) DO NOTHING`, [PACKAGE_ASSETS_MARKER]);
    console.log(`[packages] covers applied for ${Object.keys(PACKAGE_COVERS).length} package(s) (one-time)`);
  } catch (err) {
    console.error('[packages] assets apply failed (non-fatal):', err);
  }
}
