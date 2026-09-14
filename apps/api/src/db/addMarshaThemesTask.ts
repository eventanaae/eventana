/**
 * One-shot: assign Marsha a manual task (from the owner) to update the party
 * themes for the year, deadline TOMORROW, notify her (in-app + WhatsApp), AND
 * email her (CC owner). Gated ADD_MARSHA_THEMES=true. Idempotent by title.
 * Turn the flag off after it runs.
 */
import { pool } from './pool.js';
import { createManualTask } from '../domain/prep.js';
import { emailEnabled, sendEmail } from '../integrations/email.js';

const MARSHA = 'tm-marsha';
const OWNER = 'sheem@eventanauae.com';
const APP = 'https://ops.eventanauae.com';
const TITLE = 'Update the party themes for the year (Themes tab)';
const NOTE = "Open the Themes tab in the dashboard and fill in the theme for each party across the year. This feeds the CEO \"Top themes\" report, so it needs to be complete.";
const PINK = '#E94F9C', INK = '#3B3641', MUT = '#8B7E86', LINE = '#F0DCE7', SOFT = '#FDEFF6';

function html(due: string): string {
  return `<!doctype html><html><body style="margin:0;padding:0;background:#FBF3F7">
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#FBF3F7"><tr><td align="center" style="padding:24px 12px 40px">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:580px">
        <tr><td style="background:${SOFT};border:1px solid ${LINE};border-radius:20px;padding:20px 22px 16px">
          <div style="font-family:Segoe UI,Arial,sans-serif;font-weight:700;color:${PINK};font-size:12.5px;letter-spacing:1px">● EVENTANA · TASK</div>
          <div style="font-family:Segoe UI,Arial,sans-serif;font-weight:800;font-size:23px;color:${INK};margin:6px 0 6px">Update the party themes 🎨</div>
          <div style="font-family:Segoe UI,Arial,sans-serif;color:${MUT};font-size:13.5px;line-height:1.6">Hi Marsha 👋 Please fill in the theme for each party across the year.</div>
        </td></tr>
        <tr><td style="height:14px"></td></tr>
        <tr><td style="background:#fff;border:1px solid ${LINE};border-radius:14px;padding:14px 16px;font-family:Segoe UI,Arial,sans-serif;font-size:13.5px;color:${INK};line-height:1.7">
          <ol style="margin:0;padding-inline-start:20px">
            <li>Open the dashboard and go to the <b>Themes</b> tab (<a href="${APP}" style="color:${PINK};text-decoration:none">${APP.replace('https://','')}</a>).</li>
            <li>For each party through the year, <b>fill in its theme</b> — it saves as you type.</li>
          </ol>
          <div style="margin:12px 0 0;color:${MUT};font-size:12.5px">Why: it feeds the CEO "Top themes" report, so it needs to be complete.</div>
          <div style="margin:12px 0 0"><b>Deadline: ${due} (tomorrow).</b> It's also in your dashboard “My tasks”.</div>
        </td></tr>
      </table>
    </td></tr></table>
  </body></html>`;
}

export async function addMarshaThemesTaskFromEnv(): Promise<void> {
  if (String(process.env.ADD_MARSHA_THEMES ?? '').toLowerCase() !== 'true') return;
  const dup = await pool.query(
    `SELECT 1 FROM prep_tasks pt JOIN prep_task_staff pts ON pts.task_id = pt.id
      WHERE pts.member_id = $1 AND pt.category = 'manual' AND pt.title = $2 LIMIT 1`,
    [MARSHA, TITLE],
  );
  if (dup.rows[0]) { console.log('[marsha-themes] task already assigned — skipped task'); }
  const d = new Date(Date.now() + 4 * 3_600_000); // Dubai now
  d.setUTCDate(d.getUTCDate() + 1);
  const tomorrow = d.toISOString().slice(0, 10);
  if (!dup.rows[0]) {
    const r = await createManualTask({ title: TITLE, memberIds: [MARSHA], dueDate: tomorrow, note: NOTE, actor: 'Sheem', notify: true });
    console.log(`[marsha-themes] ${r ? `task ${r.id} created, deadline ${tomorrow}, notified` : 'task FAILED'}`);
  }
  if (emailEnabled()) {
    const { rows } = await pool.query<{ email: string | null }>(`SELECT email FROM team_members WHERE lower(name) = 'marsha'`);
    const to = (rows[0]?.email ?? '').trim() || 'marsha@eventanauae.com';
    const res = await sendEmail({ to, cc: OWNER, subject: '🎨 Task — update the party themes (due tomorrow)', html: html(tomorrow) });
    console.log(`[marsha-themes] email Marsha <${to}> cc <${OWNER}>: ${res.ok ? 'SENT' : 'FAILED ' + (res as any).error}`);
  }
}
