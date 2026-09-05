/**
 * Edit the Arabic feedback_request WhatsApp template IN PLACE (Meta rejects
 * re-creating an existing template, so the seed can't change its wording — an
 * existing template must be EDITED by its id). Gated by WA_EDIT_FEEDBACK=true.
 * Submits the owner's finalised copy for Meta re-review.
 */
import { config } from '../config.js';

const P = (s: string) => console.log(`[wa-edit] ${s}`);

const NEW_FEEDBACK_AR =
  `هلا {{1}} ياقلبي عساج طيبة 🤍\nحبيت آخذ فيدباك عن الحفلة اللي سويناها لكم. إذا تحسّين في أي شي يحتاج تعديل أو تطوير، أو في شي عيّبج وحبيتي تخبريني عنه، لا تترددين — رايكم يهمّنا وايد ويساعدنا نطوّر ونخلّي كل حفلة أحلى من اللي قبلها 🌸\nتقييمكم ما ياخذ منكم ثواني: {{2}}\nيسلمو من قلب على ثقتكم فينا 🤍`;

export async function waEditFeedbackFromEnv(): Promise<void> {
  if (String(process.env.WA_EDIT_FEEDBACK ?? '').toLowerCase() !== 'true') return;
  const token = config.whatsapp.accessToken;
  const waba = process.env.WHATSAPP_WABA_ID;
  const v = config.meta.graphVersion;
  if (!token || !waba) { P('missing token / WABA id'); return; }
  try {
    // Find the ar feedback_request template id.
    const lr = await fetch(`https://graph.facebook.com/${v}/${waba}/message_templates?fields=name,language,status,id&limit=100&access_token=${encodeURIComponent(token)}`);
    const lj: any = await lr.json();
    if (!Array.isArray(lj?.data)) { P(`list failed: ${JSON.stringify(lj).slice(0, 200)}`); return; }
    const tpl = lj.data.find((t: any) => t.name === 'feedback_request' && t.language === 'ar');
    if (!tpl) { P('feedback_request [ar] not found'); return; }
    P(`editing feedback_request [ar] id=${tpl.id} (was ${tpl.status})`);

    const res = await fetch(`https://graph.facebook.com/${v}/${tpl.id}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        category: 'MARKETING',
        components: [{ type: 'BODY', text: NEW_FEEDBACK_AR, example: { body_text: [['سارة', 'https://eventanauae.com/?event=EV-2026-0195']] } }],
      }),
    });
    const j: any = await res.json();
    P(res.ok && !j.error ? `edit submitted OK — Meta will re-review. ${JSON.stringify(j).slice(0, 120)}` : `edit failed: ${JSON.stringify(j).slice(0, 240)}`);
  } catch (err) {
    P(`failed: ${(err as Error).message}`);
  }
}
