/**
 * Edit the approved `staff_notify` template IN PLACE — drop the "please let us
 * know if you need anything" closing (owner: unnecessary for staff). Edits by id
 * with components only (no category, else 3835031). Gated by WA_EDIT_STAFF=true;
 * run once, then turn the flag off.
 */
import { config } from '../config.js';
import { STAFF_TEMPLATE, STAFF_BODY, STAFF_EXAMPLE } from './reseedStaffAlert.js';

export async function waEditStaffNotifyFromEnv(): Promise<void> {
  if (String(process.env.WA_EDIT_STAFF ?? '').toLowerCase() !== 'true') return;
  const token = config.whatsapp.accessToken;
  const waba = process.env.WHATSAPP_WABA_ID;
  const v = config.meta.graphVersion;
  if (!token || !waba) { console.log('[wa-edit-staff] missing token / WABA id'); return; }
  try {
    const lr = await fetch(`https://graph.facebook.com/${v}/${waba}/message_templates?fields=name,language,id&limit=200&access_token=${encodeURIComponent(token)}`);
    const lj: any = await lr.json();
    const tpl = Array.isArray(lj?.data) ? lj.data.find((t: any) => t.name === STAFF_TEMPLATE && t.language === 'en') : null;
    if (!tpl) { console.log('[wa-edit-staff] staff_notify [en] not found'); return; }
    const res = await fetch(`https://graph.facebook.com/${v}/${tpl.id}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ components: [{ type: 'BODY', text: STAFF_BODY, example: { body_text: [STAFF_EXAMPLE] } }] }),
    });
    const j: any = await res.json();
    console.log(res.ok && !j.error
      ? `[wa-edit-staff] staff_notify edit submitted OK — Meta re-reviewing`
      : `[wa-edit-staff] edit FAILED: ${JSON.stringify(j).slice(0, 220)}`);
  } catch (err) {
    console.error('[wa-edit-staff] failed:', (err as Error).message);
  }
}
