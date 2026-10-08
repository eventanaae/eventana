/**
 * One-shot: upload the clean (car-free) Stitch/summer party photo to Cloudinary
 * and set it as the Summer package cover. The image bytes are embedded (base64)
 * because the server can't read the owner's desktop; it uploads them with the
 * server-side Cloudinary creds. Triggered by SET_SHAN_LEADER='summerimg' (reused
 * key — 300 env-var cap). Logs the hosted URL so it can be pinned into
 * packageAssetsData.ts PACKAGE_COVERS.summer (applyPackageAssets re-asserts
 * covers from that file on every boot, so the code is the source of truth).
 */
import { SUMMER_COVER_B64 } from './summerImageData.js';
import { uploadBytes, uploadsEnabled } from '../integrations/cloudinary.js';
import { pool } from './pool.js';

export async function uploadSummerCoverFromEnv(): Promise<void> {
  if (process.env.SET_SHAN_LEADER !== 'summerimg') return;
  if (!uploadsEnabled()) { console.log('[summer-cover] Cloudinary not configured — skipped'); return; }
  try {
    const bytes = Buffer.from(SUMMER_COVER_B64, 'base64');
    const url = await uploadBytes(new Uint8Array(bytes), 'eventana/themes', 'summer-stitch-clean');
    if (!url) { console.error('[summer-cover] upload FAILED (no URL returned)'); return; }
    // Set it now so it shows immediately this boot; code must also pin it (see note).
    await pool.query(`UPDATE packages SET cover_image_url = $1 WHERE id = 'summer'`, [url]).catch(() => {});
    console.log(`[summer-cover] DONE. Hosted URL = ${url}  <<< put this in packageAssetsData.ts PACKAGE_COVERS.summer, then blank SET_SHAN_LEADER.`);
  } catch (err) {
    console.error('[summer-cover] failed:', (err as Error).message);
  }
}
