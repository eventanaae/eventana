/**
 * Team WhatsApp template. The original `staff_alert` name is locked by Meta
 * (a deleted template name can't be reused for up to 4 weeks — delete returned
 * 2593002, re-create 2388023 "language is being deleted"). So we submit under a
 * fresh name `staff_notify` with the name-personalised body:
 * {{1}} first name, {{2}} headline, {{3}} details. Gated by WA_RESEED_STAFF=true;
 * safe to run once, then set the flag back to false.
 */
import { config } from '../config.js';

export const STAFF_TEMPLATE = 'staff_notify';
const BODY = `Hi {{1}} 💛\n\n{{2}}\n\n{{3}}`;
const EXAMPLE = ['Gloria', '🛒 Update the missing-items list before your day off', 'Tomorrow is your day off — please update anything missing so we can buy it Wednesday 🤍'];

export async function reseedStaffAlertFromEnv(): Promise<void> {
  if (String(process.env.WA_RESEED_STAFF ?? '').toLowerCase() !== 'true') return;
  const token = config.whatsapp.accessToken;
  const waba = process.env.WHATSAPP_WABA_ID;
  const v = config.meta.graphVersion;
  if (!token || !waba) { console.log('[wa-reseed] missing token / WABA id'); return; }
  try {
    const res = await fetch(`https://graph.facebook.com/${v}/${waba}/message_templates`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        name: STAFF_TEMPLATE,
        language: 'en',
        category: 'UTILITY',
        components: [{ type: 'BODY', text: BODY, example: { body_text: [EXAMPLE] } }],
      }),
    });
    const j: any = await res.json();
    console.log(res.ok && !j.error
      ? `[wa-reseed] ${STAFF_TEMPLATE} submitted (id ${j.id}, ${j.status})`
      : `[wa-reseed] create failed: ${JSON.stringify(j).slice(0, 240)}`);
  } catch (err) {
    console.error('[wa-reseed] failed:', (err as Error).message);
  }
}
