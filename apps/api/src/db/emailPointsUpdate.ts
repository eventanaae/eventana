/**
 * One-shot: email the field crew the "points doubled" announcement, CC Marsha.
 *
 * Triggered by SET_SHAN_LEADER=send (then blank the env). NOTE: this REUSES the
 * now-obsolete SET_SHAN_LEADER key because Render caps the service at 300 env
 * vars (can't add a new one); setShanLeaderFromEnv only runs on the value
 * 'true', so 'send' is inert there and only this task reacts. Recipients are the
 * active point-scheme crew (everyone with an email who isn't the owner, Marsha,
 * or the retired driver); Marsha is CC'd on each. Branded like the booking /
 * finance emails. Non-fatal and logs each send so the owner can confirm.
 */
import { pool } from './pool.js';
import { config } from '../config.js';
import { emailEnabled, sendEmail } from '../integrations/email.js';

const BRAND = '#EF5D95';
const INK = '#4A3540';
const MUTED = '#9B8A94';
const GROUND = '#FBEAF2';
const PANEL = '#FCEEF6';
const HAIR = '#F4DDEC';
const RAINBOW = 'linear-gradient(90deg,#7FD8C4,#BFE29A,#F7D06B,#F7A98C,#F080A8,#B79BE0)';
const DISPLAY = "'Fredoka','Baloo 2','Segoe UI',Arial,sans-serif";

function firstName(name: string): string {
  return (name || '').trim().split(/\s+/)[0] || 'there';
}

function buildHtml(name: string): string {
  const earn = (emoji: string, text: string) =>
    `<tr><td style="padding:9px 16px;border-bottom:1px solid ${HAIR};font-size:14px;color:${INK}">
       <span style="display:inline-block;width:24px">${emoji}</span>${text}</td></tr>`;
  const logo = config.emailLogoUrl
    ? `<img src="${config.emailLogoUrl}" alt="Eventana Events" width="210" style="display:inline-block;width:210px;max-width:70%;height:auto">`
    : `<div style="font-family:${DISPLAY};font-size:28px;font-weight:700;color:${BRAND}">Eventana</div>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <link href="https://fonts.googleapis.com/css2?family=Fredoka:wght@500;600;700&display=swap" rel="stylesheet"></head>
  <body style="margin:0;padding:0;background:${GROUND};font-family:'Segoe UI',-apple-system,BlinkMacSystemFont,Arial,sans-serif;color:${INK}">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${GROUND}">
      <tr><td align="center" style="padding:30px 16px 44px">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px">
          <tr><td style="text-align:center;padding:2px 0 22px">${logo}</td></tr>
          <tr><td style="background:#ffffff;border-radius:26px;overflow:hidden;border:1px solid #F6E4EF;box-shadow:0 10px 34px rgba(214,49,127,.10)">
            <div style="height:7px;background:${BRAND};background:${RAINBOW}"></div>
            <div style="padding:30px 28px 34px">
              <div style="text-align:center;font-size:40px;line-height:1;margin-bottom:8px">🎉</div>
              <div style="text-align:center;font-size:11.5px;font-weight:700;letter-spacing:2.5px;text-transform:uppercase;color:${BRAND};margin-bottom:6px">Rewards update</div>
              <h1 style="margin:0 0 6px;text-align:center;font-family:${DISPLAY};font-size:24px;font-weight:700;color:${INK}">Your points just got bigger!</h1>
              <p style="margin:12px 0 2px;font-size:14.5px;line-height:1.6;color:${INK}">Hi ${firstName(name)},</p>
              <p style="margin:8px 0 16px;font-size:14.5px;line-height:1.6;color:${INK}">
                Great news — we've made your rewards even more rewarding. From now on, <b style="color:${BRAND}">every point is doubled</b>:
              </p>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${PANEL};border:1px solid ${HAIR};border-radius:16px">
                ${earn('🎈', '<b>20 points</b> for every event you complete')}
                ${earn('⭐', '<b>+40 points</b> for every 5★ customer rating')}
                ${earn('💅', '<b>+40 points</b> for every Glam Doll you perform')}
                <tr><td style="padding:9px 16px;font-size:14px;color:${INK}">
                  <span style="display:inline-block;width:24px">🎟️</span>Bring in an event with your code — now <b>every AED 1 = 1 point</b> (an AED 4,000 event ≈ 4,000 points!)</td></tr>
              </table>
              <p style="margin:18px 0 0;font-size:14.5px;line-height:1.6;color:${INK}">
                Your monthly target is still <b>600 points</b> — but now you reach it <b>twice as fast</b>. Past 600, every <b>100 points = AED 10</b>, and tips are <b>always 100% yours</b> on top.
              </p>
              <p style="margin:14px 0 0;font-size:14.5px;line-height:1.6;color:${INK}">
                We've already updated this month's board with the new points — open your <b>Profile</b> to see your new total. Keep shining — you're the heart of every Eventana party. 💛
              </p>
              <p style="margin:18px 0 0;font-size:14.5px;color:${MUTED}">— Eventana</p>
            </div>
          </td></tr>
          <tr><td style="text-align:center;color:#b8a6b0;font-size:11.5px;padding:24px 12px 0;line-height:1.8">
            Eventana Events · Abu Dhabi &amp; Dubai, UAE
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body></html>`;
}

export async function emailPointsUpdateFromEnv(): Promise<void> {
  if (process.env.SET_SHAN_LEADER !== 'send') return;
  if (!emailEnabled()) { console.log('[points-email] email disabled — skipped'); return; }

  // Idempotent guard: send this announcement AT MOST ONCE, even if the env flag
  // is accidentally left on across a redeploy (the task has no per-message
  // dedupe otherwise, so staff would get the email again on every boot). Claim a
  // settings marker first; only the winner sends.
  const claim = await pool.query(
    `INSERT INTO settings (key, value, updated_by)
     VALUES ('points_double_email_sent', to_jsonb(now()::text), 'system')
     ON CONFLICT (key) DO NOTHING RETURNING key`,
  ).catch(() => ({ rowCount: 0 as number }));
  if (!claim.rowCount) { console.log('[points-email] already sent (marker present) — skipped'); return; }

  // Field crew = active members with an email who are on the points scheme:
  // not the owner, not Marsha (she's CC'd, on commission not points), not the
  // retired driver Shan.
  const { rows } = await pool.query<{ name: string; email: string }>(
    `SELECT name, email FROM team_members
      WHERE active AND email IS NOT NULL AND btrim(email) <> ''
        AND COALESCE(access_level,'') <> 'owner'
        AND lower(name) <> ALL($1::text[])
      ORDER BY name`,
    [['shan', 'sheem', 'marsha']],
  );
  const m = await pool.query<{ email: string }>(
    `SELECT email FROM team_members WHERE lower(name) = 'marsha' AND active AND email IS NOT NULL AND btrim(email) <> '' LIMIT 1`,
  );
  const cc = m.rows[0]?.email ?? null;

  if (rows.length === 0) { console.log('[points-email] no crew with email — nothing sent'); return; }
  let sent = 0;
  for (const r of rows) {
    const ccForThis = cc && cc.toLowerCase() !== r.email.toLowerCase() ? cc : undefined;
    const res = await sendEmail({
      to: r.email,
      cc: ccForThis,
      subject: '🎉 Your points just got bigger!',
      html: buildHtml(r.name),
    });
    if (res.ok) sent++;
    console.log(`[points-email] ${r.name} <${r.email}> cc=${ccForThis ?? '-'} → ${res.ok ? 'sent' : 'FAILED'}`);
  }
  console.log(`[points-email] DONE sent=${sent}/${rows.length}, cc=${cc ?? 'none'}. Blank SET_SHAN_LEADER now.`);
}
