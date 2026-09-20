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

/** An email that belongs to procurement / purchasing / tenders / suppliers. */
const PROC_RE = /(procure|purchas|tender|supply|vendor|contract)/i;

/** Fetch one page's HTML (short timeout, best-effort). */
async function fetchHtml(url: string): Promise<string | null> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(url, { signal: ctrl.signal, redirect: 'follow', headers: { 'user-agent': 'Mozilla/5.0 EventanaBot' } }).catch(() => null);
    clearTimeout(timer);
    if (!res || !res.ok) return null;
    return (await res.text()).slice(0, 400_000);
  } catch {
    return null;
  }
}

/** All plausible contact emails in a page (mailto first), junk filtered. */
function pickEmails(html: string): string[] {
  const set = new Set<string>();
  for (const m of html.matchAll(/mailto:([a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,})/gi)) set.add(m[1].toLowerCase());
  for (const m of html.matchAll(/[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}/gi)) set.add(m[0].toLowerCase());
  return [...set].filter(
    (e) => !/\.(png|jpg|jpeg|gif|webp|svg)$/i.test(e) &&
      !/(example|sentry|wixpress|\.wix|godaddy|domain|yourdomain|email@|test@|no-?reply|\.io$)/i.test(e),
  );
}

/**
 * Find a business's published emails from its website — homepage plus a few
 * likely pages (contact, procurement, suppliers, tenders). Returns the best
 * PROCUREMENT email (preferred — they book with a budget) and a general one.
 */
async function findEmails(site: string): Promise<{ general: string | null; procurement: string | null }> {
  const base = site.replace(/\/$/, '');
  const pages = [site, `${base}/contact`, `${base}/contact-us`, `${base}/procurement`, `${base}/suppliers`, `${base}/tenders`];
  const all = new Set<string>();
  for (const p of pages) {
    const html = await fetchHtml(p);
    if (html) pickEmails(html).forEach((e) => all.add(e));
    // Stop early once we already have a procurement address.
    if ([...all].some((e) => PROC_RE.test(e))) break;
  }
  const arr = [...all];
  const procurement = arr.find((e) => PROC_RE.test(e)) ?? null;
  const general = arr.find((e) => /^(info|contact|hello|admin|reception|enquir|marketing)/i.test(e)) ?? arr[0] ?? null;
  return { general, procurement };
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
export async function collectCorporateLeads(opts?: { maxPagesPerQuery?: number; maxEnrich?: number; discover?: Array<{ category: CorpCategory; term: string }> }): Promise<{
  discovered: number; added: number; enriched: number;
}> {
  if (!config.googleMapsApiKey) return { discovered: 0, added: 0, enriched: 0 };
  const maxPages = Math.max(0, Math.min(3, opts?.maxPagesPerQuery ?? 2));
  const maxEnrich = Math.max(0, Math.min(150, opts?.maxEnrich ?? 60));
  const targets = opts?.discover ?? SEARCH_TARGETS;
  let discovered = 0;
  let added = 0;

  for (const target of targets) {
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
             ON CONFLICT (external_id) WHERE external_id IS NOT NULL DO NOTHING`,
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

  // Email + procurement pass: for leads with a website not yet checked, read their
  // site and prefer a PROCUREMENT email (they book with a budget), else a general
  // one. Progressive — a bounded batch per run — so it steadily upgrades the list.
  const { rows: toEnrich } = await pool.query<{ id: string; website: string; email: string | null }>(
    `SELECT id, website, email FROM corporate_leads
      WHERE website IS NOT NULL AND website <> ''
        AND (procurement_checked = FALSE OR procurement_checked IS NULL)
      ORDER BY (email IS NULL OR email = '') DESC, created_at DESC LIMIT ${maxEnrich}`,
  );
  let enriched = 0;
  for (const l of toEnrich) {
    const { general, procurement } = await findEmails(l.website);
    // Procurement wins (even over an existing general email); else fill if empty.
    const chosen = procurement ?? (!l.email ? general : null);
    if (chosen) {
      await pool.query(
        `UPDATE corporate_leads
            SET email = $2,
                contact_name = CASE WHEN $3 THEN 'Procurement' ELSE contact_name END,
                enriched_at = now(), updated_at = now()
          WHERE id = $1 AND NOT EXISTS (SELECT 1 FROM corporate_leads x WHERE x.id <> $1 AND lower(x.email) = lower($2))`,
        [l.id, chosen, Boolean(procurement)],
      ).catch(() => {});
      enriched++;
    }
    // Mark checked so we don't refetch this site every day.
    await pool.query(`UPDATE corporate_leads SET procurement_checked = TRUE, enriched_at = COALESCE(enriched_at, now()) WHERE id = $1`, [l.id]).catch(() => {});
    await new Promise((r) => setTimeout(r, 150));
  }

  // New rule: email is mandatory. Drop auto-collected businesses that can never
  // be emailed — no website at all, or a site we already checked with no email.
  await pool.query(
    `DELETE FROM corporate_leads
      WHERE source = 'places' AND (email IS NULL OR email = '')
        AND ((website IS NULL OR website = '') OR procurement_checked = TRUE)`,
  ).catch(() => {});

  console.log(`[corp-collect] discovered ${discovered}, added ${added}, enriched ${enriched}`);
  return { discovered, added, enriched };
}

/** Wipe the whole corporate directory and let collection start fresh. */
export async function resetCorporateLeads(): Promise<number> {
  const r = await pool.query(`DELETE FROM corporate_leads`);
  await pool.query(`DELETE FROM app_kv WHERE k = 'corp_collect_at'`).catch(() => {});
  return r.rowCount ?? 0;
}

/**
 * DAILY auto-collection from the periodic sweep (runs at most once per ~20h,
 * guarded by app_kv). To keep the paid Places cost low it rotates: the FIRST ever
 * run does a full discovery, then each day discovers a small rotating slice of
 * categories (full coverage every few days) while the free email/procurement
 * enrichment runs every day. Gated by CORP_COLLECT + a Google key.
 */
export async function sweepCorporateCollect(): Promise<number> {
  if (String(process.env.CORP_COLLECT ?? 'on').toLowerCase() === 'off') return 0;
  if (!config.googleMapsApiKey) return 0;
  // Once-per-day guard.
  const last = await pool.query<{ v: string }>(`SELECT v FROM app_kv WHERE k = 'corp_collect_at'`).catch(() => ({ rows: [] as { v: string }[] }));
  const lastAt = last.rows[0]?.v ? new Date(last.rows[0].v).getTime() : 0;
  if (Date.now() - lastAt < 20 * 3600 * 1000) return 0;

  const anyPlaces = await pool.query(`SELECT 1 FROM corporate_leads WHERE source = 'places' LIMIT 1`).catch(() => ({ rowCount: 0 }));
  let discover: Array<{ category: CorpCategory; term: string }>;
  if (!anyPlaces.rowCount) {
    discover = SEARCH_TARGETS; // first run ever — pull everything
  } else {
    // Rotate ~2 categories per day so the whole set is refreshed every few days.
    const day = Math.floor(Date.now() / 86_400_000);
    const n = SEARCH_TARGETS.length;
    const i = (day * 2) % n;
    discover = [SEARCH_TARGETS[i], SEARCH_TARGETS[(i + 1) % n]];
  }
  const res = await collectCorporateLeads({ maxPagesPerQuery: anyPlaces.rowCount ? 1 : 2, maxEnrich: 60, discover }).catch(() => ({ added: 0, enriched: 0 }));
  await pool.query(`INSERT INTO app_kv (k, v) VALUES ('corp_collect_at', now()) ON CONFLICT (k) DO UPDATE SET v = now()`).catch(() => {});
  return (res.added ?? 0) + (res.enriched ?? 0);
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
