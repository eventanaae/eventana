/**
 * Warm Eventana-style birthday WhatsApp template for the team (English — the
 * crew reads English). One variable {{1}} = first name, lots of fixed warmth so
 * Meta's word-ratio is happy. Gated by WA_SEED_BIRTHDAY=true; run once, then
 * turn the flag off.
 */
import { config } from '../config.js';

export const STAFF_BIRTHDAY_TEMPLATE = 'staff_birthday_wish';
const BODY = `🎂 Happy Birthday, {{1}}! 💛\n\nWishing you the happiest of birthdays from your whole Eventana family. 🎈 Thank you for everything you bring to our team — today, we're celebrating you! 💕`;
const EXAMPLE = ['Gloria'];

export async function seedStaffBirthdayFromEnv(): Promise<void> {
  if (String(process.env.WA_SEED_BIRTHDAY ?? '').toLowerCase() !== 'true') return;
  const token = config.whatsapp.accessToken;
  const waba = process.env.WHATSAPP_WABA_ID;
  const v = config.meta.graphVersion;
  if (!token || !waba) { console.log('[wa-birthday] missing token / WABA id'); return; }
  try {
    const res = await fetch(`https://graph.facebook.com/${v}/${waba}/message_templates`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        name: STAFF_BIRTHDAY_TEMPLATE,
        language: 'en',
        category: 'MARKETING',
        allow_category_change: true,
        components: [{ type: 'BODY', text: BODY, example: { body_text: [EXAMPLE] } }],
      }),
    });
    const j: any = await res.json();
    console.log(res.ok && !j.error
      ? `[wa-birthday] ${STAFF_BIRTHDAY_TEMPLATE} submitted (id ${j.id}, ${j.status})`
      : `[wa-birthday] create failed: ${JSON.stringify(j).slice(0, 240)}`);
  } catch (err) {
    console.error('[wa-birthday] failed:', (err as Error).message);
  }
}
