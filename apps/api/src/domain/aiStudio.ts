/**
 * AI Studio — three Claude-powered helpers, all "draft first, human decides":
 *
 *  1. Sales Agent   — drafts a WhatsApp reply (or a follow-up for a lead that
 *                     went quiet) with suggested packages / add-ons and a quote.
 *                     Nothing is sent: the draft lands in the reply box and a
 *                     person presses Send (owner's rule: approve first).
 *  2. Event Designer — a customer picks a theme + budget; Claude writes a party
 *                     concept with decor options built ONLY from the live
 *                     catalogue (every price is re-read from the database).
 *  3. Marketing      — reel and ad ideas for an occasion, and a table of which
 *                     ads actually produced bookings (WhatsApp lead → paid order).
 *
 * Prices are never trusted from the model: every package/service it names is
 * matched back to the catalogue by id and priced from the database; anything
 * it invents is dropped. When ANTHROPIC_API_KEY is unset every helper still
 * answers with a plain rule-based fallback, so the screens never break.
 */
import { z } from 'zod';
import { pool } from '../db/pool.js';
import { loadConfig } from './settings.js';
import { generateText, anthropicEnabled } from '../integrations/anthropic.js';
import { leadMessages, replyWindow, normalizePhone } from './whatsappLeads.js';
import { OCCASIONS, nextOccasionDate } from './marketingCalendar.js';

const aed = (fils: number) => Math.round(fils) / 100;

/** Pull the first JSON object out of a model reply (it may wrap it in prose or ```json). */
function parseJson<T>(text: string | null): T | null {
  if (!text) return null;
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]) as T; } catch { return null; }
}

interface CatItem { kind: 'package' | 'service'; id: string; name: string; priceFils: number; unit: string; note: string; celebration: string[] }

/** The live catalogue, flattened for the model and for price checks. */
async function catalogue(celebrationType?: string): Promise<CatItem[]> {
  const cfg = await loadConfig();
  const out: CatItem[] = [];
  for (const p of cfg.packages.values()) {
    if (celebrationType && p.celebrationType !== celebrationType) continue;
    out.push({
      kind: 'package', id: p.id, name: p.name, priceFils: p.priceFils, unit: 'package',
      note: `${p.capacity}, ${p.durationHours}h — ${(p.items ?? []).map((i) => i.name).slice(0, 10).join(', ')}`,
      celebration: [p.celebrationType],
    });
  }
  for (const s of cfg.services.values()) {
    if (s.needsAdminReview) continue;
    if (celebrationType && s.celebrationTypes && !s.celebrationTypes.includes(celebrationType as any)) continue;
    const kind = (s.pricing as any)?.kind;
    const unit = kind === 'per_child' ? `per child (min ${(s.pricing as any).minChildren ?? 1})`
      : kind === 'per_piece' ? `per piece (min ${(s.pricing as any).minQuantity ?? 1})` : 'flat';
    out.push({
      kind: 'service', id: s.id, name: s.name, priceFils: s.priceFils, unit,
      note: (s.shortDescription || '').slice(0, 90), celebration: (s.celebrationTypes ?? []) as string[],
    });
  }
  return out;
}

const catLines = (items: CatItem[]) =>
  items.map((c) => `${c.kind}:${c.id} | ${c.name} | AED ${aed(c.priceFils)} ${c.unit} | ${c.note}`).join('\n');

/** Keep only catalogue items, priced from the DB. qty for per-child/per-piece. */
function priceLines(lines: Array<{ id?: string; qty?: number }> | undefined, items: CatItem[], kids = 20) {
  const byId = new Map(items.map((i) => [i.id, i]));
  const out: Array<{ kind: string; id: string; name: string; qty: number; unitAed: number; totalAed: number }> = [];
  for (const l of lines ?? []) {
    const c = l?.id ? byId.get(String(l.id)) : undefined;
    if (!c) continue;
    let qty = Math.max(1, Math.round(Number(l.qty) || 1));
    if (c.unit.startsWith('per child')) qty = Math.max(qty, kids, Number(c.unit.match(/min (\d+)/)?.[1] ?? 1));
    if (c.unit.startsWith('per piece')) qty = Math.max(qty, Number(c.unit.match(/min (\d+)/)?.[1] ?? 1));
    if (c.unit === 'flat' || c.unit === 'package') qty = 1;
    if (out.some((o) => o.id === c.id)) continue;
    out.push({ kind: c.kind, id: c.id, name: c.name, qty, unitAed: aed(c.priceFils), totalAed: aed(c.priceFils * qty) });
  }
  return out;
}

const BRAND = `You work for Eventana, a kids' party & events company in Dubai (UAE). Warm, short, friendly Gulf-business tone. Reply in the SAME language the customer writes in (Arabic Gulf dialect or English). Never invent prices, discounts, availability or promises — only use the catalogue given. Refunds, complaints and discounts are for a human: say the team will confirm.`;

// ── 1. Sales Agent ──────────────────────────────────────────────────────────

export async function salesDraft(rawPhone: string, mode: 'reply' | 'followup') {
  const phone = normalizePhone(rawPhone);
  const { rows } = await pool.query(
    `SELECT phone, name, status, event_date::text AS event_date, emirate, notes, order_id FROM whatsapp_leads WHERE phone = $1`,
    [phone],
  );
  const lead = rows[0] ?? { phone, name: null, status: 'new' };
  const msgs = (await leadMessages(phone, 40)).slice(-25);
  const window = await replyWindow(phone);
  const items = await catalogue();
  const convo = msgs.map((m: any) => `${m.direction === 'in' ? 'CUSTOMER' : 'EVENTANA'}: ${String(m.body ?? '').slice(0, 500)}`).join('\n');

  const task = mode === 'followup'
    ? `This customer has not confirmed a booking. Write ONE short, kind follow-up message (no pressure) that reminds them of what they asked about, offers the best-fit package or add-on, and asks one easy question to move forward (date / number of kids / budget).`
    : `Write the next reply to the customer's latest message: answer it, suggest the best-fit package and 1–3 add-ons, and include a simple quote when there is enough info (kids count, celebration). Ask for any missing detail (date, area, number of kids).`;

  const prompt = `${task}

Lead: name=${lead.name ?? '-'}, status=${lead.status}, party date=${lead.event_date ?? 'unknown'}, emirate=${lead.emirate ?? 'unknown'}.
Conversation (oldest first):
${convo || '(no messages yet)'}

Catalogue (kind:id | name | price | unit | details):
${catLines(items)}

Return ONLY JSON:
{"reply":"<the WhatsApp message, ready to send>","kids":<number or null>,"suggest":[{"id":"<catalogue id>","why":"<short reason>"}],"quote":[{"id":"<catalogue id>","qty":<number>}],"note":"<one line for the staff member: anything to check before sending>"}`;

  const ai = parseJson<{ reply?: string; kids?: number | null; suggest?: Array<{ id: string; why?: string }>; quote?: Array<{ id: string; qty?: number }>; note?: string }>(
    await generateText({ system: BRAND, prompt, maxTokens: 1200 }),
  );
  const kids = Math.max(1, Math.round(Number(ai?.kids) || 20));
  const byId = new Map(items.map((i) => [i.id, i]));
  const suggestions = (ai?.suggest ?? [])
    .map((s) => ({ c: byId.get(String(s.id)), why: s.why ?? '' }))
    .filter((s) => s.c)
    .slice(0, 4)
    .map((s) => ({ kind: s.c!.kind, id: s.c!.id, name: s.c!.name, priceAed: aed(s.c!.priceFils), unit: s.c!.unit, why: s.why }));
  const quote = priceLines(ai?.quote, items, kids);
  return {
    ai: anthropicEnabled() && Boolean(ai?.reply),
    reply: ai?.reply
      ?? (mode === 'followup'
        ? `Hi${lead.name ? ' ' + lead.name : ''}! 😊 Just checking in about your party${lead.event_date ? ` on ${lead.event_date}` : ''}. Would you like us to hold the date for you? Tell us the number of kids and we'll send the best package.`
        : `Hi${lead.name ? ' ' + lead.name : ''}! 😊 Thanks for reaching Eventana. When is the party, and how many kids are you expecting? We'll suggest the best package for you.`),
    suggestions,
    quote,
    quoteTotalAed: Math.round(quote.reduce((s, l) => s + l.totalAed, 0) * 100) / 100,
    kids,
    note: ai?.note ?? (anthropicEnabled() ? 'AI could not answer — a simple template was used.' : 'AI is off (no Claude key) — a simple template was used.'),
    window,
  };
}

/** Leads worth a follow-up: talked to us, no paid order, went quiet 2–30 days ago. */
export async function salesFollowups() {
  const { rows } = await pool.query(
    `SELECT l.phone, l.name, l.status, l.event_date::text AS event_date, l.emirate, l.message_count,
            l.last_message_at, l.source_headline,
            (SELECT body FROM whatsapp_messages m WHERE m.phone = l.phone AND m.direction = 'in' ORDER BY created_at DESC LIMIT 1) AS last_in
       FROM whatsapp_leads l
      WHERE l.order_id IS NULL
        AND l.status IN ('new','quoted','confirmed')
        AND l.last_message_at < now() - interval '2 days'
        AND l.last_message_at > now() - interval '30 days'
        AND (l.event_date IS NULL OR l.event_date >= current_date)
      ORDER BY (l.event_date IS NULL), l.event_date, l.last_message_at DESC
      LIMIT 80`,
  );
  return rows.map((r) => ({
    phone: r.phone, name: r.name, status: r.status, eventDate: r.event_date, emirate: r.emirate,
    messages: r.message_count, lastMessageAt: r.last_message_at, ad: r.source_headline,
    lastIn: String(r.last_in ?? '').slice(0, 140),
    windowOpen: Date.now() - new Date(r.last_message_at).getTime() < 24 * 3600 * 1000,
  }));
}

// ── 2. Event Designer ───────────────────────────────────────────────────────

export const designSchema = z.object({
  celebrationType: z.enum(['kids', 'graduation', 'bride', 'baby', 'gender', 'adult', 'customc']).default('kids'),
  themeId: z.string().max(80).nullable().optional(),
  themeText: z.string().trim().max(120).nullable().optional(),
  budgetAed: z.number().min(0).max(1_000_000).nullable().optional(),
  childrenCount: z.number().int().min(1).max(500).default(20),
  age: z.string().max(20).nullable().optional(),
  notes: z.string().max(600).nullable().optional(),
  lang: z.enum(['en', 'ar']).default('en'),
});

export async function designParty(input: {
  celebrationType: string; themeId?: string | null; themeText?: string | null; budgetAed?: number | null;
  childrenCount: number; age?: string | null; notes?: string | null; lang?: 'en' | 'ar';
}) {
  const items = await catalogue(input.celebrationType);
  const { rows: themeRows } = input.themeId
    ? await pool.query(`SELECT id, name, tags, colors, cover_image_url FROM themes WHERE id = $1`, [input.themeId])
    : { rows: [] as any[] };
  const theme = themeRows[0] ?? null;
  const { rows: inspo } = theme
    ? await pool.query(`SELECT image_url FROM theme_inspiration WHERE theme_id = $1 ORDER BY id LIMIT 6`, [theme.id])
    : { rows: [] as any[] };
  const themeName = theme?.name ?? (input.themeText || 'your theme');
  const budget = input.budgetAed && input.budgetAed > 0 ? input.budgetAed : null;
  const ar = input.lang === 'ar';

  const prompt = `Design a ${input.celebrationType} party concept.
Theme: ${themeName}${theme?.colors?.length ? ` (colours ${theme.colors.join(', ')})` : ''}.
Kids: ${input.childrenCount}${input.age ? `, age ${input.age}` : ''}. Budget: ${budget ? `AED ${budget}` : 'not given'}.
Customer notes: ${input.notes || '-'}.
Write in ${ar ? 'Arabic (Gulf, warm)' : 'English'}.

Use ONLY this catalogue (kind:id | name | price | unit | details):
${catLines(items)}

Return ONLY JSON:
{"title":"<catchy party name>","story":"<2-3 sentences describing the look & feel>","palette":["#hex",...4],
 "zones":[{"zone":"<Entrance | Backdrop | Cake table | Balloons | Activity | Food | Favours>","idea":"<what it looks like>","ids":["<catalogue id that delivers it, optional>"]}],
 "core":[{"id":"<catalogue id>","qty":<n>}],"extras":[{"id":"<catalogue id>","qty":<n>,"why":"<short>"}],
 "tip":"<one practical tip>"}
"core" = the main plan that fits the budget (a package if one fits, else services). "extras" = 2-4 optional upgrades.`;

  const ai = parseJson<{ title?: string; story?: string; palette?: string[]; zones?: Array<{ zone: string; idea: string; ids?: string[] }>; core?: Array<{ id: string; qty?: number }>; extras?: Array<{ id: string; qty?: number; why?: string }>; tip?: string }>(
    await generateText({ system: BRAND, prompt, maxTokens: 1600 }),
  );

  let core = priceLines(ai?.core, items, input.childrenCount);
  if (!core.length) {
    // Fallback: the fullest package within budget, else the cheapest few services.
    const pk = items.filter((i) => i.kind === 'package' && (!budget || aed(i.priceFils) <= budget)).sort((a, b) => b.priceFils - a.priceFils)[0];
    core = priceLines(pk ? [{ id: pk.id }] : items.filter((i) => i.kind === 'service').slice(0, 3).map((i) => ({ id: i.id })), items, input.childrenCount);
  }
  const extras = priceLines(ai?.extras, items, input.childrenCount)
    .filter((e) => !core.some((c) => c.id === e.id))
    .map((e) => ({ ...e, why: ai?.extras?.find((x) => String(x.id) === e.id)?.why ?? '' }));
  const byId = new Map(items.map((i) => [i.id, i]));
  const coreTotal = Math.round(core.reduce((s, l) => s + l.totalAed, 0) * 100) / 100;
  return {
    ai: anthropicEnabled() && Boolean(ai?.title),
    title: ai?.title ?? `${themeName} party`,
    story: ai?.story ?? (ar ? `حفلة بثيم ${themeName} لـ ${input.childrenCount} طفل، بتجهيز كامل من إيفنتانا.` : `A ${themeName} celebration for ${input.childrenCount} kids, fully set up by Eventana.`),
    palette: (ai?.palette ?? theme?.colors ?? []).filter((c: string) => /^#[0-9a-f]{3,8}$/i.test(c)).slice(0, 5),
    zones: (ai?.zones ?? []).slice(0, 7).map((z) => ({ zone: z.zone, idea: z.idea, items: (z.ids ?? []).map((id) => byId.get(String(id))?.name).filter(Boolean) })),
    core, coreTotalAed: coreTotal,
    extras,
    withinBudget: budget ? coreTotal <= budget : null,
    tip: ai?.tip ?? '',
    theme: theme ? { id: theme.id, name: theme.name, cover: theme.cover_image_url } : null,
    inspiration: inspo.map((r: any) => r.image_url),
  };
}

// ── 3. Marketing ────────────────────────────────────────────────────────────

export function upcomingOccasions(limit = 12) {
  const now = new Date();
  return OCCASIONS
    .map((o) => ({ o, next: nextOccasionDate(o, now) }))
    .filter((x) => x.next && !x.o.corporateOnly)
    .sort((a, b) => a.next!.dateISO.localeCompare(b.next!.dateISO))
    .slice(0, limit)
    .map((x) => ({ slug: x.o.slug, name: x.o.name, nameAr: x.o.nameAr, date: x.next!.dateISO, greetingOnly: Boolean(x.o.greetingOnly) }));
}

export async function marketingIdeas(input: { occasion?: string | null; topic?: string | null; goal?: string | null; lang?: 'en' | 'ar' }) {
  const occ = input.occasion ? OCCASIONS.find((o) => o.slug === input.occasion) : null;
  const items = await catalogue();
  const results = await adResults(90).catch(() => null);
  const winners = (results?.ads ?? []).filter((a) => a.bookings > 0).slice(0, 5)
    .map((a) => `"${a.headline}" → ${a.bookings} bookings from ${a.leads} chats`).join('; ');
  const prompt = `Create marketing content for ${occ ? `${occ.name} (${occ.nameAr})${occ.greetingOnly ? ' — GREETING ONLY: warm wishes, absolutely no selling or prices' : ''}` : (input.topic || 'this month')}.
Goal: ${input.goal || 'more party bookings through WhatsApp'}. Audience: parents in the UAE (mostly Emirati/Arab mums), plus companies for corporate events.
What already worked in our ads (last 90 days): ${winners || 'no booking data yet'}.
Products we sell (pick the ones that fit): ${items.slice(0, 40).map((i) => i.name).join(', ')}.
Write in ${input.lang === 'ar' ? 'Arabic (Gulf) with a few English words where natural' : 'English, with an Arabic version of each caption'}.

Return ONLY JSON:
{"reels":[{"title":"","hook":"<first 2 seconds, on-screen text>","shots":["<shot 1>","..."],"caption":"","captionAr":"","hashtags":["#..."],"why":"<why it should convert>"}],
 "ads":[{"headline":"","primaryText":"","cta":"<Send WhatsApp message | Book now | Learn more>","audience":"<who to target>","offer":"<offer or none>","test":"<what this variant tests vs the others>"}]}
Give 5 reels and 3 ad variants that test ONE clear difference each (offer vs no offer, emotion vs price, video vs photo idea).`;
  const ai = parseJson<{ reels?: any[]; ads?: any[] }>(await generateText({ system: BRAND, prompt, maxTokens: 2500 }));
  return {
    ai: anthropicEnabled() && Boolean(ai?.reels?.length),
    occasion: occ ? { slug: occ.slug, name: occ.name, nameAr: occ.nameAr, greetingOnly: Boolean(occ.greetingOnly) } : null,
    reels: (ai?.reels ?? []).slice(0, 6),
    ads: (ai?.ads ?? []).slice(0, 4),
    note: ai ? '' : (anthropicEnabled() ? 'AI did not answer — try again.' : 'AI is off: add ANTHROPIC_API_KEY on the API service to generate ideas.'),
  };
}

/**
 * Which ads brought real bookings: WhatsApp leads grouped by the ad that sent
 * them, with how many gave a date, confirmed, and paid — and the money paid.
 */
export async function adResults(days = 90) {
  const d = Math.max(7, Math.min(730, Math.round(days)));
  const { rows } = await pool.query(
    `SELECT COALESCE(l.source_ad_id, '') AS ad_id,
            COALESCE(NULLIF(btrim(l.source_headline), ''), CASE WHEN l.source_ad_id IS NULL THEN 'No ad (organic / direct)' ELSE 'Ad ' || l.source_ad_id END) AS headline,
            count(*)::int AS leads,
            count(*) FILTER (WHERE l.event_date IS NOT NULL)::int AS with_date,
            count(*) FILTER (WHERE l.status IN ('confirmed','booked') OR l.order_id IS NOT NULL)::int AS confirmed,
            count(*) FILTER (WHERE l.order_id IS NOT NULL)::int AS bookings,
            COALESCE(sum(o.total_fils) FILTER (WHERE o.status = 'paid' OR o.status = 'confirmed' OR o.status = 'completed'), 0)::bigint AS revenue_fils
       FROM whatsapp_leads l
       LEFT JOIN orders o ON o.id = l.order_id
      WHERE l.first_message_at > now() - ($1 || ' days')::interval
      GROUP BY 1, 2
      ORDER BY bookings DESC, leads DESC
      LIMIT 60`,
    [String(d)],
  );
  const ads = rows.map((r) => ({
    adId: r.ad_id || null, headline: r.headline, leads: r.leads, withDate: r.with_date, confirmed: r.confirmed,
    bookings: r.bookings, revenueAed: aed(Number(r.revenue_fils)),
    bookingRate: r.leads ? Math.round((r.bookings / r.leads) * 1000) / 10 : 0,
  }));
  const tot = ads.reduce((s, a) => ({ leads: s.leads + a.leads, bookings: s.bookings + a.bookings, revenueAed: s.revenueAed + a.revenueAed }), { leads: 0, bookings: 0, revenueAed: 0 });
  return { days: d, ads, total: { ...tot, revenueAed: Math.round(tot.revenueAed * 100) / 100 } };
}

/** Plain-language verdict on the ad table: what to scale, fix or stop. */
export async function adVerdict(days = 90, lang: 'en' | 'ar' = 'ar') {
  const r = await adResults(days);
  if (!r.ads.length) return { verdict: lang === 'ar' ? 'ما في بيانات إعلانات كافية بعد.' : 'Not enough ad data yet.' };
  const table = r.ads.slice(0, 25).map((a) => `${a.headline} | chats ${a.leads} | gave date ${a.withDate} | booked ${a.bookings} | AED ${a.revenueAed}`).join('\n');
  const text = await generateText({
    system: BRAND,
    prompt: `Last ${r.days} days of WhatsApp ad results (one row per ad):\n${table}\n\nIn ${lang === 'ar' ? 'Gulf Arabic' : 'English'}, give a short verdict (max 8 bullet lines): which ads to scale, which to fix (chats but no bookings) and which to stop, and one test to run next. Use only these numbers.`,
    maxTokens: 700,
  });
  return { verdict: text ?? (lang === 'ar' ? 'الذكاء الاصطناعي مب مفعّل.' : 'AI is off.') };
}
