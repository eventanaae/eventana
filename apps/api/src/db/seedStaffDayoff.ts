/**
 * Warm Eventana day-off WhatsApp template (English — the crew reads English).
 * Its own template (not the generic staff_notify wrapper) so the message reads
 * clean and personal with no repeated name/phrase. {{1}} = first name. Gated by
 * WA_SEED_DAYOFF=true; run once, then turn the flag off.
 */
import { config } from '../config.js';

export const STAFF_DAYOFF_TEMPLATE = 'staff_dayoff_wish';
const BODY = `🌿 Happy day off, {{1}}! 💛\n\nSwitch off and recharge today — do something you love, and come back refreshed. You've earned it 🌸`;
const EXAMPLE = ['Gloria'];

export async function seedStaffDayoffFromEnv(): Promise<void> {
  if (String(process.env.WA_SEED_DAYOFF ?? '').toLowerCase() !== 'true') return;
  const token = config.whatsapp.accessToken;
  const waba = process.env.WHATSAPP_WABA_ID;
  const v = config.meta.graphVersion;
  if (!token || !waba) { console.log('[wa-dayoff] missing token / WABA id'); return; }
  try {
    const res = await fetch(`https://graph.facebook.com/${v}/${waba}/message_templates`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        name: STAFF_DAYOFF_TEMPLATE,
        language: 'en',
        category: 'MARKETING',
        allow_category_change: true,
        components: [{ type: 'BODY', text: BODY, example: { body_text: [EXAMPLE] } }],
      }),
    });
    const j: any = await res.json();
    console.log(res.ok && !j.error
      ? `[wa-dayoff] ${STAFF_DAYOFF_TEMPLATE} submitted (id ${j.id}, ${j.status})`
      : `[wa-dayoff] create failed: ${JSON.stringify(j).slice(0, 240)}`);
  } catch (err) {
    console.error('[wa-dayoff] failed:', (err as Error).message);
  }
}
