/**
 * Issue staff referral codes from the environment.
 *
 * Set STAFF_REFERRAL_CODES to a JSON array of { name, email, code?, percent? }.
 * On boot each is matched to a team member by name; a referral code (their name
 * + "SALE" by default) is created for them, and the code is emailed to them the
 * FIRST time it is minted. Re-running is a no-op unless STAFF_REFERRAL_RESEND
 * is 'true', which re-sends the email. No-op when the variable is unset.
 *
 *   STAFF_REFERRAL_CODES='[{"name":"Diana","email":"d@x.com"}]'
 */
import { pool } from './pool.js';
import { sendEmail, emailEnabled } from '../integrations/email.js';
import { makeStaffCode } from '../domain/staffReferral.js';

const DASHBOARD_URL = 'https://ops.eventanauae.com';

interface Entry {
  name: string;
  email?: string;
  code?: string;
  percent?: number;
}

export async function issueReferralCodesFromEnv(): Promise<void> {
  const raw = process.env.STAFF_REFERRAL_CODES;
  if (!raw) return;

  let entries: Entry[];
  try {
    entries = JSON.parse(raw);
  } catch {
    console.error('[referral] STAFF_REFERRAL_CODES is not valid JSON — skipping');
    return;
  }
  if (!Array.isArray(entries) || entries.length === 0) return;

  const resend = (process.env.STAFF_REFERRAL_RESEND ?? '').toLowerCase() === 'true';

  for (const e of entries) {
    if (!e?.name) continue;
    const percent = Number.isFinite(e.percent) ? Number(e.percent) : 5;
    const code = (e.code?.trim() || makeStaffCode(e.name)).toUpperCase();

    const { rows } = await pool.query<{ id: string; email: string | null }>(
      `SELECT id, email FROM team_members WHERE lower(name) = lower($1) AND active LIMIT 1`,
      [e.name],
    );
    const member = rows[0];
    if (!member) {
      console.warn(`[referral] no active team member named "${e.name}" — skipping`);
      continue;
    }

    // Keep their email current (used to send the code), if provided.
    const email = e.email?.trim() || member.email || '';
    if (e.email?.trim() && e.email.trim() !== member.email) {
      await pool.query(`UPDATE team_members SET email = $2 WHERE id = $1`, [member.id, e.email.trim()]);
    }

    // One active code per member: retire any other codes, then upsert this one.
    await pool.query(`UPDATE staff_referral_codes SET active = false WHERE member_id = $1 AND code <> $2`, [member.id, code]);
    const existed = await pool.query(`SELECT 1 FROM staff_referral_codes WHERE code = $1`, [code]);
    await pool.query(
      `INSERT INTO staff_referral_codes (code, member_id, percent, active)
       VALUES ($1,$2,$3,true)
       ON CONFLICT (code) DO UPDATE SET member_id = EXCLUDED.member_id, percent = EXCLUDED.percent, active = true`,
      [code, member.id, percent],
    );

    const isNew = existed.rowCount === 0;
    if (!(isNew || resend)) continue;
    if (!emailEnabled() || !email) {
      console.warn(`[referral] ${e.name}: code ${code} set but not emailed (no email / email disabled)`);
      continue;
    }
    const result = await sendEmail({
      to: email,
      subject: `Your Eventana referral code: ${code}`,
      html: referralHtml(e.name, code),
    });
    console.log(`[referral] ${e.name} <${email}> code ${code} · email ${result.ok ? `sent (${result.id})` : `FAILED: ${result.error}`}`);
  }
}

function referralHtml(name: string, code: string): string {
  const first = name.split(' ')[0];
  return `<!doctype html><html><body style="margin:0;background:#faf6f2;font-family:'Segoe UI',Arial,sans-serif;color:#3B3641">
    <div style="max-width:560px;margin:0 auto;padding:24px">
      <div style="text-align:center;padding:14px 0 18px">
        <span style="font-size:22px;font-weight:800;color:#E94F9C;letter-spacing:.5px">Eventana</span>
      </div>
      <div style="background:#fff;border-radius:18px;padding:26px 24px;line-height:1.6;font-size:15px">
        <p style="margin:0 0 14px">Hi ${first} 👋</p>
        <p style="margin:0 0 18px">Here is your personal Eventana referral code. Share it with clients you bring in — when they book an <b>event</b> and enter your code at checkout, <b>you earn points on that event's value</b> that count toward your monthly target and reward. It's added automatically.</p>
        <div style="text-align:center;margin:0 0 18px">
          <div style="display:inline-block;font-family:ui-monospace,Menlo,monospace;font-size:22px;font-weight:800;letter-spacing:2px;background:#FDEFF6;color:#C6437E;border-radius:12px;padding:14px 26px">${code}</div>
        </div>
        <div style="border:1px solid #f0dce7;border-radius:14px;padding:14px 16px;font-size:13.5px;color:#6f6369">
          <div style="font-weight:800;color:#3B3641;margin-bottom:6px">How it works</div>
          1. Give your client the code <b>${code}</b>.<br>
          2. They enter it in the promo box when they book their event.<br>
          3. Once the event is paid, you get points on its value — see them in your Profile.
        </div>
        <p style="font-size:12.5px;color:#a3968f;margin:16px 0 0">Codes work on event bookings only, not on shop purchases. It gives the customer no discount — it's your reward for bringing the booking.</p>
        <div style="margin-top:16px"><a href="${DASHBOARD_URL}" style="display:inline-block;background:#E94F9C;color:#fff;text-decoration:none;font-weight:700;font-size:14px;padding:10px 20px;border-radius:12px">Open the Operations app →</a></div>
      </div>
      <div style="text-align:center;color:#b3a8a0;font-size:11px;padding:16px 0;line-height:1.6">
        Eventana Events · Abu Dhabi &amp; Dubai, UAE
      </div>
    </div>
  </body></html>`;
}
