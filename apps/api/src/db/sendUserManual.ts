/**
 * One-shot: email each team member a User Manual for the Eventana dashboard,
 * tailored to their role (owner / manager / employee / driver). Gated by
 * SEND_USER_MANUAL=true. Recipients + roles resolved from team_members; Sheem
 * falls back to the business inbox. English — the dashboard UI is English and
 * the crew reads English (same as the weekly schedule email). Self-contained
 * HTML (no external link needed). Turn the flag off after it sends.
 */
import { pool } from './pool.js';
import { emailEnabled, sendEmail } from '../integrations/email.js';

const PINK = '#E94F9C', DEEP = '#C93A83', INK = '#3B3641', MUT = '#8B7E86', LINE = '#F0DCE7', SOFT = '#FDEFF6';
const APP = 'https://ops.eventanauae.com';

type Role = 'owner' | 'manager' | 'employee' | 'driver';

// Name → role. Employees: Jane, Diana, Gloria, Dindo. Driver: Shan.
const TEAM: Array<{ name: string; role: Role }> = [
  { name: 'Sheem', role: 'owner' },
  { name: 'Marsha', role: 'manager' },
  { name: 'Shan', role: 'driver' },
  { name: 'Jane', role: 'employee' },
  { name: 'Diana', role: 'employee' },
  { name: 'Gloria', role: 'employee' },
  { name: 'Dindo', role: 'employee' },
];
const FALLBACK: Record<string, string> = { sheem: 'sheem@eventanauae.com' };

/** One feature card: an icon tab name + what it's for + how to use it. */
function card(icon: string, title: string, what: string, steps: string[]): string {
  const li = steps.map((s) => `<li style="margin:5px 0">${s}</li>`).join('');
  return `<table width="100%" cellpadding="0" cellspacing="0" style="background:#fff;border:1px solid ${LINE};border-radius:14px;margin:0 0 12px">
    <tr><td style="padding:14px 16px">
      <div style="font-family:Segoe UI,Arial,sans-serif;font-weight:800;font-size:15.5px;color:${INK}">${icon} &nbsp;${title}</div>
      <div style="font-family:Segoe UI,Arial,sans-serif;font-size:13px;color:${MUT};margin:5px 0 8px;line-height:1.6">${what}</div>
      <ul style="font-family:Segoe UI,Arial,sans-serif;font-size:13px;color:${INK};line-height:1.6;margin:0;padding-inline-start:20px">${li}</ul>
    </td></tr></table>`;
}

function shell(first: string, intro: string, cardsHtml: string): string {
  return `<!doctype html><html><body style="margin:0;padding:0;background:#FBF3F7">
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#FBF3F7"><tr><td align="center" style="padding:24px 12px 40px">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px">
        <tr><td style="background:${SOFT};border:1px solid ${LINE};border-radius:20px;padding:22px 22px 18px">
          <div style="font-family:Segoe UI,Arial,sans-serif;font-weight:700;color:${PINK};font-size:12.5px;letter-spacing:1px">● EVENTANA · USER MANUAL</div>
          <div style="font-family:Segoe UI,Arial,sans-serif;font-weight:800;font-size:25px;color:${INK};margin:6px 0 6px">How to use your dashboard 📱</div>
          <div style="font-family:Segoe UI,Arial,sans-serif;color:${MUT};font-size:13.5px;line-height:1.6">Hi ${first} 👋 ${intro}</div>
        </td></tr>
        <tr><td style="height:14px"></td></tr>
        <tr><td style="background:#fff;border:1px solid ${LINE};border-radius:14px;padding:14px 16px;margin-bottom:12px">
          <div style="font-family:Segoe UI,Arial,sans-serif;font-weight:800;font-size:15px;color:${INK}">🔑 &nbsp;Getting in</div>
          <ul style="font-family:Segoe UI,Arial,sans-serif;font-size:13px;color:${INK};line-height:1.6;margin:8px 0 0;padding-inline-start:20px">
            <li style="margin:5px 0">Open <b><a href="${APP}" style="color:${DEEP};text-decoration:none">${APP.replace('https://','')}</a></b> on your phone or laptop, and log in with your email &amp; password.</li>
            <li style="margin:5px 0">On a phone, your main tools are the <b>bottom tabs</b>; tap <b>“More”</b> for everything else.</li>
            <li style="margin:5px 0">The app updates itself. If something looks off, just refresh the page.</li>
          </ul>
        </td></tr>
        <tr><td style="height:6px"></td></tr>
        <tr><td>${cardsHtml}</td></tr>
        <tr><td style="background:#fff;border:1px solid ${LINE};border-left:4px solid ${PINK};border-radius:14px;padding:13px 15px;font-family:Segoe UI,Arial,sans-serif;font-size:12.5px;color:${INK};line-height:1.6">
          <b style="font-size:13.5px">💬 Need help?</b><br>If anything doesn’t work or you’re not sure how to do something, message Marsha or Sheem — we’re happy to walk you through it.
        </td></tr>
      </table>
    </td></tr></table>
  </body></html>`;
}

function employeeBody(): string {
  return [
    card('◉', 'Home — start here every day', 'Your day at a glance: the tasks waiting for you today, and any alerts.', [
      'Open <b>Home</b> first thing — it shows what needs doing today.',
      'Tap any task to see the details and where to go.',
    ]),
    card('▦', 'Events — your jobs & prep tasks', 'Every upcoming event and the preparation tasks assigned to you.', [
      'Open an event to see <b>your prep tasks</b> for it (clean, dress, set up, design…).',
      'When you finish a task, <b>mark it done</b> — add the photo if it asks for one.',
      'A checklist inside a task? Tick each item as you complete it.',
    ]),
    card('▣', 'Inventory — stock & missing items', 'Check what we have, and report anything missing or broken so it gets bought.', [
      'Report a <b>missing or broken item</b> here — it goes straight to the shopping list.',
      'Help with the stock count when asked (the “everyone in” day).',
    ]),
    card('👤', 'Profile — your points & achievements', 'Your achievements, reward points, tips and feedback, plus your details.', [
      'See your <b>points and rewards</b> (per event, feedback, Glam Doll…).',
      'Read the <b>customer feedback</b> from parties you worked on.',
    ]),
  ].join('');
}

function driverBody(): string {
  return [
    card('▦', 'Events — your delivery jobs', 'Every delivery you need to do: new, changed and cancelled orders with addresses.', [
      'Open a job to see the <b>address, directions, time and what to load</b>.',
      'You also get a <b>WhatsApp message</b> for every new / changed / cancelled order.',
      'On the shopping day, your <b>shopping list</b> of items to buy is here too.',
    ]),
    card('🚐', 'My Schedule — your week', 'Your weekly pickup and delivery schedule at a glance.', [
      'Check your <b>pickups, drop-offs and office times</b> for the week.',
      'Timings can change with events — any change is shared with you in advance.',
    ]),
  ].join('');
}

function managerBody(): string {
  return [
    card('◉ ▦', 'Home & Events', 'Run the day: today’s tasks and every event, job, booking and prep task.', [
      'Add a <b>note for the team</b> on an event, log a <b>customer extra</b>, and check prep is assigned.',
      'The bell/Updates shows anything that needs someone assigned.',
    ]),
    card('💬 ➕', 'Leads & New Order', 'Turn WhatsApp enquiries into bookings.', [
      '<b>Leads</b>: every enquiry and its party date — follow up from here.',
      '<b>New Order</b>: build a WhatsApp order and send the customer a payment link.',
    ]),
    card('🌴', 'Leave & day-off approvals', 'Approve the team’s leave and weekly day-off requests.', [
      'Review and <b>approve or decline</b> requests — approved leave blocks that day automatically.',
    ]),
    card('💸 🎁 🚚', 'Sales, Products & Suppliers', 'Receipts & invoices, the product catalogue, and who we buy from.', [
      'Issue and email <b>receipts / invoices</b>; process refunds (pick the item, choose the reason).',
      'Manage <b>products, prices &amp; descriptions</b> and the <b>supplier</b> list.',
    ]),
    card('🏷️ 🎨 🌟', 'Discounts, Themes & Reviews', 'Promo codes, each party’s theme, and every rating.', [
      'Create <b>discount codes</b> customers use at checkout.',
      'Fill in each party’s <b>theme</b>; read the <b>Google reviews + ratings</b> report.',
    ]),
  ].join('');
}

function ownerBody(): string {
  return [
    card('◆', 'CEO Dashboard', 'Your money and growth in one place — for the owner only.', [
      'Cash in the account now, income &amp; expenses for the period, and net.',
      'Top emirates, top themes, top expenses by supplier, and the year-by-year P&L.',
      'Switch the period (This month / This year / Last year / All time).',
    ]),
    card('💸', 'Sales & Get Paid', 'Receipts, invoices, expenses and accounts.', [
      'The full book with the collected total; issue receipts/invoices; process refunds.',
    ]),
    card('◉ ▦ 👥', 'Home, Events & Customers', 'Everything the manager sees, plus the money views.', [
      'Run the day, manage every event, and see the full customer book (spend, history, contacts).',
    ]),
    card('☺ ★', 'Team & Achievements', 'Staff, roles, days off, and the incentives.', [
      'Manage the team and see everyone’s points and rewards.',
    ]),
    card('⚙', 'Settings', 'Pricing, delivery zones and integrations.', [
      'Adjust pricing/zones and connect integrations. Change carefully — it affects live bookings.',
    ]),
  ].join('');
}

const INTRO: Record<Role, string> = {
  owner: 'here’s your full guide to the Eventana dashboard — every tool, and the CEO view that’s yours alone.',
  manager: 'here’s your guide to the dashboard — the tools you use to run the office day to day.',
  employee: 'here’s a quick guide to your dashboard — the four screens you’ll use every day.',
  driver: 'here’s a quick guide to your dashboard — your jobs and your weekly schedule.',
};

function bodyFor(role: Role): string {
  return role === 'owner' ? ownerBody() : role === 'manager' ? managerBody() : role === 'driver' ? driverBody() : employeeBody();
}

export function userManualHtml(first: string, role: Role): string {
  return shell(first, INTRO[role], bodyFor(role));
}

export async function sendUserManualFromEnv(): Promise<void> {
  if (String(process.env.SEND_USER_MANUAL ?? '').toLowerCase() !== 'true') return;
  if (!emailEnabled()) { console.log('[user-manual] email disabled'); return; }
  const { rows } = await pool.query<{ name: string; email: string | null }>(
    `SELECT name, email FROM team_members WHERE lower(name) = ANY($1)`,
    [TEAM.map((t) => t.name.toLowerCase())],
  );
  const found = new Map(rows.map((r) => [r.name.toLowerCase(), (r.email ?? '').trim()]));
  for (const { name, role } of TEAM) {
    const email = found.get(name.toLowerCase()) || FALLBACK[name.toLowerCase()] || '';
    if (!email) { console.log(`[user-manual] ${name}: NO EMAIL on file — skipped`); continue; }
    const html = userManualHtml(name, role);
    const res = await sendEmail({ to: email, subject: '📱 Your Eventana dashboard — how to use it', html });
    console.log(`[user-manual] ${name} (${role}) <${email}>: ${res.ok ? 'SENT' : 'FAILED ' + (res as any).error}`);
  }
  console.log('[user-manual] DONE');
}
