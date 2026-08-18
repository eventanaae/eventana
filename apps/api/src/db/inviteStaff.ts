/**
 * Staff invites from the environment.
 *
 * Set STAFF_INVITES to a JSON array of people to onboard onto the Operations
 * app. On boot each is upserted into team_members (matched by name), given an
 * access level and a personal staff token, and emailed that token plus links
 * to both apps. Emailing only happens the first time a token is minted, so
 * repeated boots don't re-send — unless STAFF_INVITE_RESEND=true, which rotates
 * the token and re-sends (use it to re-issue an invite on demand).
 *
 *   STAFF_INVITES='[{"name":"Marsha","email":"marsha@eventanauae.com","accessLevel":"manager"}]'
 */
import { randomBytes } from 'node:crypto';
import { pool } from './pool.js';
import { sendEmail, emailEnabled } from '../integrations/email.js';

const DASHBOARD_URL = 'https://eventana-dashboard.onrender.com';
const CUSTOMER_URL = 'https://eventana-customer.onrender.com';

interface Invite {
  name: string;
  email: string;
  accessLevel?: 'owner' | 'manager' | 'employee' | 'driver';
}

export async function inviteStaffFromEnv(): Promise<void> {
  const raw = process.env.STAFF_INVITES;
  if (!raw) return;

  let invites: Invite[];
  try {
    invites = JSON.parse(raw);
  } catch {
    console.error('[invite] STAFF_INVITES is not valid JSON — skipping');
    return;
  }
  if (!Array.isArray(invites) || invites.length === 0) return;

  const resend = (process.env.STAFF_INVITE_RESEND ?? '').toLowerCase() === 'true';

  for (const inv of invites) {
    if (!inv?.name || !inv?.email) continue;
    const level = inv.accessLevel ?? 'employee';
    const id = `tm-${inv.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;

    // Ensure the member exists (create if missing).
    await pool.query(
      `INSERT INTO team_members (id, name, role, active, access_level, email)
       SELECT $1,$2,'Crew',true,$3,$4
        WHERE NOT EXISTS (SELECT 1 FROM team_members WHERE lower(name) = lower($2))`,
      [id, inv.name, level, inv.email],
    );
    // Keep email + access level current.
    await pool.query(
      `UPDATE team_members SET email = $2, access_level = $3 WHERE lower(name) = lower($1)`,
      [inv.name, inv.email, level],
    );

    // Read the current token; mint one if absent (or if forced to rotate).
    const { rows } = await pool.query(
      `SELECT id, access_token FROM team_members WHERE lower(name) = lower($1) LIMIT 1`,
      [inv.name],
    );
    const member = rows[0];
    if (!member) continue;

    const needsToken = !member.access_token || resend;
    if (!needsToken) continue;

    const token = `stf_${randomBytes(18).toString('hex')}`;
    await pool.query(`UPDATE team_members SET access_token = $2 WHERE id = $1`, [member.id, token]);

    if (!emailEnabled()) {
      console.warn(`[invite] ${inv.name}: token set but email is disabled (RESEND_API_KEY unset)`);
      continue;
    }
    const result = await sendEmail({
      to: inv.email,
      subject: 'Your Eventana access — Operations + Customer apps',
      html: inviteHtml(inv.name, level, token),
    });
    console.log(`[invite] ${inv.name} <${inv.email}> token issued · email ${result.ok ? `sent (${result.id})` : `FAILED: ${result.error}`}`);
  }
}

function inviteHtml(name: string, level: string, token: string): string {
  const first = name.split(' ')[0];
  return `<!doctype html><html><body style="margin:0;background:#faf6f2;font-family:'Segoe UI',Arial,sans-serif;color:#3B3641">
    <div style="max-width:560px;margin:0 auto;padding:24px">
      <div style="text-align:center;padding:14px 0 18px">
        <span style="font-size:22px;font-weight:800;color:#E94F9C;letter-spacing:.5px">Eventana</span>
      </div>
      <div style="background:#fff;border-radius:18px;padding:26px 24px;line-height:1.6;font-size:15px">
        <p style="margin:0 0 14px">Hi ${first} 👋</p>
        <p style="margin:0 0 18px">You've been added to Eventana for testing — here's everything you need for <b>both</b> apps.</p>

        <div style="border:1px solid #f0dce7;border-radius:14px;padding:16px;margin-bottom:16px">
          <div style="font-weight:800;font-size:15px;margin-bottom:6px">🛠️ Operations app (staff)</div>
          <div style="font-size:13.5px;color:#6f6369;margin-bottom:12px">Your access level: <b style="text-transform:capitalize">${level}</b></div>
          <div style="font-size:13px;color:#6f6369;margin-bottom:6px">Your access token — paste it on the sign-in screen:</div>
          <div style="font-family:ui-monospace,Menlo,monospace;font-size:14px;font-weight:700;background:#FDEFF6;color:#C6437E;border-radius:10px;padding:12px 14px;word-break:break-all;margin-bottom:14px">${token}</div>
          <a href="${DASHBOARD_URL}" style="display:inline-block;background:#E94F9C;color:#fff;text-decoration:none;font-weight:700;font-size:14px;padding:11px 20px;border-radius:12px">Open the Operations app →</a>
          <div style="font-size:12px;color:#a3968f;margin-top:10px">Steps: open the link → paste the token → Sign in. Keep this token private — it's your login.</div>
        </div>

        <div style="border:1px solid #f0dce7;border-radius:14px;padding:16px">
          <div style="font-weight:800;font-size:15px;margin-bottom:6px">🎈 Customer app</div>
          <div style="font-size:13px;color:#6f6369;margin-bottom:12px">To test the booking side, just register a normal account with your email and a password.</div>
          <a href="${CUSTOMER_URL}" style="display:inline-block;background:#3B3641;color:#fff;text-decoration:none;font-weight:700;font-size:14px;padding:11px 20px;border-radius:12px">Open the Customer app →</a>
        </div>
      </div>
      <div style="text-align:center;color:#b3a8a0;font-size:11px;padding:16px 0;line-height:1.6">
        Eventana Events · Abu Dhabi &amp; Dubai, UAE
      </div>
    </div>
  </body></html>`;
}
