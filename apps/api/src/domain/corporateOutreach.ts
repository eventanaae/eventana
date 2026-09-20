/**
 * Corporate / B2B outreach.
 *
 * Grows a directory of businesses (schools, universities, hospitals, clinics,
 * banks, government, companies, new shops) that book events from a budget, and
 * lets the team email them ahead of occasions — through the same approval flow
 * as consumer campaigns.
 *
 * Auto-collection uses the Google Places API (v1 Text Search): once a week it
 * asks Google for each category in each emirate, stores any NEW place (deduped
 * by Google place id), auto-categorises it, and tries to pull the official
 * published email from the business's own website. Everything is review-gated —
 * nothing is emailed without the owner approving a campaign.
 *
 * Gated by CORP_COLLECT (default 'on'); a no-op without a Google key or when the
 * Places API isn't enabled on the key (failed calls are logged, not fatal).
 */
import { pool } from '../db/pool.js';
import { config } from '../config.js';

export type CorpCategory =
  | 'school' | 'nursery' | 'university' | 'hospital' | 'clinic'
  | 'bank' | 'government' | 'company' | 'new_shop' | 'other';

export const CORP_CATEGORY_LABELS: Record<CorpCategory, string> = {
  school: 'Schools', nursery: 'Nurseries', university: 'Universities',
  hospital: 'Hospitals', clinic: 'Clinics', bank: 'Banks',
  government: 'Government', company: 'Companies', new_shop: 'New shops', other: 'Other',
};

const EMIRATES = ['Dubai', 'Abu Dhabi', 'Sharjah', 'Ajman', 'Ras Al Khaimah', 'Fujairah', 'Umm Al Quwain'];

/** What we ask Google for, and the category each search feeds. */
const SEARCH_TARGETS: Array<{ category: CorpCategory; term: string }> = [
  { category: 'school', term: 'schools' },
  { category: 'nursery', term: 'nurseries' },
  { category: 'university', term: 'universities and colleges' },
  { category: 'hospital', term: 'hospitals' },
  { category: 'clinic', term: 'medical clinics' },
  { category: 'bank', term: 'banks' },
  { category: 'government', term: 'government offices' },
];

/** Map Google Place `types` (and a name fallback) to our category. */
export function categorizeFromTypes(types: string[], name: string): CorpCategory {
  const t = new Set((types ?? []).map((x) => x.toLowerCase()));
  const n = (name ?? '').toLowerCase();
  if (t.has('university') || /universit|college|institute/.test(n)) return 'university';
  if (t.has('preschool') || /nursery|nurseries|kindergarten|kg|early learning/.test(n)) return 'nursery';
  if (t.has('primary_school') || t.has('secondary_school') || t.has('school') || /school|academy/.test(n)) return 'school';
  if (t.has('hospital') || /hospital|medical center|medical centre/.test(n)) return 'hospital';
  if (t.has('doctor') || t.has('dentist') || t.has('physiotherapist') || t.has('medical_lab') || /clinic|dental|polyclinic|health cent/.test(n)) return 'clinic';
  if (t.has('bank') || t.has('atm') || t.has('finance') || /\bbank\b/.test(n)) return 'bank';
  if (t.has('local_government_office') || t.has('city_hall') || t.has('courthouse') || t.has('embassy') || /municipalit|ministry|authority|government|council/.test(n)) return 'government';
  if (t.has('store') || t.has('shopping_mall') || t.has('clothing_store') || t.has('shop')) return 'new_shop';
  return 'company';
}

interface PlaceLite {
  id: string;
  name: string;
  website: string | null;
  phone: string | null;
  types: string[];
  address: string | null;
}

/** One page of a Google Places v1 Text Search. Returns [] on any failure. */
async function placesSearchPage(
  textQuery: string,
  pageToken?: string,
): Promise<{ places: PlaceLite[]; nextPageToken: string | null }> {
  const key = config.googleMapsApiKey;
  if (!key) return { places: [], nextPageToken: null };
  try {
    const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'X-Goog-Api-Key': key,
        'X-Goog-FieldMask':
          'places.id,places.displayName,places.websiteUri,places.internationalPhoneNumber,places.types,places.formattedAddress,nextPageToken',
      },
      body: JSON.stringify({ textQuery, regionCode: 'AE', maxResultCount: 20, ...(pageToken ? { pageToken } : {}) }),
    });
    if (!res.ok) {
      console.error(`[corp-collect] places "${textQuery}" → ${res.status}: ${(await res.text()).slice(0, 160)}`);
      return { places: [], nextPageToken: null };
    }
    const json = (await res.json()) as any;
    const places: PlaceLite[] = (json.places ?? []).map((p: any) => ({
      id: String(p.id),
      name: p.displayName?.text ?? '',
      website: p.websiteUri ?? null,
      phone: p.internationalPhoneNumber ?? null,
      types: p.types ?? [],
      address: p.formattedAddress ?? null,
    }));
    return { places, nextPageToken: json.nextPageToken ?? null };
  } catch (err) {
    console.error(`[corp-collect] places "${textQuery}" failed:`, (err as Error).message);
    return { places: [], nextPageToken: null };
  }
}

/** Pull the official published email from a business website (homepage). */
async function emailFromWebsite(url: string): Promise<string | null> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(url, { signal: ctrl.signal, redirect: 'follow', headers: { 'user-agent': 'Mozilla/5.0 EventanaBot' } }).catch(() => null);
    clearTimeout(timer);
    if (!res || !res.ok) return null;
    const html = (await res.text()).slice(0, 400_000);
    // Prefer an explicit mailto:, else any address in the page.
    const mailto = html.match(/mailto:([a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,})/i);
    const found = mailto?.[1] ?? html.match(/[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}/i)?.[0] ?? null;
    if (!found) return null;
    const e = found.toLowerCase();
    // Drop obvious non-contact/junk addresses.
    if (/\.(png|jpg|jpeg|gif|webp|svg)$/i.test(e)) return null;
    if (/(example|sentry|wixpress|\.wix|godaddy|domain|yourdomain|email@|test@|no-?reply)/i.test(e)) return null;
    return e;
  } catch {
    return null;
  }
}

/** True if a place looks like a UAE business worth keeping (has a phone or site). */
function keepable(p: PlaceLite): boolean {
  return Boolean(p.name && (p.website || p.phone));
}

/**
 * Run a collection pass: discover businesses via Places (all categories × all
 * emirates, paginated), insert NEW ones (deduped by place id), then enrich a
 * bounded batch of leads that still lack an email from their website.
 * `maxPagesPerQuery` caps cost/time (1 page = 20 results, 3 = up to 60).
 */
export async function collectCorporateLeads(opts?: { maxPagesPerQuery?: number; maxEnrich?: number }): Promise<{
  discovered: number; added: number; enriched: number;
}> {
  if (!config.googleMapsApiKey) return { discovered: 0, added: 0, enriched: 0 };
  const maxPages = Math.max(0, Math.min(3, opts?.maxPagesPerQuery ?? 2));
  const maxEnrich = Math.max(0, Math.min(120, opts?.maxEnrich ?? 50));
  let discovered = 0;
  let added = 0;

  for (const target of SEARCH_TARGETS) {
    for (const emirate of EMIRATES) {
      let pageToken: string | undefined;
      for (let page = 0; page < maxPages; page++) {
        const { places, nextPageToken } = await placesSearchPage(`${target.term} in ${emirate}, UAE`, pageToken);
        for (const p of places) {
          discovered++;
          if (!keepable(p)) continue;
          const category = categorizeFromTypes(p.types, p.name);
          // Insert new; dedupe on the Google place id. Existing rows are left alone.
          const ins = await pool.query(
            `INSERT INTO corporate_leads (name, category, phone, website, emirate, source, external_id)
             VALUES ($1,$2,$3,$4,$5,'places',$6)
             ON CONFLICT (external_id) DO NOTHING`,
            [p.name.slice(0, 200), category, p.phone, p.website, emirate, p.id],
          );
          if (ins.rowCount) added++;
        }
        if (!nextPageToken) break;
        pageToken = nextPageToken;
        // Google requires a short delay before a page token becomes valid.
        await new Promise((r) => setTimeout(r, 2200));
      }
    }
  }

  // Enrichment: pull emails for leads that have a website but no email yet.
  const { rows: toEnrich } = await pool.query<{ id: string; website: string }>(
    `SELECT id, website FROM corporate_leads
      WHERE website IS NOT NULL AND website <> ''
        AND (email IS NULL OR email = '')
        AND enriched_at IS NULL
      ORDER BY created_at DESC LIMIT ${maxEnrich}`,
  );
  let enriched = 0;
  for (const l of toEnrich) {
    const email = await emailFromWebsite(l.website);
    // Stamp enriched_at either way so we don't retry a site that has no email.
    if (email) {
      // Skip if another lead already owns this email (unique index).
      await pool.query(
        `UPDATE corporate_leads SET email = $2, enriched_at = now(), updated_at = now()
          WHERE id = $1 AND NOT EXISTS (SELECT 1 FROM corporate_leads x WHERE lower(x.email) = lower($2))`,
        [l.id, email],
      ).catch(() => {});
      enriched++;
    }
    await pool.query(`UPDATE corporate_leads SET enriched_at = now() WHERE id = $1 AND enriched_at IS NULL`, [l.id]).catch(() => {});
    await new Promise((r) => setTimeout(r, 150));
  }

  console.log(`[corp-collect] discovered ${discovered}, added ${added}, enriched ${enriched}`);
  return { discovered, added, enriched };
}

/**
 * Weekly auto-collection from the periodic sweep. Runs at most once per ~6.5
 * days (guarded by the newest places-sourced lead). Gated by CORP_COLLECT and a
 * Google key. Discovery-only cost is small; enrichment is free (website reads).
 */
export async function sweepCorporateCollect(): Promise<number> {
  if (String(process.env.CORP_COLLECT ?? 'on').toLowerCase() === 'off') return 0;
  if (!config.googleMapsApiKey) return 0;
  const recent = await pool.query(
    `SELECT 1 FROM corporate_leads WHERE source = 'places' AND created_at > now() - interval '6 days' LIMIT 1`,
  );
  // If we collected within the last 6 days, only run the (free) enrichment pass,
  // never a fresh paid discovery. A brand-new table (no places rows) runs full.
  const anyPlaces = await pool.query(`SELECT 1 FROM corporate_leads WHERE source = 'places' LIMIT 1`);
  if (recent.rowCount && anyPlaces.rowCount) {
    const { enriched } = await collectCorporateLeads({ maxPagesPerQuery: 0, maxEnrich: 50 }).catch(() => ({ enriched: 0 }));
    return enriched;
  }
  const { added } = await collectCorporateLeads({ maxPagesPerQuery: 2, maxEnrich: 60 });
  return added;
}

/** WHERE clause for an emailable corporate segment ('all' or a category). */
export function corporateAudienceWhere(segment: string): string {
  const base = `email IS NOT NULL AND email <> '' AND email_opt_out = FALSE AND status <> 'not_interested'`;
  const cat = segment.replace(/^corp:/, '');
  if (cat && cat !== 'all' && cat in CORP_CATEGORY_LABELS) {
    return `${base} AND category = '${cat}'`;
  }
  return base;
}

/** Counts for the dashboard: total per category, plus emailable / opted-out. */
export async function corporateCounts(): Promise<{
  byCategory: Record<string, { total: number; emailable: number }>;
  total: number; emailable: number; optedOut: number;
}> {
  const { rows } = await pool.query<{ category: string; total: string; emailable: string }>(
    `SELECT category,
            count(*)::int AS total,
            count(*) FILTER (WHERE email IS NOT NULL AND email <> '' AND email_opt_out = FALSE AND status <> 'not_interested')::int AS emailable
       FROM corporate_leads GROUP BY category`,
  );
  const byCategory: Record<string, { total: number; emailable: number }> = {};
  let total = 0, emailable = 0;
  for (const r of rows) {
    byCategory[r.category] = { total: Number(r.total), emailable: Number(r.emailable) };
    total += Number(r.total);
    emailable += Number(r.emailable);
  }
  const opt = await pool.query<{ n: string }>(`SELECT count(*)::int n FROM corporate_leads WHERE email_opt_out = TRUE`);
  return { byCategory, total, emailable, optedOut: Number(opt.rows[0].n) };
}
