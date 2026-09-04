/**
 * Monthly finance report, emailed to managers.
 *
 * Computes a month's revenue / expenses / profit and mails a branded summary
 * to the owner+manager team members with an email on file, plus any addresses
 * in FINANCE_REPORT_TO. A boot sweep sends the previous month's report once,
 * deduped by the finance_reports table. All non-fatal.
 */
import { formatAed } from '@eventana/shared';
import { pool } from '../db/pool.js';
import { config } from '../config.js';
import { emailEnabled, sendEmail } from '../integrations/email.js';

interface Summary {
  month: string;
  revenueFils: number;
  expensesFils: number;
  profitFils: number;
  marginPct: number;
  tipsFils: number;
  ordersCount: number;
  byCategory: Array<{ category: string; amountFils: number }>;
  topItems: Array<{ name: string; count: number }>;
  topEmirates: Array<{ emirate: string; count: number }>;
}

// The monthly revenue target the owner set (AED 30,000 by default; override with
// MONTHLY_REVENUE_TARGET_AED). The report says whether the month hit it.
const MONTHLY_TARGET_FILS = Math.round(Number(process.env.MONTHLY_REVENUE_TARGET_AED || 30000) * 100);

const monthLabel = (m: string) => {
  const [y, mo] = m.split('-').map(Number);
  return new Date(y, mo - 1, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
};

export async function computeSummary(monthStr: string): Promise<Summary> {
  const start = `${monthStr}-01`;
  const end = new Date(`${start}T00:00:00Z`);
  end.setUTCMonth(end.getUTCMonth() + 1);
  const endStr = end.toISOString().slice(0, 10);

  const [rev, exp, byCat, tips, orders, items, emirates] = await Promise.all([
    // Revenue = every sale recorded that month (QuickBooks history + new sales),
    // so a past month reports its true income, not just newly-created orders.
    pool.query(
      `SELECT COALESCE(SUM(total_fils),0) v FROM finance_receipts WHERE date >= $1 AND date < $2`,
      [start, endStr],
    ),
    // Expenses = every expense spent that month (QuickBooks history INCLUDED —
    // this is a monthly P&L, not the live cash balance, so nothing is excluded).
    pool.query(`SELECT COALESCE(SUM(amount_fils),0) v FROM expenses WHERE spent_on >= $1 AND spent_on < $2`, [start, endStr]),
    // Top 3 expenses ALWAYS excluding wages/salaries (owner: payroll is a fixed
    // cost she doesn't want dominating this list) — covers "Wage expenses",
    // "Part Timers", any salary line.
    pool.query(
      `SELECT category, SUM(amount_fils) v FROM expenses
        WHERE spent_on >= $1 AND spent_on < $2
          AND category NOT ILIKE '%wage%' AND category NOT ILIKE '%salar%'
          AND category NOT ILIKE '%part tim%' AND category NOT ILIKE '%payroll%'
        GROUP BY category ORDER BY v DESC LIMIT 3`,
      [start, endStr],
    ),
    pool.query(
      `SELECT COALESCE(SUM(amount_fils),0) v FROM tips t JOIN events e ON e.id=t.event_id
        WHERE t.status='paid' AND e.event_date >= $1 AND e.event_date < $2`,
      [start, endStr],
    ),
    // Orders = every sale/receipt dated in the month, whether it was an event or
    // a shop / printed-goods order (the owner wants the total order count, not a
    // split). Same source as revenue, so the two always agree.
    pool.query(
      `SELECT COUNT(*) v FROM finance_receipts WHERE date >= $1 AND date < $2`,
      [start, endStr],
    ),
    // Top 5 most-requested items that month, by how many receipts contain them.
    pool.query(
      `SELECT btrim(li->>'name') AS name, COUNT(*) n
         FROM finance_receipts r, LATERAL jsonb_array_elements(r.line_items) li
        WHERE r.date >= $1 AND r.date < $2 AND COALESCE(btrim(li->>'name'),'') <> ''
        GROUP BY 1 ORDER BY n DESC, name LIMIT 5`,
      [start, endStr],
    ),
    // Top 3 emirates that month. QuickBooks receipts carry the customer's emirate
    // (historical_customers); app bookings carry the event's emirate.
    pool.query(
      `SELECT emirate, COUNT(*) n FROM (
         SELECT COALESCE(NULLIF(btrim(hc.emirate),''), NULLIF(btrim(ev.emirate),'')) AS emirate
           FROM finance_receipts r
           LEFT JOIN historical_customers hc ON hc.id = r.customer_id
           LEFT JOIN events ev ON ev.id = r.event_id
          WHERE r.date >= $1 AND r.date < $2
       ) s WHERE emirate IS NOT NULL
        GROUP BY emirate ORDER BY n DESC LIMIT 3`,
      [start, endStr],
    ),
  ]);

  const revenue = Number(rev.rows[0].v);
  const expenses = Number(exp.rows[0].v);
  const profit = revenue - expenses;
  return {
    month: monthStr,
    revenueFils: revenue,
    expensesFils: expenses,
    profitFils: profit,
    marginPct: revenue > 0 ? Math.round((profit / revenue) * 1000) / 10 : 0,
    tipsFils: Number(tips.rows[0].v),
    ordersCount: Number(orders.rows[0].v),
    byCategory: byCat.rows.map((r) => ({ category: r.category, amountFils: Number(r.v) })),
    topItems: items.rows.map((r) => ({ name: r.name, count: Number(r.n) })),
    topEmirates: emirates.rows.map((r) => ({ emirate: r.emirate, count: Number(r.n) })),
  };
}

function buildHtml(s: Summary): string {
  const row = (label: string, value: string, color?: string) =>
    `<tr><td style="padding:8px 0;color:#6b6069;font-weight:600">${label}</td>
     <td style="padding:8px 0;text-align:right;font-weight:800;color:${color ?? '#3B3641'}">${value}</td></tr>`;
  // A ranked mini-list (top items / emirates / expenses): "name" left, value right.
  const rankList = (title: string, rows: Array<{ left: string; right: string }>) =>
    rows.length
      ? `<div style="margin-top:18px;font-weight:700;font-size:13px;color:#6b6069">${title}</div>
         <table style="width:100%;border-collapse:collapse;font-size:13px;margin-top:6px">${rows
           .map(
             (r, i) =>
               `<tr><td style="padding:4px 0;color:#8b7d84">${i + 1}. ${r.left}</td>
                <td style="padding:4px 0;text-align:right;font-weight:700">${r.right}</td></tr>`,
           )
           .join('')}</table>`
      : '';
  // The target is on REVENUE — what's left after expenses (total amount minus
  // expenses) — NOT on gross sales. One banner covers all three cases the owner
  // wants called out: target reached, below target, or an outright loss.
  const revenue = s.revenueFils - s.expensesFils;
  const gap = MONTHLY_TARGET_FILS - revenue;
  const banner = (bg: string, fg: string, text: string) =>
    `<div style="margin:14px 0 0;padding:12px 14px;border-radius:12px;font-weight:800;font-size:13.5px;background:${bg};color:${fg}">${text}</div>`;
  const targetBanner =
    revenue < 0
      ? banner('#fdecea', '#b3261e',
          `⚠️ Loss this month — revenue was −AED ${formatAed(-revenue)} after expenses (AED ${formatAed(gap)} below the AED ${formatAed(MONTHLY_TARGET_FILS)} revenue target)`)
      : revenue >= MONTHLY_TARGET_FILS
        ? banner('#e9f7f1', '#1f7a5c',
            `🎯 Target reached — AED ${formatAed(revenue)} revenue vs the AED ${formatAed(MONTHLY_TARGET_FILS)} target`)
        : banner('#fff4e5', '#b26a00',
            `🎯 Below target — AED ${formatAed(revenue)} revenue, AED ${formatAed(gap)} short of the AED ${formatAed(MONTHLY_TARGET_FILS)} target`);
  const lossBanner = '';
  return `<div style="max-width:560px;margin:0 auto;font-family:Segoe UI,Arial,sans-serif;background:#faf6f2;padding:24px">
    <div style="text-align:center;padding:8px 0 16px"><span style="font-size:22px;font-weight:800;color:#E94F9C">Eventana</span></div>
    <div style="background:#fff;border-radius:18px;padding:26px 24px;color:#3B3641">
      <h2 style="margin:0 0 4px">Monthly report</h2>
      <div style="color:#b3a8a0;font-weight:700;margin-bottom:18px">${monthLabel(s.month)}</div>
      <table style="width:100%;border-collapse:collapse;font-size:15px">
        ${row('Orders', String(s.ordersCount))}
        ${row('Total amount', `AED ${formatAed(s.revenueFils)}`, '#2e9e7e')}
        ${row('Expenses', `AED ${formatAed(s.expensesFils)}`, '#F06C6C')}
        ${row('Tips collected (to staff)', `AED ${formatAed(s.tipsFils)}`)}
      </table>
      ${targetBanner}
      ${lossBanner}
      ${rankList('Top 5 most requested', s.topItems.map((t) => ({ left: t.name, right: `${t.count}×` })))}
      ${rankList('Top 3 emirates', s.topEmirates.map((e) => ({ left: e.emirate, right: `${e.count} order${e.count === 1 ? '' : 's'}` })))}
      ${rankList('Top 3 expenses', s.byCategory.map((c) => ({ left: c.category, right: `AED ${formatAed(c.amountFils)}` })))}
      <p style="color:#b3a8a0;font-size:12px;margin-top:22px">Automated report from your Eventana dashboard.</p>
    </div>
  </div>`;
}

async function recipients(): Promise<string[]> {
  const { rows } = await pool.query<{ email: string }>(
    `SELECT DISTINCT email FROM team_members
      WHERE active AND access_level IN ('owner','manager') AND email IS NOT NULL AND email <> ''`,
  );
  return [...new Set([...config.email.financeReportTo, ...rows.map((r) => r.email)])];
}

/** Compute + email the report for a month. Records the send for dedupe. */
export async function sendReport(monthStr: string): Promise<{ recipients: number; sent: number }> {
  const to = await recipients();
  if (!emailEnabled() || to.length === 0) return { recipients: to.length, sent: 0 };
  const summary = await computeSummary(monthStr);
  const html = buildHtml(summary);
  let sent = 0;
  for (const addr of to) {
    const res = await sendEmail({ to: addr, subject: `Eventana — Finance report · ${monthLabel(monthStr)}`, html });
    if (res.ok) sent++;
  }
  await pool.query(
    `INSERT INTO finance_reports (month, recipients) VALUES ($1,$2)
     ON CONFLICT (month) DO UPDATE SET sent_at = now(), recipients = EXCLUDED.recipients`,
    [monthStr, sent],
  );
  return { recipients: to.length, sent };
}

/** Sweep: once the month turns over, mail the previous month's report once. */
export async function sweepMonthlyReport(): Promise<void> {
  if (!emailEnabled()) return;
  try {
    const now = new Date();
    const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const monthStr = `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}`;
    // Claim the month atomically; only the winner sends.
    const { rowCount } = await pool.query(
      `INSERT INTO finance_reports (month, recipients) VALUES ($1, 0) ON CONFLICT (month) DO NOTHING`,
      [monthStr],
    );
    if (rowCount) await sendReport(monthStr);
  } catch (err) {
    console.error('[finance-report] sweep failed:', (err as Error).message);
  }
}
