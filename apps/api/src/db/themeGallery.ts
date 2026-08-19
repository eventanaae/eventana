/**
 * Applies real theme photos on boot (idempotent, non-fatal).
 *
 * Each theme's cover image and its inspiration gallery are set from real
 * setup photos uploaded to Cloudinary. Two themes the catalogue didn't have
 * yet (Ballerina, Power Puff Girls) are created here so their photos have a
 * home. Authoritative: it rewrites the gallery to match THEME_GALLERY, which
 * is the single source of truth for these images.
 */
import { pool } from './pool.js';
import { THEME_GALLERY } from './themeGalleryData.js';

/** Themes the original catalogue lacked — created so their photos can attach. */
const NEW_THEMES: Array<{
  id: string; name: string; tags: string[]; colors: string[]; gradient: string; sortOrder: number;
}> = [
  { id: 'ballerina', name: 'Ballerina', tags: ['Cute', 'Girls'], colors: ['#F9C6DC', '#FDE0EE', '#D9B8E8'], gradient: 'linear-gradient(135deg,#FDE0EE,#D9B8E8)', sortOrder: 41 },
  { id: 'powerpuff', name: 'Power Puff Girls', tags: ['Characters', 'Girls'], colors: ['#F06CA8', '#5BCFC5', '#7A8AC8'], gradient: 'linear-gradient(135deg,#F9C6DC,#BDEBE4)', sortOrder: 42 },
];

export async function applyThemeGallery(): Promise<void> {
  try {
    // Ensure the two extra themes exist before attaching their photos.
    for (const th of NEW_THEMES) {
      await pool.query(
        `INSERT INTO themes (id, name, tags, colors, gradient, popular, featured, active, celebration_type, sort_order)
         SELECT $1,$2,$3,$4,$5,false,false,true,'kids',$6
          WHERE NOT EXISTS (SELECT 1 FROM themes WHERE id = $1)`,
        [th.id, th.name, th.tags, th.colors, th.gradient, th.sortOrder],
      );
    }

    let applied = 0;
    for (const [themeId, urls] of Object.entries(THEME_GALLERY)) {
      if (!Array.isArray(urls) || urls.length === 0) continue;
      // Cover = first url (chosen as the most representative photo).
      await pool.query(`UPDATE themes SET cover_image_url = $2 WHERE id = $1`, [themeId, urls[0]]);
      // Rewrite the gallery to exactly match the source of truth.
      await pool.query(`DELETE FROM theme_inspiration WHERE theme_id = $1`, [themeId]);
      for (const url of urls) {
        await pool.query(
          `INSERT INTO theme_inspiration (theme_id, image_url) VALUES ($1,$2)`,
          [themeId, url],
        );
      }
      applied += 1;
    }
    console.log(`[themes] gallery applied for ${applied} theme(s)`);
  } catch (err) {
    console.error('[themes] gallery apply failed (non-fatal):', err);
  }
}
