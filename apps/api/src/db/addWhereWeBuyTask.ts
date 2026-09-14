/**
 * One-shot: assign Jane, Diana & Gloria a manual task (from the owner) to sit
 * together TODAY and fill the "Where We Buy" list from their phones, notify them
 * (in-app + WhatsApp), AND email the three (CC owner). Gated ADD_WWB_TASK=true.
 * Member ids + emails are resolved by name from team_members. Idempotent by
 * title. Turn the flag off after it runs.
 */
import { pool } from './pool.js';
import { createManualTask } from '../domain/prep.js';
import { emailEnabled, sendEmail } from '../integrations/email.js';

const OWNER = 'sheem@eventanauae.com';
const LINK = 'https://claude.ai/code/artifact/1157f6ca-adf5-4460-815f-0a546e04c1c0';
const NAMES = ['jane', 'diana', 'gloria'];
const TITLE = "Fill the 'Where We Buy' shopping list together (from your phone)";
const NOTE =
  "Today, sit together and open the link on the phone — Marsha keeps it open, everyone names the items we regularly buy. For each item add: the item, the supplier (full company name), the supplier's PHONE, the emirate, and WHERE the shop is (area or a Google Maps link). When done, tap 'Copy list to send' and send it to Sheem. Link: " +
  LINK;

const PINK = '#E94F9C', INK = '#3B3641', MUT = '#8B7E86', LINE = '#F0DCE7', SOFT = '#FDEFF6';

function html(names: string): string {
  return `<!doctype html><html><body style="margin:0;padding:0;background:#FBF3F7">
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#FBF3F7"><tr><td align="center" style="padding:24px 12px 40px">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px">
        <tr><td style="background:${SOFT};border:1px solid ${LINE};border-radius:20px;padding:20px 22px 16px">
          <div style="font-family:Segoe UI,Arial,sans-serif;font-weight:700;color:${PINK};font-size:12.5px;letter-spacing:1px">● EVENTANA · TEAM TASK</div>
          <div style="font-family:Segoe UI,Arial,sans-serif;font-weight:800;font-size:23px;color:${INK};margin:6px 0 6px">Where We Buy — fill it together today 🛒</div>
          <div style="font-family:Segoe UI,Arial,sans-serif;color:${MUT};font-size:13.5px;line-height:1.6">Hi ${names} 💛 Please sit together <b>today</b> and fill our shopping list straight from your phone — no paper, no pen. It only takes a bit when you do it together.</div>
        </td></tr>
        <tr><td style="height:14px"></td></tr>
        <tr><td style="background:#fff;border:1px solid ${LINE};border-radius:14px;padding:16px 18px;font-family:Segoe UI,Arial,sans-serif;font-size:13.5px;color:${INK};line-height:1.7">
          <div style="margin:0 0 10px"><b>👉 Open the link (no login needed):</b><br><a href="${LINK}" style="color:${PINK};text-decoration:none;word-break:break-all">${LINK}</a></div>
          <b>How to fill it — for every item you usually order:</b>
          <ol style="margin:8px 0 0;padding-inline-start:20px">
            <li><b>Item</b> — type what we buy</li>
            <li><b>Supplier</b> — the full, correct shop/company name (not a nickname) 🏬</li>
            <li><b>Phone</b> — the supplier's number / WhatsApp ☎️</li>
            <li><b>Emirate</b> + <b>Where</b> — the area, mall/street, or a Google Maps link 📍</li>
            <li>Tap <b>Add</b> — and keep going</li>
          </ol>
          <div style="margin:12px 0 0;color:${MUT};font-size:12.5px">Why: once it's complete, the system auto-suggests the right supplier (and how to reach them) whenever someone reports a missing item. The more complete, the easier shopping gets for all of us.</div>
          <div style="margin:12px 0 0">When you're done, <b>Marsha taps “📋 Copy list to send”</b> and sends it to Sheem 💌</div>
          <div style="margin:12px 0 0"><b>Deadline: today.</b> It's also in your dashboard “My tasks”.</div>
        </td></tr>
        <tr><td style="height:12px"></td></tr>
        <tr><td style="background:#fff;border:1px solid ${LINE};border-inline-start:4px solid ${PINK};border-radius:14px;padding:13px 15px;font-family:Segoe UI,Arial,sans-serif;font-size:12.5px;color:${INK};line-height:1.6">
          🔹 Example — Item: Fabric · Supplier: Ali Hashi (full shop name) · Phone: 06 xxx xxxx · Emirate: Ajman · Where: Ajman China Mall. Thank you my loves 🩷
        </td></tr>
      </table>
    </td></tr></table>
  </body></html>`;
}

export async function addWhereWeBuyTaskFromEnv(): Promise<void> {
  if (String(process.env.ADD_WWB_TASK ?? '').toLowerCase() !== 'true') return;

  const { rows } = await pool.query<{ id: string; name: string; email: string | null }>(
    `SELECT id, name, email FROM team_members WHERE lower(name) = ANY($1)`,
    [NAMES],
  );
  if (!rows.length) { console.log('[wwb-task] no matching members found — aborted'); return; }
  const ids = rows.map((r) => r.id);
  const first = rows.map((r) => (r.name || '').split(' ')[0]).filter(Boolean);
  const namesLabel = first.length > 1 ? first.slice(0, -1).join(', ') + ' & ' + first.slice(-1) : (first[0] || 'team');
  console.log(`[wwb-task] resolved: ${rows.map((r) => `${r.name}=${r.id}`).join(', ')}`);

  const dup = await pool.query(
    `SELECT 1 FROM prep_tasks WHERE category = 'manual' AND title = $1 LIMIT 1`,
    [TITLE],
  );
  const today = new Date(Date.now() + 4 * 3_600_000).toISOString().slice(0, 10); // Dubai
  if (dup.rows[0]) {
    console.log('[wwb-task] task already exists — skipped task creation');
  } else {
    const r = await createManualTask({ title: TITLE, memberIds: ids, dueDate: today, note: NOTE, actor: 'Sheem', notify: true });
    console.log(`[wwb-task] ${r ? `task ${r.id} created for ${ids.length}, deadline ${today}, notified` : 'task FAILED'}`);
  }

  if (emailEnabled()) {
    const emails = rows.map((r) => (r.email ?? '').trim()).filter(Boolean);
    if (!emails.length) { console.log('[wwb-task] no member emails on file — email skipped'); return; }
    const [to, ...rest] = emails;
    const res = await sendEmail({ to, cc: [...rest, OWNER], subject: '🛒 Today — fill the “Where We Buy” list together', html: html(namesLabel) });
    console.log(`[wwb-task] email to <${to}> cc <${[...rest, OWNER].join(', ')}>: ${res.ok ? 'SENT' : 'FAILED ' + (res as any).error}`);
  }
}
