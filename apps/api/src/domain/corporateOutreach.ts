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
import { sendEmail, renderCampaignHtml } from '../integrations/email.js';

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
  const pages = [
    site, `${base}/contact`, `${base}/contact-us`, `${base}/contactus`,
    `${base}/procurement`, `${base}/suppliers`, `${base}/supplier-registration`,
    `${base}/tenders`, `${base}/tender`, `${base}/vendors`, `${base}/vendor-registration`,
    `${base}/rfp`, `${base}/work-with-us`, `${base}/about-us`, `${base}/about`,
  ];
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
  const maxEnrich = Math.max(0, Math.min(300, opts?.maxEnrich ?? 60));
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
  const res = await collectCorporateLeads({ maxPagesPerQuery: anyPlaces.rowCount ? 1 : 2, maxEnrich: 220, discover }).catch(() => ({ added: 0, enriched: 0 }));
  await pool.query(`INSERT INTO app_kv (k, v) VALUES ('corp_collect_at', now()) ON CONFLICT (k) DO UPDATE SET v = now()`).catch(() => {});
  return (res.added ?? 0) + (res.enriched ?? 0);
}

// ── B2B outreach sequence: auto first-touch + follow-up + reply detection ──

// "Pop-up activation" — the owner's term: a pop-up stand for a product,
// giveaways/distributions, or a special staff perk. Kept broad, not food-only.
/** A tailored pitch per business type — subject, the services that sector cares
 *  about, and the real occasions it celebrates. Owner-authored, polished. */
const CORP_PITCH: Record<CorpCategory, { subject: string; services: string[]; occasions: string }> = {
  school: {
    subject: 'Unforgettable celebrations for your school ✨',
    services: [
      '🎓 Graduation & prize-day staging, backdrops and balloon décor',
      '🎨 Creative workshops for teachers & students — art, flowers and more',
      '✨ Interactive pop-up booths and light-bite corners',
      '📸 A branded photo booth to capture the day',
    ],
    occasions: 'graduations, Teachers’ Day, National Day & Flag Day, and recognition ceremonies',
  },
  nursery: {
    subject: 'Little moments, magically done 🎈',
    services: [
      '🎈 Full themed décor and balloon styling for little ones',
      '🎪 Games, entertainers and interactive activity stations',
      '🎨 Craft workshops — flower arranging, art and pottery',
      '✨ Pop-up booths, light bites and a photo corner for parents',
    ],
    occasions: 'KG graduations, Teachers’ Day, National Day & Flag Day, the first day of school, and parents’ meetings',
  },
  university: {
    subject: 'Events students will never forget 🎓',
    services: [
      '🎨 Themed décor and styling with balloon installations',
      '🎓 Interactive workshops and activities for students',
      '✨ Pop-up booths, live experiences and light-bite corners',
      '📸 A branded photo booth and content moments',
    ],
    occasions: 'graduation ceremonies, Teachers’ Day, National Day & Flag Day, and summer & orientation events',
  },
  hospital: {
    subject: 'Moments your team & patients will treasure 💛',
    services: [
      '💛 Staff & nurses’ appreciation events, beautifully done',
      '🌸 Relaxing creative workshops — flowers, pottery and art',
      '✨ Pop-up booths and healthy-food corners',
      '🎁 Custom-designed, branded giveaways',
    ],
    occasions: 'National Day & Flag Day, International & Emirati Women’s Day, awareness days (breast cancer, diabetes and more), and staff celebrations',
  },
  clinic: {
    subject: 'Warm celebrations for your clinic 💐',
    services: [
      '💛 Staff & patient appreciation events',
      '🌸 Relaxing creative workshops — flowers, pottery and art',
      '✨ Pop-up booths and healthy-food corners',
      '🎁 Custom-designed, branded giveaways',
    ],
    occasions: 'National Day & Flag Day, International & Emirati Women’s Day, awareness days (breast cancer, diabetes and more), and staff celebrations',
  },
  bank: {
    subject: 'Celebrations your people will love 🎉',
    services: [
      '✨ Interactive pop-up booths — live experiences or branded food',
      '🌸 Engaging workshops for your staff or customers',
      '🎨 Standout branded décor and styling',
      '🏆 Full milestone-event management, concept to teardown',
    ],
    occasions: 'Family Day, employee engagement & recognition celebrations, National Day, Flag Day & Women’s Day, and Eid & Christmas',
  },
  government: {
    subject: 'Celebrations done to the right standard 🇦🇪',
    services: [
      '✨ Interactive pop-up booths — live experiences or branded food',
      '🌸 Engaging workshops for your staff or customers',
      '🎨 Standout branded décor and styling',
      '🏆 Full milestone-event management, concept to teardown',
    ],
    occasions: 'Family Day, employee engagement & recognition celebrations, National Day, Flag Day & Women’s Day, and Eid & the International Day of Happiness',
  },
  company: {
    subject: 'Bring your team together — beautifully 🎉',
    services: [
      '✨ Interactive pop-up booths — live experiences or branded food',
      '🌸 Engaging workshops for your staff or customers',
      '🎨 Standout branded décor and styling',
      '🏆 Full milestone-event management, concept to teardown',
    ],
    occasions: 'Family Day, employee engagement & recognition celebrations, National Day, Flag Day & Women’s Day, and Eid & the International Day of Happiness',
  },
  new_shop: {
    subject: 'Make your grand opening unforgettable 🎊',
    services: [
      '✂️ Grand-opening décor, staging and ribbon cutting',
      '🎈 Launch-day activations and balloon installations',
      '✨ Interactive pop-up booths and light-bite corners',
      '🌸 Creative workshops — flower arranging and pottery painting',
    ],
    occasions: '',
  },
  other: {
    subject: 'Celebrations, beautifully done ✨',
    services: [
      '🎨 Complete themed décor and styling',
      '🌸 Creative workshops — flower arranging, pottery and art',
      '✨ Interactive pop-up booths — live experiences or branded food',
      '📸 A branded photo booth to capture the day',
    ],
    occasions: 'National Day, Flag Day, Ramadan iftars, Eid & Women’s Day, and every occasion',
  },
};

/** The tailored FIRST email to a newly-collected company — SHORT and scannable
 *  (cold outreach): warm one-liner + sector intro + ask for the right contact +
 *  a small glimpse of services + one branded line + a warm close. */
export function buildFirstTouchBody(category: CorpCategory): string {
  const p = CORP_PITCH[category] ?? CORP_PITCH.other;
  const sector = (CORP_CATEGORY_LABELS[category] ?? 'organisation').toLowerCase().replace(/s$/, '');
  // Services as coloured "chips" (a table row each) so the eye scans them fast —
  // far more dynamic than a plain bullet list. Email-safe (tables + inline).
  const serviceRows = p.services.map((x) => `
    <tr><td style="padding:10px 14px;background:#FBF1F7;border-radius:12px;font-size:14px;font-weight:600;color:#3B3641;border-left:4px solid #F06CA8">${x}</td></tr>
    <tr><td style="height:8px;line-height:8px;font-size:0">&nbsp;</td></tr>`).join('');
  // Solid colour FIRST, gradient layered on top — Outlook keeps the solid so the
  // white hero text is never invisible.
  const hero = `
    <div style="background:#E94F9C;background:linear-gradient(135deg,#F97CB4 0%,#E94F9C 100%);border-radius:16px;padding:22px 22px 20px;margin:0 0 18px;color:#ffffff">
      <div style="font-size:11px;font-weight:700;letter-spacing:.6px;text-transform:uppercase;color:#ffe6f2">Eventana Events · UAE</div>
      <div style="font-size:22px;font-weight:800;line-height:1.25;margin-top:7px;color:#ffffff">${p.subject}</div>
    </div>`;
  const occText = p.occasions
    ? (/every occasion/i.test(p.occasions) ? p.occasions : `${p.occasions} — and every occasion 🎉`)
    : '';
  const occasionsBand = occText
    ? `<div style="background:#FFF3D6;border-radius:12px;padding:13px 15px;margin:16px 0;font-size:13.5px;color:#5a4a2a"><b>🎊 We celebrate:</b> ${occText}</div>`
    : '';
  return `
    ${hero}
    <p style="margin:0 0 4px;font-size:11.5px;font-weight:700;color:#8a7f88;letter-spacing:.3px">Attn: Procurement / Events Department</p>
    <p style="margin:0 0 12px">Dear <b>{{name}}</b>,</p>
    <p style="margin:0 0 12px">At Eventana Events, we don’t just decorate — we create experiences that bring your people together. Every concept is designed with real creativity, and <b>no one knows the UAE’s occasions and local culture like we do</b>. 💛</p>
    <div style="background:#FDEFF6;border-left:4px solid #E94F9C;border-radius:10px;padding:12px 14px;margin:0 0 4px;font-size:14px"><b>Who’s the right person</b> for events or procurement? Just reply with their name and email.</div>
    <p style="margin:18px 0 8px;font-weight:800;color:#3B3641;font-size:15px">A few things we create for your ${sector} 👇</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0">${serviceRows}</table>
    <p style="margin:4px 0 0;font-size:13.5px;color:#8a7f88;font-style:italic">…and so much more — whatever the occasion, we design it from scratch. ✨</p>
    ${occasionsBand}
    <div style="text-align:center;background:#F0E9FB;border-radius:14px;padding:16px 14px;margin:16px 0;font-size:14.5px;font-weight:700;color:#3B3641">✨ Every detail <span style="color:#7C5BB8">fully branded to your logo</span> — a celebration made just for you.</div>
    <div style="text-align:center;margin:16px 0 4px">
      <a href="${config.publicAppUrl.replace(/\/$/, '')}/company-profile.html" style="display:inline-block;background:#fff;color:#E94F9C;text-decoration:none;font-weight:800;font-size:14px;padding:11px 22px;border-radius:999px;border:2px solid #E94F9C">📄 View our company profile</a>
    </div>
    <p style="margin:14px 0 6px">Share a date and a rough budget, and we’ll craft a tailored proposal — no obligation.</p>
    <p style="margin:12px 0 0">Warmly,<br/><b>The Eventana Team</b> 🎈</p>`;
}

/**
 * AUTO first-touch: newly-collected companies (status 'new', with an email) are
 * emailed their tailored first email automatically — PACED to protect hello@'s
 * sending reputation (CORP_FIRST_TOUCH_PER_DAY, default 60/day). Marks each
 * 'contacted' so the follow-up + reply chain takes over. Runs at most once per
 * ~20h. Gated by CORP_AUTOSEND — kept OFF until the owner approves the templates
 * once; set CORP_AUTOSEND=on to go live (then it's fully automatic forever).
 */
/** Company emails go out only during UAE business hours: Mon–Fri, 10:00–14:00
 *  Dubai time (UTC+4, no DST). Protects reputation and lands in-hours. */
export function inCorpSendWindow(now: Date = new Date()): boolean {
  const dubai = new Date(now.getTime() + 4 * 3600 * 1000);
  const day = dubai.getUTCDay();   // 0 Sun … 6 Sat  (UAE weekend = Sat/Sun)
  const hour = dubai.getUTCHours();
  return day >= 1 && day <= 5 && hour >= 10 && hour < 14;
}

/** Daily first-touch cap: env override wins; otherwise a gentle warm-up ramp —
 *  100/day in week 1, +50 each week, capped at 200. */
async function corpDailyCap(): Promise<number> {
  const envN = Number(process.env.CORP_FIRST_TOUCH_PER_DAY);
  if (Number.isFinite(envN) && envN > 0) return Math.min(400, Math.floor(envN));
  const s = await pool.query<{ v: string }>(`SELECT v FROM app_kv WHERE k = 'corp_autosend_started'`).catch(() => ({ rows: [] as { v: string }[] }));
  let startMs = s.rows[0]?.v ? new Date(s.rows[0].v).getTime() : 0;
  if (!startMs) {
    await pool.query(`INSERT INTO app_kv (k, v) VALUES ('corp_autosend_started', now()) ON CONFLICT (k) DO NOTHING`).catch(() => {});
    startMs = Date.now();
  }
  const weeks = Math.floor((Date.now() - startMs) / (7 * 86_400_000));
  return Math.min(200, 100 + 50 * weeks);
}

export async function sweepCorporateFirstTouch(): Promise<number> {
  // Owner switched auto-send ON 2026-09-20. Default is now 'on'; set
  // CORP_AUTOSEND=off in the environment to pause it.
  if (String(process.env.CORP_AUTOSEND ?? 'on').toLowerCase() === 'off') return 0;
  if (!inCorpSendWindow()) return 0; // only Mon–Fri, 10:00–14:00 Dubai
  const perDay = await corpDailyCap();
  const last = await pool.query<{ v: string }>(`SELECT v FROM app_kv WHERE k = 'corp_firsttouch_at'`).catch(() => ({ rows: [] as { v: string }[] }));
  const lastAt = last.rows[0]?.v ? new Date(last.rows[0].v).getTime() : 0;
  if (Date.now() - lastAt < 20 * 3600 * 1000) return 0;

  // Owner asked to CC herself + Marsha on the VERY FIRST batch only (to watch it
  // go out), and to keep that first batch small (20) so the CC doesn't flood.
  const ccDone = await pool.query(`SELECT 1 FROM app_kv WHERE k = 'corp_firsttouch_cc_done'`).catch(() => ({ rowCount: 0 }));
  const firstBatchCc = ccDone.rowCount ? undefined : ['sheem@eventanauae.com', 'marsha@eventanauae.com'];
  const limit = firstBatchCc ? Math.min(perDay, 20) : perDay;

  const { rows } = await pool.query<{ id: string; email: string; name: string; category: string }>(
    `SELECT id, email, name, category FROM corporate_leads
      WHERE email IS NOT NULL AND email <> '' AND email_opt_out = FALSE
        AND status = 'new' AND first_contacted_at IS NULL
        AND lower(email) NOT IN (SELECT lower(email) FROM email_suppression)
      ORDER BY created_at ASC
      LIMIT $1`,
    [limit],
  ).catch(() => ({ rows: [] as { id: string; email: string; name: string; category: string }[] }));

  let sent = 0;
  const { unsubToken } = await import('./marketing.js');
  for (const r of rows) {
    const cat = (r.category as CorpCategory) in CORP_PITCH ? (r.category as CorpCategory) : 'other';
    const p = CORP_PITCH[cat];
    const unsub = `${config.email.publicBaseUrl}/api/unsubscribe?k=corp&c=${encodeURIComponent(r.id)}&t=${unsubToken(r.id)}`;
    const html = renderCampaignHtml(buildFirstTouchBody(cat).replace(/\{\{\s*name\s*\}\}/gi, r.name || 'there'), unsub);
    const res = await sendEmail({
      to: r.email, subject: p.subject, html, skipMonitorBcc: true, replyTo: config.email.replyTo,
      cc: firstBatchCc,
      tags: [{ name: 'corp', value: 'firsttouch' }],
    });
    if (res.ok) {
      sent++;
      await pool.query(
        `UPDATE corporate_leads SET status = 'contacted', first_contacted_at = now(), updated_at = now() WHERE id = $1`,
        [r.id],
      ).catch(() => {});
      await pool.query(`INSERT INTO email_send_log (campaign_id, email, kind) VALUES (NULL,$1,$2)`, [r.email.toLowerCase(), 'corporate']).catch(() => {});
    }
    await new Promise((res) => setTimeout(res, 150));
  }
  await pool.query(`INSERT INTO app_kv (k, v) VALUES ('corp_firsttouch_at', now()) ON CONFLICT (k) DO UPDATE SET v = now()`).catch(() => {});
  // Mark the first-batch CC as done so only that first batch was copied to owner+Marsha.
  if (sent && firstBatchCc) await pool.query(`INSERT INTO app_kv (k, v) VALUES ('corp_firsttouch_cc_done', now()) ON CONFLICT (k) DO UPDATE SET v = now()`).catch(() => {});
  if (sent) console.log(`[corp-firsttouch] sent ${sent} first emails${firstBatchCc ? ' (CC owner+Marsha, first batch)' : ''}`);
  return sent;
}

/** The gentle 2-week reminder body for a company that never replied. */
function buildReminderBody(): string {
  return `
    <p style="font-size:19px;font-weight:800;margin:0 0 12px;color:#3B3641">Just following up 💛</p>
    <p style="margin:0 0 4px;font-size:12px;font-weight:700;color:#8a7f88;letter-spacing:.3px">Attn: Procurement / Events Department</p>
    <p style="margin:0 0 14px">Hello <b>{{name}}</b>,</p>
    <p style="margin:0 0 4px">We reached out a couple of weeks ago about Eventana handling your organisation’s celebrations and events across the UAE, and wanted to make sure it reached the right desk.</p>
    <p style="margin:14px 0 4px"><b>Who is the best person to speak to</b> about events or procurement? A quick reply with their name and email is all we need, and we’ll take it from there.</p>
    <p style="margin:14px 0 6px">We’d be glad to prepare a tailored proposal whenever it suits you — no obligation.</p>
    <p style="margin:12px 0 0">Warm regards,<br/>The Eventana Team</p>`;
}

/** A ready suggested reply the owner/Marsha can review and send when a company
 *  shows interest — kept warm, specific and short. */
export function buildSuggestedReply(companyName: string): string {
  const who = companyName && companyName !== 'there' ? companyName : 'your team';
  return `Hi ${who},\n\nThank you so much for getting back to us — great to hear from you!\n\n`
    + `We'd love to put together a tailored proposal for your event. To make it a perfect fit, could you share:\n`
    + `• The occasion and rough date\n• Approximate number of guests\n• A rough budget (so we tailor the concept)\n\n`
    + `We handle everything end-to-end — concept, décor, setup and teardown — and we know the UAE's occasions and local culture inside out.\n\n`
    + `You can also reach us any time on 056 450 0777 (WhatsApp or call).\n\nWarm regards,\nThe Eventana Team`;
}

/** Render one sector's first email for preview/review (subject + full branded
 *  HTML with a sample company name). Used to send test copies to the owner. */
export function firstTouchPreview(category: CorpCategory, sampleName: string): { subject: string; html: string } {
  const p = CORP_PITCH[category] ?? CORP_PITCH.other;
  const body = buildFirstTouchBody(category).replace(/\{\{\s*name\s*\}\}/gi, sampleName);
  const html = renderCampaignHtml(body, `${config.email.publicBaseUrl}/api/unsubscribe?k=corp&c=preview&t=preview`);
  return { subject: p.subject, html };
}

/**
 * DAILY auto follow-up: any company we contacted 14+ days ago that never replied
 * and hasn't been reminded yet gets ONE gentle reminder. Guarded to run at most
 * once per ~20h. Respects suppression, opt-out and 'not_interested'. Gated by
 * CORP_COLLECT (same switch as the collector).
 */
export async function sweepCorporateFollowups(): Promise<number> {
  if (String(process.env.CORP_COLLECT ?? 'on').toLowerCase() === 'off') return 0;
  if (!inCorpSendWindow()) return 0; // company emails only Mon–Fri, 10:00–14:00 Dubai
  const last = await pool.query<{ v: string }>(`SELECT v FROM app_kv WHERE k = 'corp_followup_at'`).catch(() => ({ rows: [] as { v: string }[] }));
  const lastAt = last.rows[0]?.v ? new Date(last.rows[0].v).getTime() : 0;
  if (Date.now() - lastAt < 20 * 3600 * 1000) return 0;

  const { rows } = await pool.query<{ id: string; email: string; name: string }>(
    `SELECT id, email, name FROM corporate_leads
      WHERE email IS NOT NULL AND email <> '' AND email_opt_out = FALSE
        AND status = 'contacted'
        AND replied_at IS NULL AND reminded_at IS NULL
        AND first_contacted_at IS NOT NULL AND first_contacted_at < now() - interval '14 days'
        AND lower(email) NOT IN (SELECT lower(email) FROM email_suppression)
      ORDER BY first_contacted_at ASC
      LIMIT 150`,
  ).catch(() => ({ rows: [] as { id: string; email: string; name: string }[] }));

  let sent = 0;
  const { unsubToken } = await import('./marketing.js');
  for (const r of rows) {
    const unsub = `${config.email.publicBaseUrl}/api/unsubscribe?k=corp&c=${encodeURIComponent(r.id)}&t=${unsubToken(r.id)}`;
    const html = renderCampaignHtml(buildReminderBody().replace(/\{\{\s*name\s*\}\}/gi, r.name || 'there'), unsub);
    const res = await sendEmail({
      to: r.email, subject: 'Following up — Eventana events for your organisation',
      html, skipMonitorBcc: true, replyTo: config.email.replyTo,
      tags: [{ name: 'corp', value: 'followup' }],
    });
    if (res.ok) {
      sent++;
      await pool.query(`UPDATE corporate_leads SET reminded_at = now(), updated_at = now() WHERE id = $1`, [r.id]).catch(() => {});
      await pool.query(`INSERT INTO email_send_log (campaign_id, email, kind) VALUES (NULL,$1,$2)`, [r.email.toLowerCase(), 'corporate']).catch(() => {});
    }
    await new Promise((res) => setTimeout(res, 120));
  }
  await pool.query(`INSERT INTO app_kv (k, v) VALUES ('corp_followup_at', now()) ON CONFLICT (k) DO UPDATE SET v = now()`).catch(() => {});
  if (sent) console.log(`[corp-followup] sent ${sent} reminders`);
  return sent;
}

// A procurement / events-looking mailbox we should prefer if a reply mentions one.
const REPLY_PROC_RE = /\b(procurement|purchas|tender|vendor|supplier|events?|marketing|admin|info|contact)@/i;
const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
// An automated / out-of-office reply — never counts as a real reply.
const AUTO_RE = /(out of office|auto[\s-]?reply|automatic reply|automated response|do not reply|no[\s-]?reply|away from (my|the) (office|desk)|on (annual )?leave|on vacation|إجازة|رد تلقائي|رد آلي|خارج المكتب|سيتم الرد|الرد التلقائي)/i;
// Signals of genuine interest (or a request to proceed) — EN + AR.
const INTEREST_RE = /(interest|proposal|quotation|\bquote\b|budget|pricing|\bprice\b|package|send (us|me|it)|share (the|your)|details|brochure|profile|catalog|meeting|call us|schedule|arrange|book|kindly send|would like|we('| a)re keen|مهتم|مهتمين|عرض سعر|عرض\b|السعر|الأسعار|التفاصيل|الباقات|اجتماع|موعد|نبغى|نبي|نود|تواصل|ابعث|أرسل|ارسل|كتالوج|بروفايل)/i;

/**
 * Process an inbound reply FROM a company (fed by the mailbox reader once Google
 * access to hello@ is granted). Matches the lead, flags it interested, auto-
 * updates the department email if the reply gives a better one, and notifies the
 * owner + Marsha with a ready suggested reply. Safe to call repeatedly.
 * Returns what it did so a caller/route can report it.
 */
export async function processCorporateReply(msg: {
  fromEmail: string; fromName?: string; subject?: string; text?: string;
}): Promise<{ matched: boolean; leadId?: string; emailUpdated?: boolean; company?: string; auto?: boolean; interested?: boolean }> {
  const from = (msg.fromEmail || '').trim().toLowerCase();
  if (!from || !from.includes('@')) return { matched: false };
  const domain = from.split('@')[1];

  // Match by exact address first, then by the sender's domain (a colleague may
  // reply from a different mailbox on the same company domain).
  const found = await pool.query<{ id: string; name: string; email: string; status: string }>(
    `SELECT id, name, email, status FROM corporate_leads
      WHERE lower(email) = $1
         OR lower(email) LIKE $2
         OR lower(COALESCE(website,'')) LIKE $2
      ORDER BY (lower(email) = $1) DESC
      LIMIT 1`,
    [from, `%${domain}%`],
  ).catch(() => ({ rows: [] as { id: string; name: string; email: string; status: string }[] }));
  const lead = found.rows[0];
  if (!lead) return { matched: false };

  const body = `${msg.text || ''}`;
  const subject = `${msg.subject || ''}`;

  // An out-of-office / automated reply is NOT a real reply — ignore it entirely
  // so the 14-day reminder still goes out later.
  if (AUTO_RE.test(body) || AUTO_RE.test(subject)) {
    return { matched: true, leadId: lead.id, company: lead.name, auto: true };
  }

  // Does the reply hand us a better department email (procurement/events @ the
  // same company domain)? That's a strong "interested" signal.
  const candidates = (body.match(EMAIL_RE) || []).map((e) => e.toLowerCase())
    .filter((e) => !e.endsWith('@eventanauae.com'));
  const better = candidates.find((e) => REPLY_PROC_RE.test(e) && e.split('@')[1] === domain)
    || candidates.find((e) => e.split('@')[1] === domain && e !== lead.email.toLowerCase());
  let emailUpdated = false;
  if (better && better !== lead.email.toLowerCase()) {
    await pool.query(`UPDATE corporate_leads SET email = $2, updated_at = now() WHERE id = $1`, [lead.id, better]).catch(() => {});
    emailUpdated = true;
  }

  // Only treat it as "interested" when the reply shows real interest OR gives a
  // department/procurement email — NOT a bare "thanks, received" greeting.
  const interested = Boolean(better) || INTEREST_RE.test(body) || INTEREST_RE.test(subject);
  const keepStatus = lead.status === 'booked' || lead.status === 'not_interested';

  // Record the human reply (so no reminder is sent), and flip to 'interested'
  // only when it qualifies.
  await pool.query(
    `UPDATE corporate_leads
        SET replied_at = now(), reply_snippet = $2,
            status = CASE WHEN $3 OR NOT $4 THEN status ELSE 'interested' END,
            updated_at = now()
      WHERE id = $1`,
    [lead.id, body.slice(0, 240), keepStatus, interested],
  ).catch(() => {});

  // Only a qualifying "interested" reply pings the owner + Marsha with a
  // suggested reply — greetings are recorded quietly, no notification.
  if (!interested) return { matched: true, leadId: lead.id, emailUpdated, company: lead.name, interested: false };

  // Notify owner + Marsha with a ready suggested reply (they review & send — CC'd
  // to each other so both stay in the loop). No blind auto-reply.
  try {
    const { pushToOwner } = await import('../integrations/push.js');
    const targets = (await pool.query<{ id: string }>(
      `SELECT id FROM team_members WHERE active AND (lower(name) = 'marsha' OR access_level = 'owner')`,
    )).rows;
    const linkKey = `corp_reply|${lead.id}`;
    const already = await pool.query(`SELECT 1 FROM focus_tasks WHERE link_key = $1 LIMIT 1`, [linkKey]);
    for (const t of targets) {
      if (!already.rowCount) {
        await pool.query(
          `INSERT INTO focus_tasks (member_id, title, sort_order, link_key)
           VALUES ($1,$2,COALESCE((SELECT MIN(sort_order) - 1 FROM focus_tasks WHERE member_id = $1 AND NOT done),0),$3)`,
          [t.id, `💬 ${lead.name} replied — review & send our proposal`, linkKey],
        ).catch(() => {});
      }
      await pushToOwner('staff', t.id, `💬 ${lead.name} is interested`,
        `${lead.name} replied to our outreach${emailUpdated ? ' (department email updated)' : ''}. Open Companies to review and send the proposal.`,
        { leadId: String(lead.id) }).catch(() => {});
    }
  } catch { /* notification is non-fatal */ }

  return { matched: true, leadId: lead.id, emailUpdated, company: lead.name };
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
