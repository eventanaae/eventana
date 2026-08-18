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
