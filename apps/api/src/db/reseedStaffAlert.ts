/**
 * The staff_alert template was submitted without a name variable. To change a
 * PENDING template you must delete it and re-create it (Meta only lets you EDIT
 * an APPROVED one). This deletes staff_alert and re-submits the name-personalised
 * version ({{1}} first name, {{2}} headline, {{3}} details). Gated by
 * WA_RESEED_STAFF=true; safe to run once.
 */
import { config } from '../config.js';

const BODY = `Hi {{1}} 💛\n\n{{2}}\n\n{{3}}`;
const EXAMPLE = ['Gloria', '🛒 Update the missing-items list before your day off', 'Tomorrow is your day off — please update anything missing so we can buy it Wednesday 🤍'];

export async function reseedStaffAlertFromEnv(): Promise<void> {
  if (String(process.env.WA_RESEED_STAFF ?? '').toLowerCase() !== 'true') return;
  const token = config.whatsapp.accessToken;
  const waba = process.env.WHATSAPP_WABA_ID;
  const v = config.meta.graphVersion;
  if (!token || !waba) { console.log('[wa-reseed] missing token / WABA id'); return; }
  try {
    // Delete every language of staff_alert (removes the pending one).
    const del = await fetch(
      `https://graph.facebook.com/${v}/${waba}/message_templates?name=staff_alert&access_token=${encodeURIComponent(token)}`,
      { method: 'DELETE' },
    );
    console.log(`[wa-reseed] delete staff_alert: ${del.status} ${(await del.text()).slice(0, 160)}`);

    // Re-create with the name-personalised body.
    const res = await fetch(`https://graph.facebook.com/${v}/${waba}/message_templates`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'staff_alert',
        language: 'en',
        category: 'UTILITY',
        components: [{ type: 'BODY', text: BODY, example: { body_text: [EXAMPLE] } }],
      }),
    });
    const j: any = await res.json();
    console.log(res.ok && !j.error
      ? `[wa-reseed] staff_alert re-submitted (id ${j.id}, ${j.status})`
      : `[wa-reseed] re-create failed: ${JSON.stringify(j).slice(0, 240)}`);
  } catch (err) {
    console.error('[wa-reseed] failed:', (err as Error).message);
  }
}
