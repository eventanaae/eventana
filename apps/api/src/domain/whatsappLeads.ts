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

/**
 * Capture a lead from the WEBSITE enquiry form (not WhatsApp) into the SAME
 * whatsapp_leads table the owner's Leads screen reads, so an interested visitor
 * who leaves their number is no longer invisible. Alerts the team immediately.
 */
export async function captureWebsiteLead(input: {
  name: string;
  phone: string;
  email?: string | null;
  message?: string | null;
  eventDate?: string | null;
  emirate?: string | null;
}): Promise<{ isNew: boolean; phone: string; welcomeCode: string | null }> {
  // normalizePhone already promotes a leading 0 to the 971 country code.
  const phone = normalizePhone(input.phone);
  // A welcome discount to nudge the lead into booking — only if the code is
  // actually live, so we never advertise a code that would be rejected.
  const codeCheck = await pool
    .query(`SELECT 1 FROM promo_codes
             WHERE code='WELCOME10' AND active
               AND (max_uses IS NULL OR uses < max_uses)
               AND (expires_at IS NULL OR expires_at > now())`)
    .catch(() => ({ rowCount: 0 }));
  const welcomeCode = codeCheck.rowCount ? 'WELCOME10' : null;
  const note = [
    'Website enquiry',
    input.email ? `email: ${input.email}` : '',
    input.message ? `“${input.message.slice(0, 500)}”` : '',
  ].filter(Boolean).join(' · ');

  const existing = await pool.query(`SELECT 1 FROM whatsapp_leads WHERE phone = $1`, [phone]);
  const isNew = existing.rowCount === 0;
  await pool.query(
    `INSERT INTO whatsapp_leads
       (phone, name, event_date, emirate, status, source_headline, notes,
        message_count, first_message_at, last_message_at)
     VALUES ($1,$2,$3,$4,'new','Website enquiry',$5,1,now(),now())
     ON CONFLICT (phone) DO UPDATE SET
       -- Never let an unauthenticated website submit overwrite what's already
       -- known about a real (WhatsApp) lead — keep the existing name/notes and
       -- only fill them when blank. Status/date are likewise preserved.
       name            = COALESCE(whatsapp_leads.name, EXCLUDED.name),
       event_date      = COALESCE(whatsapp_leads.event_date, EXCLUDED.event_date),
       emirate         = COALESCE(whatsapp_leads.emirate, EXCLUDED.emirate),
       source_headline = COALESCE(whatsapp_leads.source_headline, EXCLUDED.source_headline),
       notes           = COALESCE(whatsapp_leads.notes, EXCLUDED.notes),
       message_count   = whatsapp_leads.message_count + 1,
       last_message_at = now(),
       updated_at      = now()`,
    [phone, input.name.trim() || null, input.eventDate || null, input.emirate || null, note || null],
  );

  // Tell the team — a dashboard ops-alert (deduped per phone/6h) + a push to Marsha.
  const ins = await pool
    .query(
      `INSERT INTO notifications (event_id, channel, template, scheduled_for, payload)
       SELECT NULL,'ops_alert','website_lead', now(), $1
        WHERE NOT EXISTS (
          SELECT 1 FROM notifications
           WHERE template='website_lead' AND cancelled_at IS NULL
             AND (payload->>'phone')=$2 AND created_at > now() - interval '6 hours')
       RETURNING id`,
      [JSON.stringify({ phone, name: input.name.trim(), emirate: input.emirate ?? null }), phone],
    )
    .catch(() => ({ rowCount: 0 }));
  if (ins.rowCount) {
    const summary = `${input.name.trim() || phone} left their number on the site${input.message ? ` — “${input.message.slice(0, 120)}”` : ''}.`;
    // Push EVERY owner/manager (not just Marsha) so the owner is notified too.
    try {
      const { rows } = await pool.query<{ id: string }>(
        `SELECT id FROM team_members WHERE active AND access_level IN ('owner','manager')`,
      );
      const { pushToOwner } = await import('../integrations/push.js');
      for (const r of rows) {
        await pushToOwner('staff', r.id, '🌐 New website enquiry', summary).catch(() => {});
      }
    } catch { /* push best-effort */ }
    // Email the team the lead, and email the visitor their welcome code.
    try {
      const { emailEnabled, sendEmail } = await import('../integrations/email.js');
      if (emailEnabled()) {
        const teamEmails = (await pool.query<{ email: string }>(
          `SELECT email FROM team_members WHERE active AND access_level IN ('owner','manager') AND COALESCE(btrim(email),'') <> ''`,
        )).rows.map((r) => r.email);
        const teamHtml = leadTeamEmailHtml({ name: input.name.trim(), phone, email: input.email ?? null, message: input.message ?? null, emirate: input.emirate ?? null });
        for (const to of teamEmails) {
          await sendEmail({ to, subject: `🌐 New website lead — ${input.name.trim() || phone}`, html: teamHtml }).catch(() => {});
        }
        if (input.email && welcomeCode) {
          await sendEmail({ to: input.email, subject: 'Welcome to Eventana 💛 — 10% off your first party', html: leadWelcomeEmailHtml(input.name.trim(), welcomeCode) }).catch(() => {});
        }
      }
    } catch { /* email best-effort */ }
  }
  return { isNew, phone, welcomeCode };
}

/** Internal email to the team when a website lead lands. */
function leadTeamEmailHtml(l: { name: string; phone: string; email: string | null; message: string | null; emirate: string | null }): string {
  const row = (k: string, v: string) => `<tr><td style="padding:4px 12px 4px 0;color:#8b6c7a;font-weight:600">${k}</td><td style="padding:4px 0;font-weight:700;color:#3A2A33">${v}</td></tr>`;
  return `<div style="font-family:'Segoe UI',Arial,sans-serif;max-width:520px;margin:0 auto;padding:22px;color:#3A2A33">
    <div style="font-size:20px;font-weight:800;color:#D6317F">🌐 New website lead</div>
    <p style="font-size:14px;color:#8b6c7a;margin:8px 0 14px">Someone left their number on the site — reach out soon.</p>
    <table style="font-size:14px">
      ${row('Name', l.name || '—')}
      ${row('Phone', `<a href="https://wa.me/${l.phone}" style="color:#D6317F">${l.phone}</a>`)}
      ${l.email ? row('Email', l.email) : ''}
      ${l.emirate ? row('Emirate', l.emirate) : ''}
      ${l.message ? row('Message', l.message) : ''}
    </table>
    <p style="font-size:12px;color:#8b6c7a;margin-top:16px">Open the Leads screen in the dashboard to follow up.</p>
  </div>`;
}

/** Welcome email to the visitor, with the discount code. */
function leadWelcomeEmailHtml(name: string, code: string): string {
  const first = (name || '').trim().split(/\s+/)[0] || 'there';
  return `<div style="font-family:'Segoe UI',Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#3A2A33;text-align:center">
    <div style="font-size:24px;font-weight:800;color:#D6317F">Eventana</div>
    <h2 style="font-size:20px;margin:14px 0 6px">Hi ${first} 💛</h2>
    <p style="font-size:15px;line-height:1.6;color:#5a4650;margin:0 0 18px">Thank you for reaching out! Here's <b>10% off</b> your first celebration to get you started 🎉</p>
    <div style="display:inline-block;background:#FCEBF3;border:1.5px dashed #D6317F;border-radius:14px;padding:14px 26px;font-size:22px;font-weight:800;letter-spacing:2px;color:#D6317F">${code}</div>
    <p style="font-size:13.5px;color:#8b6c7a;margin:18px 0 0">Enter it at checkout in the Eventana app. Our team will also reach out to help you plan 🤍</p>
  </div>`;
}

/** Records a message this system sent, so the lead history stays complete. */
export async function recordOutboundMessage(args: {
  phone: string;
  body: string;
  messageId?: string | null;
  sentBy: 'agent' | 'staff';
}): Promise<void> {
  const phone = normalizePhone(args.phone);
  await pool.query(
    `INSERT INTO whatsapp_messages (phone, wa_message_id, direction, body, sent_by)
     VALUES ($1,$2,'out',$3,$4)
     ON CONFLICT (wa_message_id) DO NOTHING`,
    [phone, args.messageId ?? null, args.body, args.sentBy],
  );
  // A HUMAN reply resolves any open "needs your reply" / "new website enquiry"
  // ops-alert for this customer, so the bell doesn't keep showing something the
  // team already handled.
  if (args.sentBy === 'staff') {
    await pool.query(
      `UPDATE notifications SET cancelled_at = now()
        WHERE template IN ('whatsapp_handoff','website_lead') AND cancelled_at IS NULL
          AND (payload->>'phone') = $1`,
      [phone],
    ).catch(() => {});
  }
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
  // A booked lead is resolved — clear any lingering "reply/enquiry" bell alert.
  await pool.query(
    `UPDATE notifications SET cancelled_at = now()
      WHERE template IN ('whatsapp_handoff','website_lead') AND cancelled_at IS NULL
        AND right(payload->>'phone', 9) = $1`,
    [tail],
  ).catch(() => {});
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

export interface Message {
  id: number;
  direction: 'in' | 'out';
  body: string | null;
  sentBy: 'agent' | 'staff' | null;
  createdAt: string;
}

/**
 * One lead's conversation, oldest first — the thread the team reads before
 * replying. Kept here rather than in the WhatsApp app so a customer's history
 * survives the phone it was typed on.
 */
export async function leadMessages(phone: string, limit = 200): Promise<Message[]> {
  const { rows } = await pool.query(
    `SELECT id, direction, body, sent_by, created_at
       FROM whatsapp_messages
      WHERE phone = $1
      ORDER BY created_at DESC
      LIMIT $2`,
    [normalizePhone(phone), Math.min(limit, 500)],
  );
  return rows
    .map((r) => ({
      id: Number(r.id),
      direction: r.direction as 'in' | 'out',
      body: r.body ?? null,
      sentBy: (r.sent_by ?? null) as 'agent' | 'staff' | null,
      createdAt: r.created_at,
    }))
    .reverse();
}

/**
 * Meta only allows a free-form reply within 24 hours of the customer's last
 * message; outside that window it must be an approved template. Rather than
 * let a send fail with a raw API error, the screen is told up front.
 */
export async function replyWindow(
  phone: string,
): Promise<{ open: boolean; lastInboundAt: string | null; hoursLeft: number | null }> {
  const { rows } = await pool.query(
    `SELECT created_at FROM whatsapp_messages
      WHERE phone = $1 AND direction = 'in'
      ORDER BY created_at DESC LIMIT 1`,
    [normalizePhone(phone)],
  );
  if (!rows.length) return { open: false, lastInboundAt: null, hoursLeft: null };
  const last = new Date(rows[0].created_at).getTime();
  const hoursLeft = 24 - (Date.now() - last) / 3_600_000;
  return {
    open: hoursLeft > 0,
    lastInboundAt: rows[0].created_at,
    hoursLeft: Math.max(0, Math.round(hoursLeft * 10) / 10),
  };
}
