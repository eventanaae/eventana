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
import { auditReport } from './audit.js';
import { accountingSummary } from './finance.js';

const OWNER = 'sheem@eventanauae.com';
const MARSHA = 'marsha@eventanauae.com';
const BRAND = '#EF5D95';
const INK = '#4A3540';
const MUTED = '#9B8A94';
const GROUND = '#FBEAF2';
const PANEL = '#FCEEF6';
const HAIR = '#F4DDEC';
const DISPLAY = "'Fredoka','Baloo 2','Segoe UI',Arial,sans-serif";

const monthLabel = (m: string) => {
  const [y, mo] = m.split('-').map(Number);
  return new Date(y, mo - 1, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
};

function kv(label: string, value: string, color = INK): string {
  return `<tr><td style="padding:8px 14px;color:${MUTED};font-size:13px;border-bottom:1px solid ${HAIR}">${label}</td>
    <td style="padding:8px 14px;text-align:right;font-weight:700;font-size:13.5px;color:${color};border-bottom:1px solid ${HAIR}">${value}</td></tr>`;
}
function section(title: string, rowsHtml: string): string {
  return `<div style="margin-top:20px;font-family:${DISPLAY};font-weight:700;font-size:12px;letter-spacing:1.5px;text-transform:uppercase;color:${BRAND}">${title}</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${PANEL};border:1px solid ${HAIR};border-radius:14px;margin-top:8px">${rowsHtml}</table>`;
}

async function buildHtml(monthStr: string): Promise<string> {
  const [acct, outstanding, methods, phones, dups] = await Promise.all([
    accountingSummary(),
    auditReport('outstanding'),
    auditReport('payment_methods'),
    auditReport('phones'),
    auditReport('dup_customers'),
  ]);

  const acctRows = kv('Cash on hand', `AED ${formatAed(acct.cashOnHandFils)}`, '#1F7A5C')
    + kv('Accounts Receivable (unpaid invoices)', `AED ${formatAed(acct.arFils)}`, '#D24B6E');

  const outRows = kv('Unpaid live orders', `${outstanding.count} · AED ${outstanding.totalDisplay}`)
    + Object.entries(outstanding.bySource || {}).map(([src, v]: any) => kv(`  from ${src}`, `${v.n} · AED ${formatAed(v.fils)}`)).join('');

  const methodRows = (methods.receiptsByMethod || [])
    .map((r: any) => kv(`${r.method} · ${r.source}`, `${r.n} · AED ${r.display}`)).join('');

  const ph = phones;
  const phoneRows = kv('App customers', `${ph.liveCustomers?.valid_e164} valid · ${ph.liveCustomers?.other_review} review`)
    + kv('QuickBooks', `${ph.historicalCustomers?.valid_e164} valid · ${ph.historicalCustomers?.other_review} review · ${ph.historicalCustomers?.empty} empty`)
    + kv('Alternate numbers', `${ph.historicalAlt?.valid_e164} valid`);

  const dupRows = (dups.rows || []).length === 0
    ? kv('Possible duplicates', 'None')
    : (dups.rows || []).slice(0, 12).map((r: any) => kv(`…${r.tail} (${r.n})`, (r.who || []).slice(0, 3).join(', '))).join('');

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <link href="https://fonts.googleapis.com/css2?family=Fredoka:wght@500;600;700&display=swap" rel="stylesheet"></head>
  <body style="margin:0;padding:0;background:${GROUND};font-family:'Segoe UI',Arial,sans-serif;color:${INK}">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${GROUND}">
      <tr><td align="center" style="padding:30px 16px 44px">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px">
          <tr><td style="text-align:center;padding:2px 0 22px"><span style="font-family:${DISPLAY};font-size:28px;font-weight:700;color:${BRAND}">Eventana</span></td></tr>
          <tr><td style="background:#ffffff;border-radius:26px;overflow:hidden;border:1px solid #F6E4EF;box-shadow:0 10px 34px rgba(214,49,127,.10)">
            <div style="height:7px;background:${BRAND}"></div>
            <div style="padding:30px 26px 34px">
              <div style="text-align:center;font-size:11.5px;font-weight:700;letter-spacing:2.5px;text-transform:uppercase;color:${BRAND};margin-bottom:6px">Reconciliation &amp; Audit</div>
              <h1 style="margin:0 0 4px;text-align:center;font-family:${DISPLAY};font-size:23px;font-weight:700;color:${INK}">${monthLabel(monthStr)}</h1>
              ${section('Cash position', acctRows)}
              ${section('Unpaid orders (not receivables)', outRows)}
              ${section('Payment method coverage', methodRows)}
              ${section('Phone number health', phoneRows)}
              ${section('Possible duplicate customers', dupRows)}
              <p style="margin:22px 0 0;font-size:11.5px;color:${MUTED};line-height:1.6">${outstanding.note}</p>
            </div>
          </td></tr>
          <tr><td style="text-align:center;color:#b8a6b0;font-size:11.5px;padding:24px 12px 0;line-height:1.8">Eventana Events · Abu Dhabi &amp; Dubai, UAE<br>Automated monthly reconciliation from your Eventana dashboard. 💛</td></tr>
        </table>
      </td></tr>
    </table>
  </body></html>`;
}

/** Compute + email the reconciliation report for a month, once. */
export async function sendReconReport(monthStr: string): Promise<{ sent: number }> {
  if (!emailEnabled()) return { sent: 0 };
  const html = await buildHtml(monthStr);
  const recipients = Array.from(new Set([OWNER, MARSHA, ...config.email.financeReportTo]));
  let sent = 0;
  for (const to of recipients) {
    const res = await sendEmail({ to, subject: `Eventana — Reconciliation & Audit · ${monthLabel(monthStr)}`, html });
    if (res.ok) sent++;
  }
  await pool.query(
    `INSERT INTO recon_reports (month, recipients) VALUES ($1,$2)
     ON CONFLICT (month) DO UPDATE SET sent_at = now(), recipients = EXCLUDED.recipients`,
    [monthStr, sent],
  );
  return { sent };
}

/** Sweep: once the month turns over, email the previous month's report once. */
export async function sweepReconReport(): Promise<void> {
  if (!emailEnabled()) return;
  try {
    const now = new Date();
    const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const monthStr = `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}`;
    const { rowCount } = await pool.query(
      `INSERT INTO recon_reports (month, recipients) VALUES ($1, 0) ON CONFLICT (month) DO NOTHING`,
      [monthStr],
    );
    if (rowCount) await sendReconReport(monthStr);
  } catch (err) {
    console.error('[recon-report] sweep failed:', (err as Error).message);
  }
}
