/**
 * Bulk-enrich the suppliers directory from Google Places (New) using our own
 * GOOGLE_MAPS_API_KEY. For every active supplier that still has no phone and
 * looks like a real company (not a person / generic / foreign online store), we
 * search Places by name and, ONLY IF the result's name clearly matches ours,
 * fill in the phone + emirate/area. Blanks only — never overwrites what's there,
 * and a weak name match is skipped so we never save a wrong number.
 *
 * Runs once (guarded) on a boot with RUN_MIGRATIONS_ON_BOOT=true; no-op without
 * the API key. Bump PLACES_ENRICH_TAG to run again.
 */
import { pool } from './pool.js';

// Names we never look up: people, generic buckets, banks/gov, foreign online.
const SKIP_RE = /\bgrocery\b|petrol|\btaxi\b|uber|bolt|careem|porter|part\s*timer|track delivery|external delivery|^drivers|other expense|salik|nol card|\brta\b|amer center|\bded\b|\bmofa\b|human resources|ministry|\bdet\b|zajel|rak bank|wio bank|ansari|emirates nbd|\btabby\b|\btamara\b|magnati|geidea|stripe|ziina|shein|temu|amazon|\bnoon\b|\bikea\b|etsy|instagram|snap chat|snapchat|namecheap|\bwix\b|quick book|shutter|handy customs|greet island|etisalat|dubizzle|talabat|mcdon|\bkfc\b|texas chicken|cinnabon|vox cinemas|life pharm|houston med|barq|\btoon\b/i;

// Generic tokens that don't identify the business (so we don't match on them).
const GENERIC = new Set([
  'llc', 'l.l.c', 'l.l.c.', 'fzco', 'fzc', 'fze', 'trading', 'trad', 'trdg', 'trd', 'traders',
  'general', 'gen', 'gen.', 'co', 'co.', 'company', 'the', 'and', '&', 'est', 'est.',
  'centre', 'center', 'store', 'shop', 'llc.', 'international', 'group', 'uae', 'dubai',
  'building', 'materials', 'services', 'service', 'trading.', 'l.l.c', 'sole', 'proprietorship',
]);

function tokens(name: string): string[] {
  return name.toLowerCase().replace(/[^a-z0-9؀-ۿ ]+/g, ' ').split(/\s+/).filter(Boolean);
}
/** The most distinctive word in a name (longest non-generic token). */
function distinctive(name: string): string | null {
  const t = tokens(name).filter((w) => w.length >= 4 && !GENERIC.has(w));
  if (!t.length) return null;
  return t.sort((a, b) => b.length - a.length)[0];
}
function looksLikeCompany(name: string): boolean {
  return /llc|l\.l\.c|fzco|fzc|fze|trading|trdg|\btrd\b|traders|general|company|\bco\b|centre|center|store|\bshop\b|flowers|flora|furniture|events?|printing|advertis|stationer|bakery|\bcake\b|dairy|insurance|\bgas\b|packaging|decoration|toys|games|cosmetics|electronics|textile|garments|fabric|building materials|maintenance|\bauto\b|kitchen|\bpack\b|\bmart\b|supermarket|hyper|pharmacy|clinic|studio|library|bookshop|est\b|enterprise|rental/i.test(name);
}
function emirateOf(addr: string): string {
  const a = addr.toLowerCase();
  if (/abu dhabi/.test(a)) return 'Abu Dhabi';
  if (/sharjah/.test(a)) return 'Sharjah';
  if (/ajman/.test(a)) return 'Ajman';
  if (/ras al khaimah|\brak\b/.test(a)) return 'Ras Al Khaimah';
  if (/fujairah/.test(a)) return 'Fujairah';
  if (/umm al quwain/.test(a)) return 'Umm Al Quwain';
  if (/dubai/.test(a)) return 'Dubai';
  return '';
}

export async function placesEnrichFromEnv(): Promise<void> {
  if (String(process.env.RUN_MIGRATIONS_ON_BOOT ?? '').toLowerCase() !== 'true') return;
  const tag = process.env.PLACES_ENRICH_TAG ?? 'v2';
  const guard = await pool.query(`SELECT 1 FROM app_kv WHERE k = $1`, [`places_enrich_${tag}`]).catch(() => ({ rowCount: 0 }));
  if (guard.rowCount) return;
  const key = process.env.GOOGLE_MAPS_API_KEY ?? '';
  if (!key) { console.log('[places] no GOOGLE_MAPS_API_KEY — skipping'); return; }

  const cap = Math.max(1, Math.min(200, Number(process.env.PLACES_ENRICH_MAX ?? 150)));
  const { rows } = await pool.query<{ id: string; name: string }>(
    `SELECT id, name FROM suppliers
      WHERE active AND COALESCE(btrim(phone),'') = '' AND COALESCE(btrim(name),'') <> ''
      ORDER BY name LIMIT $1`,
    [cap],
  );

  let filled = 0, skipped = 0, nomatch = 0, apiErr = 0;
  for (const s of rows) {
    const name = String(s.name).trim();
    if (SKIP_RE.test(name) || !looksLikeCompany(name)) { skipped++; continue; }
    const key1 = distinctive(name);
    if (!key1) { skipped++; continue; }
    try {
      const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': key,
          'X-Goog-FieldMask': 'places.displayName,places.formattedAddress,places.internationalPhoneNumber,places.nationalPhoneNumber',
        },
        body: JSON.stringify({ textQuery: `${name} UAE`, regionCode: 'AE', maxResultCount: 3 }),
      });
      if (!res.ok) { apiErr++; if (apiErr <= 3) console.warn(`[places] API ${res.status} for "${name}": ${(await res.text()).slice(0, 160)}`); continue; }
      const data = await res.json() as any;
      const places: any[] = data.places ?? [];
      // Accept the first result whose name contains our distinctive token.
      const hit = places.find((p) => {
        const dn = String(p.displayName?.text ?? '').toLowerCase();
        return dn.includes(key1);
      });
      if (!hit) { nomatch++; continue; }
      const phone = String(hit.internationalPhoneNumber ?? hit.nationalPhoneNumber ?? '').trim();
      if (!phone) { nomatch++; continue; }
      const addr = String(hit.formattedAddress ?? '');
      const emirate = emirateOf(addr);
      const r = await pool.query(
        `UPDATE suppliers
            SET phone = $2,
                location = COALESCE(NULLIF(btrim(location),''), NULLIF($3,''))
          WHERE id = $1 AND COALESCE(btrim(phone),'') = ''`,
        [s.id, phone, emirate],
      );
      if (r.rowCount) { filled++; console.log(`[places] ${name} → ${phone}${emirate ? ` · ${emirate}` : ''}`); }
    } catch (e) {
      apiErr++;
      if (apiErr <= 3) console.warn(`[places] fetch failed for "${name}": ${(e as Error).message}`);
    }
  }
  console.log(`[places] done: filled ${filled}, no-match ${nomatch}, skipped ${skipped}, api-errors ${apiErr} (scanned ${rows.length})`);
  await pool.query(`INSERT INTO app_kv (k, v) VALUES ($1, now()) ON CONFLICT (k) DO NOTHING`, [`places_enrich_${tag}`]).catch(() => {});
}
