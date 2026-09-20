/**
 * Email delivery via Resend.
 *
 * A thin adapter over Resend's REST API — no SDK dependency. When
 * RESEND_API_KEY is unset the whole thing is a graceful no-op so campaigns can
 * still be composed and queued; nothing is sent until the key is in.
 */
import { config } from '../config.js';

export function emailEnabled(): boolean {
  return Boolean(config.email.resendApiKey);
}

export interface SendResult {
  ok: boolean;
  id?: string;
  error?: string;
}

export async function sendEmail(args: {
  to: string;
  subject: string;
  html: string;
  replyTo?: string;
  /** Visible carbon-copy recipient(s) — the primary recipient sees who is CC'd. */
  cc?: string | string[];
  /** Silent monitoring recipient(s) — BCC, so the customer never sees them.
   *  The primary recipient is never BCC'd to itself. */
  bcc?: string | string[];
  /** Skip the global monitor BCC for this send — e.g. a bulk marketing blast we
   *  don't want to copy the manager on hundreds of times. */
  skipMonitorBcc?: boolean;
  /** Optional file attachments. `content` is base64-encoded; `contentType`
   *  maps to Resend's `content_type` when given. */
  attachments?: Array<{ filename: string; content: string; contentType?: string }>;
  /** Resend tags — echoed back in delivery webhooks (used to attribute a
   *  marketing campaign's opens/clicks/bounces). Names/values: [a-zA-Z0-9_-]. */
  tags?: Array<{ name: string; value: string }>;
}): Promise<SendResult> {
  if (!config.email.resendApiKey) return { ok: false, error: 'email_disabled' };
  // Merge the caller's BCC with the global monitor inbox (config), so a manager
  // silently sees a copy of every email — and knows what reached vs bounced.
  const bccList = Array.from(new Set(
    [
      ...(Array.isArray(args.bcc) ? args.bcc : args.bcc ? [args.bcc] : []),
      ...(args.skipMonitorBcc ? [] : config.email.monitorBcc),
    ]
      .map((s) => String(s).trim())
      .filter((s) => s && s.toLowerCase() !== args.to.toLowerCase()),
  ));
  const ccList = Array.from(new Set(
    (Array.isArray(args.cc) ? args.cc : args.cc ? [args.cc] : [])
      .map((s) => String(s).trim())
      .filter((s) => s && s.toLowerCase() !== args.to.toLowerCase()),
  ));
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${config.email.resendApiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        from: config.email.from,
        to: [args.to],
        subject: args.subject,
        html: args.html,
        ...(ccList.length ? { cc: ccList } : {}),
        ...(bccList.length ? { bcc: bccList } : {}),
        ...(args.replyTo ? { reply_to: args.replyTo } : {}),
        ...(args.tags && args.tags.length ? { tags: args.tags } : {}),
        ...(args.attachments && args.attachments.length
          ? {
              attachments: args.attachments.map((a) => ({
                filename: a.filename,
                content: a.content,
                ...(a.contentType ? { content_type: a.contentType } : {}),
              })),
            }
          : {}),
      }),
    });
    if (!res.ok) return { ok: false, error: `${res.status}: ${(await res.text()).slice(0, 300)}` };
    const json = (await res.json()) as { id?: string };
    return { ok: true, id: json.id };
  } catch (err) {
    return { ok: false, error: (err as Error).message.slice(0, 300) };
  }
}

/**
 * Wraps campaign body HTML in the approved, mobile-friendly Eventana brand shell:
 * hosted logo, rounded white card with a candy top-bar, a WhatsApp/phone contact
 * line, and the required unsubscribe footer (CAN-SPAM/PECR basics).
 */
export function renderCampaignHtml(bodyHtml: string, unsubscribeUrl: string): string {
  const BRAND = '#E94F9C';
  const RAINBOW = 'linear-gradient(90deg,#F58FB8,#F7C948,#5BCFC5,#B79CE6)';
  const GROUND = '#FBF6F3';
  const logo = config.emailLogoUrl
    ? `<img src="${config.emailLogoUrl}" alt="Eventana Events" width="220" style="display:inline-block;width:220px;max-width:70%;height:auto">`
    : `<span style="font-family:'Segoe UI',Arial,sans-serif;font-size:26px;font-weight:800;color:${BRAND};letter-spacing:.5px">Eventana</span>`;
  const wa = config.contact.whatsapp;
  const phone = config.contact.phoneDisplay;
  const contact = `
    <div style="text-align:center;margin:22px 0 4px">
      <a href="https://wa.me/${wa}" style="display:inline-block;background:${BRAND};color:#fff;text-decoration:none;font-weight:800;font-size:15px;padding:13px 26px;border-radius:999px">💬 Chat with us on WhatsApp</a>
    </div>
    <p style="text-align:center;font-size:13px;color:#8a7f88;margin:8px 0 0">Or call / WhatsApp <b style="color:${BRAND}">${phone}</b> — we’ll help you plan it.</p>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
  <body style="margin:0;padding:0;background:${GROUND};font-family:'Segoe UI',-apple-system,BlinkMacSystemFont,Arial,sans-serif;color:#3B3641;-webkit-font-smoothing:antialiased">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${GROUND}">
      <tr><td align="center" style="padding:28px 16px 40px">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px">
          <tr><td style="text-align:center;padding:2px 0 20px">${logo}</td></tr>
          <tr><td style="background:#ffffff;border-radius:24px;overflow:hidden;border:1px solid #F6E4EF;box-shadow:0 10px 32px rgba(214,49,127,.10)">
            <div style="height:7px;background:${RAINBOW}"></div>
            <div style="padding:30px 28px 32px;line-height:1.65;font-size:15px">
              ${bodyHtml}
              ${contact}
            </div>
          </td></tr>
          <tr><td style="text-align:center;color:#b8a6b0;font-size:11.5px;padding:22px 12px 0;line-height:1.8">
            Eventana Events · Abu Dhabi &amp; Dubai, UAE<br/>
            <a href="${unsubscribeUrl}" style="color:#b8a6b0">Unsubscribe</a>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body></html>`;
}
