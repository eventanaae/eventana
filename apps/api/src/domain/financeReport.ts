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
  eventsDone: number;
  byCategory: Array<{ category: string; amountFils: number }>;
}

const monthLabel = (m: string) => {
  const [y, mo] = m.split('-').map(Number);
  return new Date(y, mo - 1, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
};

export async function computeSummary(monthStr: string): Promise<Summary> {
  const start = `${monthStr}-01`;
  const end = new Date(`${start}T00:00:00Z`);
  end.setUTCMonth(end.getUTCMonth() + 1);
  const endStr = end.toISOString().slice(0, 10);

  const [rev, exp, byCat, tips, events] = await Promise.all([
    pool.query(
      `SELECT COALESCE(SUM(total_fils),0) v FROM orders
        WHERE status='paid' AND kind IN ('booking','addon') AND created_at >= $1 AND created_at < $2`,
      [start, endStr],
    ),
    pool.query(`SELECT COALESCE(SUM(amount_fils),0) v FROM expenses WHERE source <> 'quickbooks' AND spent_on >= $1 AND spent_on < $2`, [start, endStr]),
    pool.query(
      `SELECT category, SUM(amount_fils) v FROM expenses WHERE source <> 'quickbooks' AND spent_on >= $1 AND spent_on < $2 GROUP BY category ORDER BY v DESC`,
      [start, endStr],
    ),
    pool.query(
      `SELECT COALESCE(SUM(amount_fils),0) v FROM tips t JOIN events e ON e.id=t.event_id
        WHERE t.status='paid' AND e.event_date >= $1 AND e.event_date < $2`,
      [start, endStr],
    ),
    pool.query(
      `SELECT COUNT(*) v FROM events WHERE phase='Event Completed' AND event_date >= $1 AND event_date < $2`,
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
    eventsDone: Number(events.rows[0].v),
    byCategory: byCat.rows.map((r) => ({ category: r.category, amountFils: Number(r.v) })),
  };
}

function buildHtml(s: Summary): string {
  const neg = s.profitFils < 0;
  const row = (label: string, value: string, color?: string) =>
    `<tr><td style="padding:8px 0;color:#6b6069;font-weight:600">${label}</td>
     <td style="padding:8px 0;text-align:right;font-weight:800;color:${color ?? '#3B3641'}">${value}</td></tr>`;
  const cats = s.byCategory
    .map(
      (c) =>
        `<tr><td style="padding:4px 0;color:#8b7d84;text-transform:capitalize">${c.category}</td>
         <td style="padding:4px 0;text-align:right;font-weight:700">AED ${formatAed(c.amountFils)}</td></tr>`,
    )
    .join('');
  return `<div style="max-width:560px;margin:0 auto;font-family:Segoe UI,Arial,sans-serif;background:#faf6f2;padding:24px">
    <div style="text-align:center;padding:8px 0 16px"><span style="font-size:22px;font-weight:800;color:#E94F9C">Eventana</span></div>
    <div style="background:#fff;border-radius:18px;padding:26px 24px;color:#3B3641">
      <h2 style="margin:0 0 4px">Monthly finance report</h2>
      <div style="color:#b3a8a0;font-weight:700;margin-bottom:18px">${monthLabel(s.month)}</div>
      <table style="width:100%;border-collapse:collapse;font-size:15px">
        ${row('Revenue', `AED ${formatAed(s.revenueFils)}`, '#2e9e7e')}
        ${row('Expenses', `AED ${formatAed(s.expensesFils)}`, '#F06C6C')}
        <tr><td colspan="2" style="border-top:1px solid #eee"></td></tr>
        ${row(`Net profit · ${s.marginPct}% margin`, `${neg ? '−' : ''}AED ${formatAed(Math.abs(s.profitFils))}`, neg ? '#F06C6C' : '#2e9e7e')}
        ${row('Events completed', String(s.eventsDone))}
        ${row('Tips collected (to staff)', `AED ${formatAed(s.tipsFils)}`)}
      </table>
      ${cats ? `<div style="margin-top:18px;font-weight:700;font-size:13px;color:#6b6069">Expenses by category</div><table style="width:100%;border-collapse:collapse;font-size:13px;margin-top:6px">${cats}</table>` : ''}
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
