/**
 * Email marketing: audience selection, campaign sending, scheduled sweep and
 * unsubscribe tokens. Sending goes through the Resend adapter, which is a
 * no-op until a key is configured.
 */
import { createHmac } from 'node:crypto';
import { pool } from '../db/pool.js';
import { config } from '../config.js';
import { emailEnabled, renderCampaignHtml, sendEmail } from '../integrations/email.js';

export type Audience = 'all' | 'past_customers' | 'no_recent_booking' | 'anniversary';

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
  if (audience === 'anniversary') {
    // Customers whose confirmed event was ~11–12 months ago — their yearly
    // re-book window is now, so a timely, relevant offer makes sense.
    return `${base} AND EXISTS (
      SELECT 1 FROM events e
       WHERE e.customer_id = c.id AND e.phase <> 'Cancelled'
         AND e.event_date >= (current_date - interval '12 months')
         AND e.event_date <  (current_date - interval '11 months'))`;
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
  const [all, past, none, anniversary, optedOut] = await Promise.all([
    q('all'),
    q('past_customers'),
    q('no_recent_booking'),
    q('anniversary'),
    pool
      .query<{ n: string }>(`SELECT count(*)::int AS n FROM customers WHERE email_opt_out = TRUE`)
      .then((r) => Number(r.rows[0].n)),
  ]);
  return { all, past_customers: past, no_recent_booking: none, anniversary, optedOut };
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
  // Approval gate: a campaign can only be sent once approved (or scheduled,
  // which is only ever set at approval time). Nothing sends without review.
  if (camp.status !== 'approved' && camp.status !== 'scheduled') {
    throw new Error('not_approved');
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
    // Light personalisation: {{name}} → the customer's first name.
    const personalised = camp.body_html.replace(/\{\{\s*name\s*\}\}/gi, (r.name || 'there').split(' ')[0]);
    const html = renderCampaignHtml(personalised, unsub);
    // Bulk send: never BCC the manager monitor inbox (one copy per recipient
    // would flood it and double the send volume). Pace to respect Resend's
    // per-second limit and only count a real success.
    const res = await sendEmail({ to: r.email, subject: camp.subject, html, skipMonitorBcc: true });
    if (res.ok) sent++;
    await new Promise((res) => setTimeout(res, 120));
  }
  await pool.query(
    `UPDATE email_campaigns SET status = $2, sent_count = $3, sent_at = now() WHERE id = $1`,
    [campaignId, sent > 0 || recips.length === 0 ? 'sent' : 'failed', sent],
  );
  return { recipients: recips.length, sent };
}

/**
 * Auto-continue the win-back campaign, one daily batch at a time, so the whole
 * audience is reached over a few days WITHOUT hitting the email provider's daily
 * send cap (which stopped the bulk blast after ~200). GATED by WINBACK_AUTO=send.
 * Sends at most WINBACK_AUTO_DAILY (default 120) un-sent codes, and only once per
 * ~20h (guarded by the most recent win-back send), so the 5-minute sweep can call
 * it freely. Stamps only on success, so a failed address simply waits for the
 * next day instead of being lost.
 */
export async function sweepWinbackCampaignAuto(): Promise<number> {
  if (String(process.env.WINBACK_AUTO ?? '').toLowerCase() !== 'send') return 0;
  if (!emailEnabled()) return 0;
  // Already sent a batch in the last ~20h? Then hold until tomorrow.
  const recent = await pool.query(
    `SELECT 1 FROM promo_codes WHERE campaign = 'winback' AND last_reminded_at > now() - interval '20 hours' LIMIT 1`);
  if (recent.rowCount) return 0;

  const daily = Math.max(1, Math.min(400, Number(process.env.WINBACK_AUTO_DAILY ?? 120) || 120));
  const { sendWinbackEmail } = await import('./notify.js');
  const { rows } = await pool.query<{ id: string; name: string; email: string; code: string; expires_at: Date | null }>(
    `SELECT c.id, c.name, c.email, p.code, p.expires_at
       FROM promo_codes p JOIN customers c ON c.id = p.customer_id
      WHERE p.campaign = 'winback' AND p.active
        AND c.email IS NOT NULL AND c.email <> '' AND c.email_opt_out = FALSE
        AND (p.expires_at IS NULL OR p.expires_at > now())
        AND (p.max_uses IS NULL OR p.uses < p.max_uses)
        AND NOT EXISTS (SELECT 1 FROM promo_redemptions r WHERE r.code = p.code)
        AND p.last_reminded_at IS NULL
      ORDER BY c.name LIMIT ${daily}`);
  if (!rows.length) return 0;
  let sent = 0;
  for (const r of rows) {
    const ok = await sendWinbackEmail({
      firstName: (r.name || '').split(' ')[0], email: r.email, code: r.code, expiresAt: r.expires_at, customerId: r.id,
    }).catch(() => false);
    if (ok) { await pool.query(`UPDATE promo_codes SET last_reminded_at = now() WHERE code = $1`, [r.code]); sent++; }
    await new Promise((res) => setTimeout(res, 120));
  }
  console.log(`[winback-auto] daily batch — sent ${sent}/${rows.length}`);
  return sent;
}

/**
 * Reminds customers about an unused personal reward (the 20%-off next-booking
 * voucher) every ~6 months until they use it or it expires. Runs from the same
 * periodic sweep; the 6-month WHERE clause keeps it from ever emailing twice in
 * a window, so it is safe to call as often as the sweep fires.
 */
export async function sweepVoucherReminders(): Promise<number> {
  // Disabled at the owner's request (2026-09-08): the 20%-off voucher was an
  // older, separate reward and the business has standardised on the AED 600
  // win-back code, so this reminder was confusing. Re-enable with
  // VOUCHER_REMINDERS=send if the 20% reward is ever brought back.
  if (String(process.env.VOUCHER_REMINDERS ?? '').toLowerCase() !== 'send') return 0;
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
      skipMonitorBcc: true, // bulk send — don't copy the manager per recipient
    });
    if (res.ok) sent++;
    // Stamp regardless of send outcome so a hard-bouncing address is not retried
    // every 5 minutes — it waits for the next 6-month window like everyone else.
    await pool.query(`UPDATE promo_codes SET last_reminded_at = now() WHERE code = $1`, [v.code]);
  }
  return sent;
}

/**
 * Win-back reminders: every ~2 weeks, re-send the AED 600 (+ free delivery)
 * win-back email to a customer who still hasn't used their code, until they use
 * it or it expires. Modelled on sweepVoucherReminders, but with the win-back
 * template and a fortnightly cadence. GATED by WINBACK_REMINDERS=send so it can
 * never fire before the owner turns it on (like abandoned-cart's CART_REMINDERS).
 * Safe to call as often as the sweep runs — the 14-day WHERE clause de-dupes.
 */
export async function sweepWinbackReminders(): Promise<number> {
  if (String(process.env.WINBACK_REMINDERS ?? '').toLowerCase() !== 'send') return 0;
  if (!emailEnabled()) return 0;
  const { sendWinbackEmail } = await import('./notify.js');
  const { rows } = await pool.query<{
    code: string; expires_at: Date | null; id: string; email: string; name: string;
  }>(
    `SELECT p.code, p.expires_at, c.id, c.email, c.name
       FROM promo_codes p
       JOIN customers c ON c.id = p.customer_id
      WHERE p.campaign = 'winback' AND p.auto_reminder AND p.active
        AND c.email IS NOT NULL AND c.email <> '' AND c.email_opt_out = FALSE
        AND (p.expires_at IS NULL OR p.expires_at > now())
        AND (p.max_uses IS NULL OR p.uses < p.max_uses)
        AND NOT EXISTS (SELECT 1 FROM promo_redemptions r WHERE r.code = p.code)
        AND p.last_reminded_at IS NOT NULL
        AND p.last_reminded_at <= now() - interval '14 days'
      ORDER BY p.last_reminded_at
      LIMIT 50`,
  );
  let sent = 0;
  for (const v of rows) {
    const ok = await sendWinbackEmail({
      firstName: (v.name || '').split(' ')[0],
      email: v.email,
      code: v.code,
      expiresAt: v.expires_at,
      customerId: v.id,
    }).catch(() => false);
    if (ok) sent++;
    // Stamp regardless so a hard-bouncing address waits for the next window.
    await pool.query(`UPDATE promo_codes SET last_reminded_at = now() WHERE code = $1`, [v.code]);
  }
  return sent;
}

/**
 * Post-event win-back: ~3 days after an event, email that customer their win-back
 * code (if they have one and it hasn't been sent yet). Sets last_reminded_at so
 * the fortnightly reminder takes over and no other path double-sends. GATED by
 * WINBACK_POSTEVENT=send. This is the ongoing flow for new bookings; the one-off
 * campaign task handles the existing backlog.
 */
export async function sweepPostEventWinback(): Promise<number> {
  if (String(process.env.WINBACK_POSTEVENT ?? '').toLowerCase() !== 'send') return 0;
  if (!emailEnabled()) return 0;
  const { sendWinbackEmail } = await import('./notify.js');
  const { rows } = await pool.query<{
    code: string; expires_at: Date | null; email: string; name: string; id: string;
  }>(
    `SELECT DISTINCT ON (p.code) p.code, p.expires_at, c.email, c.name, c.id
       FROM events e
       JOIN customers c ON c.id = e.customer_id
       JOIN promo_codes p ON p.customer_id = c.id AND p.campaign = 'winback' AND p.active
      WHERE e.event_date >= (CURRENT_DATE - interval '4 days')
        AND e.event_date <= (CURRENT_DATE - interval '3 days')
        AND e.phase <> 'Cancelled'
        AND c.email IS NOT NULL AND c.email <> '' AND c.email_opt_out = FALSE
        AND (p.expires_at IS NULL OR p.expires_at > now())
        AND (p.max_uses IS NULL OR p.uses < p.max_uses)
        AND NOT EXISTS (SELECT 1 FROM promo_redemptions r WHERE r.code = p.code)
        AND p.last_reminded_at IS NULL
      LIMIT 50`,
  );
  let sent = 0;
  for (const v of rows) {
    const ok = await sendWinbackEmail({
      firstName: (v.name || '').split(' ')[0], email: v.email, code: v.code, expiresAt: v.expires_at, customerId: v.id,
    }).catch(() => false);
    await pool.query(`UPDATE promo_codes SET last_reminded_at = now() WHERE code = $1`, [v.code]);
    if (ok) sent++;
  }
  return sent;
}

/**
 * Smart anniversary marketing. Once a month, if there are customers whose
 * confirmed event was ~a year ago (their re-book window), create ONE campaign
 * suggestion targeted at them — as `pending_approval`, never auto-sent. The
 * Manager/CEO reviews and approves (or edits/rejects) it before anything goes
 * out. Deduped by month so it is only ever suggested once per month.
 */
// Retired at the owner's request (2026-09-08) in favour of a real customer-
// birthday greeting (sweepCustomerBirthdays). No longer called from the sweep;
// kept only so any other reference still compiles.
export async function sweepAnniversarySuggestions(): Promise<number> {
  const now = new Date();
  const monthKey = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  const dedupeKey = `anniversary-${monthKey}`;

  // Already suggested this month?
  const existing = await pool.query(`SELECT 1 FROM email_campaigns WHERE dedupe_key = $1 LIMIT 1`, [dedupeKey]);
  if (existing.rowCount) return 0;

  // Any opted-in customers in the anniversary window?
  const { rows: cnt } = await pool.query<{ n: string }>(
    `SELECT count(*)::int AS n FROM customers c WHERE ${audienceWhere('anniversary')}`,
  );
  const audienceSize = Number(cnt[0].n);
  if (audienceSize === 0) return 0;

  const body = `
    <p style="font-size:18px;font-weight:800;margin:0 0 12px">It's almost time to celebrate again 🎉</p>
    <p style="margin:0 0 14px">Hi {{name}}, it's been almost a year since your Eventana celebration — and if another special day is coming up, we'd love to make it magical again.</p>
    <p style="margin:0 0 14px">As a welcome-back treat, here's a little something for your next booking. Tap below in the app to start planning.</p>
    <p style="margin:14px 0 0">With love,<br/>The Eventana Team 💕</p>`;

  await pool.query(
    `INSERT INTO email_campaigns (subject, body_html, audience, status, created_by, source, dedupe_key)
     VALUES ($1,$2,'anniversary','pending_approval','Eventana (auto)','anniversary',$3)
     ON CONFLICT (dedupe_key) DO NOTHING`,
    [`We'd love to celebrate with you again 🎉`, body, dedupeKey],
  );
  return 1;
}

/**
 * Warm birthday greeting to a CUSTOMER on their real birthday (not the baby's
 * birthday from the order). Only fires for customers whose personal `birthday`
 * is on file — so it stays dormant until birthdays are collected. Auto-sent
 * (owner asked to just handle it), once per customer per year. Email only.
 */
export async function sweepCustomerBirthdays(): Promise<number> {
  if (!emailEnabled()) return 0;
  const { rows } = await pool.query<{ id: string; name: string; email: string }>(
    `SELECT id, name, email FROM customers
      WHERE birthday IS NOT NULL
        AND to_char(birthday,'MM-DD') = to_char(current_date,'MM-DD')
        AND email IS NOT NULL AND email <> '' AND email_opt_out = FALSE
        AND (birthday_greeted_year IS NULL OR birthday_greeted_year < extract(year from current_date)::int)
      LIMIT 200`,
  );
  let sent = 0;
  for (const c of rows) {
    const first = (c.name || '').trim().split(/\s+/)[0] || '';
    const body = `
      <p style="font-size:20px;font-weight:800;margin:0 0 12px">كل عام وانتِ بخير ${first} 🎂🤍</p>
      <p style="margin:0 0 14px;font-size:15px">اليوم يومك، وحبينا نكون أول من يعايدك 🌸 من كل قلوبنا في ايفينتانا، نتمنى لك سنة مليانة فرح ولحظات حلوة تستاهلينها.</p>
      <p style="margin:0 0 14px;font-size:15px">وإذا في مناسبة قريبة تبين نزيّنها لك، احنا دايماً حاضرين نسوي لك يوم لا يُنسى 💕</p>
      <p style="margin:16px 0 0;font-size:15px">بكل الحب،<br/>فريق ايفينتانا 🎈</p>`;
    const unsub = `${config.email.publicBaseUrl}/api/unsubscribe?c=${encodeURIComponent(c.id)}&t=${unsubToken(c.id)}`;
    const res = await sendEmail({ to: c.email, subject: `كل عام وانتِ بخير ${first} 🎂`, html: renderCampaignHtml(body, unsub) });
    if (res.ok) {
      await pool.query(`UPDATE customers SET birthday_greeted_year = extract(year from current_date)::int WHERE id = $1`, [c.id]);
      sent++;
    }
    await new Promise((r) => setTimeout(r, 120)); // gentle pacing
  }
  if (sent) console.log(`[birthday] greeted ${sent} customer(s)`);
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
