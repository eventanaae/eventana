/**
 * Create the customer WhatsApp message templates in Meta via the WhatsApp
 * Business Management API, so they can be submitted for approval without
 * fighting the (automation-hostile) WhatsApp Manager UI. Runs only when
 * WHATSAPP_WABA_ID is set AND an access token is configured; idempotent — Meta
 * rejects a duplicate name, which we log and move past. Category UTILITY, en.
 *
 * The body text mirrors domain/notify.ts renderWhatsApp(). Variables are
 * sequential {{1}}.. with one example value each (Meta requires the example).
 */
import { config } from '../config.js';

interface Tpl { name: string; language?: string; category?: string; body: string; example: string[] }

const TEMPLATES: Tpl[] = [
  {
    name: 'booking_confirmation',
    body: `🎉 {{1}}, your Eventana celebration is confirmed!\n\n🎈 Guest of honour: {{2}}\n📅 {{3}}\n🕒 {{4}}\n📍 {{5}}\n🔖 Ref: {{6}}\n💳 Total: {{7}}\n\nWe've saved every detail and our team is already planning the magic.\n\n📧 Your full itemised invoice is in your email.\n\nTrack it anytime: {{8}}\n\nCan't wait to celebrate with you! 💕`,
    example: ['Sara', 'Adam', 'Friday, 4 September 2026', '6:00 PM', 'Dubai', 'EV-2026-0195', 'AED 4,000', 'https://ops.eventanauae.com/?event=EV-2026-0195'],
  },
  {
    name: 'three_day_reminder',
    body: `🎈 {{1}}, just 3 days to go!\n\nThe countdown is on for your Eventana celebration on {{2}} in {{3}}. Need to tweak anything? It's all in the app: {{4}}\n\nSee you very soon! 💖`,
    example: ['Sara', 'Friday, 4 September 2026 at 6:00 PM', 'Dubai', 'https://ops.eventanauae.com/?event=EV-2026-0195'],
  },
  {
    name: 'event_day',
    // Meta's classifier insists this is MARKETING, not UTILITY (celebratory,
    // not tied to a specific transaction). Declaring it MARKETING lets it create.
    category: 'MARKETING',
    body: `🥳 {{1}}, it's party day!\n\nToday's the day — your celebration starts at {{2}}, and our team is on the way with all the magic. 🚐✨ Everything you need is in the app: {{3}}\n\nHave the most wonderful time! 💛`,
    example: ['Sara', '6:00 PM', 'https://ops.eventanauae.com/?event=EV-2026-0195'],
  },
  {
    name: 'team_on_the_way',
    body: `🚐 Your Eventana team is on the way{{1}}!\n\nWe're heading to you now to set up your celebration. 🎈 See you very soon!`,
    example: [' — ETA around 5:30 PM'],
  },
  {
    name: 'team_arrived',
    body: `📍 Your Eventana team has arrived!\n\nOur crew is at your location and starting the magic now. ✨ Everything will be ready shortly — thank you for choosing Eventana! 💕`,
    example: [],
  },
  {
    name: 'setup_ready',
    category: 'MARKETING', // classified MARKETING by Meta (see event_day)
    body: `✨ Everything is set up and ready!\n\nYour celebration is all ready to go. 🎉 Have the most wonderful time — we can't wait to hear how it went! 💕`,
    example: [],
  },
  {
    name: 'feedback_request',
    body: `⭐ {{1}}, how was your celebration?\n\nWe hope everyone had the most wonderful time! 💕 Your feedback helps us make every Eventana celebration even better — it only takes a minute: {{2}}\n\nThank you! 🌸`,
    example: ['Sara', 'https://ops.eventanauae.com/?event=EV-2026-0195'],
  },
  {
    name: 'cancellation_refund',
    body: `🌸 {{1}}, your Eventana booking has been cancelled.\n\n🔖 Order: {{2}}\n📅 Event date: {{3}}\n💳 Paid: {{4}}\n↩️ Refund: {{5}} ({{6}}%)\n\nYour refund may take ~7 business days to appear, depending on your bank. 💛`,
    example: ['Sara', 'ORD-2026-0195', 'Friday, 4 September 2026', 'AED 4,000', 'AED 3,000', '75'],
  },
  {
    name: 'refund_processed',
    body: `💸 {{1}}, your Eventana refund has been processed.\n\n🔖 Order: {{2}}\n↩️ Amount: {{3}}\n\nPlease allow ~7 business days for it to appear. 💛`,
    example: ['Sara', 'ORD-2026-0195', 'AED 3,000'],
  },
  // --- Driver (operational, English — sent to the assigned driver) ---
  {
    name: 'driver_new_order',
    body: `🚚 New Eventana delivery assigned to you!\n\n📅 {{1}}\n🕒 {{2}}\n📍 {{3}}\n🗺️ Directions: {{4}}\n🔖 Order: {{5}}\n📋 {{6}}\n\nIt has been added to your schedule — full details are in the app.`,
    example: ['Friday, 4 September 2026', '6:00 PM', 'Dubai — Jumeirah', 'https://www.google.com/maps/dir/?api=1&destination=25.2,55.2&travelmode=driving', 'EV-2026-0195', 'Kids Birthday · Adam · Deluxe Package'],
  },
  {
    name: 'driver_order_updated',
    body: `✏️ An Eventana delivery has changed.\n\n📅 {{1}}\n🕒 {{2}}\n📍 {{3}}\n🗺️ Directions: {{4}}\n🔖 Order: {{5}}\n📋 {{6}}\n\nYour schedule has been updated — please check the app.`,
    example: ['Friday, 4 September 2026', '6:00 PM', 'Dubai — Jumeirah', 'https://www.google.com/maps/dir/?api=1&destination=25.2,55.2&travelmode=driving', 'EV-2026-0195', 'Kids Birthday · Adam · Deluxe Package'],
  },
  {
    name: 'driver_order_cancelled',
    body: `❌ An Eventana delivery has been cancelled.\n\n📅 {{1}}\n📍 {{2}}\n🔖 Order: {{3}}\n\nIt has been removed from your schedule.`,
    example: ['Friday, 4 September 2026', 'Dubai — Jumeirah', 'EV-2026-0195'],
  },
];

/**
 * Arabic variants — warm, friendly Emirati tone (most of our customers are
 * Arabic and don't engage with English). Same template names + params as the
 * English set, language 'ar'. Wording approved by the owner 2026-09-03. Meta
 * rule: a body may not end on a variable, so each ends on a line of text.
 */
const TEMPLATES_AR: Tpl[] = [
  {
    name: 'booking_confirmation',
    language: 'ar',
    body: `🎉 هلا {{1}}! حجزكم مع Eventana تأكد 💕\nاحتفال {{2}} صار جاهز عندنا وفريقنا بدأ يجهّز كل التفاصيل الحلوة ✨\n📅 {{3}}   🕒 {{4}}   📍 {{5}}\n🔖 رقم الحجز: {{6}}   💳 الإجمالي: {{7}}\n📧 الفاتورة الكاملة وصلتكم على الإيميل.\nتابعي التفاصيل: {{8}}\nنعدكم بيوم ما يننسى 🌸`,
    example: ['سارة', 'آدم', 'الجمعة ٤ سبتمبر ٢٠٢٦', '٦:٠٠ مساءً', 'دبي', 'EV-2026-0195', 'AED 4,000', 'https://ops.eventanauae.com/?event=EV-2026-0195'],
  },
  {
    name: 'three_day_reminder',
    language: 'ar',
    body: `🎈 باقي ٣ أيام {{1}}! العدّ التنازلي بدأ لاحتفالكم يوم {{2}} في {{3}}.\nتبين تعدلين شي؟ كله بالتطبيق: {{4}}\nنشوفكم قريب 💖`,
    example: ['سارة', 'الجمعة ٤ سبتمبر ٢٠٢٦ الساعة ٦:٠٠ مساءً', 'دبي', 'https://ops.eventanauae.com/?event=EV-2026-0195'],
  },
  {
    name: 'event_day',
    language: 'ar',
    category: 'MARKETING',
    body: `🥳 اليوم يومكم {{1}}! احتفالكم يبدأ {{2}}، وفريقنا في الطريق لكم بكل اللمسات الحلوة 🚐✨\nتابعي من هني: {{3}}\nنتمنى لكم أحلى وقت 💛`,
    example: ['سارة', '٦:٠٠ مساءً', 'https://ops.eventanauae.com/?event=EV-2026-0195'],
  },
  {
    name: 'team_on_the_way',
    language: 'ar',
    body: `🚐 فريق Eventana في الطريق لكم{{1}}! يايين نجهّز أجواء احتفالكم 🎈 نشوفكم بعد شوي!`,
    example: [' — تقريباً الساعة ٥:٣٠ مساءً'],
  },
  {
    name: 'team_arrived',
    language: 'ar',
    body: `📍 فريق Eventana وصل عندكم! الفريق بالموقع وبدأ يرتّب كل شي ✨ بيصير جاهز بعد شوي — يسلمو إنكم اخترتونا 💕`,
    example: [],
  },
  {
    name: 'setup_ready',
    language: 'ar',
    category: 'MARKETING',
    body: `✨ كل شي صار جاهز! احتفالكم مجهّز وينتظركم 🎉 نتمنى لكم أحلى وقت — ونبي نسمع رايكم بعدين 💕`,
    example: [],
  },
  {
    name: 'feedback_request',
    language: 'ar',
    body: `هلا {{1}} ياقلبي عساج طيبة 🤍\nحبيت آخذ فيدباك عن الحفلة اللي سويناها لكم. إذا تحسّين في أي شي يحتاج تعديل أو تطوير، أو في شي عيّبج وحبيتي تخبريني عنه، لا تترددين — رايكم يهمّنا وايد ويساعدنا نطوّر ونخلّي كل حفلة أحلى من اللي قبلها 🌸\nتقييمكم ما ياخذ منكم دقيقة: {{2}}\nيسلمو من قلب على ثقتكم فينا 🤍`,
    example: ['سارة', 'https://ops.eventanauae.com/?event=EV-2026-0195'],
  },
  {
    name: 'cancellation_refund',
    language: 'ar',
    body: `🌸 تم إلغاء حجزكم مع Eventana {{1}}.\n🔖 الأوردر: {{2}}   📅 {{3}}\n💳 المدفوع: {{4}}   ↩️ المسترجع: {{5}} ({{6}}%)\nالاسترجاع ممكن ياخذ ٧ أيام عمل عشان يبين بحسابكم 💛`,
    example: ['سارة', 'ORD-2026-0195', 'الجمعة ٤ سبتمبر ٢٠٢٦', 'AED 4,000', 'AED 3,000', '75'],
  },
  {
    name: 'refund_processed',
    language: 'ar',
    body: `💸 تم تنفيذ استرجاع مبلغكم {{1}}.\n🔖 الأوردر: {{2}}   ↩️ المبلغ: {{3}}\nعطونا ٧ أيام عمل عشان يبين بحسابكم 💛`,
    example: ['سارة', 'ORD-2026-0195', 'AED 3,000'],
  },
];

export async function seedWhatsAppTemplatesFromEnv(): Promise<void> {
  const waba = process.env.WHATSAPP_WABA_ID;
  if (!waba) return;
  const token = config.whatsapp.accessToken;
  if (!token) { console.log('[wa-templates] no WHATSAPP_ACCESS_TOKEN — skipping'); return; }
  const url = `https://graph.facebook.com/${config.meta.graphVersion}/${waba}/message_templates`;
  for (const t of [...TEMPLATES, ...TEMPLATES_AR]) {
    const lang = t.language ?? 'en';
    const body: Record<string, unknown> = { type: 'BODY', text: t.body };
    if (t.example.length) body.example = { body_text: [t.example] };
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        // allow_category_change: let Meta auto-assign the category instead of
        // rejecting when it disagrees (event_day/setup_ready read as MARKETING to
        // its classifier). Without it those two 400 with "category mismatch".
        body: JSON.stringify({ name: t.name, language: lang, category: t.category ?? 'UTILITY', allow_category_change: true, components: [body] }),
      });
      const json = (await res.json()) as any;
      if (res.ok) console.log(`[wa-templates] ${t.name} (${lang}): submitted (id ${json.id ?? '—'}, ${json.status ?? '?'})`);
      else console.log(`[wa-templates] ${t.name} (${lang}): ${res.status} ${JSON.stringify(json).slice(0, 220)}`);
    } catch (e) {
      console.log(`[wa-templates] ${t.name} (${lang}): error ${(e as Error).message.slice(0, 160)}`);
    }
  }
}
