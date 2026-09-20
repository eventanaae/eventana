/**
 * One-time import of the products/services that exist in QuickBooks but were
 * missing from the app catalogue (the catalogue is code-defined, not QB-derived —
 * see the "catalogue source" note). Pulls the live QuickBooks Item list, skips
 * duplicates of what we already have + accounting/non-product rows, and inserts
 * the rest into `services` (active, flat pricing, all celebration types, QB price;
 * zero-price items stay 0 so the owner can price them at order time).
 *
 * Runs once, guarded by app_kv 'qb_products_imported_v1'. Idempotent: it also
 * skips any name that already exists in `services`.
 */
import { pool } from './pool.js';

// QuickBooks Item names to SKIP: duplicates of items we already stock (under a
// slightly different name) + accounting / non-product / consumable / promo rows.
const SKIP = new Set([
  // duplicates of existing catalogue items
  'amwaj slide', 'bouncy castle', 'bubbles house', 'cake stand', 'balloon twisting',
  'foam machin', 'welcoming stand', 'acrobatic clown', 'acrobatic clown show', 'mascot',
  'mascot staff', 'character', 'chocolate fountain station', 'corn kiosk', 'ice cream kiosk',
  'live cotton candy', 'live popcorn', 'live hotdog', 'face painting services',
  'cupcake decorating session', 'spa party', 'drawing session', 'slimes session', 'tote bag session',
  // accounting / non-product / small consumables / promo offers
  'rent', 'dollars', 'number', 'hours', 'services', 'delivery charges', 'other accessories',
  'vase', 'post card', 'printed cups', 'party hat', 'table cover', 'bar table', 'chair',
  'wooden chairs', 'helium balloon', 'helium balloons - 12inch', 'helium balloons - 30 inch',
  '30 inch balloon', '24 hour offer', '2900 aed offer', '2999 offer',
].map((s) => s.toLowerCase()));

const CELEB = ['kids', 'graduation', 'bride', 'baby', 'gender', 'adult', 'customc'];

/** Best-effort category from the product name → one of our 9 category ids. */
function categoryFor(name: string): string {
  const n = name.toLowerCase();
  if (/(food|kiosk|bbq|cake|cupcake|lollipop|candy|sambosa|samosa|halwa|rqaq|indian|soft drink|hospitalit|corn|ice cream|chocolate|popcorn|hot ?dog|meal|bites|grazing|سمبوس|حار|dessert)/.test(n)) return 'food';
  if (/(slide|bouncy|castle|bubbles house|playground|soppy)/.test(n)) return 'inflatables';
  if (/(machine|machin|foam|snow)/.test(n)) return 'machines';
  if (/(session|coloring|colouring|pottery|slime|tote|flower|handcraft|canvas|painting|coloring)/.test(n)) return 'activities';
  if (/(clown|mascot|band|dukan|comedian|dance|henna|calligrapher|entertain|reality show|character|acrobat|traditional|performance|bakers|show)/.test(n)) return 'entertainment';
  if (/(giveaway|give aways|charms)/.test(n)) return 'giveaways';
  if (/(game|voting)/.test(n)) return 'games';
  if (/(backdrop|stand|decorat|set ?up|pakage|package|jalsa|areesh|afro|table|sofa|lantern|lenten|moon|christmas|wall|entrance|door|photo corner|red carpet|bicycle|cart|umbrella|centerpiece|rose|butterfly|يلسة|number)/.test(n)) return 'backdrop';
  return 'extras';
}

export async function importQbProductsOnce(): Promise<void> {
  const guard = await pool.query(`SELECT 1 FROM app_kv WHERE k = 'qb_products_imported_v1'`).catch(() => ({ rowCount: 0 }));
  if (guard.rowCount) return;

  const { quickbooksConfigured, listQbItems } = await import('../domain/quickbooks.js');
  if (!quickbooksConfigured()) { console.log('[qb-import] QuickBooks not configured — skipping.'); return; }

  let items: Array<{ name: string; price: number }>;
  try { items = await listQbItems(); }
  catch (e) { console.error('[qb-import] could not read QuickBooks items:', (e as Error).message); return; }

  const existing = new Set((await pool.query(`SELECT lower(name) n FROM services`)).rows.map((r: any) => r.n));
  let added = 0, skipped = 0;
  for (const it of items) {
    const name = (it.name || '').trim();
    if (!name) { skipped++; continue; }
    const low = name.toLowerCase();
    if (SKIP.has(low) || existing.has(low)) { skipped++; continue; }
    const priceFils = Math.max(0, Math.round(Number(it.price || 0) * 100));
    const cat = categoryFor(name);
    const id = `${low.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 36) || 'item'}-${Math.random().toString(36).slice(2, 6)}`;
    try {
      await pool.query(
        `INSERT INTO services (id, name, category_id, price_fils, pricing, celebration_types, active)
         VALUES ($1,$2,$3,$4,$5,$6,true) ON CONFLICT (id) DO NOTHING`,
        [id, name, cat, priceFils, JSON.stringify({ kind: 'flat' }), CELEB],
      );
      existing.add(low); added++;
    } catch (e) { console.error('[qb-import] insert failed for', name, (e as Error).message); }
  }
  await pool.query(`INSERT INTO app_kv (k, v) VALUES ('qb_products_imported_v1', now()) ON CONFLICT (k) DO UPDATE SET v = now()`).catch(() => {});
  console.log(`[qb-import] added ${added}, skipped ${skipped} (of ${items.length} QuickBooks items)`);
}
