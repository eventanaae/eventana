/**
 * One-shot: move the "themes" task off Marsha and onto Jane + Gloria (they fill
 * the Themes form). If Gloria is off tomorrow (weekly day off or an approved day
 * off), Diana takes her place. Deadline tomorrow — they work on it today after
 * the photoshoot and tomorrow. Notifies the assignees and emails them (CC owner).
 * Gated MOVE_THEMES_TASK=true. Idempotent by title. Turn the flag off after.
 */
import { pool } from './pool.js';
import { createManualTask } from '../domain/prep.js';
import { emailEnabled, sendEmail } from '../integrations/email.js';

const OWNER = 'sheem@eventanauae.com';
const MARSHA_TITLE = 'Update the party themes for the year (Themes tab)';
const NEW_TITLE = 'Fill in the party themes for the year (Themes tab)';
const NOTE =
  "Open the Themes tab in the dashboard and fill in the theme for each party across the year (it saves as you type). Please work on it today after the photoshoot, and finish it tomorrow. This feeds the CEO “Top themes” report, so it needs to be complete.";
const PINK = '#E94F9C', INK = '#3B3641', MUT = '#8B7E86', LINE = '#F0DCE7', SOFT = '#FDEFF6';
const APP = 'https://ops.eventanauae.com';

function html(names: string, due: string): string {
  return `<!doctype html><html><body style="margin:0;padding:0;background:#FBF3F7">
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#FBF3F7"><tr><td align="center" style="padding:24px 12px 40px">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px">
        <tr><td style="background:${SOFT};border:1px solid ${LINE};border-radius:20px;padding:20px 22px 16px">
          <div style="font-family:Segoe UI,Arial,sans-serif;font-weight:700;color:${PINK};font-size:12.5px;letter-spacing:1px">● EVENTANA · TASK</div>
          <div style="font-family:Segoe UI,Arial,sans-serif;font-weight:800;font-size:23px;color:${INK};margin:6px 0 6px">Fill in the party themes 🎨</div>
          <div style="font-family:Segoe UI,Arial,sans-serif;color:${MUT};font-size:13.5px;line-height:1.6">Hi ${names} 👋 Please fill in the theme for each party across the year in the dashboard.</div>
        </td></tr>
        <tr><td style="height:14px"></td></tr>
        <tr><td style="background:#fff;border:1px solid ${LINE};border-radius:14px;padding:14px 16px;font-family:Segoe UI,Arial,sans-serif;font-size:13.5px;color:${INK};line-height:1.7">
          <ol style="margin:0;padding-inline-start:20px">
            <li>Open the dashboard → <b>Themes</b> tab (<a href="${APP}" style="color:${PINK};text-decoration:none">${APP.replace('https://','')}</a>).</li>
            <li>For each party through the year, <b>fill in its theme</b> — it saves as you type.</li>
          </ol>
          <div style="margin:12px 0 0"><b>Please start today after the photoshoot, and finish tomorrow.</b> It's in your dashboard “My tasks”. Deadline: ${due}.</div>
          <div style="margin:10px 0 0;color:${MUT};font-size:12.5px">Why: it feeds the CEO “Top themes” report, so it needs to be complete. Thank you 🩷</div>
        </td></tr>
      </table>
    </td></tr></table>
  </body></html>`;
}

export async function moveThemesTaskFromEnv(): Promise<void> {
  if (String(process.env.MOVE_THEMES_TASK ?? '').toLowerCase() !== 'true') return;

  // 1) Remove the themes task from Marsha (log + staff + task rows).
  const old = await pool.query<{ id: number }>(
    `SELECT id FROM prep_tasks WHERE category = 'manual' AND title = $1`,
    [MARSHA_TITLE],
  );
  const oldIds = old.rows.map((r) => r.id);
  if (oldIds.length) {
    await pool.query(`DELETE FROM prep_task_log WHERE task_id = ANY($1)`, [oldIds]).catch(() => {});
    await pool.query(`DELETE FROM prep_task_staff WHERE task_id = ANY($1)`, [oldIds]);
    await pool.query(`DELETE FROM prep_tasks WHERE id = ANY($1)`, [oldIds]);
    console.log(`[themes-move] removed Marsha's themes task(s) ${oldIds.join(', ')}`);
  } else {
    console.log("[themes-move] no Marsha themes task found");
  }

  // 2) Work out tomorrow (Dubai) and who the second assignee is.
  const tmr = new Date(Date.now() + 4 * 3_600_000);
  tmr.setUTCDate(tmr.getUTCDate() + 1);
  const tomorrow = tmr.toISOString().slice(0, 10);
  const dow = tmr.getUTCDay(); // 0=Sun … 6=Sat

  const { rows: team } = await pool.query<{ id: string; name: string; email: string | null; weekly_day_off: number | null }>(
    `SELECT id, name, email, weekly_day_off FROM team_members WHERE lower(name) = ANY($1)`,
    ['jane', 'gloria', 'diana'],
  );
  const byName = (n: string) => team.find((t) => (t.name || '').toLowerCase() === n);
  const jane = byName('jane'), gloria = byName('gloria'), diana = byName('diana');
  if (!jane) { console.log('[themes-move] Jane not found — aborted'); return; }

  let gloriaOff = gloria ? gloria.weekly_day_off === dow : true;
  if (gloria && !gloriaOff) {
    const leave = await pool.query(
      `SELECT 1 FROM staff_days_off WHERE member_id = $1 AND status = 'approved' AND start_date <= $2 AND end_date >= $2 LIMIT 1`,
      [gloria.id, tomorrow],
    );
    if (leave.rows[0]) gloriaOff = true;
  }
  const second = gloriaOff ? diana : gloria;
  const assignees = [jane, second].filter(Boolean) as typeof team;
  const first = assignees.map((a) => (a.name || '').split(' ')[0]);
  const namesLabel = first.length > 1 ? first.slice(0, -1).join(', ') + ' & ' + first.slice(-1) : (first[0] || 'team');
  console.log(`[themes-move] tomorrow ${tomorrow} dow=${dow}; Gloria off tomorrow=${gloriaOff}; assignees=${assignees.map((a) => a.name).join(', ')}`);

  // 3) Create the new task for the assignees, deadline tomorrow, notify them.
  const dup = await pool.query(`SELECT 1 FROM prep_tasks WHERE category = 'manual' AND title = $1 LIMIT 1`, [NEW_TITLE]);
  if (dup.rows[0]) {
    console.log('[themes-move] new task already exists — skipped creation');
  } else {
    const r = await createManualTask({ title: NEW_TITLE, memberIds: assignees.map((a) => a.id), dueDate: tomorrow, note: NOTE, actor: 'Sheem', notify: true });
    console.log(`[themes-move] ${r ? `task ${r.id} created for ${assignees.map((a) => a.name).join(', ')}, deadline ${tomorrow}, notified` : 'task FAILED'}`);
  }

  // 4) Email the assignees (CC owner).
  if (emailEnabled()) {
    const emails = assignees.map((a) => (a.email ?? '').trim()).filter(Boolean);
    if (!emails.length) { console.log('[themes-move] no assignee emails — email skipped'); return; }
    const [to, ...rest] = emails;
    const res = await sendEmail({ to, cc: [...rest, OWNER], subject: '🎨 Task — fill in the party themes (today after the photoshoot + tomorrow)', html: html(namesLabel, tomorrow) });
    console.log(`[themes-move] email to <${to}> cc <${[...rest, OWNER].join(', ')}>: ${res.ok ? 'SENT' : 'FAILED ' + (res as any).error}`);
  }
}
