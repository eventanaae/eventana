/**
 * One-shot: email Gloria explaining why her August event's customer rating shows
 * on her profile but did not add to her points — the incentive system counts
 * from 1 September 2026, each month counts only that month, and the crew can now
 * see their own ratings. Owner-requested, written in "we" voice (the company).
 * Gated by EMAIL_GLORIA_POINTS=true; resolves her address from team_members
 * (fallback to the known gmail). Turn the flag off after it sends.
 */
import { pool } from './pool.js';
import { emailEnabled, sendEmail } from '../integrations/email.js';

const GLORIA_FALLBACK = 'daphinegloria@gmail.com';
const PINK = '#E94F9C', DEEP = '#C93A83', INK = '#3B3641';

function bodyHtml(first: string): string {
  const point = (txt: string) =>
    `<tr><td style="padding:0 0 10px"><table cellpadding="0" cellspacing="0"><tr>
      <td valign="top" style="width:22px"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${PINK};margin-top:7px"></span></td>
      <td style="font-family:Segoe UI,Arial,sans-serif;font-size:14px;color:${INK};line-height:1.6;padding-left:4px">${txt}</td>
    </tr></table></td></tr>`;
  return `<!doctype html><html><body style="margin:0;padding:0;background:#FBF3F7">
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#FBF3F7"><tr><td align="center" style="padding:24px 12px 40px">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px">
        <tr><td style="background:#FDEFF6;border:1px solid #F0DCE7;border-radius:20px;padding:20px 20px 16px">
          <div style="font-family:Segoe UI,Arial,sans-serif;font-weight:700;color:${PINK};font-size:13px">● EVENTANA · TEAM</div>
          <div style="font-family:Segoe UI,Arial,sans-serif;font-weight:800;font-size:24px;color:${INK};margin:6px 0 4px">About your points &amp; ratings 💛</div>
          <div style="font-family:Segoe UI,Arial,sans-serif;color:#8B7E86;font-size:13.5px">A quick note to clear up your question, ${first}.</div>
        </td></tr>
        <tr><td style="height:16px;line-height:16px;font-size:16px">&nbsp;</td></tr>

        <tr><td style="background:#ffffff;border:1px solid #F0DCE7;border-radius:16px;padding:16px 18px">
          <div style="font-family:Segoe UI,Arial,sans-serif;font-size:14px;color:${INK};line-height:1.65">
            Hi ${first} 🤍<br><br>
            We completely understand your concern — you saw a lovely customer rating from your <b>August</b> event on your profile, but noticed it did not add to your points, and you were wondering why. That is a totally fair question!
          </div>
        </td></tr>
        <tr><td style="height:12px;line-height:12px;font-size:12px">&nbsp;</td></tr>

        <tr><td style="background:#ffffff;border:1px solid #F0DCE7;border-radius:16px;padding:16px 18px">
          <div style="font-family:Segoe UI,Arial,sans-serif;font-weight:800;font-size:15px;color:${DEEP};margin-bottom:10px">Here is what is happening</div>
          <table width="100%" cellpadding="0" cellspacing="0">
            ${point('The rating <b>is</b> correctly linked to you — that is exactly why it shows on your profile 🌟')}
            ${point('It does not add points because our incentive system officially started counting from <b>1 September 2026</b>, just as we shared with the team from the start. Anything before that was our setup period, so it does not count toward points.')}
            ${point('Each month is counted on its own — the points for a given month reflect <b>only that month’s</b> work.')}
          </table>
        </td></tr>
        <tr><td style="height:12px;line-height:12px;font-size:12px">&nbsp;</td></tr>

        <tr><td style="background:#FFF3D6;border:1px solid #F3E4B8;border-radius:16px;padding:14px 16px;font-family:Segoe UI,Arial,sans-serif;font-size:13.5px;color:#7a5a12;line-height:1.65">
          From <b>September onward</b>, every 5-star rating adds to your points 💛 — and the nice part is you can now <b>see all your customer ratings</b> right on your profile.
        </td></tr>

        <tr><td style="height:18px;line-height:18px;font-size:18px">&nbsp;</td></tr>
        <tr><td style="font-family:Segoe UI,Arial,sans-serif;font-size:13.5px;color:${INK};line-height:1.6">
          Any questions at all, we are always here for you 🤍<br><br>
          — Team Eventana
        </td></tr>
      </table>
    </td></tr></table>
  </body></html>`;
}

export async function sendGloriaPointsEmailFromEnv(): Promise<void> {
  if (String(process.env.EMAIL_GLORIA_POINTS ?? '').toLowerCase() !== 'true') return;
  if (!emailEnabled()) { console.log('[gloria-email] email disabled'); return; }
  const { rows } = await pool.query<{ name: string | null; email: string | null }>(
    `SELECT name, email FROM team_members WHERE lower(name) LIKE 'gloria%' OR lower(name) LIKE '% gloria%' LIMIT 1`,
  );
  const to = (rows[0]?.email ?? '').trim() || GLORIA_FALLBACK;
  const first = (rows[0]?.name ?? 'Gloria').split(' ')[0] || 'Gloria';
  const res = await sendEmail({
    to,
    subject: 'About your points & ratings 💛',
    html: bodyHtml(first),
  });
  console.log(`[gloria-email] to ${to}: ${res.ok ? 'SENT ' + (res.id ?? '') : 'FAILED ' + (res as any).error}`);
}
