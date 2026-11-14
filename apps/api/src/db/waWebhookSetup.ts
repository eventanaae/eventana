/**
 * WhatsApp inbound setup (SET_SHAN_LEADER=wahook). Sends were working but Meta
 * delivered NO inbound message in a month. Using the keys the API already holds
 * (WHATSAPP_ACCESS_TOKEN + WHATSAPP_APP_SECRET + WHATSAPP_VERIFY_TOKEN), this:
 *  1. finds the Meta app and the WhatsApp Business Account behind the token;
 *  2. logs the WABA's phone numbers (which number the API owns);
 *  3. subscribes the app to the WABA (POST /{waba}/subscribed_apps);
 *  4. registers the app webhook for `messages` with our callback + verify token
 *     (Meta verifies it live against GET /api/webhooks/whatsapp).
 * Logs every step; never logs a token.
 */
import { config } from '../config.js';

const L = (s: string) => console.log(`[wahook] ${s}`);
const G = () => `https://graph.facebook.com/${config.meta.graphVersion}`;

async function graph(path: string, token: string, method: 'GET' | 'POST' = 'GET', body?: Record<string, string>): Promise<any> {
  const url = `${G()}/${path}${path.includes('?') ? '&' : '?'}access_token=${encodeURIComponent(token)}`;
  const res = await fetch(url, {
    method,
    signal: AbortSignal.timeout(20000),
    headers: body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : undefined,
    body: body ? new URLSearchParams(body).toString() : undefined,
  });
  const j: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${res.status} ${j?.error?.message ?? ''}`.trim());
  return j;
}

export async function waWebhookSetupFromEnv(): Promise<void> {
  const tok = config.whatsapp.accessToken, secret = config.whatsapp.appSecret, verify = config.whatsapp.verifyToken;
  L(`keys present: token=${!!tok} appSecret=${!!secret} verifyToken=${!!verify} phoneNumberId=${!!config.whatsapp.phoneNumberId}`);
  if (!tok) return;
  try {
    const app = await graph('app?fields=id,name', tok);
    L(`app: ${app.name} (${app.id})`);
    const appToken = secret ? `${app.id}|${secret}` : null;

    // WABA ids from the token's granular scopes.
    let wabas: string[] = [];
    if (appToken) {
      try {
        const dbg = await graph(`debug_token?input_token=${encodeURIComponent(tok)}`, appToken);
        const d = dbg.data ?? {};
        L(`token type=${d.type} valid=${d.is_valid} expires=${d.expires_at ? new Date(d.expires_at * 1000).toISOString() : 'never'} scopes=${(d.scopes ?? []).join(',')} granular=${JSON.stringify(d.granular_scopes ?? [])}`);
        for (const g of d.granular_scopes ?? []) if (String(g.scope).startsWith('whatsapp_business')) wabas.push(...(g.target_ids ?? []));
        wabas = [...new Set(wabas)];
      } catch (e) { L(`debug_token: ${(e as Error).message}`); }
    }
    // Fallbacks: an explicit id (SET_SHAN_LEADER=wahook:<wabaId>), then the
    // businesses the system user can see and the WABAs they own / share.
    const explicit = String(process.env.SET_SHAN_LEADER ?? '').split(':')[1];
    if (explicit) wabas.push(explicit.trim());
    if (!wabas.length) {
      try {
        const me = await graph('me?fields=id,name', tok);
        L(`token user: ${me.name} (${me.id})`);
        const biz = await graph('me/businesses?fields=id,name', tok).catch((e) => { L(`me/businesses: ${(e as Error).message}`); return { data: [] }; });
        for (const b of biz.data ?? []) {
          L(`business: ${b.name} (${b.id})`);
          for (const edge of ['owned_whatsapp_business_accounts', 'client_whatsapp_business_accounts']) {
            const w = await graph(`${b.id}/${edge}?fields=id,name`, tok).catch((e) => { L(`${edge}: ${(e as Error).message}`); return { data: [] }; });
            for (const a of w.data ?? []) { L(`${edge}: ${a.name} (${a.id})`); wabas.push(a.id); }
          }
        }
      } catch (e) { L(`business lookup: ${(e as Error).message}`); }
      wabas = [...new Set(wabas)];
    }
    if (!wabas.length) L('no WABA id found — pass it as SET_SHAN_LEADER=wahook:<wabaId>');
    for (const w of wabas) {
      try {
        const ph = await graph(`${w}/phone_numbers?fields=display_phone_number,verified_name,quality_rating,platform_type,status`, tok);
        for (const p of ph.data ?? []) L(`WABA ${w} number ${p.display_phone_number} "${p.verified_name}" platform=${p.platform_type} status=${p.status} quality=${p.quality_rating} id=${p.id}${p.id === config.whatsapp.phoneNumberId ? '  <- used by the API' : ''}`);
      } catch (e) { L(`phone_numbers ${w}: ${(e as Error).message}`); }
      try {
        const before = await graph(`${w}/subscribed_apps`, tok);
        L(`WABA ${w} subscribed apps before: ${(before.data ?? []).map((a: any) => a.whatsapp_business_api_data?.name ?? a.whatsapp_business_api_data?.id ?? '?').join(', ') || 'none'}`);
        const r = await graph(`${w}/subscribed_apps`, tok, 'POST', {});
        L(`WABA ${w} subscribe app: ${JSON.stringify(r)}`);
      } catch (e) { L(`subscribed_apps ${w}: ${(e as Error).message}`); }
    }

    if (appToken && verify) {
      try {
        const cur = await graph(`${app.id}/subscriptions`, appToken);
        L(`app webhooks before: ${(cur.data ?? []).map((s: any) => `${s.object} → ${s.callback_url} [${(s.fields ?? []).map((f: any) => f.name).join(',')}] active=${s.active}`).join(' | ') || 'none'}`);
        const r = await graph(`${app.id}/subscriptions`, appToken, 'POST', {
          object: 'whatsapp_business_account',
          callback_url: 'https://eventana-api.onrender.com/api/webhooks/whatsapp',
          verify_token: verify,
          fields: 'messages',
          include_values: 'true',
        });
        L(`register webhook: ${JSON.stringify(r)}`);
        const after = await graph(`${app.id}/subscriptions`, appToken);
        L(`app webhooks after: ${(after.data ?? []).map((s: any) => `${s.object} → ${s.callback_url} [${(s.fields ?? []).map((f: any) => f.name).join(',')}] active=${s.active}`).join(' | ') || 'none'}`);
      } catch (e) { L(`app subscriptions: ${(e as Error).message}`); }
    } else {
      L('cannot register the webhook: app secret or verify token missing');
    }
  } catch (e) { L(`failed: ${(e as Error).message}`); }
}
