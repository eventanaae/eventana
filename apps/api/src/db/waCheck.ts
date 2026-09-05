/**
 * WhatsApp token + template-status check. Gated by WA_TOKEN_CHECK=true. Read-only.
 *  - debug_token: is the access token valid, and does it EXPIRE (temporary) or
 *    never (permanent System-User token — what production needs)?
 *  - message_templates: the live Meta approval status of every template.
 */
import { config } from '../config.js';

const P = (s: string) => console.log(`[wa-check] ${s}`);

export async function waTokenCheckFromEnv(): Promise<void> {
  if (String(process.env.WA_TOKEN_CHECK ?? '').toLowerCase() !== 'true') return;
  const token = config.whatsapp.accessToken;
  const v = config.meta.graphVersion;
  if (!token) { P('no WHATSAPP_ACCESS_TOKEN set'); return; }
  try {
    const res = await fetch(`https://graph.facebook.com/${v}/debug_token?input_token=${encodeURIComponent(token)}&access_token=${encodeURIComponent(token)}`);
    const j: any = await res.json();
    const d = j?.data ?? {};
    const exp = Number(d.expires_at ?? 0);
    P(`token: valid=${d.is_valid} type=${d.type ?? '?'} app_id=${d.app_id ?? '?'} `
      + `expires_at=${exp} (${exp === 0 ? 'NEVER — permanent ✅' : new Date(exp * 1000).toISOString() + ' — TEMPORARY ⚠️'}) `
      + `scopes=${(d.scopes ?? []).join(',')}`);
    if (j?.error) P(`debug_token error: ${JSON.stringify(j.error).slice(0, 200)}`);
  } catch (e) { P(`debug_token failed: ${(e as Error).message}`); }

  const waba = process.env.WHATSAPP_WABA_ID;
  if (waba) {
    try {
      const tr = await fetch(`https://graph.facebook.com/${v}/${waba}/message_templates?fields=name,language,status,category&limit=60&access_token=${encodeURIComponent(token)}`);
      const tj: any = await tr.json();
      if (Array.isArray(tj?.data)) {
        P(`templates on Meta (${tj.data.length}):`);
        for (const t of tj.data) P(`  ${t.name} [${t.language}] → ${t.status} (${t.category})`);
      } else {
        P(`template list: ${JSON.stringify(tj).slice(0, 240)}`);
      }
    } catch (e) { P(`template list failed: ${(e as Error).message}`); }
  }
  P('DONE');
}
