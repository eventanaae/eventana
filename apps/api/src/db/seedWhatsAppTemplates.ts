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

interface Tpl { name: string; body: string; example: string[] }

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
];

export async function seedWhatsAppTemplatesFromEnv(): Promise<void> {
  const waba = process.env.WHATSAPP_WABA_ID;
  if (!waba) return;
  const token = config.whatsapp.accessToken;
  if (!token) { console.log('[wa-templates] no WHATSAPP_ACCESS_TOKEN — skipping'); return; }
  const url = `https://graph.facebook.com/${config.meta.graphVersion}/${waba}/message_templates`;
  for (const t of TEMPLATES) {
    const body: Record<string, unknown> = { type: 'BODY', text: t.body };
    if (t.example.length) body.example = { body_text: [t.example] };
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ name: t.name, language: 'en', category: 'UTILITY', components: [body] }),
      });
      const json = (await res.json()) as any;
      if (res.ok) console.log(`[wa-templates] ${t.name}: submitted (id ${json.id ?? '—'}, ${json.status ?? '?'})`);
      else console.log(`[wa-templates] ${t.name}: ${res.status} ${JSON.stringify(json).slice(0, 220)}`);
    } catch (e) {
      console.log(`[wa-templates] ${t.name}: error ${(e as Error).message.slice(0, 160)}`);
    }
  }
}
