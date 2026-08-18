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
}): Promise<SendResult> {
  if (!config.email.resendApiKey) return { ok: false, error: 'email_disabled' };
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
        ...(args.replyTo ? { reply_to: args.replyTo } : {}),
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
 * Wraps campaign body HTML in a simple, mobile-friendly Eventana shell with a
 * required unsubscribe footer (CAN-SPAM/PECR basics).
 */
export function renderCampaignHtml(bodyHtml: string, unsubscribeUrl: string): string {
  return `<!doctype html><html><body style="margin:0;background:#faf6f2;font-family:'Segoe UI',Arial,sans-serif;color:#3B3641">
    <div style="max-width:560px;margin:0 auto;padding:24px">
      <div style="text-align:center;padding:14px 0 18px">
        <span style="font-size:22px;font-weight:800;color:#E94F9C;letter-spacing:.5px">Eventana</span>
      </div>
      <div style="background:#fff;border-radius:18px;padding:26px 24px;line-height:1.6;font-size:15px">
        ${bodyHtml}
      </div>
      <div style="text-align:center;color:#b3a8a0;font-size:11px;padding:16px 0;line-height:1.6">
        Eventana Events · Abu Dhabi &amp; Dubai, UAE<br/>
        You’re receiving this because you booked or registered with Eventana.<br/>
        <a href="${unsubscribeUrl}" style="color:#b3a8a0">Unsubscribe</a>
      </div>
    </div>
  </body></html>`;
}
