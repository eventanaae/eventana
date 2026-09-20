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
import type { Audience } from './marketing.js';

export type OccasionType = 'commercial' | 'national' | 'islamic' | 'seasonal' | 'greeting' | 'awareness';

export interface Occasion {
  slug: string;
  name: string; // English label
  nameAr: string; // Arabic label
  type: OccasionType;
  /** Relationship-only occasion: a warm greeting, NEVER a sales push. */
  greetingOnly?: boolean;
  /** Only relevant to businesses (awareness/wellness days) — no consumer draft. */
  corporateOnly?: boolean;
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
  // ── Awareness / wellness days — corporate only (schools, companies, clinics
  // run these), respectful copy, never framed as a "party". ───────────────────
  {
    slug: 'world-cancer-day',
    name: 'World Cancer Day',
    nameAr: 'اليوم العالمي للسرطان',
    type: 'awareness',
    corporateOnly: true,
    audience: 'all',
    leadDays: 22,
    sendDaysBefore: 7,
    fixed: { month: 2, day: 4 },
    copy: {
      subject: 'Plan a meaningful awareness day for your team 🎗️',
      heading: 'World Cancer Day — awareness that matters 🎗️',
      intro: 'Many organisations mark World Cancer Day with an awareness or wellness activity for their staff and community.',
    },
  },
  {
    slug: 'world-health-day',
    name: 'World Health Day',
    nameAr: 'يوم الصحة العالمي',
    type: 'awareness',
    corporateOnly: true,
    audience: 'all',
    leadDays: 22,
    sendDaysBefore: 7,
    fixed: { month: 4, day: 7 },
    copy: {
      subject: 'Host a wellness day for your team 🌿',
      heading: 'World Health Day — a wellness day for your team 🌿',
      intro: 'World Health Day is a lovely reason to bring a wellness activity to your workplace, school or clinic.',
    },
  },
  {
    slug: 'earth-day',
    name: 'Earth Day',
    nameAr: 'يوم الأرض',
    type: 'awareness',
    corporateOnly: true,
    audience: 'all',
    leadDays: 22,
    sendDaysBefore: 7,
    fixed: { month: 4, day: 22 },
    copy: {
      subject: 'Mark Earth Day with a green activity 🌍',
      heading: 'Earth Day — a green day for your organisation 🌍',
      intro: 'Celebrate Earth Day with an eco-themed awareness activity for your team or students.',
    },
  },
  {
    slug: 'world-environment-day',
    name: 'World Environment Day',
    nameAr: 'اليوم العالمي للبيئة',
    type: 'awareness',
    corporateOnly: true,
    audience: 'all',
    leadDays: 22,
    sendDaysBefore: 7,
    fixed: { month: 6, day: 5 },
    copy: {
      subject: 'A sustainability activity for your team 🌱',
      heading: 'World Environment Day 🌱',
      intro: 'World Environment Day is a great moment for a green, sustainability-themed activity at your organisation.',
    },
  },
  {
    slug: 'intl-youth-day',
    name: 'International Youth Day',
    nameAr: 'اليوم العالمي للشباب',
    type: 'awareness',
    corporateOnly: true,
    audience: 'all',
    leadDays: 20,
    sendDaysBefore: 6,
    fixed: { month: 8, day: 12 },
    copy: {
      subject: 'Celebrate your young people 🌟',
      heading: 'International Youth Day 🌟',
      intro: 'Schools, universities and youth programmes love to mark this day with an engaging event for their students.',
    },
  },
  {
    slug: 'older-persons-day',
    name: 'Day of Older Persons',
    nameAr: 'يوم كبار السن',
    type: 'awareness',
    corporateOnly: true,
    audience: 'all',
    leadDays: 20,
    sendDaysBefore: 6,
    fixed: { month: 10, day: 1 },
    copy: {
      subject: 'Honour our elders with a warm gathering 🤍',
      heading: 'International Day of Older Persons 🤍',
      intro: 'A thoughtful gathering to honour senior citizens — perfect for community centres, care homes and organisations.',
    },
  },
  {
    slug: 'breast-cancer-awareness',
    name: 'Breast Cancer Awareness (Pink October)',
    nameAr: 'أكتوبر الوردي',
    type: 'awareness',
    corporateOnly: true,
    audience: 'all',
    leadDays: 24,
    sendDaysBefore: 7,
    fixed: { month: 10, day: 1 },
    copy: {
      subject: 'Plan your Pink October awareness day 🎀',
      heading: 'Pink October — Breast Cancer Awareness 🎀',
      intro: 'Many organisations mark Pink October with an awareness activity for their team and community.',
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
  {
    slug: 'valentines-day', name: 'Valentine’s Day', nameAr: 'يوم الحب', type: 'commercial',
    audience: 'all', leadDays: 20, sendDaysBefore: 7, fixed: { month: 2, day: 14 },
    copy: { subject: 'Make this Valentine’s unforgettable 💕', heading: 'A little love, beautifully done 💕',
      intro: 'Plan a romantic surprise or a sweet celebration — styled décor, a dessert corner and every detail handled.', ctaLabel: 'Plan a Valentine’s surprise' },
  },
  {
    slug: 'haq-al-laila', name: 'Haq Al Laila', nameAr: 'حق الليلة', type: 'commercial',
    audience: 'all', leadDays: 20, sendDaysBefore: 7, variable: { 2026: '2026-02-02', 2027: '2027-01-23' },
    copy: { subject: 'Celebrate Haq Al Laila the Emirati way 🌙', heading: 'Haq Al Laila is coming 🌙',
      intro: 'Mark this beloved Emirati tradition with a joyful setup — sweets, giveaways and heritage décor for the little ones.', ctaLabel: 'Plan your Haq Al Laila' },
  },
  {
    slug: 'chinese-new-year', name: 'Chinese New Year', nameAr: 'رأس السنة الصينية', type: 'seasonal',
    audience: 'all', leadDays: 25, sendDaysBefore: 10, variable: { 2026: '2026-02-17', 2027: '2027-02-06' },
    copy: { subject: 'Ring in the Lunar New Year 🧧', heading: 'Happy Chinese New Year 🧧',
      intro: 'Celebrate with a vibrant, on-theme setup — décor, live stations and interactive moments your guests will love.', ctaLabel: 'Plan a Lunar New Year event' },
  },
  {
    slug: 'easter', name: 'Easter', nameAr: 'عيد الفصح', type: 'seasonal',
    audience: 'all', leadDays: 20, sendDaysBefore: 7, variable: { 2026: '2026-04-05', 2027: '2027-03-28' },
    copy: { subject: 'Hop into a beautiful Easter celebration 🐰', heading: 'An Easter to remember 🐰',
      intro: 'From egg hunts to pastel décor and dessert corners — we’ll style a joyful Easter for families or teams.', ctaLabel: 'Plan an Easter celebration' },
  },
  {
    slug: 'workers-day', name: 'International Workers’ Day', nameAr: 'يوم العمال العالمي', type: 'commercial',
    audience: 'all', leadDays: 20, sendDaysBefore: 7, fixed: { month: 5, day: 1 },
    copy: { subject: 'Celebrate your team this Workers’ Day 💪', heading: 'Honour your people 💪',
      intro: 'Show your staff appreciation with a thoughtful gathering — food stations, giveaways and a feel-good setup.', ctaLabel: 'Plan a staff celebration' },
  },
  {
    slug: 'fathers-day', name: 'Father’s Day', nameAr: 'يوم الأب', type: 'commercial',
    audience: 'all', leadDays: 20, sendDaysBefore: 7, variable: { 2026: '2026-06-21', 2027: '2027-06-20' },
    copy: { subject: 'Make Dad’s day special 💙', heading: 'Celebrate the dads 💙',
      intro: 'Plan a warm family gathering or a surprise for the special dads — beautifully styled, fully handled.', ctaLabel: 'Plan a Father’s Day surprise' },
  },
  {
    slug: 'intl-friendship-day', name: 'International Friendship Day', nameAr: 'يوم الصداقة العالمي', type: 'commercial',
    audience: 'all', leadDays: 18, sendDaysBefore: 5, fixed: { month: 7, day: 30 },
    copy: { subject: 'Gather your favourite people 💛', heading: 'Happy Friendship Day 💛',
      intro: 'Bring friends or colleagues together with a fun, interactive setup — activities, treats and photo moments.', ctaLabel: 'Plan a get-together' },
  },
  {
    slug: 'onam', name: 'Onam', nameAr: 'أونام', type: 'seasonal',
    audience: 'all', leadDays: 20, sendDaysBefore: 7, variable: { 2026: '2026-08-26', 2027: '2027-09-14' },
    copy: { subject: 'Celebrate Onam in full colour 🌸', heading: 'Happy Onam 🌸',
      intro: 'Mark the harvest festival with vibrant décor, a pookalam setup and live food stations — for families or teams.', ctaLabel: 'Plan an Onam celebration' },
  },
  {
    slug: 'intl-charity-day', name: 'International Day of Charity', nameAr: 'يوم العمل الخيري العالمي', type: 'awareness',
    audience: 'all', corporateOnly: true, leadDays: 18, sendDaysBefore: 5, fixed: { month: 9, day: 5 },
    copy: { subject: 'Mark the Day of Charity with your team 🤍', heading: 'A day to give back 🤍',
      intro: 'Rally your people around a meaningful CSR activation or fundraising event — thoughtfully organised end to end.', ctaLabel: 'Plan a charity activation' },
  },
  {
    slug: 'world-mental-health-day', name: 'World Mental Health Day', nameAr: 'يوم الصحة النفسية العالمي', type: 'awareness',
    audience: 'all', corporateOnly: true, leadDays: 18, sendDaysBefore: 5, fixed: { month: 10, day: 10 },
    copy: { subject: 'Support your team’s wellbeing 🌿', heading: 'World Mental Health Day 🌿',
      intro: 'Host a calming wellbeing activation for your staff — relaxing workshops, refreshment corners and feel-good moments.', ctaLabel: 'Plan a wellbeing day' },
  },
  {
    slug: 'diwali', name: 'Diwali', nameAr: 'ديوالي', type: 'seasonal',
    audience: 'all', leadDays: 22, sendDaysBefore: 8, variable: { 2026: '2026-11-08', 2027: '2027-10-29' },
    copy: { subject: 'Light up Diwali in style ✨', heading: 'Happy Diwali ✨',
      intro: 'Celebrate the festival of lights with radiant décor, live sweets stations and interactive moments.', ctaLabel: 'Plan a Diwali celebration' },
  },
  {
    slug: 'intl-mens-day', name: 'International Men’s Day', nameAr: 'يوم الرجل العالمي', type: 'commercial',
    audience: 'all', leadDays: 16, sendDaysBefore: 5, fixed: { month: 11, day: 19 },
    copy: { subject: 'Celebrate the men who make a difference 💙', heading: 'International Men’s Day 💙',
      intro: 'Recognise the men in your team or family with a thoughtful gathering — great food and a relaxed, feel-good setup.', ctaLabel: 'Plan a celebration' },
  },
  {
    slug: 'world-childrens-day', name: 'World Children’s Day', nameAr: 'يوم الطفل العالمي', type: 'commercial',
    audience: 'all', leadDays: 18, sendDaysBefore: 5, fixed: { month: 11, day: 20 },
    copy: { subject: 'A day all about the kids 🎈', heading: 'Happy World Children’s Day 🎈',
      intro: 'Delight the little ones with games, activity stations, entertainers and playful décor — for families or schools.', ctaLabel: 'Plan a kids’ celebration' },
  },
  {
    slug: 'day-of-determination', name: 'Int’l Day of Persons of Determination', nameAr: 'اليوم العالمي لأصحاب الهمم', type: 'awareness',
    audience: 'all', corporateOnly: true, leadDays: 18, sendDaysBefore: 5, fixed: { month: 12, day: 3 },
    copy: { subject: 'An inclusive celebration for People of Determination 🤍', heading: 'Day of Persons of Determination 🤍',
      intro: 'Host a warm, inclusive activation that brings everyone together — thoughtfully designed and accessible to all.', ctaLabel: 'Plan an inclusive event' },
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

/** The real things people actually request for this kind of event — photo booth,
 *  a main backdrop/stand, giveaways, décor, and a hands-on activity (flower
 *  arranging, pottery painting…). Chosen to fit each occasion, never generic. */
function servicesFor(o: Occasion): string[] {
  const s = o.slug;
  if (['halloween', 'uae-childrens-day', 'hag-al-laila', 'back-to-school'].includes(s))
    return ['📸 Photo booth with fun props', '🖼️ Themed backdrop & main stand', '🎈 Balloon & themed décor', '🎨 Kids activity station (crafts, pottery painting)', '🎁 Party favours & giveaways', '🎭 Characters, mascots & face painting'];
  if (s === 'graduation-season')
    return ['🖼️ Graduation backdrop & stage', '📸 Photo booth with props', '🎓 Décor in the school/college colours', '🎁 Graduation favours & giveaways', '🍰 Dessert tables & catering'];
  if (['uae-mothers-day', 'intl-womens-day', 'intl-day-families'].includes(s))
    return ['🌸 Elegant floral & themed décor', '🖼️ Feature backdrop & photo corner', '📸 Photo booth', '🎨 Flower-arranging or pottery-painting activity', '🎁 Thoughtful giveaways', '🍰 Tea / brunch dessert tables'];
  if (['uae-national-day', 'uae-flag-day'].includes(s))
    return ['🇦🇪 Décor & backdrop in the nation’s colours', '📸 Photo booth with national props', '🎁 National Day giveaways for staff & guests', '🎨 Cultural activity corner', '🍽️ Food & sweets stations'];
  if (['ramadan', 'eid-al-fitr', 'eid-al-adha'].includes(s))
    return ['🌙 Majlis & Eid-themed décor', '🖼️ Feature backdrop & photo corner', '🍽️ Iftar / gathering catering stations', '🎁 Eid giveaways', '🍰 Sweets & dessert tables'];
  if (['new-year', 'christmas'].includes(s))
    return ['✨ Festive décor & lighting', '🖼️ Feature backdrop & photo booth', '🎁 Festive giveaways', '🍰 Dessert tables & catering', '🎉 Entertainment'];
  if (s === 'intl-day-happiness')
    return ['🎈 Joyful themed setup & backdrop', '📸 Photo booth', '🎨 Feel-good activity (flower arranging / pottery)', '🎁 Small giveaways', '🍰 Treat tables'];
  if (s === 'world-teachers-day')
    return ['🍎 Teacher-appreciation backdrop & décor', '📸 Photo booth', '🎁 Thank-you gifts & giveaways', '🎨 Appreciation activity corner', '🍰 Dessert & catering'];
  if (['world-cancer-day', 'breast-cancer-awareness'].includes(s))
    return ['🖼️ Awareness backdrop & branded stand', '📸 Photo booth with awareness props', '🎗️ Ribbons, giveaways & tote bags', '🌸 Themed décor in the awareness colour', '🎨 Activity corner (flower arranging / pledge wall)', '🧺 Refreshments corner'];
  if (['world-health-day', 'world-environment-day', 'earth-day'].includes(s))
    return ['🖼️ Awareness backdrop & branded stand', '📸 Photo booth', '🌱 Themed eco / wellness décor', '🎨 Activity corner (planting, pottery, flowers)', '🎁 Branded giveaways', '🧺 Healthy refreshments corner'];
  if (s === 'intl-youth-day')
    return ['🖼️ Event backdrop & stage', '📸 Photo booth', '🎨 Interactive activity stations', '🎮 Games & entertainment', '🎁 Giveaways', '🍰 Refreshments'];
  if (s === 'older-persons-day')
    return ['🤍 Warm gathering setup & backdrop', '📸 Keepsake photo corner', '🎨 Gentle activity (flower arranging)', '🎶 Entertainment', '🍰 Catering & refreshments', '🎁 Thoughtful giveaways'];
  return ['📸 Photo booth', '🖼️ Feature backdrop & main stand', '🌸 Beautiful themed décor', '🎨 Interactive activity (flowers / pottery)', '🎁 Giveaways & favours', '🍰 Catering & dessert tables'];
}

/** Owner-authored overrides for an occasion's email (from occasion_settings).
 *  `customConsumer`/`customCorp` are FULL bodies learned from the owner's edits —
 *  when present they replace the generated body entirely for that audience. */
export interface OccasionOverride { services?: string[]; intro?: string; offer?: string; customConsumer?: string; customCorp?: string }

/** Inner campaign HTML (wrapped in the Eventana shell — which adds the WhatsApp
 *  contact CTA — at send time). Greeting-only occasions carry no services/pitch.
 *  `ov` lets the owner override the services list, intro, and add a CUSTOMER offer. */
export function buildOccasionBody(o: Occasion, ov?: OccasionOverride): string {
  if (ov?.customConsumer) return ov.customConsumer; // learned from the owner's edit
  const heading = `<p style="font-size:19px;font-weight:800;margin:0 0 12px;color:#3B3641">${o.copy.heading}</p>`;
  const greet = `<p style="margin:0 0 14px">Hi {{name}},</p>`;
  const intro = `<p style="margin:0 0 14px">${ov?.intro || o.copy.intro}</p>`;
  if (o.greetingOnly) {
    return `${heading}${greet}${intro}<p style="margin:16px 0 0">With love,<br/>The Eventana Team 💕</p>`;
  }
  // A customer offer (e.g. "10% off this week") — shown as a highlighted banner.
  const offer = ov?.offer
    ? `<div style="background:#FDEFF6;border:2px dashed #F3B6D2;border-radius:16px;padding:14px 16px;text-align:center;margin:4px 0 14px">
         <div style="font-size:12px;font-weight:800;color:#c98bb0;letter-spacing:1px">SPECIAL OFFER</div>
         <div style="font-size:17px;font-weight:800;color:#E94F9C;margin-top:2px">${ov.offer}</div>
       </div>`
    : '';
  const services = (ov?.services && ov.services.length ? ov.services : servicesFor(o));
  const list = `
    <p style="margin:18px 0 8px;font-weight:700;color:#3B3641">What we can bring for you:</p>
    <ul style="margin:0;padding-left:20px">
      ${services.map((x) => `<li style="margin:0 0 6px">${x}</li>`).join('')}
    </ul>`;
  return `${heading}${greet}${intro}${offer}${list}<p style="margin:16px 0 0">With love,<br/>The Eventana Team 💕</p>`;
}

/** Corporate (B2B) version of an occasion email — for schools, companies, banks,
 *  clinics, etc. Positions Eventana as their events partner, with the same
 *  tailored services and the shell's WhatsApp contact. No website link. */
export function buildCorporateBody(o: Occasion, ov?: OccasionOverride): string {
  if (ov?.customCorp) return ov.customCorp; // learned from the owner's edit
  const services = (ov?.services && ov.services.length ? ov.services : servicesFor(o));
  const servicesList = `
    <p style="margin:18px 0 8px;font-weight:700;color:#3B3641">What we can arrange for ${o.name}:</p>
    <ul style="margin:0;padding-left:20px">
      ${services.map((x) => `<li style="margin:0 0 6px">${x}</li>`).join('')}
    </ul>`;
  // A strong, specific "why us" — local cultural expertise is our real edge.
  const whyUs = `
    <p style="margin:18px 0 8px;font-weight:700;color:#3B3641">Why organisations choose Eventana:</p>
    <ul style="margin:0;padding-left:20px">
      <li style="margin:0 0 6px">🇦🇪 We know the UAE’s occasions and local culture better than anyone — every detail done right and appropriate.</li>
      <li style="margin:0 0 6px">🎨 Concepts tailored to your brand, theme and budget — not off-the-shelf.</li>
      <li style="margin:0 0 6px">✅ Fully managed — design, setup and teardown handled end-to-end.</li>
      <li style="margin:0 0 6px">💛 Trusted across Abu Dhabi &amp; Dubai by families and organisations alike.</li>
    </ul>`;
  return `
    <p style="font-size:19px;font-weight:800;margin:0 0 12px;color:#3B3641">${o.copy.heading}</p>
    <p style="margin:0 0 4px;font-size:12px;font-weight:700;color:#8a7f88;letter-spacing:.3px">Attn: Procurement / Events Department</p>
    <p style="margin:0 0 14px">Hello <b>{{name}}</b>,</p>
    <p style="margin:0 0 4px">${ov?.intro || `With ${o.name} coming up, many organisations across the UAE mark it with a special activity for their people and guests — and Eventana can create it beautifully, tailored to you.`}</p>
    <p style="margin:14px 0 4px"><b>Could you kindly point us to the right person</b> in your procurement or events team? We’ll send the details straight to them — just reply with their name and email.</p>
    ${servicesList}
    ${whyUs}
    <p style="margin:16px 0 6px">Share your date and a rough budget, and we’ll send you a tailored proposal.</p>
    <p style="margin:12px 0 0">Warm regards,<br/>The Eventana Team</p>`;
}

/** The owner's saved overrides for an occasion (services / intro / offer). */
export async function getOccasionOverrides(slug: string): Promise<OccasionOverride> {
  type Row = { services: string | null; intro: string | null; offer: string | null; custom_body_consumer: string | null; custom_body_corp: string | null };
  const { rows } = await pool.query<Row>(
    `SELECT services, intro, offer, custom_body_consumer, custom_body_corp FROM occasion_settings WHERE slug = $1`, [slug],
  ).catch(() => ({ rows: [] as Row[] }));
  const r = rows[0];
  if (!r) return {};
  const services = r.services ? r.services.split(/\r?\n/).map((s: string) => s.trim()).filter(Boolean) : undefined;
  return {
    services: services && services.length ? services : undefined,
    intro: r.intro || undefined, offer: r.offer || undefined,
    customConsumer: r.custom_body_consumer || undefined, customCorp: r.custom_body_corp || undefined,
  };
}

/** Persist the owner's manual edit of an occasion campaign as the reusable body
 *  for that audience — the system "learns" so next time it's ready. */
export async function learnFromCampaign(id: number): Promise<void> {
  const { rows } = await pool.query<{ dedupe_key: string | null; source: string; body_html: string }>(
    `SELECT dedupe_key, source, body_html FROM email_campaigns WHERE id = $1`, [id],
  );
  const c = rows[0];
  if (!c?.dedupe_key || !['occasion', 'occasion_corp'].includes(c.source)) return;
  const slug = c.dedupe_key.split('|')[1];
  const col = c.dedupe_key.endsWith('|corp') ? 'custom_body_corp' : 'custom_body_consumer';
  await pool.query(
    `INSERT INTO occasion_settings (slug, ${col}, updated_at) VALUES ($1,$2,now())
     ON CONFLICT (slug) DO UPDATE SET ${col} = EXCLUDED.${col}, updated_at = now()`,
    [slug, c.body_html],
  ).catch(() => {});
}

/** Save (upsert) the owner's overrides for an occasion; reused every year. */
export async function saveOccasionSettings(
  slug: string, d: { services?: string; intro?: string; offer?: string; by?: string },
): Promise<void> {
  if (!OCCASIONS.some((o) => o.slug === slug)) throw new Error('unknown_occasion');
  await pool.query(
    `INSERT INTO occasion_settings (slug, services, intro, offer, updated_by, updated_at)
     VALUES ($1,$2,$3,$4,$5,now())
     ON CONFLICT (slug) DO UPDATE SET
       services = EXCLUDED.services, intro = EXCLUDED.intro, offer = EXCLUDED.offer,
       updated_by = EXCLUDED.updated_by, updated_at = now()`,
    [slug, d.services ?? null, d.intro ?? null, d.offer ?? null, d.by ?? null],
  );
}

/** Rebuild ONE campaign's email from its occasion template + saved services
 *  (the "Regenerate" action — for when the owner doesn't like the current copy).
 *  Only works on an editable auto occasion draft. Returns true if rebuilt. */
export async function regenerateCampaign(id: number): Promise<boolean> {
  const { rows } = await pool.query<{ dedupe_key: string | null; source: string; status: string }>(
    `SELECT dedupe_key, source, status FROM email_campaigns WHERE id = $1`, [id],
  );
  const c = rows[0];
  if (!c || !c.dedupe_key || !['occasion', 'occasion_corp'].includes(c.source)) return false;
  if (!['draft', 'pending_approval', 'scheduled'].includes(c.status)) return false;
  const slug = c.dedupe_key.split('|')[1];
  const isCorp = c.dedupe_key.endsWith('|corp');
  const o = OCCASIONS.find((x) => x.slug === slug);
  if (!o) return false;
  // Regenerate = throw away any learned custom body and rebuild fresh from the
  // template (that's the whole point — the owner didn't like the current copy).
  const ov = await getOccasionOverrides(slug);
  const fresh: OccasionOverride = { ...ov, customConsumer: undefined, customCorp: undefined };
  const subject = isCorp ? `${o.copy.subject} — for your organisation` : o.copy.subject;
  const body = isCorp ? buildCorporateBody(o, fresh) : buildOccasionBody(o, fresh);
  await pool.query(`UPDATE email_campaigns SET subject = $2, body_html = $3 WHERE id = $1`, [id, subject, body]);
  await pool.query(`UPDATE occasion_settings SET ${isCorp ? 'custom_body_corp' : 'custom_body_consumer'} = NULL WHERE slug = $1`, [slug]).catch(() => {});
  return true;
}

/** Rebuild the current editable drafts for ONE occasion from its templates +
 *  saved overrides (used right after the owner edits an occasion's services). */
export async function regenerateOneOccasion(slug: string): Promise<number> {
  const o = OCCASIONS.find((x) => x.slug === slug);
  if (!o) return 0;
  const ov = await getOccasionOverrides(slug);
  const { rows } = await pool.query<{ id: string; dedupe_key: string }>(
    `SELECT id, dedupe_key FROM email_campaigns
      WHERE source IN ('occasion','occasion_corp') AND status IN ('draft','pending_approval','scheduled')
        AND (dedupe_key LIKE $1 OR dedupe_key LIKE $2)`,
    [`occasion|${slug}|%`, `occasion|${slug}|%|corp`],
  );
  let n = 0;
  for (const r of rows) {
    const isCorp = r.dedupe_key.endsWith('|corp');
    const subject = isCorp ? `${o.copy.subject} — for your organisation` : o.copy.subject;
    const body = isCorp ? buildCorporateBody(o, ov) : buildOccasionBody(o, ov);
    await pool.query(`UPDATE email_campaigns SET subject = $2, body_html = $3 WHERE id = $1`, [r.id, subject, body]);
    n++;
  }
  return n;
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
  // Self-heal any drafts still on an older template (safe: stale-only, so manual
  // edits are never touched). Fixes drafts prepared before a template change.
  await regenerateOccasionDrafts().catch(() => 0);
  const { pushToOwner } = await import('../integrations/push.js');
  const targets = (await pool.query<{ id: string }>(
    `SELECT id FROM team_members WHERE active AND (lower(name) = 'marsha' OR access_level = 'owner')`,
  )).rows;
  // Do we have any businesses we can email? (drives the corporate draft).
  const haveCorp = (await pool.query(
    `SELECT 1 FROM corporate_leads WHERE email IS NOT NULL AND email <> '' AND email_opt_out = FALSE AND status <> 'not_interested' LIMIT 1`,
  ).catch(() => ({ rowCount: 0 }))).rowCount;

  let prepared = 0;
  const createDraft = async (
    dedupeKey: string, audience: string, subject: string, body: string, source: string, label: string, dateISO: string, scheduledFor: Date,
  ): Promise<void> => {
    const exists = await pool.query(`SELECT 1 FROM email_campaigns WHERE dedupe_key = $1`, [dedupeKey]);
    if (exists.rowCount) return;
    let ins;
    try {
      ins = await pool.query<{ id: string }>(
        `INSERT INTO email_campaigns (subject, body_html, audience, status, scheduled_for, created_by, source, dedupe_key)
         VALUES ($1,$2,$3,'pending_approval',$4,'Eventana AI',$5,$6) RETURNING id`,
        [subject, body, audience, scheduledFor.toISOString(), source, dedupeKey],
      );
    } catch {
      return; // race on the unique dedupe index
    }
    prepared++;
    const dateLabel = new Date(`${dateISO}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', timeZone: 'UTC' });
    for (const t of targets) {
      await pushToOwner('staff', t.id, '📣 A marketing campaign is ready to review',
        `${label} (${dateLabel}) — a draft email is waiting in Marketing. Review, edit and approve.`,
        { campaignId: String(ins.rows[0].id) }).catch(() => {});
    }
    console.log(`[marketing-calendar] prepared "${label}" for ${dateISO} (send ${scheduledFor.toISOString().slice(0, 10)})`);
  };

  // A shared to-do for owner + Marsha ~a month before a SELLING occasion (never
  // for greeting-only days). Whoever ticks it off clears it for both (link_key).
  const ensureOccasionTask = async (o: Occasion, dateISO: string, year: number): Promise<void> => {
    const linkKey = `mktg|${o.slug}|${year}`;
    const exists = await pool.query(`SELECT 1 FROM focus_tasks WHERE link_key = $1 LIMIT 1`, [linkKey]);
    if (exists.rowCount) return;
    const dateLabel = new Date(`${dateISO}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', timeZone: 'UTC' });
    const title = `📣 ${o.name} (${dateLabel}) — review & approve the marketing campaign`;
    for (const t of targets) {
      await pool.query(
        `INSERT INTO focus_tasks (member_id, title, sort_order, link_key)
         VALUES ($1,$2,COALESCE((SELECT MIN(sort_order) - 1 FROM focus_tasks WHERE member_id = $1 AND NOT done),0),$3)`,
        [t.id, title, linkKey],
      ).catch(() => {});
    }
  };

  for (const o of OCCASIONS) {
    const next = nextOccasionDate(o, now);
    if (!next) continue; // variable date not confirmed for an upcoming year
    const away = daysUntil(next.dateISO, now);
    if (away > o.leadDays || away < o.sendDaysBefore) continue;
    const scheduledFor = sendTime(next.dateISO, o.sendDaysBefore);
    const ov = await getOccasionOverrides(o.slug);
    // Consumer draft (to our customers) — skipped for corporate-only occasions.
    if (!o.corporateOnly) {
      await createDraft(`occasion|${o.slug}|${next.year}`, o.audience, o.copy.subject, buildOccasionBody(o, ov), 'occasion', o.name, next.dateISO, scheduledFor);
    }
    // Corporate draft (to businesses) — for any selling/awareness occasion when
    // we actually have companies to email.
    if (!o.greetingOnly && haveCorp) {
      await createDraft(`occasion|${o.slug}|${next.year}|corp`, 'corp:all', `${o.copy.subject} — for your organisation`, buildCorporateBody(o, ov), 'occasion_corp', `${o.name} (companies)`, next.dateISO, scheduledFor);
    }
    // Owner + Marsha to-do for selling occasions that actually have a draft to act
    // on (greeting-only days like Commemoration Day never create a task).
    if (!o.greetingOnly) {
      const hasDraft = await pool.query(
        `SELECT 1 FROM email_campaigns WHERE dedupe_key IN ($1,$2) LIMIT 1`,
        [`occasion|${o.slug}|${next.year}`, `occasion|${o.slug}|${next.year}|corp`],
      );
      if (hasDraft.rowCount) await ensureOccasionTask(o, next.dateISO, next.year);
    }
  }
  return prepared;
}

/**
 * Prepare ONE occasion's draft on demand (dashboard "Prepare now"), even outside
 * the lead window. Returns the campaign id, or the existing one if already made.
 */
export async function prepareOccasionNow(slug: string, opts?: { corporate?: boolean }): Promise<{ id: string; created: boolean } | null> {
  const o = OCCASIONS.find((x) => x.slug === slug);
  if (!o) return null;
  const next = nextOccasionDate(o);
  if (!next) return null;
  // Corporate draft when the occasion is corporate-only, OR the caller asked for
  // the company version (and it isn't a greeting-only day). Else the consumer draft.
  const corp = Boolean(o.corporateOnly) || (Boolean(opts?.corporate) && !o.greetingOnly);
  const dedupeKey = corp ? `occasion|${o.slug}|${next.year}|corp` : `occasion|${o.slug}|${next.year}`;
  const existing = await pool.query<{ id: string }>(`SELECT id FROM email_campaigns WHERE dedupe_key = $1`, [dedupeKey]);
  if (existing.rows[0]) return { id: String(existing.rows[0].id), created: false };
  const away = daysUntil(next.dateISO);
  // If it's too close to honour the normal pre-send lead, schedule for tomorrow 10:00 Dubai.
  const scheduledFor = away < o.sendDaysBefore ? sendTime(new Date(Date.now() + 86_400_000).toISOString().slice(0, 10), 0) : sendTime(next.dateISO, o.sendDaysBefore);
  const ov = await getOccasionOverrides(slug);
  const ins = await pool.query<{ id: string }>(
    `INSERT INTO email_campaigns (subject, body_html, audience, status, scheduled_for, created_by, source, dedupe_key)
     VALUES ($1,$2,$3,'pending_approval',$4,'Eventana AI',$5,$6)
     RETURNING id`,
    corp
      ? [`${o.copy.subject} — for your organisation`, buildCorporateBody(o, ov), 'corp:all', scheduledFor.toISOString(), 'occasion_corp', dedupeKey]
      : [o.copy.subject, buildOccasionBody(o, ov), o.audience, scheduledFor.toISOString(), 'occasion', dedupeKey],
  );
  return { id: String(ins.rows[0].id), created: true };
}

/**
 * Rebuild the subject + body of every still-editable auto occasion draft from the
 * CURRENT templates — used after a template change so drafts prepared earlier pick
 * up the new design (services list, no website link, etc.). Skips sent campaigns.
 */
export async function regenerateOccasionDrafts(opts?: { all?: boolean }): Promise<number> {
  // By default only refresh STALE drafts — those still holding the old inline
  // website button (`<a `), which the new template never produces. This makes it
  // safe to run every sweep: new drafts and manual plain-text edits never match,
  // so a person's edits are never clobbered. `all:true` rewrites every draft.
  const staleOnly = opts?.all ? '' : `AND (body_html LIKE '%<a %' OR body_html LIKE '%Or reply to this email%' OR body_html LIKE '%students or guests%' OR body_html LIKE '%How we can help your organisation%')`;
  const { rows } = await pool.query<{ id: string; dedupe_key: string }>(
    `SELECT id, dedupe_key FROM email_campaigns
      WHERE source IN ('occasion','occasion_corp')
        AND status IN ('draft','pending_approval','scheduled')
        AND dedupe_key IS NOT NULL ${staleOnly}`,
  );
  let n = 0;
  for (const r of rows) {
    const parts = r.dedupe_key.split('|'); // occasion | slug | year | [corp]
    const slug = parts[1];
    const isCorp = parts[3] === 'corp';
    const o = OCCASIONS.find((x) => x.slug === slug);
    if (!o) continue;
    const ov = await getOccasionOverrides(slug);
    const subject = isCorp ? `${o.copy.subject} — for your organisation` : o.copy.subject;
    const body = isCorp ? buildCorporateBody(o, ov) : buildOccasionBody(o, ov);
    await pool.query(`UPDATE email_campaigns SET subject = $2, body_html = $3 WHERE id = $1`, [r.id, subject, body]);
    n++;
  }
  console.log(`[marketing] regenerated ${n} occasion draft(s)`);
  return n;
}

/**
 * The calendar as the dashboard shows it: every occasion's next date, how far
 * away, its type, and the linked auto-campaign's status (if any).
 */
type CalCampaign = { id: string; status: string; scheduledFor: string | null } | null;
export async function marketingCalendar(): Promise<
  Array<{
    slug: string; name: string; nameAr: string; type: OccasionType;
    greetingOnly: boolean; corporateOnly: boolean;
    dateISO: string | null; daysAway: number | null; needsDateConfirm: boolean;
    consumer: CalCampaign; corporate: CalCampaign;
    services: string[]; servicesCustom: boolean; intro: string; offer: string;
  }>
> {
  const now = new Date();
  const lookup = async (key: string): Promise<CalCampaign> => {
    const r = (await pool.query<{ id: string; status: string; scheduled_for: string | null }>(
      `SELECT id, status, scheduled_for FROM email_campaigns WHERE dedupe_key = $1`, [key],
    )).rows[0];
    return r ? { id: String(r.id), status: r.status, scheduledFor: r.scheduled_for } : null;
  };
  const rows = await Promise.all(
    OCCASIONS.map(async (o) => {
      const next = nextOccasionDate(o, now);
      const ov = await getOccasionOverrides(o.slug);
      const consumer = next && !o.corporateOnly ? await lookup(`occasion|${o.slug}|${next.year}`) : null;
      const corporate = next && !o.greetingOnly ? await lookup(`occasion|${o.slug}|${next.year}|corp`) : null;
      return {
        slug: o.slug, name: o.name, nameAr: o.nameAr, type: o.type,
        greetingOnly: Boolean(o.greetingOnly), corporateOnly: Boolean(o.corporateOnly),
        dateISO: next?.dateISO ?? null,
        daysAway: next ? daysUntil(next.dateISO, now) : null,
        needsDateConfirm: Boolean(o.variable) && !next,
        consumer, corporate,
        services: ov.services && ov.services.length ? ov.services : servicesFor(o),
        servicesCustom: Boolean(ov.services && ov.services.length),
        intro: ov.intro || '',
        offer: ov.offer || '',
      };
    }),
  );
  return rows.sort((a, b) => {
    if (a.daysAway == null) return 1;
    if (b.daysAway == null) return -1;
    return a.daysAway - b.daysAway;
  });
}
