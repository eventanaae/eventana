/**
 * WhatsApp leads — who asked, for which date, and did it become a booking.
 *
 * The gap this closes: Eventana's ads buy WhatsApp conversations (6,000+ of
 * them), but nothing ever wrote down what happened next. Ads Manager can
 * report a conversation; only this table can report a BOOKING.
 *
 * Every inbound message updates one row per phone number. The party date is
 * read out of the customer's own words — Arabic or English — and stored the
 * moment it is mentioned, not only when they confirm, so a date is never
 * lost to an ambiguous "تمام" later.
 */

import { pool } from '../db/pool.js';
import type { InboundMessage } from '../integrations/whatsapp.js';

export type LeadStatus = 'new' | 'quoted' | 'confirmed' | 'booked' | 'lost';

export interface Lead {
  phone: string;
  name: string | null;
  eventDate: string | null;
  emirate: string | null;
  status: LeadStatus;
  ctwaClid: string | null;
  sourceAdId: string | null;
  messageCount: number;
  firstMessageAt: string;
  lastMessageAt: string;
  confirmedAt: string | null;
  orderId: string | null;
}

/** Digits only, promoted to a UAE country code when the number is local. */
export function normalizePhone(raw: string): string {
  let d = (raw ?? '').replace(/\D+/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  if (d.startsWith('0')) d = `971${d.slice(1)}`;
  else if (d.length === 9 && d.startsWith('5')) d = `971${d}`;
  return d;
}

/** ٠١٢٣٤٥٦٧٨٩ and ۰۱۲۳۴۵۶۷۸۹ → 0123456789. */
function westernDigits(s: string): string {
  return s
    .replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (c) => String(c.charCodeAt(0) - 0x06f0));
}

const MONTHS: Record<string, number> = {
  // English, long and short
  january: 1, jan: 1, february: 2, feb: 2, march: 3, mar: 3, april: 4, apr: 4,
  may: 5, june: 6, jun: 6, july: 7, jul: 7, august: 8, aug: 8,
  september: 9, sep: 9, sept: 9, october: 10, oct: 10, november: 11, nov: 11,
  december: 12, dec: 12,
  // Arabic as used in the UAE
  'يناير': 1, 'فبراير': 2, 'مارس': 3, 'ابريل': 4, 'أبريل': 4, 'مايو': 5,
  'يونيو': 6, 'يوليو': 7, 'اغسطس': 8, 'أغسطس': 8, 'سبتمبر': 9,
  'اكتوبر': 10, 'أكتوبر': 10, 'نوفمبر': 11, 'ديسمبر': 12,
};

/** Sunday-first, matching how UAE weekdays are named in both languages. */
const WEEKDAYS: Record<string, number> = {
  sunday: 0, sun: 0, monday: 1, mon: 1, tuesday: 2, tue: 2, wednesday: 3, wed: 3,
  thursday: 4, thu: 4, friday: 5, fri: 5, saturday: 6, sat: 6,
  'الاحد': 0, 'الأحد': 0, 'الاثنين': 1, 'الإثنين': 1, 'الثلاثاء': 2,
  'الاربعاء': 3, 'الأربعاء': 3, 'الخميس': 4, 'الجمعة': 5, 'السبت': 6,
};

function iso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Reads a party date out of free text.
 *
 * Deliberately conservative: it returns null rather than guess. A wrong date
 * on a lead is worse than no date, because the team would plan around it.
 * Anything in the past, or more than 18 months out, is rejected as a
 * misreading rather than stored.
 */
export function parseEventDate(text: string, now = new Date()): string | null {
  if (!text) return null;
  const s = westernDigits(text).toLowerCase();

  const accept = (d: Date): string | null => {
    if (Number.isNaN(d.getTime())) return null;
    const days = (d.getTime() - now.getTime()) / 86_400_000;
    // Yesterday is tolerated (timezone edges); the future window is 18 months.
    if (days < -1 || days > 550) return null;
    return iso(d);
  };

  // "15/3", "15-03-2026", "2026-03-15"
  const numeric =
    /(?:^|\s)(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?=\s|$)/.exec(s) ??
    /(?:^|\s)(\d{1,2})[-/](\d{1,2})(?:[-/](\d{2,4}))?(?=\s|$)/.exec(s);
  if (numeric) {
    let y: number, m: number, day: number;
    if (numeric[0].trim().length >= 8 && numeric[1].length === 4) {
      [y, m, day] = [Number(numeric[1]), Number(numeric[2]), Number(numeric[3])];
    } else {
      // UAE writes day first.
      day = Number(numeric[1]);
      m = Number(numeric[2]);
      y = numeric[3]
        ? Number(numeric[3].length === 2 ? `20${numeric[3]}` : numeric[3])
        : now.getFullYear();
      // A day/month already past this year almost always means next year.
      const candidate = new Date(y, m - 1, day);
      if (!numeric[3] && candidate.getTime() < now.getTime() - 86_400_000) y += 1;
    }
    if (m >= 1 && m <= 12 && day >= 1 && day <= 31) {
      const hit = accept(new Date(y, m - 1, day));
      if (hit) return hit;
    }
  }

  // "15 March", "15 مارس", "March 15"
  // `(?![a-z])` matters: without it "mar" matches inside "marhaba" and
  // "5 marhaba" would be read as 5 March. Arabic names need no such guard.
  const monthNames = Object.keys(MONTHS).join('|');
  const dayThenMonth = new RegExp(`(\\d{1,2})\\s*(?:من\\s*)?(${monthNames})(?![a-z])`, 'i').exec(s);
  const monthThenDay = new RegExp(`(${monthNames})(?![a-z])\\s*(\\d{1,2})`, 'i').exec(s);
  const named = dayThenMonth
    ? { day: Number(dayThenMonth[1]), month: MONTHS[dayThenMonth[2]] }
    : monthThenDay
      ? { day: Number(monthThenDay[2]), month: MONTHS[monthThenDay[1]] }
      : null;
  if (named && named.month && named.day >= 1 && named.day <= 31) {
    let year = now.getFullYear();
    if (new Date(year, named.month - 1, named.day).getTime() < now.getTime() - 86_400_000) year += 1;
    const hit = accept(new Date(year, named.month - 1, named.day));
    if (hit) return hit;
  }

  // "بكرة" / "tomorrow"
  if (/\b(tomorrow)\b|بكرة|بكره/.test(s)) {
    return accept(new Date(now.getTime() + 86_400_000));
  }

  // "الجمعة الجاي" / "next friday" — the next occurrence of that weekday.
  const weekdayNames = Object.keys(WEEKDAYS).join('|');
  const weekday = new RegExp(`(${weekdayNames})(?![a-z])`, 'i').exec(s);
  if (weekday && /(الجاي|القادم|الجاية|القادمة|next|coming)/.test(s)) {
    const target = WEEKDAYS[weekday[1]];
    const d = new Date(now.getTime());
    const delta = (target - d.getDay() + 7) % 7 || 7;
    d.setDate(d.getDate() + delta);
    return accept(d);
  }

  return null;
}

/** Emirate mentioned in the message, in either language. */
export function parseEmirate(text: string): string | null {
  const s = (text ?? '').toLowerCase();
  const map: Array<[RegExp, string]> = [
    [/dubai|دبي/, 'Dubai'],
    [/abu ?dhabi|ابوظبي|أبوظبي|ابو ظبي|أبو ظبي/, 'Abu Dhabi'],
    [/sharjah|الشارقة|الشارقه/, 'Sharjah'],
    [/ajman|عجمان/, 'Ajman'],
    [/ras al|راس الخيمة|رأس الخيمة/, 'Ras Al Khaimah'],
    [/fujairah|الفجيرة|الفجيره/, 'Fujairah'],
    [/umm al|ام القيوين|أم القيوين/, 'Umm Al Quwain'],
    [/al ?ain|العين/, 'Al Ain'],
  ];
  for (const [re, name] of map) if (re.test(s)) return name;
  return null;
}

/**
 * Does this message read as the customer saying yes?
 *
 * Only ever promotes a lead that already HAS a date — "تمام" on its own is
 * far more often "understood" than "booked", and a false confirmation would
 * put a party in the team's plan that nobody agreed to.
 */
export function readsAsConfirmation(text: string): boolean {
  const s = westernDigits(text ?? '').toLowerCase().trim();
  if (!s || s.length > 120) return false;
  return /(^|\s)(تم|تمام|موافق|موافقة|اوك|أوك|اكيد|أكيد|نعم|ايوه|أيوه|ماشي|يالله نحجز|ابغى احجز|أبغى أحجز|نحجز|احجزي|book it|confirm(ed)?|yes please|go ahead|let'?s book)(\s|$|[!.،؟])/i.test(
    s,
  );
}

/* ------------------------------------------------------------------ */
/* Writes                                                              */
/* ------------------------------------------------------------------ */

export interface RecordResult {
  lead: Lead;
  /** True the first time this number ever messaged — a genuinely new lead. */
  isNew: boolean;
  /** True when this message is the one that set the party date. */
  capturedDate: boolean;
  /** True when this message flipped the lead to confirmed. */
  confirmed: boolean;
}

/**
 * Records one inbound message and updates its lead.
 *
 * Idempotent on Meta's message id: a webhook Meta retries three times
 * produces one message row and one set of updates.
 */
export async function recordInboundMessage(msg: InboundMessage): Promise<RecordResult | null> {
  const phone = normalizePhone(msg.phone);
  if (!phone) return null;

  const inserted = await pool.query(
    `INSERT INTO whatsapp_messages (phone, wa_message_id, direction, body)
     VALUES ($1, $2, 'in', $3)
     ON CONFLICT (wa_message_id) DO NOTHING
     RETURNING id`,
    [phone, msg.messageId, msg.text],
  );
  // Already processed — say nothing, do nothing, reply nothing.
  if (inserted.rowCount === 0) return null;

  const existing = await pool.query(
    `SELECT * FROM whatsapp_leads WHERE phone = $1`,
    [phone],
  );
  const prev = existing.rows[0] as Record<string, any> | undefined;

  const detectedDate = parseEventDate(msg.text, msg.timestamp);
  const detectedEmirate = parseEmirate(msg.text);
  const hasDate = Boolean(prev?.event_date) || Boolean(detectedDate);
  const confirming = readsAsConfirmation(msg.text) && hasDate;

  // Status only ever moves forward. A confirmed lead that sends another
  // question does not fall back to 'new'.
  const rank: Record<string, number> = { new: 0, quoted: 1, confirmed: 2, booked: 3, lost: 0 };
  const current: string = prev?.status ?? 'new';
  let next = current;
  if (confirming) next = 'confirmed';
  else if (hasDate && rank[current] < 1) next = 'quoted';
  if (rank[next] < rank[current]) next = current;

  const { rows } = await pool.query(
    `INSERT INTO whatsapp_leads
       (phone, name, event_date, emirate, status, ctwa_clid, source_ad_id, source_headline,
        message_count, first_message_at, last_message_at, confirmed_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,1,$9,$9,$10)
     ON CONFLICT (phone) DO UPDATE SET
       -- COALESCE order matters: never overwrite something already known
       -- with a null from a message that simply didn't mention it.
       name            = COALESCE(EXCLUDED.name, whatsapp_leads.name),
       event_date      = COALESCE(EXCLUDED.event_date, whatsapp_leads.event_date),
       emirate         = COALESCE(EXCLUDED.emirate, whatsapp_leads.emirate),
       status          = EXCLUDED.status,
       -- The FIRST ad that brought them is the one that earned the lead.
       ctwa_clid       = COALESCE(whatsapp_leads.ctwa_clid, EXCLUDED.ctwa_clid),
       source_ad_id    = COALESCE(whatsapp_leads.source_ad_id, EXCLUDED.source_ad_id),
       source_headline = COALESCE(whatsapp_leads.source_headline, EXCLUDED.source_headline),
       message_count   = whatsapp_leads.message_count + 1,
       last_message_at = EXCLUDED.last_message_at,
       confirmed_at    = COALESCE(whatsapp_leads.confirmed_at, EXCLUDED.confirmed_at),
       updated_at      = now()
     RETURNING *`,
    [
      phone,
      msg.name,
      detectedDate,
      detectedEmirate,
      next,
      msg.ctwaClid,
      msg.sourceAdId,
      msg.sourceHeadline,
      msg.timestamp,
      confirming ? msg.timestamp : null,
    ],
  );

  return {
    lead: toLead(rows[0]),
    isNew: !prev,
    capturedDate: Boolean(detectedDate) && !prev?.event_date,
    confirmed: confirming && current !== 'confirmed',
  };
}

/** Records a message this system sent, so the lead history stays complete. */
export async function recordOutboundMessage(args: {
  phone: string;
  body: string;
  messageId?: string | null;
  sentBy: 'agent' | 'staff';
}): Promise<void> {
  await pool.query(
    `INSERT INTO whatsapp_messages (phone, wa_message_id, direction, body, sent_by)
     VALUES ($1,$2,'out',$3,$4)
     ON CONFLICT (wa_message_id) DO NOTHING`,
    [normalizePhone(args.phone), args.messageId ?? null, args.body, args.sentBy],
  );
}

/**
 * Marks the lead that matches a paid order as booked.
 *
 * This is the join that finally answers "what did a booking cost": the lead
 * carries the ad, the order carries the money. Matching is on the last nine
 * digits so a number saved as 0501234567 still meets 971501234567.
 */
export async function linkOrderToLead(orderId: string, phone: string): Promise<void> {
  const tail = normalizePhone(phone).slice(-9);
  if (tail.length < 9) return;
  await pool.query(
    `UPDATE whatsapp_leads
        SET status = 'booked', order_id = $1, updated_at = now()
      WHERE right(phone, 9) = $2
        AND (order_id IS NULL OR order_id = $1)`,
    [orderId, tail],
  );
}

/* ------------------------------------------------------------------ */
/* Reads                                                               */
/* ------------------------------------------------------------------ */

function toLead(r: Record<string, any>): Lead {
  return {
    phone: r.phone,
    name: r.name ?? null,
    eventDate: r.event_date ? iso(new Date(r.event_date)) : null,
    emirate: r.emirate ?? null,
    status: r.status,
    ctwaClid: r.ctwa_clid ?? null,
    sourceAdId: r.source_ad_id ?? null,
    messageCount: Number(r.message_count ?? 0),
    firstMessageAt: r.first_message_at,
    lastMessageAt: r.last_message_at,
    confirmedAt: r.confirmed_at ?? null,
    orderId: r.order_id ?? null,
  };
}

export async function listLeads(opts: { status?: string; limit?: number } = {}): Promise<Lead[]> {
  const { rows } = await pool.query(
    `SELECT * FROM whatsapp_leads
      WHERE ($1::text IS NULL OR status = $1)
      ORDER BY last_message_at DESC
      LIMIT $2`,
    [opts.status ?? null, Math.min(opts.limit ?? 200, 500)],
  );
  return rows.map(toLead);
}

/**
 * The number the whole exercise exists to produce: how many conversations
 * became confirmed parties, and how many of those were actually paid for.
 */
export async function leadFunnel(): Promise<{
  total: number;
  quoted: number;
  confirmed: number;
  booked: number;
  byEmirate: Array<{ emirate: string; leads: number; booked: number }>;
}> {
  const { rows: totals } = await pool.query(
    `SELECT count(*)::int AS total,
            count(*) FILTER (WHERE status IN ('quoted','confirmed','booked'))::int AS quoted,
            count(*) FILTER (WHERE status IN ('confirmed','booked'))::int AS confirmed,
            count(*) FILTER (WHERE status = 'booked')::int AS booked
       FROM whatsapp_leads`,
  );
  const { rows: byEmirate } = await pool.query(
    `SELECT COALESCE(emirate, 'غير معروف') AS emirate,
            count(*)::int AS leads,
            count(*) FILTER (WHERE status = 'booked')::int AS booked
       FROM whatsapp_leads
      GROUP BY 1
      ORDER BY leads DESC`,
  );
  return { ...(totals[0] as any), byEmirate: byEmirate as any };
}

/**
 * Backfill leads from an external record — in practice, the labels the team
 * kept by hand in the WhatsApp Business app for years before this existed.
 *
 * Idempotent, and deliberately conservative: a lead already marked `booked`
 * never gets demoted, and an existing date/emirate is never overwritten with
 * a blank. Re-running the same import changes nothing.
 */
export async function importLeads(
  rows: Array<{
    phone: string;
    name?: string | null;
    eventDate?: string | null;
    emirate?: string | null;
    status?: string | null;
    notes?: string | null;
  }>,
): Promise<{ received: number; imported: number; skipped: number }> {
  let imported = 0;
  let skipped = 0;
  for (const r of rows) {
    const phone = normalizePhone(r.phone ?? '');
    // A UAE mobile is 12 digits with the country code; anything shorter is a
    // malformed row, not a customer.
    if (phone.length < 10) {
      skipped += 1;
      continue;
    }
    const status = ['new', 'quoted', 'confirmed', 'booked', 'lost'].includes(r.status ?? '')
      ? (r.status as string)
      : 'new';
    await pool.query(
      `INSERT INTO whatsapp_leads (phone, name, event_date, emirate, status, notes, message_count)
            VALUES ($1, $2, $3::date, $4, $5, $6, 0)
       ON CONFLICT (phone) DO UPDATE SET
            name       = COALESCE(whatsapp_leads.name, EXCLUDED.name),
            event_date = COALESCE(whatsapp_leads.event_date, EXCLUDED.event_date),
            emirate    = COALESCE(whatsapp_leads.emirate, EXCLUDED.emirate),
            status     = CASE WHEN whatsapp_leads.status = 'booked'
                              THEN whatsapp_leads.status ELSE EXCLUDED.status END,
            notes      = COALESCE(whatsapp_leads.notes, EXCLUDED.notes),
            updated_at = now()`,
      [phone, r.name || null, r.eventDate || null, r.emirate || null, status, r.notes || null],
    );
    imported += 1;
  }
  return { received: rows.length, imported, skipped };
}
