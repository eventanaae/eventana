/**
 * Monthly Reconciliation & Audit email.
 *
 * Once a month, the owner (sheem@eventanauae.com) and Marsha get a full
 * reconciliation snapshot: cash on hand + A/R, the real make-up of unpaid
 * orders, payment-method coverage, phone-number health, and possible duplicate
 * customers — the same diagnostics as the dashboard's Reconciliation tab, in one
 * email. A boot sweep sends the previous month once, deduped by recon_reports.
 */
import { formatAed } from '@eventana/shared';
import { pool } from '../db/pool.js';
import { config } from '../config.js';
import { emailEnabled, sendEmail } from '../integrations/email.js';
import { accountingSummary } from './finance.js';

const OWNER = 'sheem@eventanauae.com';
const MARSHA = 'marsha@eventanauae.com';
const BRAND = '#EF5D95';
const INK = '#4A3540';
const MUTED = '#9B8A94';
const GROUND = '#FBEAF2';
const PANEL = '#FCEEF6';
const HAIR = '#F4DDEC';
const RAINBOW = 'linear-gradient(90deg,#7FD8C4,#BFE29A,#F7D06B,#F7A98C,#F080A8,#B79BE0)';
const DISPLAY = "'Fredoka','Baloo 2','Segoe UI',Arial,sans-serif";

// The monthly REVENUE target the owner set (AED 30,000 by default) — revenue is
// what's left AFTER expenses, never gross sales. Kept in step with the monthly
// finance report's MONTHLY_REVENUE_TARGET_AED.
const MONTHLY_TARGET_FILS = Math.round(Number(process.env.MONTHLY_REVENUE_TARGET_AED || 30000) * 100);

const monthLabel = (m: string) => {
  const [y, mo] = m.split('-').map(Number);
  return new Date(y, mo - 1, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
};

/** A numbered ranked list (top items / emirates / expenses), as table rows. */
function rankedRows(items: Array<{ left: string; right: string }>): string {
  return items
    .map((r, i) => `<tr><td style="padding:8px 14px;color:${INK};font-size:13px;border-bottom:1px solid ${HAIR}">${i + 1}. ${r.left}</td>
      <td style="padding:8px 14px;text-align:right;font-weight:700;font-size:13px;color:${INK};border-bottom:1px solid ${HAIR}">${r.right}</td></tr>`)
    .join('');
}

/** The revenue-vs-target banner (loss / reached / below), same rule as the finance report. */
function targetBanner(revenue: number): string {
  const gap = MONTHLY_TARGET_FILS - revenue;
  const box = (bg: string, fg: string, text: string) =>
    `<div style="margin:12px 0 0;padding:12px 15px;border-radius:12px;font-weight:700;font-size:13px;line-height:1.5;background:${bg};color:${fg}">${text}</div>`;
  if (revenue < 0) {
    return box('#FDE7EA', '#B3261E',
      `⚠️ Loss this month — revenue was −AED ${formatAed(-revenue)} after expenses (AED ${formatAed(gap)} below the AED ${formatAed(MONTHLY_TARGET_FILS)} revenue target)`);
  }
  if (revenue >= MONTHLY_TARGET_FILS) {
    return box('#E4F6EE', '#1F7A5C',
      `🎯 Target reached — AED ${formatAed(revenue)} revenue vs the AED ${formatAed(MONTHLY_TARGET_FILS)} target`);
  }
  return box('#FFF3E0', '#B26A00',
    `🎯 Below target — AED ${formatAed(revenue)} revenue, AED ${formatAed(gap)} short of the AED ${formatAed(MONTHLY_TARGET_FILS)} target`);
}

function kv(label: string, value: string, color = INK): string {
  return `<tr><td style="padding:8px 14px;color:${MUTED};font-size:13px;border-bottom:1px solid ${HAIR}">${label}</td>
    <td style="padding:8px 14px;text-align:right;font-weight:700;font-size:13.5px;color:${color};border-bottom:1px solid ${HAIR}">${value}</td></tr>`;
}
function section(title: string, rowsHtml: string): string {
  return `<div style="margin-top:20px;font-family:${DISPLAY};font-weight:700;font-size:12px;letter-spacing:1.5px;text-transform:uppercase;color:${BRAND}">${title}</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${PANEL};border:1px solid ${HAIR};border-radius:14px;margin-top:8px">${rowsHtml}</table>`;
}

async function buildHtml(monthStr: string): Promise<string> {
  const { computeSummary } = await import('./financeReport.js');
  const [acct, month] = await Promise.all([
    accountingSummary(),
    computeSummary(monthStr),
  ]);

  const monthRevenue = month.revenueFils - month.expensesFils;
  // Exactly what the owner specified for the monthly report: orders, total,
  // expenses, revenue-after-expenses, tips, top 5 products, top 3 emirates,
  // top 3 expenses excluding salaries, and the AED 30k revenue-target banner.
  const monthRows = kv('Orders', String(month.ordersCount))
    + kv('Total amount (sales)', `AED ${formatAed(month.revenueFils)}`, '#1F7A5C')
    + kv('Expenses', `AED ${formatAed(month.expensesFils)}`, '#D24B6E')
    + kv('Revenue (after expenses)', `${monthRevenue < 0 ? '−' : ''}AED ${formatAed(Math.abs(monthRevenue))}`, monthRevenue < 0 ? '#D24B6E' : '#1F7A5C')
    + kv('Tips (to staff)', `AED ${formatAed(month.tipsFils)}`);
  const topItemsRows = rankedRows((month.topItems ?? []).map((t: any) => ({ left: t.name, right: `${t.count}×` })));
  const topEmiratesRows = rankedRows((month.topEmirates ?? []).map((e: any) => ({ left: e.emirate, right: `${e.count} order${e.count === 1 ? '' : 's'}` })));
  const topExpenseRows = rankedRows((month.byCategory ?? []).map((c: any) => ({ left: c.category, right: `AED ${formatAed(c.amountFils)}` })));

  const acctRows = kv('Cash on hand', `AED ${formatAed(acct.cashOnHandFils)}`, '#1F7A5C')
    + kv('Accounts Receivable (unpaid invoices)', `AED ${formatAed(acct.arFils)}`, '#D24B6E');

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <link href="https://fonts.googleapis.com/css2?family=Fredoka:wght@500;600;700&display=swap" rel="stylesheet"></head>
  <body style="margin:0;padding:0;background:${GROUND};font-family:'Segoe UI',Arial,sans-serif;color:${INK}">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${GROUND}">
      <tr><td align="center" style="padding:30px 16px 44px">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px">
          <tr><td style="text-align:center;padding:2px 0 22px">${config.emailLogoUrl
            ? `<img src="${config.emailLogoUrl}" alt="Eventana Events" width="210" style="display:inline-block;width:210px;max-width:70%;height:auto">`
            : `<span style="font-family:${DISPLAY};font-size:28px;font-weight:700;color:${BRAND}">Eventana</span>`}</td></tr>
          <tr><td style="background:#ffffff;border-radius:26px;overflow:hidden;border:1px solid #F6E4EF;box-shadow:0 10px 34px rgba(214,49,127,.10)">
            <div style="height:7px;background:${BRAND};background:${RAINBOW}"></div>
            <div style="padding:30px 26px 34px">
              <div style="text-align:center;font-size:11.5px;font-weight:700;letter-spacing:2.5px;text-transform:uppercase;color:${BRAND};margin-bottom:6px">Monthly Report</div>
              <h1 style="margin:0 0 4px;text-align:center;font-family:${DISPLAY};font-size:23px;font-weight:700;color:${INK}">${monthLabel(monthStr)}</h1>
              ${section(`This month (${monthLabel(monthStr)})`, monthRows)}
              ${targetBanner(monthRevenue)}
              ${topItemsRows ? section('Top 5 most requested', topItemsRows) : ''}
              ${topEmiratesRows ? section('Top 3 emirates', topEmiratesRows) : ''}
              ${topExpenseRows ? section('Top 3 expenses (excl. wages)', topExpenseRows) : ''}
              ${section('Cash position', acctRows)}
            </div>
          </td></tr>
          <tr><td style="text-align:center;color:#b8a6b0;font-size:11.5px;padding:24px 12px 0;line-height:1.8">Eventana Events · Abu Dhabi &amp; Dubai, UAE<br>Automated monthly report from your Eventana dashboard. 💛</td></tr>
        </table>
      </td></tr>
    </table>
  </body></html>`;
}

/**
 * Compute + email the monthly report for a month, once.
 * `record` (default true) writes the dedup row so the month is not re-sent; an
 * on-demand preview passes false so it never consumes the real end-of-month slot.
 */
export async function sendReconReport(monthStr: string, record = true): Promise<{ sent: number }> {
  if (!emailEnabled()) return { sent: 0 };
  const html = await buildHtml(monthStr);
  const recipients = Array.from(new Set([OWNER, MARSHA, ...config.email.financeReportTo]));
  let sent = 0;
  for (const to of recipients) {
    const res = await sendEmail({ to, subject: `Eventana — Monthly Report · ${monthLabel(monthStr)}`, html });
    if (res.ok) sent++;
  }
  if (record) {
    await pool.query(
      `INSERT INTO recon_reports (month, recipients) VALUES ($1,$2)
       ON CONFLICT (month) DO UPDATE SET sent_at = now(), recipients = EXCLUDED.recipients`,
      [monthStr, sent],
    );
  }
  return { sent };
}

/**
 * Sweep: email THIS month's report once, on the LAST calendar day of the month
 * (owner's rule — "only the last day of the month"). Deduped by month in
 * recon_reports, so even though the reconcile loop runs many times that day the
 * report is sent exactly once.
 */
export async function sweepReconReport(): Promise<void> {
  if (!emailEnabled()) return;
  try {
    const now = new Date();
    // Last day of the current month? (day-0 of next month = last day of this one.)
    const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    if (now.getDate() !== lastDay) return;
    const monthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const { rowCount } = await pool.query(
      `INSERT INTO recon_reports (month, recipients) VALUES ($1, 0) ON CONFLICT (month) DO NOTHING`,
      [monthStr],
    );
    if (rowCount) await sendReconReport(monthStr);
  } catch (err) {
    console.error('[recon-report] sweep failed:', (err as Error).message);
  }
}
