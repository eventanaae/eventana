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

  const adSpendFils = Number(adSpend?.v ?? 0);
  const revMonthFils = Number(revMonth?.v ?? 0);
  return {
    // Marketing & ADS first — this is the owner's main focus.
    marketing: {
      adSpendThisMonthAed: AED(adSpendFils),
      revenueThisMonthAed: AED(revMonthFils),
      roughReturnPerAed: adSpendFils > 0 ? Math.round((revMonthFils / adSpendFils) * 10) / 10 : null,
      newLeads24h: Number(leads?.n ?? 0),
      abandonedCarts: Number(abandoned?.n ?? 0),
      abandonedValueAed: AED(abandoned?.v),
      note: 'الإيراد الشهري مب كله من الإعلانات — استخدميه كمؤشر عام للعائد مقابل الصرف، لا تنسبي كل المبيعات للإعلانات.',
    },
    sales24h: {
      newSales: Number(sales?.n ?? 0), newSalesAed: AED(sales?.v),
      refunds: Number(refunds?.n ?? 0), refundsAed: AED(refunds?.v),
      newRatings: Number(ratings?.n ?? 0), avgRating: ratings?.avg ?? null, lowRatings: Number(ratings?.low ?? 0),
    },
    attention: {
      understaffedEvents: Number(understaffed?.n ?? 0),
      atRiskPrepEvents: Number(atRisk?.n ?? 0),
      abandonedCarts: Number(abandoned?.n ?? 0),
    },
    ahead: {
      eventsNext7Days: Number(upcoming?.n ?? 0),
      nextEvent: nextEvent
        ? { date: nextEvent.d, time: nextEvent.start_time, type: nextEvent.celebration_type, theme: nextEvent.theme, customer: nextEvent.customer, emirate: nextEvent.emirate }
        : null,
    },
    cashOnHandAed: cash?.cashOnHandFils != null ? AED(cash.cashOnHandFils) : null,
  };
}

/** A plain fixed-format Arabic brief — the fallback when Claude isn't configured,
 *  so the owner always gets her morning summary even without the AI layer. */
function plainBrief(s: Awaited<ReturnType<typeof gatherSnapshot>>): string {
  const m = s.marketing;
  const L: string[] = ['☀️ صباح الخير شيم! هذا ملخّص إيفنتانا:', '', '📣 التسويق والإعلانات'];
  L.push(`• صرف الإعلانات هالشهر: AED ${m.adSpendThisMonthAed} · إيراد الشهر: AED ${m.revenueThisMonthAed}${m.roughReturnPerAed != null ? ` (كل درهم صرف ≈ ${m.roughReturnPerAed} درهم مبيعات)` : ''}`);
  L.push(`• عملاء محتملين جدد (واتساب) آخر ٢٤س: ${m.newLeads24h}`);
  if (m.abandonedCarts) L.push(`• ${m.abandonedCarts} سلة متروكة (AED ${m.abandonedValueAed}) — فرصة متابعة/إعلان استهداف`);
  L.push('', '💰 المبيعات (آخر ٢٤ ساعة)');
  L.push(`• مبيعات: ${s.sales24h.newSales} (AED ${s.sales24h.newSalesAed})`);
  if (s.sales24h.refunds) L.push(`• استرجاعات: ${s.sales24h.refunds} (AED ${s.sales24h.refundsAed})`);
  if (s.sales24h.newRatings) L.push(`• تقييمات: ${s.sales24h.newRatings} (متوسط ${s.sales24h.avgRating ?? '—'}${s.sales24h.lowRatings ? ` · ${s.sales24h.lowRatings} منخفضة` : ''})`);
  L.push('', '⚠️ يحتاج انتباهچ اليوم');
  if (s.attention.understaffedEvents) L.push(`• ${s.attention.understaffedEvents} إيفينت ناقص طاقم`);
  if (s.attention.atRiskPrepEvents) L.push(`• ${s.attention.atRiskPrepEvents} إيفينت تجهيزه متأخّر`);
  if (s.attention.abandonedCarts) L.push(`• ${s.attention.abandonedCarts} سلة متروكة تنتظر متابعة`);
  if (!s.attention.understaffedEvents && !s.attention.atRiskPrepEvents && !s.attention.abandonedCarts) L.push('• كل شي تمام ✅');
  L.push('', `📅 الأسبوع الجاي: ${s.ahead.eventsNext7Days} إيفينت.`);
  if (s.ahead.nextEvent) L.push(`الجاي: ${s.ahead.nextEvent.customer ?? ''} · ${s.ahead.nextEvent.date} ${s.ahead.nextEvent.time ?? ''} · ${s.ahead.nextEvent.theme ?? s.ahead.nextEvent.type ?? ''}`);
  if (s.cashOnHandAed != null) L.push('', `💵 الكاش: AED ${s.cashOnHandAed}`);
  return L.join('\n');
}

const SYSTEM = `أنتِ "كلوديا" — مديرة التسويق والإعلانات والعمليات الذكية لشركة إيفنتانا (تنسيق حفلات أطفال في الإمارات). تكتبين للمالكة "شيم" ملخّص صباحي قصير بالعربي الخليجي الدافئ من لقطة بيانات (آخر ٢٤ ساعة + الأسبوع الجاي).
القواعد المهمة:
- ناديها باسمها "شيم" (مب شيمة).
- **ابدئي دايماً بقسم "📣 التسويق والإعلانات" — هذا تركيز شيم الأساسي**: صرف الإعلانات هالشهر، العائد التقريبي مقابل الصرف، العملاء المحتملين الجدد، والسلال المتروكة كفرصة استهداف/متابعة. لا تنسبي كل المبيعات للإعلانات — العائد مؤشر عام فقط.
- بعدها أقسام قصيرة: 💰 المبيعات (آخر ٢٤س)، ⚠️ يحتاج انتباهچ اليوم (الأهم أول)، 📅 الأسبوع الجاي، 💡 توصية تسويقية عملية واحدة أو اثنتين.
- استخدمي الأرقام الحقيقية من اللقطة فقط، لا تخترعين. لو ما في شي يحتاج انتباه قوليها بوضوح.
- قصيرة ومرتّبة بعناوين الأقسام ونقاط. حدود ١٣٠ كلمة. المبالغ بالدرهم. نبرة زميلة شاطرة، مب تقرير جامد.`;

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
  const DASH = 'https://ops.eventanauae.com';
  const CEO_LINK = `${DASH}/?view=ceo`;

  // SHORT push teaser (not the whole brief — a long notification is unreadable),
  // and a tap target that deep-links straight to the CEO dashboard.
  const m = snapshot.marketing;
  const attCount = snapshot.attention.understaffedEvents + snapshot.attention.atRiskPrepEvents + snapshot.attention.abandonedCarts;
  const teaser = `صباح الخير شيم 🌸 إعلانات الشهر AED ${m.adSpendThisMonthAed} · ${m.newLeads24h} عميل جديد · مبيعات أمس ${snapshot.sales24h.newSales}${attCount ? ` · ⚠️ ${attCount} يحتاج انتباهچ` : ''}. افتحي للتفاصيل 👇`;
  for (const o of owners.rows) {
    await pushToOwner('staff', o.id, title, teaser, { url: CEO_LINK }).catch(() => {});
  }

  if (emailEnabled()) {
    const esc = (t: string) => t.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] as string));
    // Render the brief as clean sections: a line that starts with an emoji becomes
    // a heading chip, bullets become spaced rows — nicer than one grey text blob.
    const body = brief.split('\n').map((raw) => {
      const line = raw.trim();
      if (!line) return '<div style="height:10px"></div>';
      if (/^(📣|💰|⚠️|📅|💡|💵|☀️)/.test(line)) {
        return `<div style="font-size:15px;font-weight:800;color:#E94F9C;margin:16px 0 6px">${esc(line)}</div>`;
      }
      const txt = line.replace(/^[•\-]\s*/, '');
      return `<div style="font-size:14.5px;line-height:1.7;color:#3B3641;font-weight:600;padding:3px 0 3px 14px;position:relative"><span style="position:absolute;right:0;color:#F06CA8">•</span>${esc(txt)}</div>`;
    }).join('');
    const html = `<div style="background:#FDF2F7;padding:24px 12px;font-family:'Quicksand',Arial,sans-serif">
      <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:20px;overflow:hidden;box-shadow:0 8px 30px rgba(233,79,156,.12)">
        <div style="background:linear-gradient(135deg,#F06CA8,#E94F9C);color:#fff;padding:22px 24px;text-align:center">
          <div style="font-size:21px;font-weight:800;letter-spacing:.3px">☀️ صباح الخير شيم</div>
          <div style="font-size:12.5px;opacity:.92;margin-top:3px">ملخّصچ اليومي من كلوديا — مديرة التسويق الذكية</div>
        </div>
        <div style="padding:20px 24px;direction:rtl;text-align:right">${body}
          <div style="text-align:center;margin-top:22px">
            <a href="${CEO_LINK}" style="display:inline-block;background:#E94F9C;color:#fff;text-decoration:none;font-weight:800;font-size:14px;padding:12px 26px;border-radius:999px">افتحي لوحة الأعمال ←</a>
          </div>
        </div>
        <div style="padding:12px;color:#c9a9bb;font-size:11.5px;text-align:center;background:#fff">إيفنتانا · تقرير تلقائي يومي — ترسله كلوديا كل صباح</div>
      </div>
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
