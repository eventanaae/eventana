/**
 * Auto-enrich the vendors directory with real contact info found on Google
 * (phone, email, emirate, area, and a 2-3 word "what they provide"). Shops &
 * companies only — individuals are skipped. Applied in batches; each batch has
 * its own app_kv guard (enrich_vendors_vN) so adding a batch never re-touches an
 * earlier one. Idempotent, and only fills blanks (COALESCE/NULLIF).
 */
import { pool } from './pool.js';

type Enrich = { names: string[]; phone?: string; email?: string; provides?: string; emirate?: string; area?: string };

// Batch 1 (verified via Google, 2026-09-21).
const BATCH1: Enrich[] = [
  { names: ['eon print solutions', 'eon print solutions llc'], phone: '+971 4 321 4422', email: 'infodxb@eonprint.co', provides: 'Printing & signage', emirate: 'Dubai', area: 'Al Quoz' },
  { names: ['black tulip flowers llc', 'black tulip flowers l.l.c'], phone: '+971 56 414 2431', email: 'trade@btfgroup.com', provides: 'Flowers', emirate: 'Dubai', area: 'Al Qusais' },
  { names: ['hot pack packaging llc', 'hotpack packaging llc'], phone: '+971 4 805 1888', email: 'marketing@hotpackuae.com', provides: 'Food packaging', emirate: 'Dubai', area: 'Dubai Investment Park' },
  { names: ['al qadah trading llc', 'al qadah trading co llc', 'al qadah trading co. llc'], phone: '+971 4 225 8877', email: '', provides: 'Party supplies', emirate: 'Dubai' },
  { names: ['vases flower trading fzco'], phone: '', email: '', provides: 'Vases & décor', emirate: 'Dubai', area: 'Dragon Mart' },
  { names: ['miz company', 'miz shop fittings trading l.l.c', 'miz shop fittings trading llc'], phone: '+971 50 218 9663', email: 'info@mizco.ae', provides: 'Popcorn/cotton-candy machines', emirate: 'Dubai', area: 'Deira' },
  { names: ['blue rhine general trading llc'], phone: '+971 4 885 7599', email: 'dercrm@bluerhine.com', provides: 'Signage & forex boards', emirate: 'Dubai', area: 'Dubai Investment Park' },
];

// Batch 2 (verified via Google, 2026-09-21). Names are the FINAL supplier names
// (lower-cased) as reconciled in supplierMapping.ts.
const BATCH2: Enrich[] = [
  { names: ['air products emirates gas llc'], phone: '+971 4 883 5578', email: '', provides: 'Helium & gases', emirate: 'Dubai', area: 'Jebel Ali' },
  { names: ['party time trading l.l.c.', 'party time trading llc'], phone: '+971 50 427 8103', email: '', provides: 'Balloons & party supplies', emirate: 'Dubai', area: 'Deira (Al Ras)' },
  { names: ['grace kitchen equipment fzco'], phone: '+971 4 368 8066', email: '', provides: 'Kitchen equipment', emirate: 'Dubai', area: 'Dragon Mart' },
  { names: ['prolatex gifts', 'pro latex gifts llc'], phone: '', email: '', provides: 'Latex balloons (Sempertex)', emirate: 'Sharjah' },
  { names: ['foam decoration llc'], phone: '+971 50 118 4878', email: '', provides: 'Foam & styrofoam décor', emirate: 'Ajman', area: 'Al Jurf' },
  { names: ['balloons co llc'], phone: '', email: '', provides: 'Balloons & décor', emirate: 'Abu Dhabi' },
];

// Batch 3 (verified via Google, 2026-09-21). Flagged/uncertain vendors (Al Yafi,
// Rose Advertising, Quatro, Cake Land, Sharifco, Sweet Intl, Promenade, KDD) were
// deliberately left out — no reliable source or a name clash.
const BATCH3: Enrich[] = [
  { names: ['reem flora'], phone: '+971 4 557 2579', email: 'sales@reemflora.com', provides: 'Flowers', emirate: 'Dubai', area: 'Al Quoz' },
  { names: ['royal armani flowers'], phone: '+971 50 900 3663', email: 'royalarmaniflowers@gmail.com', provides: 'Flowers', emirate: 'Dubai', area: 'Al Barsha' },
  { names: ['yatai flowers fze', 'yatai flowers fzco'], phone: '+971 4 440 4859', provides: 'Artificial flowers & décor', emirate: 'Dubai', area: 'Dragon Mart' },
  { names: ['ali hashel gar. & textiles tr. l.l.c'], phone: '+971 6 747 5203', provides: 'Fabric & textiles', emirate: 'Ajman', area: 'Nakheel' },
  { names: ['adventure sign & printing'], phone: '+971 54 490 9185', provides: 'Signage & printing', emirate: 'Dubai', area: 'Deira (Naif)' },
  { names: ['desco copy centre llc'], phone: '+971 4 372 4722', email: 'dsohq@descoonline.com', provides: 'Copy & print', emirate: 'Dubai' },
  { names: ['creative minds gen'], phone: '+971 4 323 7180', provides: 'Party supplies', emirate: 'Dubai', area: 'Al Barsha' },
  { names: ['al ezdihar gifts trading fzco'], phone: '+971 55 875 7226', provides: 'Décor & gifts', emirate: 'Dubai', area: 'Dragon Mart' },
  { names: ['nur jahan toys & games trading llc'], phone: '+971 4 514 5645', provides: 'Toys & games', emirate: 'Dubai', area: 'Dragon Mart' },
  { names: ['galb al gamar games trading fzco'], phone: '+971 55 181 4881', provides: 'Toys & games', emirate: 'Dubai', area: 'Dragon Mart' },
  { names: ['jaleel traders llc'], phone: '+971 4 347 8078', provides: 'Foodstuff wholesale', emirate: 'Dubai', area: 'Ras Al Khor' },
  { names: ['al juddur furniture trading fzco'], phone: '+971 55 836 4216', provides: 'Furniture', emirate: 'Dubai', area: 'Dragon Mart' },
  { names: ['mint gulf furniture rental llc'], phone: '+971 4 347 4340', email: 'sales@minteventrentals.com', provides: 'Event furniture rental', emirate: 'Dubai', area: 'Al Quoz' },
  { names: ['moments rentals (best moments events llc)'], phone: '+971 4 824 2221', email: 'partners@moments-events.ae', provides: 'Event rentals', emirate: 'Dubai' },
  { names: ['little bears events'], phone: '+971 58 162 3074', provides: 'Kids party rentals', emirate: 'Dubai', area: 'DIP' },
  { names: ['teddy events'], phone: '+971 50 418 0640', email: 'hello@teddy.ae', provides: 'Party equipment rental', emirate: 'Dubai', area: 'Tecom' },
  { names: ['la crema cocoa and chocolate manufacturing llc'], phone: '+971 4 266 3355', email: 'info@lacrema.ae', provides: 'Chocolate & cocoa', emirate: 'Dubai', area: 'Ras Al Khor' },
  { names: ['oasis ice cream llc'], phone: '+971 50 150 5576', email: 'ashley@oasisicecream.ae', provides: 'Ice cream', emirate: 'Dubai' },
  { names: ['swaidan trading co. llc'], phone: '+971 4 347 9000', provides: 'Peugeot service', emirate: 'Dubai', area: 'Sheikh Zayed Road' },
  { names: ['badraa auto mechanical l.l.c'], provides: 'Auto repair', emirate: 'Dubai', area: 'Ras Al Khor' },
  { names: ['resin art world general trading llc'], phone: '+971 54 471 8471', email: 'info@resinartworld.ae', provides: 'Resin & art supplies', emirate: 'Dubai', area: 'Barsha Heights' },
  { names: ['beauty lovers cosmetics trading fzco'], phone: '+971 58 565 6788', provides: 'Cosmetics', emirate: 'Dubai', area: 'Dragon Mart' },
  { names: ['kalon technology trading fzco'], phone: '+971 56 997 0155', provides: 'Electronics', emirate: 'Dubai', area: 'Dragon Mart' },
  { names: ['adventure hq llc'], phone: '800 23847', provides: 'Adventure gear', emirate: 'Dubai', area: 'Al Quoz' },
  { names: ['pan emirates'], phone: '+971 2 621 1030', email: 'care@panhomestores.com', provides: 'Home furniture', emirate: 'UAE' },
  { names: ['sukoon insurance'], phone: '800 785666', email: 'service@sukoon.com', provides: 'Insurance', emirate: 'Dubai', area: 'Deira' },
  { names: ['gravitas international llc'], phone: '+971 4 340 8181', provides: 'Balloons wholesale', emirate: 'Dubai', area: 'Al Quoz' },
  { names: ['party center'], phone: '+971 4 283 1353', email: 'info@mypartycentre.com', provides: 'Party supplies', emirate: 'Dubai', area: 'Al Garhoud' },
  { names: ['picture square studio'], phone: '+971 50 495 7798', provides: 'Photo studio & printing', emirate: 'Dubai', area: 'Al Barsha' },
  { names: ['halwan stationery'], phone: '+971 6 566 4396', provides: 'Stationery', emirate: 'Sharjah' },
  { names: ["women's world textile"], provides: 'Fabric', emirate: 'Dubai', area: 'Al Barsha' },
];

async function applyBatch(batch: Enrich[], guardKey: string, label: string): Promise<void> {
  const guard = await pool.query(`SELECT 1 FROM app_kv WHERE k = $1`, [guardKey]).catch(() => ({ rowCount: 0 }));
  if (guard.rowCount) return;
  let n = 0;
  for (const e of batch) {
    const loc = [e.emirate, e.area].filter(Boolean).join(' · ');
    const r = await pool.query(
      `UPDATE suppliers SET
         phone = COALESCE(NULLIF($2,''), phone),
         email = COALESCE(NULLIF($3,''), email),
         supplies = COALESCE(NULLIF($4,''), supplies),
         location = COALESCE(NULLIF($5,''), location)
       WHERE lower(btrim(name)) = ANY($1::text[])`,
      [e.names, e.phone ?? '', e.email ?? '', e.provides ?? '', loc],
    );
    if (r.rowCount) n += r.rowCount;
    else {
      await pool.query(
        `INSERT INTO suppliers (name, phone, email, supplies, location, active, created_by)
         VALUES (initcap($1), NULLIF($2,''), NULLIF($3,''), NULLIF($4,''), NULLIF($5,''), true, 'Google enrich')`,
        [e.names[0], e.phone ?? '', e.email ?? '', e.provides ?? '', loc],
      );
      n++;
    }
  }
  console.log(`[enrich] enriched/added ${n} vendors (${label})`);
  await pool.query(`INSERT INTO app_kv (k, v) VALUES ($1, now()) ON CONFLICT (k) DO NOTHING`, [guardKey]).catch(() => {});
}

export async function enrichVendorsFromEnv(): Promise<void> {
  if (String(process.env.RUN_MIGRATIONS_ON_BOOT ?? '').toLowerCase() !== 'true') return;
  await applyBatch(BATCH1, 'enrich_vendors_v1', 'batch 1');
  await applyBatch(BATCH2, 'enrich_vendors_v2', 'batch 2');
  await applyBatch(BATCH3, 'enrich_vendors_v3', 'batch 3');
}
