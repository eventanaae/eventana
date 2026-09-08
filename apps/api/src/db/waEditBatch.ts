/**
 * Edit several already-approved customer templates IN PLACE (Meta rejects
 * re-creating an existing template — an existing one must be edited by its id).
 * Pushes the updated wording from seedWhatsAppTemplates.ts (links removed from
 * all but feedback, morning "on the way" line dropped, typo fixed, refund copy
 * reworded). Gated by WA_EDIT_BATCH=true; each edit re-enters Meta review.
 */
import { config } from '../config.js';
import { TEMPLATES, TEMPLATES_AR } from './seedWhatsAppTemplates.js';

// The exact (name, language) pairs whose wording changed.
const CHANGES: Array<{ name: string; language: string }> = [
  { name: 'booking_confirmation', language: 'en' },
  { name: 'booking_confirmation', language: 'ar' },
  { name: 'three_day_reminder', language: 'en' },
  { name: 'three_day_reminder', language: 'ar' },
  { name: 'event_day', language: 'en' },
  { name: 'event_day', language: 'ar' },
  { name: 'booking_updated', language: 'en' },
  { name: 'booking_updated', language: 'ar' },
  { name: 'refund_processed', language: 'ar' },
];

const P = (s: string) => console.log(`[wa-edit-batch] ${s}`);

export async function waEditBatchFromEnv(): Promise<void> {
  if (String(process.env.WA_EDIT_BATCH ?? '').toLowerCase() !== 'true') return;
  const token = config.whatsapp.accessToken;
  const waba = process.env.WHATSAPP_WABA_ID;
  const v = config.meta.graphVersion;
  if (!token || !waba) { P('missing token / WABA id'); return; }
  const defFor = (name: string, lang: string) =>
    (lang === 'ar' ? TEMPLATES_AR : TEMPLATES).find((t) => t.name === name && (t.language ?? 'en') === lang);
  try {
    // One listing gives us every template id.
    const lr = await fetch(`https://graph.facebook.com/${v}/${waba}/message_templates?fields=name,language,status,id,category&limit=200&access_token=${encodeURIComponent(token)}`);
    const lj: any = await lr.json();
    if (!Array.isArray(lj?.data)) { P(`list failed: ${JSON.stringify(lj).slice(0, 200)}`); return; }
    for (const c of CHANGES) {
      const def = defFor(c.name, c.language);
      if (!def) { P(`${c.name} [${c.language}] — no local definition, skip`); continue; }
      const tpl = lj.data.find((t: any) => t.name === c.name && t.language === c.language);
      if (!tpl) { P(`${c.name} [${c.language}] — not found at Meta, skip`); continue; }
      const body: Record<string, unknown> = { type: 'BODY', text: def.body };
      if (def.example.length) body.example = { body_text: [def.example] };
      const res = await fetch(`https://graph.facebook.com/${v}/${tpl.id}`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ category: def.category ?? 'UTILITY', components: [body] }),
      });
      const j: any = await res.json();
      P(res.ok && !j.error
        ? `${c.name} [${c.language}] edit submitted OK — Meta re-reviewing`
        : `${c.name} [${c.language}] edit FAILED: ${JSON.stringify(j).slice(0, 200)}`);
    }
  } catch (err) {
    P(`failed: ${(err as Error).message}`);
  }
}
