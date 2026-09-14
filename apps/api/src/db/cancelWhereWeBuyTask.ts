/**
 * One-shot: cancel the "Where We Buy" task that was assigned to Jane/Diana/Gloria
 * (Sheem + Marsha will do that list instead) and email the three to let them know
 * a different task is coming soon. Gated CANCEL_WWB_TASK=true. Idempotent.
 * Turn the flag off after it runs.
 */
import { pool } from './pool.js';
import { emailEnabled, sendEmail } from '../integrations/email.js';

const OWNER = 'sheem@eventanauae.com';
const NAMES = ['jane', 'diana', 'gloria'];
const TITLE = "Fill the 'Where We Buy' shopping list together (from your phone)";
const PINK = '#E94F9C', INK = '#3B3641', MUT = '#8B7E86', LINE = '#F0DCE7', SOFT = '#FDEFF6';

function html(names: string): string {
  return `<!doctype html><html><body style="margin:0;padding:0;background:#FBF3F7">
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#FBF3F7"><tr><td align="center" style="padding:24px 12px 40px">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px">
        <tr><td style="background:${SOFT};border:1px solid ${LINE};border-radius:20px;padding:20px 22px 16px">
          <div style="font-family:Segoe UI,Arial,sans-serif;font-weight:700;color:${PINK};font-size:12.5px;letter-spacing:1px">● EVENTANA · UPDATE</div>
          <div style="font-family:Segoe UI,Arial,sans-serif;font-weight:800;font-size:22px;color:${INK};margin:6px 0 6px">Small change of plan 💛</div>
          <div style="font-family:Segoe UI,Arial,sans-serif;color:${MUT};font-size:13.5px;line-height:1.6">Hi ${names} — you don't need to do the “Where We Buy” list. <b>Marsha and I will take care of that one.</b></div>
        </td></tr>
        <tr><td style="height:14px"></td></tr>
        <tr><td style="background:#fff;border:1px solid ${LINE};border-radius:14px;padding:14px 16px;font-family:Segoe UI,Arial,sans-serif;font-size:13.5px;color:${INK};line-height:1.7">
          I have <b>another task</b> for the three of you instead — I'll send you the details very soon. No action needed right now. Thank you my loves 🩷
        </td></tr>
      </table>
    </td></tr></table>
  </body></html>`;
}

export async function cancelWhereWeBuyTaskFromEnv(): Promise<void> {
  if (String(process.env.CANCEL_WWB_TASK ?? '').toLowerCase() !== 'true') return;

  const found = await pool.query<{ id: number }>(
    `SELECT id FROM prep_tasks WHERE category = 'manual' AND title = $1`,
    [TITLE],
  );
  const ids = found.rows.map((r) => r.id);
  if (ids.length) {
    await pool.query(`DELETE FROM prep_task_log WHERE task_id = ANY($1)`, [ids]).catch(() => {});
    await pool.query(`DELETE FROM prep_task_staff WHERE task_id = ANY($1)`, [ids]);
    await pool.query(`DELETE FROM prep_tasks WHERE id = ANY($1)`, [ids]);
    console.log(`[wwb-cancel] deleted task(s) ${ids.join(', ')}`);
  } else {
    console.log('[wwb-cancel] no matching task found — nothing to delete');
  }

  if (emailEnabled()) {
    const { rows } = await pool.query<{ name: string; email: string | null }>(
      `SELECT name, email FROM team_members WHERE lower(name) = ANY($1)`,
      [NAMES],
    );
    const first = rows.map((r) => (r.name || '').split(' ')[0]).filter(Boolean);
    const namesLabel = first.length > 1 ? first.slice(0, -1).join(', ') + ' & ' + first.slice(-1) : (first[0] || 'team');
    const emails = rows.map((r) => (r.email ?? '').trim()).filter(Boolean);
    if (!emails.length) { console.log('[wwb-cancel] no member emails — email skipped'); return; }
    const [to, ...rest] = emails;
    const res = await sendEmail({ to, cc: [...rest, OWNER], subject: '💛 Update — the “Where We Buy” list is covered', html: html(namesLabel) });
    console.log(`[wwb-cancel] email to <${to}> cc <${[...rest, OWNER].join(', ')}>: ${res.ok ? 'SENT' : 'FAILED ' + (res as any).error}`);
  }
}
