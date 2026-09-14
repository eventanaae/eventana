/**
 * One-shot: email Marsha to action the Tabby + Tamara go-live (get production API
 * credentials), CC the owner so it's shared with her. Gated SEND_BNPL_REQUEST=true.
 * Recipients resolved from team_members (Marsha), owner falls back to the business
 * inbox. Turn the flag off after it sends.
 */
import { pool } from './pool.js';
import { emailEnabled, sendEmail } from '../integrations/email.js';

const PINK = '#E94F9C', INK = '#3B3641', MUT = '#8B7E86', LINE = '#F0DCE7', SOFT = '#FDEFF6';
const OWNER = 'sheem@eventanauae.com';

const TABBY_MSG =
  `Hello Tabby team,\n\nWe're Eventana Events (eventanauae.com), a kids' parties and events company in the UAE. Our booking website is built and Tabby is already integrated in our checkout — we're ready to go live.\n\nCould you please:\n1. Activate our merchant account for production/live, and\n2. Issue our production API credentials — specifically the Secret Key and Merchant Code.\n\nOur server needs to register a webhook to your API; our webhook endpoint is:\nhttps://eventana-api.onrender.com/api/webhooks/tabby\n\nPlease also share any go-live checklist or test cases you require before enabling live payments.\n\nThank you,\nEventana Events`;

const TAMARA_MSG =
  `Hello Tamara team,\n\nWe're Eventana Events (eventanauae.com), a kids' parties and events company in the UAE. Tamara is already integrated in our booking checkout and we'd like to switch to live.\n\nCould you please:\n1. Approve/activate our merchant account for production/live, and\n2. Provide our production API Token and Notification (webhook) Token.\n\nOur notification/webhook endpoint is:\nhttps://eventana-api.onrender.com/api/webhooks/tamara\n\nPlease also send any go-live requirements or test scenarios you need us to complete first.\n\nThank you,\nEventana Events`;

function pre(text: string): string {
  return `<pre style="white-space:pre-wrap;font-family:Segoe UI,Arial,sans-serif;font-size:13px;color:${INK};background:#fff;border:1px solid ${LINE};border-radius:12px;padding:14px 16px;margin:6px 0 0;line-height:1.6">${text.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] as string))}</pre>`;
}

function html(): string {
  return `<!doctype html><html><body style="margin:0;padding:0;background:#FBF3F7">
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#FBF3F7"><tr><td align="center" style="padding:24px 12px 40px">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px">
        <tr><td style="background:${SOFT};border:1px solid ${LINE};border-radius:20px;padding:20px 22px 16px">
          <div style="font-family:Segoe UI,Arial,sans-serif;font-weight:700;color:${PINK};font-size:12.5px;letter-spacing:1px">● EVENTANA · ACTION NEEDED</div>
          <div style="font-family:Segoe UI,Arial,sans-serif;font-weight:800;font-size:23px;color:${INK};margin:6px 0 6px">Activate Tabby &amp; Tamara 💳</div>
          <div style="font-family:Segoe UI,Arial,sans-serif;color:${MUT};font-size:13.5px;line-height:1.6">Hi Marsha 👋 We're ready to switch on Tabby and Tamara in our booking checkout — the integration is already built. We just need each provider to <b>activate our account for LIVE</b> and give us the <b>production API credentials</b>.</div>
        </td></tr>
        <tr><td style="height:14px"></td></tr>
        <tr><td style="background:#fff;border:1px solid ${LINE};border-radius:14px;padding:14px 16px;font-family:Segoe UI,Arial,sans-serif;font-size:13.5px;color:${INK};line-height:1.7">
          <b>What to do:</b>
          <ol style="margin:8px 0 0;padding-inline-start:20px">
            <li>Contact <b>Tabby</b> and <b>Tamara</b> through their merchant portal / support (or our account manager if we have one) and request <b>go-live + production credentials</b> — use the ready messages below.</li>
            <li>Then <b>send whatever they give you to Shaima</b> so we can finish the setup.</li>
          </ol>
          <div style="margin:14px 0 0"><b>What we need from each (must be PRODUCTION, not test):</b></div>
          <ul style="margin:6px 0 0;padding-inline-start:20px">
            <li><b>Tabby</b> → Secret Key · Merchant Code · Webhook Secret</li>
            <li><b>Tamara</b> → API Token · Notification (webhook) Token</li>
          </ul>
          <div style="margin:14px 0 4px"><b>Our webhook endpoints</b> (give these if asked):</div>
          <div style="font-size:12.5px;color:${MUT}">Tabby: https://eventana-api.onrender.com/api/webhooks/tabby<br>Tamara: https://eventana-api.onrender.com/api/webhooks/tamara</div>
        </td></tr>
        <tr><td style="height:14px"></td></tr>
        <tr><td style="font-family:Segoe UI,Arial,sans-serif;font-weight:800;font-size:14px;color:${INK}">✉️ Message to send Tabby</td></tr>
        <tr><td>${pre(TABBY_MSG)}</td></tr>
        <tr><td style="height:14px"></td></tr>
        <tr><td style="font-family:Segoe UI,Arial,sans-serif;font-weight:800;font-size:14px;color:${INK}">✉️ Message to send Tamara</td></tr>
        <tr><td>${pre(TAMARA_MSG)}</td></tr>
        <tr><td style="height:14px"></td></tr>
        <tr><td style="background:#fff;border:1px solid ${LINE};border-inline-start:4px solid ${PINK};border-radius:14px;padding:13px 15px;font-family:Segoe UI,Arial,sans-serif;font-size:12.5px;color:${INK};line-height:1.6">
          ⚠️ The keys must be <b>Production/live</b> — test/sandbox keys won't activate. Once you have them, send them to Shaima and we'll finish and turn it on. Thank you! 💛
        </td></tr>
      </table>
    </td></tr></table>
  </body></html>`;
}

export async function sendBnplRequestFromEnv(): Promise<void> {
  if (String(process.env.SEND_BNPL_REQUEST ?? '').toLowerCase() !== 'true') return;
  if (!emailEnabled()) { console.log('[bnpl-request] email disabled'); return; }
  const { rows } = await pool.query<{ email: string | null }>(
    `SELECT email FROM team_members WHERE lower(name) = 'marsha'`,
  );
  const to = (rows[0]?.email ?? '').trim() || 'marsha@eventanauae.com';
  const res = await sendEmail({
    to,
    cc: OWNER,
    subject: '💳 Action needed — activate Tabby & Tamara (get our live API keys)',
    html: html(),
  });
  console.log(`[bnpl-request] Marsha <${to}> cc <${OWNER}>: ${res.ok ? 'SENT' : 'FAILED ' + (res as any).error}`);
}
