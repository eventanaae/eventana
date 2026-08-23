/**
 * Applies package cover images + the Spa inspiration gallery on boot
 * (idempotent, non-fatal). Every package cover is a real event photo chosen
 * per tier (Golden→Barbie, Silver→Princess, Bronze→Bow, Summer→Lilo,
 * Movie→K-Pop stage, Spa→Spa Party); the Spa gallery is currently empty.
 */
import { pool } from './pool.js';
import { PACKAGE_COVERS, SPA_GALLERY } from './packageAssetsData.js';

export async function applyPackageAssets(): Promise<void> {
  try {
    // Clear every cover first so removing a package from PACKAGE_COVERS also
    // removes its cover (keeps the set authoritative + tidy).
    await pool.query(`UPDATE packages SET cover_image_url = NULL`);
    for (const [pkgId, url] of Object.entries(PACKAGE_COVERS)) {
      await pool.query(`UPDATE packages SET cover_image_url = $2 WHERE id = $1`, [pkgId, url]);
    }
    // Authoritative: clear the Spa gallery first so an empty SPA_GALLERY
    // actually removes the photos, then re-insert whatever remains.
    await pool.query(`DELETE FROM package_inspiration WHERE package_id = 'spa'`);
    for (const url of SPA_GALLERY) {
      await pool.query(
        `INSERT INTO package_inspiration (package_id, image_url) VALUES ('spa', $1)`,
        [url],
      );
    }
    console.log(`[packages] covers applied for ${Object.keys(PACKAGE_COVERS).length} package(s)`);
  } catch (err) {
    console.error('[packages] assets apply failed (non-fatal):', err);
  }
}
