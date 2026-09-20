/**
 * Marketing Calendar & Campaign Automation.
 *
 * A year-round catalogue of UAE / international occasions. An engine runs from
 * the periodic sweep and, a few weeks before each occasion, auto-prepares a
 * branded DRAFT campaign (subject + body + audience + a send date) and drops it
 * into the existing approval queue, then notifies the owner + Marsha to review.
 *
 * Nothing is ever sent automatically: an auto-prepared campaign lands as
 * `pending_approval`, and the owner/manager approves (or edits / rejects) it in
 * the Marketing page exactly like a hand-written one. Approving a campaign with
 * a future send date schedules it; the scheduled-send sweep mails it on the day.
 *
 * Islamic / variable-date occasions must be RE-VERIFIED against the real UAE
 * Hijri calendar every year — the dates below are best-effort estimates and are
 * only used to seed a review-gated draft. A year not in the table is surfaced in
 * the calendar as "confirm the date" and no draft is auto-created for it.
 */
import { pool } from '../db/pool.js';
import { config } from '../config.js';
import type { Audience } from './marketing.js';

export type OccasionType = 'commercial' | 'national' | 'islamic' | 'seasonal' | 'greeting';

export interface Occasion {
  slug: string;
  name: string; // English label
  nameAr: string; // Arabic label
  type: OccasionType;
  /** Relationship-only occasion: a warm greeting, NEVER a sales push. */
  greetingOnly?: boolean;
  /** Which segment this occasion targets by default. */
  audience: Audience;
  /** Prepare the draft this many days before the occasion (default 30). */
  leadDays: number;
  /** Schedule the send this many days before the occasion. */
  sendDaysBefore: number;
  /** Fixed Gregorian date (recurs every year). */
  fixed?: { month: number; day: number };
  /** Variable date per year — 'YYYY-MM-DD' in UAE local time. ESTIMATES: confirm yearly. */
  variable?: Record<number, string>;
  /** Email copy. `heading`/`intro` are the pitch; `ctaLabel` omitted ⇒ greeting only. */
  copy: {
    subject: string;
    heading: string;
    intro: string;
    ctaLabel?: string;
  };
}

/**
 * The occasion catalogue. Commercial dates get a soft "book with us" CTA;
 * greeting-only dates (national days of remembrance, religious greetings) carry
 * warmth and NO sales language, per the owner's cultural-context rule.
 */
export const OCCASIONS: Occasion[] = [
  {
    slug: 'new-year',
    name: 'New Year',
    nameAr: 'رأس السنة',
    type: 'seasonal',
    audience: 'all',
    leadDays: 30,
    sendDaysBefore: 10,
    fixed: { month: 12, day: 31 },
    copy: {
      subject: 'Start the new year with a celebration to remember 🎉',
      heading: 'A brand new year of reasons to celebrate ✨',
      intro:
        'From all of us at Eventana — here’s to a year full of birthdays, milestones and beautiful moments. Whatever you’re planning, we’ll bring the magic: themed setups, food stations, and a team that handles every detail.',
      ctaLabel: 'Plan your first celebration',
    },
  },
  {
    slug: 'uae-mothers-day',
    name: 'UAE Mother’s Day',
    nameAr: 'عيد الأم',
    type: 'commercial',
    audience: 'all',
    leadDays: 25,
    sendDaysBefore: 7,
    fixed: { month: 3, day: 21 },
    copy: {
      subject: 'Make her day unforgettable this Mother’s Day 💐',
      heading: 'Celebrate the heart of the family 💐',
      intro:
        'Mother’s Day is coming. Surprise her with a beautifully styled gathering — an intimate tea, a family brunch, or a full celebration. Tell us the vibe and we’ll take care of everything.',
      ctaLabel: 'Plan a Mother’s Day surprise',
    },
  },
  {
    slug: 'intl-womens-day',
    name: 'International Women’s Day',
    nameAr: 'يوم المرأة العالمي',
    type: 'commercial',
    audience: 'all',
    leadDays: 20,
    sendDaysBefore: 5,
    fixed: { month: 3, day: 8 },
    copy: {
      subject: 'Celebrating the women who make life beautiful 💐',
      heading: 'Happy International Women’s Day 💐',
      intro:
        'Today we honour the incredible women in our lives. Planning to bring the ladies together? We’ll style a beautiful gathering — an elegant tea, a brunch, or a full celebration.',
      ctaLabel: 'Plan a celebration for her',
    },
  },
  {
    slug: 'uae-childrens-day',
    name: 'UAE Children’s Day',
    nameAr: 'يوم الطفل الإماراتي',
    type: 'commercial',
    audience: 'all',
    leadDays: 20,
    sendDaysBefore: 5,
    fixed: { month: 3, day: 15 },
    copy: {
      subject: 'Make Children’s Day magical 🎈',
      heading: 'It’s all about the little ones today 🎈',
      intro:
        'UAE Children’s Day is here! Celebrate the joy they bring with a fun, themed party — games, treats and happy faces all around. We’ll handle every detail.',
      ctaLabel: 'Plan a Children’s Day party',
    },
  },
  {
    slug: 'intl-day-happiness',
    name: 'International Day of Happiness',
    nameAr: 'اليوم العالمي للسعادة',
    type: 'seasonal',
    audience: 'all',
    leadDays: 16,
    sendDaysBefore: 3,
    fixed: { month: 3, day: 20 },
    copy: {
      subject: 'A little happiness goes a long way 🌸',
      heading: 'Happy International Day of Happiness 🌸',
      intro:
        'Nothing spreads joy like celebrating together. On the Day of Happiness, gather the people you love — we’ll help you create a moment full of smiles.',
      ctaLabel: 'Plan something joyful',
    },
  },
  {
    slug: 'intl-day-families',
    name: 'International Day of Families',
    nameAr: 'اليوم العالمي للأسرة',
    type: 'commercial',
    audience: 'all',
    leadDays: 18,
    sendDaysBefore: 4,
    fixed: { month: 5, day: 15 },
    copy: {
      subject: 'Bring the whole family together 🤍',
      heading: 'Happy International Day of Families 🤍',
      intro:
        'Family is everything. Celebrate yours with a gathering to remember — good food, warm décor, and time together while we take care of the rest.',
      ctaLabel: 'Plan a family gathering',
    },
  },
  {
    slug: 'graduation-season',
    name: 'Graduation season',
    nameAr: 'موسم التخرّج',
    type: 'commercial',
    audience: 'all',
    leadDays: 30,
    sendDaysBefore: 14,
    fixed: { month: 6, day: 1 },
    copy: {
      subject: 'Throw the graduation party they’ve earned 🎓',
      heading: 'Cap, gown… and a celebration to match 🎓',
      intro:
        'Graduation is a once-in-a-lifetime milestone. Let’s make it special with a custom-themed setup, a dessert table and all the little touches that turn a party into a memory.',
      ctaLabel: 'Plan a graduation party',
    },
  },
  {
    slug: 'back-to-school',
    name: 'Back to school',
    nameAr: 'العودة إلى المدارس',
    type: 'seasonal',
    audience: 'all',
    leadDays: 25,
    sendDaysBefore: 10,
    fixed: { month: 8, day: 25 },
    copy: {
      subject: 'One last celebration before school starts 🎒',
      heading: 'Send summer off in style 🎒',
      intro:
        'Before the school bells ring, gather the kids for one more unforgettable day. A themed party, games and treats — we’ll set it all up so you can just enjoy it.',
      ctaLabel: 'Book a back-to-school party',
    },
  },
  {
    slug: 'emirati-womens-day',
    name: 'Emirati Women’s Day',
    nameAr: 'يوم المرأة الإماراتية',
    type: 'national',
    audience: 'all',
    leadDays: 20,
    sendDaysBefore: 5,
    fixed: { month: 8, day: 28 },
    copy: {
      subject: 'Celebrating the women who inspire us 🤍',
      heading: 'Happy Emirati Women’s Day 🤍',
      intro:
        'Today we celebrate the strength, grace and achievements of Emirati women. From our family at Eventana to yours — thank you for everything you do.',
      // greeting-flavoured but a soft CTA is welcome for a gathering
      ctaLabel: 'Host a gathering to celebrate her',
    },
  },
  {
    slug: 'halloween',
    name: 'Halloween',
    nameAr: 'الهالووين',
    type: 'commercial',
    audience: 'all',
    leadDays: 25,
    sendDaysBefore: 10,
    fixed: { month: 10, day: 31 },
    copy: {
      subject: 'Spooky, sweet and unforgettable 🎃',
      heading: 'Let’s throw a spooktacular party 🎃',
      intro:
        'Halloween is almost here! Think themed décor, a candy station and costumes galore. We’ll build the whole spooky scene — you just bring the little monsters.',
      ctaLabel: 'Plan a Halloween party',
    },
  },
  {
    slug: 'world-teachers-day',
    name: 'World Teachers’ Day',
    nameAr: 'يوم المعلم',
    type: 'commercial',
    audience: 'all',
    leadDays: 20,
    sendDaysBefore: 5,
    fixed: { month: 10, day: 5 },
    copy: {
      subject: 'Celebrate the teachers who shape our children 🍎',
      heading: 'Happy Teachers’ Day 🍎',
      intro:
        'Behind every child’s success is a wonderful teacher. Planning a school or class appreciation? We’ll set up a warm, memorable celebration to thank them.',
      ctaLabel: 'Plan a teacher appreciation',
    },
  },
  {
    slug: 'uae-flag-day',
    name: 'UAE Flag Day',
    nameAr: 'يوم العلم',
    type: 'national',
    greetingOnly: true,
    audience: 'all',
    leadDays: 14,
    sendDaysBefore: 2,
    fixed: { month: 11, day: 3 },
    copy: {
      subject: 'Proudly raising the flag 🇦🇪',
      heading: 'Happy Flag Day 🇦🇪',
      intro:
        'On UAE Flag Day we stand together in pride and gratitude. From all of us at Eventana — happy Flag Day to you and your family.',
    },
  },
  {
    slug: 'uae-commemoration-day',
    name: 'UAE Commemoration Day',
    nameAr: 'يوم الشهيد',
    type: 'national',
    greetingOnly: true,
    audience: 'all',
    leadDays: 12,
    sendDaysBefore: 1,
    fixed: { month: 11, day: 30 },
    copy: {
      subject: 'Honouring the heroes of our nation 🤍',
      heading: 'Commemoration Day 🤍',
      intro:
        'Today we pause to honour the sacrifice of those who gave everything for the UAE. With deep respect and gratitude, from all of us at Eventana.',
    },
  },
  {
    slug: 'uae-national-day',
    name: 'UAE National Day',
    nameAr: 'اليوم الوطني',
    type: 'national',
    audience: 'all',
    leadDays: 30,
    sendDaysBefore: 7,
    fixed: { month: 12, day: 2 },
    copy: {
      subject: 'Celebrate the Spirit of the Union 🇦🇪',
      heading: 'Happy UAE National Day 🇦🇪',
      intro:
        'A proud day for our nation! Whether it’s a family gathering or a themed celebration in the nation’s colours, we’ll help you mark it in style.',
      ctaLabel: 'Plan a National Day celebration',
    },
  },
  {
    slug: 'christmas',
    name: 'Christmas & festive season',
    nameAr: 'الأعياد الموسمية',
    type: 'seasonal',
    audience: 'all',
    leadDays: 30,
    sendDaysBefore: 12,
    fixed: { month: 12, day: 24 },
    copy: {
      subject: 'Make the festive season sparkle ✨',
      heading: 'A festive gathering, beautifully done ✨',
      intro:
        'The most wonderful time of the year is here. Let’s create a warm, magical setup for your family and friends — décor, dessert tables and all the festive touches.',
      ctaLabel: 'Plan a festive gathering',
    },
  },
  // ── Islamic / variable-date occasions — CONFIRM the Hijri date every year ──
  {
    slug: 'hag-al-laila',
    name: 'Hag Al Laila',
    nameAr: 'حق الليلة',
    type: 'islamic',
    audience: 'all',
    leadDays: 20,
    sendDaysBefore: 4,
    // 15th of Sha'ban — ESTIMATE, confirm the Hijri date each year.
    variable: { 2026: '2026-02-02', 2027: '2027-01-23' },
    copy: {
      subject: 'Hag Al Laila is coming — let’s celebrate 🌙🍬',
      heading: 'Hag Al Laila Mubarak 🌙🍬',
      intro:
        'One of our most loved traditions! Bring the children together for a joyful Hag Al Laila — sweets, songs and a beautifully themed setup. We’ll make it special.',
      ctaLabel: 'Plan a Hag Al Laila celebration',
    },
  },
  {
    slug: 'ramadan',
    name: 'Ramadan',
    nameAr: 'رمضان',
    type: 'islamic',
    audience: 'all',
    leadDays: 25,
    sendDaysBefore: 5,
    variable: { 2026: '2026-02-18', 2027: '2027-02-08' },
    copy: {
      subject: 'Ramadan gatherings, thoughtfully arranged 🌙',
      heading: 'Ramadan Kareem from Eventana 🌙',
      intro:
        'As the holy month begins, we wish you peace and blessings. Planning an iftar or a family gathering? We’ll style it beautifully so you can focus on the people who matter.',
      ctaLabel: 'Plan a Ramadan gathering',
    },
  },
  {
    slug: 'eid-al-fitr',
    name: 'Eid Al Fitr',
    nameAr: 'عيد الفطر',
    type: 'islamic',
    audience: 'all',
    leadDays: 20,
    sendDaysBefore: 5,
    variable: { 2026: '2026-03-20', 2027: '2027-03-10' },
    copy: {
      subject: 'Celebrate Eid with a gathering to remember 🌙',
      heading: 'Eid Mubarak from all of us 🌙',
      intro:
        'Eid is a time for family, joy and togetherness. Let us set the scene for a beautiful Eid celebration — themed décor, sweets and every festive detail handled.',
      ctaLabel: 'Plan an Eid celebration',
    },
  },
  {
    slug: 'eid-al-adha',
    name: 'Eid Al Adha',
    nameAr: 'عيد الأضحى',
    type: 'islamic',
    audience: 'all',
    leadDays: 20,
    sendDaysBefore: 5,
    variable: { 2026: '2026-05-27', 2027: '2027-05-16' },
    copy: {
      subject: 'A blessed Eid Al Adha to you 🤍',
      heading: 'Eid Al Adha Mubarak 🤍',
      intro:
        'Wishing you and your loved ones a blessed Eid Al Adha. If you’re hosting the family, we’d be honoured to help you make it beautiful.',
      ctaLabel: 'Plan an Eid gathering',
    },
  },
  {
    slug: 'islamic-new-year',
    name: 'Islamic New Year',
    nameAr: 'رأس السنة الهجرية',
    type: 'islamic',
    greetingOnly: true,
    audience: 'all',
    leadDays: 12,
    sendDaysBefore: 1,
    variable: { 2026: '2026-06-16', 2027: '2027-06-06' },
    copy: {
      subject: 'A blessed Hijri New Year 🌙',
      heading: 'Happy Islamic New Year 🌙',
      intro:
        'Wishing you a Hijri New Year filled with peace, health and happiness — from your family at Eventana.',
    },
  },
  {
    slug: 'prophet-birthday',
    name: 'Prophet’s Birthday (Mawlid)',
    nameAr: 'المولد النبوي',
    type: 'islamic',
    greetingOnly: true,
    audience: 'all',
    leadDays: 12,
    sendDaysBefore: 1,
    variable: { 2026: '2026-08-25', 2027: '2027-08-15' },
    copy: {
      subject: 'Blessings on Mawlid Al Nabi 🤍',
      heading: 'Mawlid Al Nabi Al Sharif 🤍',
      intro:
        'On this blessed occasion, we send you our warmest wishes for peace and light — from all of us at Eventana.',
    },
  },
];

/** Resolve the next upcoming date for an occasion, from `from` (inclusive). */
export function nextOccasionDate(o: Occasion, from = new Date()): { dateISO: string; year: number } | null {
  const todayISO = from.toISOString().slice(0, 10);
  if (o.fixed) {
    const y = from.getUTCFullYear();
    for (const year of [y, y + 1]) {
      const iso = `${year}-${String(o.fixed.month).padStart(2, '0')}-${String(o.fixed.day).padStart(2, '0')}`;
      if (iso >= todayISO) return { dateISO: iso, year };
    }
    return null;
  }
  if (o.variable) {
    const upcoming = Object.entries(o.variable)
      .map(([year, iso]) => ({ year: Number(year), iso }))
      .filter((e) => e.iso >= todayISO)
      .sort((a, b) => a.iso.localeCompare(b.iso));
    if (upcoming[0]) return { dateISO: upcoming[0].iso, year: upcoming[0].year };
    return null; // year not in the (yearly-confirmed) table → surfaced, not auto-created
  }
  return null;
}

/** Days from `from` until the given ISO date (calendar days, UTC). */
function daysUntil(dateISO: string, from = new Date()): number {
  const a = Date.parse(`${dateISO}T00:00:00Z`);
  const b = Date.parse(`${from.toISOString().slice(0, 10)}T00:00:00Z`);
  return Math.round((a - b) / 86_400_000);
}

/** 10:00 Asia/Dubai == 06:00 UTC on the send day (occasion minus sendDaysBefore). */
function sendTime(dateISO: string, daysBefore: number): Date {
  const d = new Date(`${dateISO}T06:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() - daysBefore);
  return d;
}

/** Inner campaign HTML (wrapped in the Eventana shell at send time). */
export function buildOccasionBody(o: Occasion): string {
  const brandPink = '#E94F9C';
  const cta =
    o.greetingOnly || !o.copy.ctaLabel
      ? ''
      : `<div style="text-align:center;margin:22px 0 6px">
           <a href="${config.publicAppUrl}" style="display:inline-block;background:${brandPink};color:#fff;text-decoration:none;font-weight:800;font-size:15px;padding:13px 26px;border-radius:999px">${o.copy.ctaLabel} →</a>
         </div>
         <p style="text-align:center;font-size:12px;color:#b3a8a0;margin:6px 0 0">Or reply to this email and we’ll help you plan it.</p>`;
  return `
    <p style="font-size:19px;font-weight:800;margin:0 0 12px;color:#3B3641">${o.copy.heading}</p>
    <p style="margin:0 0 14px;font-size:15px;line-height:1.65">Hi {{name}},</p>
    <p style="margin:0 0 14px;font-size:15px;line-height:1.65">${o.copy.intro}</p>
    ${cta}
    <p style="margin:18px 0 0;font-size:15px">With love,<br/>The Eventana Team 💕</p>`;
}

const GATE = () => String(process.env.MARKETING_CALENDAR ?? 'on').toLowerCase() !== 'off';

/**
 * Auto-prepare draft campaigns for occasions coming up within their lead window.
 * Idempotent via `dedupe_key` (`occasion|<slug>|<year>`). Creates the campaign as
 * `pending_approval` with a future `scheduled_for`, then alerts owner + Marsha.
 * Returns how many new drafts were prepared. Never sends anything.
 */
export async function sweepMarketingCalendar(): Promise<number> {
  if (!GATE()) return 0;
  const now = new Date();
  let prepared = 0;
  for (const o of OCCASIONS) {
    const next = nextOccasionDate(o, now);
    if (!next) continue; // variable date not confirmed for an upcoming year
    const away = daysUntil(next.dateISO, now);
    // Only within the lead window and still far enough out to actually send.
    if (away > o.leadDays || away < o.sendDaysBefore) continue;
    const dedupeKey = `occasion|${o.slug}|${next.year}`;
    const exists = await pool.query(`SELECT 1 FROM email_campaigns WHERE dedupe_key = $1`, [dedupeKey]);
    if (exists.rowCount) continue;

    const scheduledFor = sendTime(next.dateISO, o.sendDaysBefore);
    const body = buildOccasionBody(o);
    let ins;
    try {
      ins = await pool.query<{ id: string }>(
        `INSERT INTO email_campaigns (subject, body_html, audience, status, scheduled_for, created_by, source, dedupe_key)
         VALUES ($1,$2,$3,'pending_approval',$4,'Eventana AI','occasion',$5)
         RETURNING id`,
        [o.copy.subject, body, o.audience, scheduledFor.toISOString(), dedupeKey],
      );
    } catch {
      continue; // race on the unique dedupe index — someone else prepared it
    }
    prepared++;

    // Alert the owner + Marsha to review it.
    const { pushToOwner } = await import('../integrations/push.js');
    const dateLabel = new Date(`${next.dateISO}T00:00:00Z`).toLocaleDateString('en-GB', {
      day: 'numeric', month: 'long', timeZone: 'UTC',
    });
    const title = '📣 A marketing campaign is ready to review';
    const bodyMsg = `${o.name} (${dateLabel}) — a draft email is waiting in Marketing. Review, edit and approve to schedule it.`;
    const targets = await pool.query<{ id: string }>(
      `SELECT id FROM team_members WHERE active AND (lower(name) = 'marsha' OR access_level = 'owner')`,
    );
    for (const t of targets.rows) {
      await pushToOwner('staff', t.id, title, bodyMsg, { campaignId: String(ins.rows[0].id) }).catch(() => {});
    }
    console.log(`[marketing-calendar] prepared "${o.name}" for ${next.dateISO} (send ${scheduledFor.toISOString().slice(0, 10)})`);
  }
  return prepared;
}

/**
 * Prepare ONE occasion's draft on demand (dashboard "Prepare now"), even outside
 * the lead window. Returns the campaign id, or the existing one if already made.
 */
export async function prepareOccasionNow(slug: string): Promise<{ id: string; created: boolean } | null> {
  const o = OCCASIONS.find((x) => x.slug === slug);
  if (!o) return null;
  const next = nextOccasionDate(o);
  if (!next) return null;
  const dedupeKey = `occasion|${o.slug}|${next.year}`;
  const existing = await pool.query<{ id: string }>(`SELECT id FROM email_campaigns WHERE dedupe_key = $1`, [dedupeKey]);
  if (existing.rows[0]) return { id: String(existing.rows[0].id), created: false };
  const away = daysUntil(next.dateISO);
  // If it's too close to honour the normal pre-send lead, schedule for tomorrow 10:00 Dubai.
  const scheduledFor = away < o.sendDaysBefore ? sendTime(new Date(Date.now() + 86_400_000).toISOString().slice(0, 10), 0) : sendTime(next.dateISO, o.sendDaysBefore);
  const ins = await pool.query<{ id: string }>(
    `INSERT INTO email_campaigns (subject, body_html, audience, status, scheduled_for, created_by, source, dedupe_key)
     VALUES ($1,$2,$3,'pending_approval',$4,'Eventana AI','occasion',$5)
     RETURNING id`,
    [o.copy.subject, buildOccasionBody(o), o.audience, scheduledFor.toISOString(), dedupeKey],
  );
  return { id: String(ins.rows[0].id), created: true };
}

/**
 * The calendar as the dashboard shows it: every occasion's next date, how far
 * away, its type, and the linked auto-campaign's status (if any).
 */
export async function marketingCalendar(): Promise<
  Array<{
    slug: string; name: string; nameAr: string; type: OccasionType; greetingOnly: boolean;
    dateISO: string | null; daysAway: number | null; needsDateConfirm: boolean;
    campaign: { id: string; status: string; scheduledFor: string | null } | null;
  }>
> {
  const now = new Date();
  const rows = await Promise.all(
    OCCASIONS.map(async (o) => {
      const next = nextOccasionDate(o, now);
      const dedupeKey = next ? `occasion|${o.slug}|${next.year}` : null;
      const camp = dedupeKey
        ? (await pool.query<{ id: string; status: string; scheduled_for: string | null }>(
            `SELECT id, status, scheduled_for FROM email_campaigns WHERE dedupe_key = $1`, [dedupeKey],
          )).rows[0]
        : undefined;
      return {
        slug: o.slug, name: o.name, nameAr: o.nameAr, type: o.type, greetingOnly: Boolean(o.greetingOnly),
        dateISO: next?.dateISO ?? null,
        daysAway: next ? daysUntil(next.dateISO, now) : null,
        // A variable occasion with no confirmed date for an upcoming year.
        needsDateConfirm: Boolean(o.variable) && !next,
        campaign: camp ? { id: String(camp.id), status: camp.status, scheduledFor: camp.scheduled_for } : null,
      };
    }),
  );
  return rows.sort((a, b) => {
    if (a.daysAway == null) return 1;
    if (b.daysAway == null) return -1;
    return a.daysAway - b.daysAway;
  });
}
