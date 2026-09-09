/**
 * One-shot: email Marsha explaining the prep-task / design-upload fix she asked
 * about, CC the Eventana business inbox (Sheem). Gated by EMAIL_MARSHA_TASKFIX=
 * true. Marsha's address is resolved from team_members (fallback to the business
 * inbox). English — the crew reads English. Turn the flag off after it sends.
 */
import { pool } from './pool.js';
import { emailEnabled, sendEmail } from '../integrations/email.js';

const MARSHA_FALLBACK = 'marsha@eventanauae.com';
const SHEEM_CC = 'sheem@eventanauae.com';

const PINK = '#E94F9C', DEEP = '#C93A83', INK = '#3B3641';

function bodyHtml(): string {
  const step = (n: string, txt: string) =>
    `<tr><td style="padding:0 0 10px"><table cellpadding="0" cellspacing="0"><tr>
      <td valign="top" style="width:26px"><span style="display:inline-block;width:22px;height:22px;line-height:22px;text-align:center;border-radius:50%;background:${PINK};color:#fff;font-weight:800;font-size:12px;font-family:Segoe UI,Arial,sans-serif">${n}</span></td>
      <td style="font-family:Segoe UI,Arial,sans-serif;font-size:14px;color:${INK};line-height:1.6;padding-left:8px">${txt}</td>
    </tr></table></td></tr>`;
  return `<!doctype html><html><body style="margin:0;padding:0;background:#FBF3F7">
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#FBF3F7"><tr><td align="center" style="padding:24px 12px 40px">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px">
        <tr><td style="background:#FDEFF6;border:1px solid #F0DCE7;border-radius:20px;padding:20px 20px 16px">
          <div style="font-family:Segoe UI,Arial,sans-serif;font-weight:700;color:${PINK};font-size:13px">● EVENTANA · OPERATIONS</div>
          <div style="font-family:Segoe UI,Arial,sans-serif;font-weight:800;font-size:24px;color:${INK};margin:6px 0 4px">Your task &amp; design fix is live 🎨</div>
          <div style="font-family:Segoe UI,Arial,sans-serif;color:#8B7E86;font-size:13.5px">Thanks for flagging this, Marsha — you were right, and it's now fixed.</div>
        </td></tr>
        <tr><td style="height:16px;line-height:16px;font-size:16px">&nbsp;</td></tr>

        <tr><td style="background:#ffffff;border:1px solid #F0DCE7;border-radius:16px;padding:16px 18px">
          <div style="font-family:Segoe UI,Arial,sans-serif;font-weight:800;font-size:15px;color:${DEEP};margin-bottom:8px">What was happening</div>
          <div style="font-family:Segoe UI,Arial,sans-serif;font-size:14px;color:${INK};line-height:1.65">
            When you marked a task as done — like the <b>Mickey Mouse Cricut</b> design — it disappeared from <b>My tasks</b>, and there was no way to upload a revised design. So once a task was done, it felt completely gone.
          </div>
        </td></tr>
        <tr><td style="height:12px;line-height:12px;font-size:12px">&nbsp;</td></tr>

        <tr><td style="background:#ffffff;border:1px solid #F0DCE7;border-radius:16px;padding:16px 18px">
          <div style="font-family:Segoe UI,Arial,sans-serif;font-weight:800;font-size:15px;color:${DEEP};margin-bottom:10px">What changed</div>
          <table width="100%" cellpadding="0" cellspacing="0">
            ${step('1', '<b>Completed tasks stay visible</b> in “My tasks”. They move to the bottom of the list, so your open work stays on top — but a finished task is never hidden.')}
            ${step('2', 'Every task now <b>shows its uploaded design/photo</b> as a thumbnail, so you can see exactly what’s on file.')}
            ${step('3', 'A completed task now has an <b>“🖌️ Update design”</b> button — upload a new file and it <b>replaces the old one</b> while the task stays done. (There’s also <b>“↺ Reopen”</b> if you’d rather redo it from scratch.)')}
          </table>
        </td></tr>
        <tr><td style="height:12px;line-height:12px;font-size:12px">&nbsp;</td></tr>

        <tr><td style="background:#FFF3D6;border:1px solid #F3E4B8;border-radius:16px;padding:14px 16px;font-family:Segoe UI,Arial,sans-serif;font-size:13.5px;color:#7a5a12;line-height:1.65">
          <b>To update the Mickey Mouse design now:</b><br>
          Tasks → <b>My tasks</b> → open the <b>Cricut</b> task (it’s there even though it’s done) → tap <b>🖌️ Update design</b> → choose the new file. That’s it. ✅
        </td></tr>

        <tr><td style="height:18px;line-height:18px;font-size:18px">&nbsp;</td></tr>
        <tr><td style="font-family:Segoe UI,Arial,sans-serif;font-size:13.5px;color:${INK};line-height:1.6">
          It’s live on the system now — no need to refresh anything special, just open Tasks. If anything still feels off, tell me and I’ll sort it.<br><br>
          — Sheem · Eventana 🤍
        </td></tr>
      </table>
    </td></tr></table>
  </body></html>`;
}

export async function sendTaskFixEmailFromEnv(): Promise<void> {
  if (String(process.env.EMAIL_MARSHA_TASKFIX ?? '').toLowerCase() !== 'true') return;
  if (!emailEnabled()) { console.log('[taskfix-email] email disabled'); return; }
  const { rows } = await pool.query<{ email: string | null }>(
    `SELECT email FROM team_members WHERE lower(name) = 'marsha' OR lower(name) LIKE 'marsha %' LIMIT 1`,
  );
  const to = (rows[0]?.email ?? '').trim() || MARSHA_FALLBACK;
  const res = await sendEmail({
    to,
    cc: SHEEM_CC,
    subject: '🎨 Fixed: your task & design updates',
    html: bodyHtml(),
  });
  console.log(`[taskfix-email] to ${to} (cc ${SHEEM_CC}): ${res.ok ? 'SENT ' + (res.id ?? '') : 'FAILED ' + (res as any).error}`);
}
