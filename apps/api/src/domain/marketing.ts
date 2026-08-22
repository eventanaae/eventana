/**
 * Email marketing: audience selection, campaign sending, scheduled sweep and
 * unsubscribe tokens. Sending goes through the Resend adapter, which is a
 * no-op until a key is configured.
 */
import { createHmac } from 'node:crypto';
import { pool } from '../db/pool.js';
import { config } from '../config.js';
import { emailEnabled, renderCampaignHtml, sendEmail } from '../integrations/email.js';

export type Audience = 'all' | 'past_customers' | 'no_recent_booking';

/** Deterministic, verifiable unsubscribe token — no extra column needed. */
export function unsubToken(customerId: string): string {
  return createHmac('sha256', config.staffToken).update(customerId).digest('hex').slice(0, 24);
}
export function verifyUnsub(customerId: string, token: string): boolean {
  const expected = unsubToken(customerId);
  return token.length === expected.length && token === expected;
}

/** WHERE clause selecting an opted-in audience. */
function audienceWhere(audience: Audience): string {
  const base = `c.email IS NOT NULL AND c.email <> '' AND c.email_opt_out = FALSE`;
  if (audience === 'past_customers') {
    return `${base} AND EXISTS (SELECT 1 FROM orders o WHERE o.customer_id = c.id AND o.status = 'paid' AND o.kind = 'booking')`;
  }
  if (audience === 'no_recent_booking') {
    return `${base} AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.customer_id = c.id AND o.status = 'paid' AND o.created_at > now() - interval '90 days')`;
  }
  return base;
}

export async function audienceCounts(): Promise<Record<Audience, number> & { optedOut: number }> {
  const q = async (a: Audience) => {
    const { rows } = await pool.query<{ n: string }>(
      `SELECT count(*)::int AS n FROM customers c WHERE ${audienceWhere(a)}`,
    );
    return Number(rows[0].n);
  };
  const [all, past, none, optedOut] = await Promise.all([
    q('all'),
    q('past_customers'),
    q('no_recent_booking'),
    pool
      .query<{ n: string }>(`SELECT count(*)::int AS n FROM customers WHERE email_opt_out = TRUE`)
      .then((r) => Number(r.rows[0].n)),
  ]);
  return { all, past_customers: past, no_recent_booking: none, optedOut };
}

/**
 * Sends a campaign to its audience now. Marks it sending → sent (partial
 * counts kept). Caller must ensure email is configured.
 */
export async function sendCampaign(campaignId: number): Promise<{ recipients: number; sent: number }> {
  const { rows } = await pool.query(`SELECT * FROM email_campaigns WHERE id = $1`, [campaignId]);
  const camp = rows[0];
  if (!camp) throw new Error('campaign_not_found');
  if (camp.status === 'sending' || camp.status === 'sent') {
    return { recipients: camp.recipient_count, sent: camp.sent_count };
  }

  const { rows: recips } = await pool.query<{ id: string; email: string; name: string }>(
    `SELECT c.id, c.email, c.name FROM customers c WHERE ${audienceWhere(camp.audience as Audience)}`,
  );
  await pool.query(`UPDATE email_campaigns SET status = 'sending', recipient_count = $2 WHERE id = $1`, [
    campaignId,
    recips.length,
  ]);

  let sent = 0;
  for (const r of recips) {
    const unsub = `${config.email.publicBaseUrl}/api/unsubscribe?c=${encodeURIComponent(r.id)}&t=${unsubToken(r.id)}`;
    const html = renderCampaignHtml(camp.body_html, unsub);
    const res = await sendEmail({ to: r.email, subject: camp.subject, html });
    if (res.ok) sent++;
  }
  await pool.query(
    `UPDATE email_campaigns SET status = $2, sent_count = $3, sent_at = now() WHERE id = $1`,
    [campaignId, sent > 0 || recips.length === 0 ? 'sent' : 'failed', sent],
  );
  return { recipients: recips.length, sent };
}

/**
 * Reminds customers about an unused personal reward (the 20%-off next-booking
 * voucher) every ~6 months until they use it or it expires. Runs from the same
 * periodic sweep; the 6-month WHERE clause keeps it from ever emailing twice in
 * a window, so it is safe to call as often as the sweep fires.
 */
export async function sweepVoucherReminders(): Promise<number> {
  if (!emailEnabled()) return 0;
  const { rows } = await pool.query<{
    code: string;
    value: number;
    expires_at: Date | null;
    id: string;
    email: string;
    name: string;
  }>(
    `SELECT p.code, p.value, p.expires_at, c.id, c.email, c.name
       FROM promo_codes p
       JOIN customers c ON c.id = p.customer_id
      WHERE p.auto_reminder AND p.active
        AND c.email IS NOT NULL AND c.email <> '' AND c.email_opt_out = FALSE
        AND (p.expires_at IS NULL OR p.expires_at > now())
        AND (p.max_uses IS NULL OR p.uses < p.max_uses)
        AND NOT EXISTS (SELECT 1 FROM promo_redemptions r WHERE r.code = p.code)
        AND p.created_at <= now() - interval '6 months'
        AND (p.last_reminded_at IS NULL OR p.last_reminded_at <= now() - interval '6 months')
      ORDER BY p.created_at
      LIMIT 50`,
  );
  let sent = 0;
  for (const v of rows) {
    const unsub = `${config.email.publicBaseUrl}/api/unsubscribe?c=${encodeURIComponent(v.id)}&t=${unsubToken(v.id)}`;
    const expiry = v.expires_at
      ? new Date(v.expires_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
      : null;
    const body = `
      <p style="font-size:18px;font-weight:800;margin:0 0 12px">You still have ${v.value}% off waiting 🎁</p>
      <p style="margin:0 0 14px">Hi ${v.name || 'there'}, your Eventana reward from a past party is ready to use on your next booking.</p>
      <div style="text-align:center;margin:18px 0">
        <div style="display:inline-block;border:2px dashed #E94F9C;border-radius:14px;padding:14px 26px">
          <div style="font-size:12px;color:#b3679a;font-weight:700;letter-spacing:.5px">YOUR CODE</div>
          <div style="font-size:24px;font-weight:800;color:#E94F9C;letter-spacing:1px">${v.code}</div>
        </div>
      </div>
      <p style="margin:0 0 6px">Enter it at checkout to take ${v.value}% off.${expiry ? ` Valid until <strong>${expiry}</strong>.` : ''}</p>
      <p style="margin:14px 0 0">See you soon,<br/>The Eventana Team 💕</p>`;
    const res = await sendEmail({
      to: v.email,
      subject: `Your ${v.value}% Eventana reward is waiting 🎁`,
      html: renderCampaignHtml(body, unsub),
    });
    if (res.ok) sent++;
    // Stamp regardless of send outcome so a hard-bouncing address is not retried
    // every 5 minutes — it waits for the next 6-month window like everyone else.
    await pool.query(`UPDATE promo_codes SET last_reminded_at = now() WHERE code = $1`, [v.code]);
  }
  return sent;
}

/** Sends any scheduled campaigns whose time has come. Called from the sweep. */
export async function sweepScheduledCampaigns(): Promise<number> {
  if (!emailEnabled()) return 0;
  const { rows } = await pool.query<{ id: number }>(
    `SELECT id FROM email_campaigns WHERE status = 'scheduled' AND scheduled_for <= now() ORDER BY scheduled_for LIMIT 5`,
  );
  for (const r of rows) {
    await sendCampaign(r.id).catch((e) => console.error('[marketing] scheduled send failed', e));
  }
  return rows.length;
}
