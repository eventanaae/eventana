/**
 * Eventana's overnight AI agent ("كلوديا" — the business's own AI operations &
 * marketing director). While the owner sleeps it watches the whole business, and
 * every morning it writes her ONE short, warm Arabic brief: what happened in the
 * last 24h, what needs her attention today (prioritised), and a couple of concrete
 * recommendations — delivered to her phone (push + WhatsApp mirror) and e-mail.
 *
 * It only READS data and reports to the OWNER — it never messages a customer,
 * changes an ad, a price or a booking. Pure advisory, safe to run unattended.
 *
 * Powered by Claude (integrations/anthropic.generateText). If Claude isn't
 * configured, it still sends a clean fixed-format brief from the same numbers, so
 * the owner always gets her morning summary.
 *
 * Throttled to once per calendar day, fired in a morning window (Dubai time), via
 * the normal reconcile sweep. Toggle with NIGHT_AGENT=off; shift the hour with
 * NIGHT_AGENT_HOUR (default 7, i.e. ~07:00 Dubai).
 */
import { pool } from '../db/pool.js';
import { config } from '../config.js';
import { generateText } from '../integrations/anthropic.js';
import { pushToOwner } from '../integrations/push.js';
import { sendEmail, emailEnabled } from '../integrations/email.js';

const AED = (fils: number | null | undefined) =>
  (Number(fils ?? 0) / 100).toLocaleString('en-AE', { minimumFractionDigits: 0, maximumFractionDigits: 0 });

/** Dubai (UTC+4, no DST) wall-clock date + hour, for the once-a-morning gate. */
function dubaiNow(): { date: string; hour: number } {
  const d = new Date(Date.now() + 4 * 3_600_000);
  return { date: d.toISOString().slice(0, 10), hour: d.getUTCHours() };
}

async function one<T = any>(sql: string, params: any[] = []): Promise<T | null> {
  try { return (await pool.query(sql, params)).rows[0] ?? null; } catch { return null; }
}

/** Gather a compact, whole-business snapshot (last 24h + the week ahead). Every
 *  query is defensive — a single failure must never block the morning brief. */
async function gatherSnapshot() {
  const [
    sales, refunds, leads, abandoned, upcoming, nextEvent, understaffed, atRisk,
    ratings, cash, adSpend, revMonth,
  ] = await Promise.all([
    one(`SELECT count(*)::int n, COALESCE(SUM(total_fils),0)::bigint v FROM finance_receipts WHERE created_at > now() - interval '24 hours'`),
    one(`SELECT count(*)::int n, COALESCE(SUM(amount_fils),0)::bigint v FROM refunds WHERE created_at > now() - interval '24 hours'`),
    one(`SELECT count(*)::int n FROM whatsapp_leads WHERE created_at > now() - interval '24 hours'`),
    one(`SELECT count(*)::int n, COALESCE(SUM(total_fils),0)::bigint v FROM orders
           WHERE status IN ('awaiting_payment','processing','needs_review')
             AND source IS DISTINCT FROM 'manual' AND created_at > now() - interval '48 hours'`),
    one(`SELECT count(*)::int n FROM events WHERE phase <> 'Cancelled' AND event_date >= current_date AND event_date <= current_date + interval '7 days'`),
    one(`SELECT to_char(e.event_date,'YYYY-MM-DD') d, e.start_time, e.celebration_type, th.name theme, c.name customer, e.emirate
           FROM events e LEFT JOIN themes th ON th.id = e.theme_id LEFT JOIN customers c ON c.id = e.customer_id
          WHERE e.phase <> 'Cancelled' AND e.event_date >= current_date
          ORDER BY e.event_date, e.start_time LIMIT 1`),
    one(`SELECT COUNT(DISTINCT es.event_id)::int n FROM event_staff es JOIN events e ON e.id = es.event_id
          WHERE es.status = 'part_time_required' AND e.phase <> 'Cancelled' AND e.event_date >= current_date`),
    one(`SELECT count(*)::int n FROM prep_tasks pt JOIN events e ON e.id = pt.event_id
          WHERE pt.status NOT IN ('completed') AND pt.due_date < current_date AND e.phase <> 'Cancelled' AND e.event_date >= current_date`),
    one(`SELECT count(*)::int n, ROUND(AVG(stars)::numeric,1) avg, count(*) FILTER (WHERE stars <= 3)::int low FROM event_ratings WHERE created_at > now() - interval '24 hours'`),
    import('./finance.js').then((m) => m.accountingSummary()).catch(() => null) as Promise<any>,
    one(`SELECT COALESCE(SUM(amount_fils),0)::bigint v FROM expenses
          WHERE spent_on >= date_trunc('month', current_date)
            AND (COALESCE(category,'') ~* '(advertis|marketing|meta|facebook|instagram|snapchat|tiktok|google ads|\\yads\\y)')`),
    one(`SELECT COALESCE(SUM(total_fils),0)::bigint v FROM finance_receipts WHERE date >= date_trunc('month', current_date)`),
  ]);

  return {
    last24h: {
      newSales: Number(sales?.n ?? 0), newSalesAed: AED(sales?.v),
      refunds: Number(refunds?.n ?? 0), refundsAed: AED(refunds?.v),
      newLeads: Number(leads?.n ?? 0),
      newRatings: Number(ratings?.n ?? 0), avgRating: ratings?.avg ?? null, lowRatings: Number(ratings?.low ?? 0),
    },
    attention: {
      abandonedCarts: Number(abandoned?.n ?? 0), abandonedValueAed: AED(abandoned?.v),
      understaffedEvents: Number(understaffed?.n ?? 0),
      atRiskPrepEvents: Number(atRisk?.n ?? 0),
    },
    ahead: {
      eventsNext7Days: Number(upcoming?.n ?? 0),
      nextEvent: nextEvent
        ? { date: nextEvent.d, time: nextEvent.start_time, type: nextEvent.celebration_type, theme: nextEvent.theme, customer: nextEvent.customer, emirate: nextEvent.emirate }
        : null,
    },
    money: {
      cashOnHandAed: cash?.cashOnHandFils != null ? AED(cash.cashOnHandFils) : null,
      adSpendThisMonthAed: AED(adSpend?.v),
      revenueThisMonthAed: AED(revMonth?.v),
    },
  };
}

/** A plain fixed-format Arabic brief — the fallback when Claude isn't configured,
 *  so the owner always gets her morning summary even without the AI layer. */
function plainBrief(s: Awaited<ReturnType<typeof gatherSnapshot>>): string {
  const L: string[] = ['☀️ صباح الخير! هذا ملخص إيفنتانا لآخر ٢٤ ساعة:', ''];
  L.push(`• مبيعات جديدة: ${s.last24h.newSales} (AED ${s.last24h.newSalesAed})`);
  if (s.last24h.refunds) L.push(`• استرجاعات: ${s.last24h.refunds} (AED ${s.last24h.refundsAed})`);
  if (s.last24h.newLeads) L.push(`• عملاء محتملين جدد (واتساب): ${s.last24h.newLeads}`);
  if (s.last24h.newRatings) L.push(`• تقييمات جديدة: ${s.last24h.newRatings} (متوسط ${s.last24h.avgRating ?? '—'}${s.last24h.lowRatings ? ` · ${s.last24h.lowRatings} منخفضة` : ''})`);
  L.push('', 'يحتاج انتباهچ:');
  if (s.attention.understaffedEvents) L.push(`• ${s.attention.understaffedEvents} إيفينت ناقص طاقم`);
  if (s.attention.atRiskPrepEvents) L.push(`• ${s.attention.atRiskPrepEvents} إيفينت تجهيزه متأخّر`);
  if (s.attention.abandonedCarts) L.push(`• ${s.attention.abandonedCarts} سلة متروكة (AED ${s.attention.abandonedValueAed}) — ممكن متابعة`);
  if (!s.attention.understaffedEvents && !s.attention.atRiskPrepEvents && !s.attention.abandonedCarts) L.push('• كل شي تمام ✅');
  L.push('', `الأسبوع الجاي: ${s.ahead.eventsNext7Days} إيفينت.`);
  if (s.ahead.nextEvent) L.push(`الجاي: ${s.ahead.nextEvent.customer ?? ''} · ${s.ahead.nextEvent.date} ${s.ahead.nextEvent.time ?? ''} · ${s.ahead.nextEvent.theme ?? s.ahead.nextEvent.type ?? ''}`);
  if (s.money.cashOnHandAed != null) L.push('', `الكاش: AED ${s.money.cashOnHandAed} · إعلانات الشهر: AED ${s.money.adSpendThisMonthAed} · إيراد الشهر: AED ${s.money.revenueThisMonthAed}`);
  return L.join('\n');
}

const SYSTEM = `أنتِ "كلوديا" — مديرة العمليات والتسويق الذكية لشركة إيفنتانا (تنسيق حفلات أطفال في الإمارات). تكتبين للمالكة (شيمة) ملخّص صباحي قصير بالعربي الخليجي الدافئ، بناءً على لقطة بيانات من آخر ٢٤ ساعة والأسبوع الجاي.
القواعد:
- ابدئي بتحية صباحية قصيرة.
- ٣ أقسام مختصرة: (١) وش صار، (٢) وش يحتاج انتباهها اليوم — مرتّبة بالأهم أول، (٣) توصية أو اثنتين عملية وواضحة.
- استخدمي الأرقام الحقيقية من اللقطة فقط. لا تخترعين أرقام. لو ما في شي يحتاج انتباه، قوليها بوضوح.
- قصيرة: حدود ١٢٠ كلمة. نقاط مختصرة. بدون مقدّمات طويلة. المبالغ بالدرهم.
- نبرة زميلة شاطرة تساعدها، مب تقرير جامد.`;

/** Build the brief text (Claude when available, else the fixed format). */
async function composeBrief(s: Awaited<ReturnType<typeof gatherSnapshot>>): Promise<string> {
  const ai = await generateText({
    system: SYSTEM,
    prompt: `لقطة بيانات إيفنتانا (JSON):\n${JSON.stringify(s, null, 2)}\n\nاكتبي الملخص الصباحي الآن.`,
    maxTokens: 1500,
  }).catch(() => null);
  return (ai && ai.trim()) ? ai.trim() : plainBrief(s);
}

/**
 * Sweep entry point — called every reconcile tick. Fires at most once per Dubai
 * calendar day, inside the morning window, then records the run in app_kv.
 */
export async function sweepNightBrief(): Promise<void> {
  if (String(process.env.NIGHT_AGENT ?? '').toLowerCase() === 'off') return;
  const { date, hour } = dubaiNow();
  const startHour = Math.max(0, Math.min(23, Number(process.env.NIGHT_AGENT_HOUR ?? 7) || 7));
  // Only in the morning window (startHour .. startHour+4), and never twice a day.
  if (hour < startHour || hour > startHour + 4) return;
  const last = await one<{ v: string }>(`SELECT v FROM app_kv WHERE k = 'night_brief_at'`);
  if (last?.v && String(last.v).slice(0, 10) >= date) return; // already sent today
  // Claim the day FIRST (so two overlapping ticks can't both send). If anything
  // below fails we've still marked today — a missed brief is better than a double.
  await pool.query(
    `INSERT INTO app_kv (k, v) VALUES ('night_brief_at', $1) ON CONFLICT (k) DO UPDATE SET v = $1`,
    [date],
  ).catch(() => {});

  await deliverBrief(date);
}

/** Compose the brief from a fresh snapshot and deliver it to every owner. Shared
 *  by the daily sweep and the on-demand test trigger. */
async function deliverBrief(date: string): Promise<void> {
  const snapshot = await gatherSnapshot();
  const brief = await composeBrief(snapshot);

  // Deliver to every owner: on-screen phone push (mirrors to their WhatsApp) and
  // e-mail with the full text. Managers are intentionally left out — this is the
  // owner's private morning brief.
  const owners = await pool.query<{ id: string; email: string | null }>(
    `SELECT id, email FROM team_members WHERE active AND access_level = 'owner'`,
  ).catch(() => ({ rows: [] as { id: string; email: string | null }[] }));

  const title = '☀️ ملخّص إيفنتانا الصباحي';
  for (const o of owners.rows) {
    await pushToOwner('staff', o.id, title, brief.length > 400 ? brief.slice(0, 390) + '…' : brief, { view: 'ceo' }).catch(() => {});
  }
  if (emailEnabled()) {
    const html = `<div style="font-family:'Quicksand',Arial,sans-serif;max-width:560px;margin:0 auto;color:#3B3641">
      <div style="background:linear-gradient(135deg,#F06CA8,#E94F9C);color:#fff;border-radius:16px;padding:18px 20px;text-align:center;margin-bottom:16px">
        <div style="font-size:20px;font-weight:800">☀️ ملخّص إيفنتانا الصباحي</div>
        <div style="font-size:12px;opacity:.9;margin-top:2px">من كلوديا — مديرتچ الذكية</div>
      </div>
      <div style="white-space:pre-wrap;font-size:15px;line-height:1.8;font-weight:600;direction:rtl;text-align:right">${brief.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] as string))}</div>
      <div style="margin-top:18px;color:#bbb;font-size:12px;text-align:center">إيفنتانا · تقرير تلقائي يومي</div>
    </div>`;
    const seen = new Set<string>();
    for (const o of owners.rows) {
      const to = (o.email ?? '').trim();
      if (!to || seen.has(to.toLowerCase())) continue;
      seen.add(to.toLowerCase());
      await sendEmail({ to, subject: title, html, skipMonitorBcc: true }).catch(() => {});
    }
  }
  console.log(`[night-agent] morning brief sent to ${owners.rows.length} owner(s) for ${date}`);
}

/** On-demand: send ONE brief right now, ignoring the morning window and the
 *  once-a-day throttle. Used by a boot one-shot so the owner can see a live sample
 *  immediately. Does NOT touch the daily throttle, so the real morning brief still
 *  fires as usual. */
export async function runNightBriefNow(): Promise<void> {
  await deliverBrief(dubaiNow().date);
}
