/**
 * One-shot: assign Marsha a manual task (from the owner) to confirm a few
 * expense classifications the owner and our records couldn't resolve, deadline
 * TOMORROW, notify her (in-app + WhatsApp), AND email her (CC owner).
 * Gated ADD_MARSHA_TRANSFERS=true. Idempotent by title. Turn the flag off after.
 */
import { pool } from './pool.js';
import { createManualTask } from '../domain/prep.js';
import { emailEnabled, sendEmail } from '../integrations/email.js';

const MARSHA = 'tm-marsha';
const OWNER = 'sheem@eventanauae.com';
const TITLE = 'Confirm a few expense classifications (Finance cleanup)';
const NOTE = 'Sheem & Claude are cleaning up the expenses. A few transfer recipients could not be identified from our records — please tell us who each one is so the cost goes to the right category. Details in the email.';
const PINK = '#E94F9C', INK = '#3B3641', MUT = '#8B7E86', LINE = '#F0DCE7', SOFT = '#FDEFF6';

// The genuinely-ambiguous ones (owner answered the rest; our driver/part-timer
// registries had no match for these).
const Q: { who: string; amt: string; ask: string }[] = [
  { who: 'Muhammad Zeeshan Badd', amt: 'AED 1,200 · Aug 2025', ask: 'Is he a <b>driver</b> or a <b>part-timer</b> (performer/helper)?' },
  { who: 'Mohammad Asruddin Alam', amt: 'AED 400 · Jan 2026', ask: 'Driver or part-timer?' },
  { who: 'Ahmad Faraz Ghulam', amt: 'AED 55', ask: 'Driver, part-timer, or a small shop purchase?' },
  { who: 'Abdul Muneeb', amt: 'AED 501 · marked "Repairing"', ask: 'What was repaired? (so we file it under Maintenance & Repairs)' },
  { who: 'Al Samiah Furniture', amt: 'AED 1,400', ask: 'Did we <b>buy</b> furniture, or <b>rent</b> tables/chairs from them?' },
  { who: '"Sheem" / "Sheem Ibrahim"', amt: 'AED 520 · a few transfers (vendors: Bidus Events, Restaurant)', ask: 'Is this Shaima (owner, money routed through her) or a different person?' },
];

function html(due: string): string {
  const rows = Q.map((q) => `
    <tr><td style="padding:10px 0;border-bottom:1px solid ${LINE}">
      <div style="font-family:Segoe UI,Arial,sans-serif;font-weight:700;font-size:14.5px;color:${INK}">${q.who}
        <span style="font-weight:500;color:${MUT};font-size:12.5px">— ${q.amt}</span></div>
      <div style="font-family:Segoe UI,Arial,sans-serif;color:${MUT};font-size:13px;line-height:1.6;margin-top:3px">${q.ask}</div>
    </td></tr>`).join('');
  return `<!doctype html><html><body style="margin:0;padding:0;background:#FBF3F7">
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#FBF3F7"><tr><td align="center" style="padding:24px 12px 40px">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:580px">
        <tr><td style="background:${SOFT};border:1px solid ${LINE};border-radius:20px;padding:20px 22px 16px">
          <div style="font-family:Segoe UI,Arial,sans-serif;font-weight:700;color:${PINK};font-size:12.5px;letter-spacing:1px">● EVENTANA · TASK</div>
          <div style="font-family:Segoe UI,Arial,sans-serif;font-weight:800;font-size:22px;color:${INK};margin:6px 0 6px">Who did we pay? 💸</div>
          <div style="font-family:Segoe UI,Arial,sans-serif;color:${MUT};font-size:13.5px;line-height:1.6">Hi Marsha 👋 Sheem & I are tidying up the expenses so every cost lands in the right category. These 6 transfer recipients aren't in our driver/part-timer records — could you tell us who each one is?</div>
        </td></tr>
        <tr><td style="height:14px"></td></tr>
        <tr><td style="background:#fff;border:1px solid ${LINE};border-radius:14px;padding:6px 16px 12px;font-family:Segoe UI,Arial,sans-serif">
          <table width="100%" cellpadding="0" cellspacing="0">${rows}</table>
          <div style="margin:14px 0 0;color:${MUT};font-size:12.5px">Just reply to this email with the answers — no need to open anything. <b>Deadline: ${due} (tomorrow).</b> It's also in your dashboard “My tasks”.</div>
        </td></tr>
      </table>
    </td></tr></table>
  </body></html>`;
}

export async function addMarshaTransfersTaskFromEnv(): Promise<void> {
  if (String(process.env.ADD_MARSHA_TRANSFERS ?? '').toLowerCase() !== 'true') return;
  const dup = await pool.query(
    `SELECT 1 FROM prep_tasks pt JOIN prep_task_staff pts ON pts.task_id = pt.id
      WHERE pts.member_id = $1 AND pt.category = 'manual' AND pt.title = $2 LIMIT 1`,
    [MARSHA, TITLE],
  );
  const d = new Date(Date.now() + 4 * 3_600_000);
  d.setUTCDate(d.getUTCDate() + 1);
  const tomorrow = d.toISOString().slice(0, 10);
  if (dup.rows[0]) {
    console.log('[marsha-transfers] task already assigned — skipped');
  } else {
    const r = await createManualTask({ title: TITLE, memberIds: [MARSHA], dueDate: tomorrow, note: NOTE, actor: 'Sheem', notify: true });
    console.log(`[marsha-transfers] ${r ? `task ${r.id} created, deadline ${tomorrow}, notified` : 'task FAILED'}`);
  }
  if (emailEnabled()) {
    const { rows } = await pool.query<{ email: string | null }>(`SELECT email FROM team_members WHERE lower(name) = 'marsha'`);
    const to = (rows[0]?.email ?? '').trim() || 'marsha@eventanauae.com';
    const res = await sendEmail({ to, cc: OWNER, subject: '💸 Quick help — who did we pay? (6 transfers, due tomorrow)', html: html(tomorrow) });
    console.log(`[marsha-transfers] email Marsha <${to}> cc <${OWNER}>: ${res.ok ? 'SENT' : 'FAILED ' + (res as any).error}`);
  } else {
    console.log('[marsha-transfers] email disabled — task only');
  }
}
