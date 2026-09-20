/** One-time: email Marsha (CC owner) about expenses entered without a supplier name. English. Guarded. */
import { pool } from './pool.js';
import { config } from '../config.js';

export async function sendMarshaMissingSupplierOnce(): Promise<void> {
  if (String(process.env.RUN_MIGRATIONS_ON_BOOT ?? '').toLowerCase() !== 'true') return;
  const guard = await pool.query(`SELECT 1 FROM app_kv WHERE k = 'marsha_missing_supplier_v1'`).catch(() => ({ rowCount: 0 }));
  if (guard.rowCount) return;

  const { sendEmail } = await import('../integrations/email.js');
  const logo = config.emailLogoUrl;
  const rows = [
    { id: 27005, date: '16 Sep 2026', aed: 165, what: 'Printing / stickers shop (white/black, gold sticker, matt A3) — shop name not on the invoice', rcpt: 'https://res.cloudinary.com/ndggkvdu/image/upload/v1789811534/eventana/receipts/ikoiqt5text4ncohxsfo.jpg' },
    { id: 214, date: '11 Dec 2025', aed: 24, what: 'Balloons (card slip shows only "Network")', rcpt: 'https://res.cloudinary.com/ndggkvdu/image/upload/v1788469980/eventana/receipts/kpo2yrc6nqbjs8qmslas.jpg' },
    { id: 2, date: '20 Aug 2026', aed: 500, what: 'Friday rice distribution — no receipt attached', rcpt: '' },
  ];
  const list = rows.map((r) =>
    `<tr><td style="padding:8px;border:1px solid #eee">#${r.id}</td><td style="padding:8px;border:1px solid #eee">${r.date}</td><td style="padding:8px;border:1px solid #eee">AED ${r.aed}</td><td style="padding:8px;border:1px solid #eee">${r.what}${r.rcpt ? ` — <a href="${r.rcpt}">view receipt</a>` : ''}</td></tr>`,
  ).join('');

  const html = `<!doctype html><html lang="en"><body style="margin:0;background:#FFF8FB;font-family:'Segoe UI',Arial,sans-serif;color:#3B3641;line-height:1.6">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 14px 40px">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:620px">
        <tr><td style="text-align:center;padding:0 0 14px">${logo ? `<img src="${logo}" alt="Eventana" width="180" style="max-width:60%">` : `<b style="font-size:22px;color:#E94F9C">Eventana</b>`}</td></tr>
        <tr><td style="background:#fff;border:1px solid #F3DEEA;border-radius:18px;padding:22px">
          <h1 style="font-size:20px;margin:0 0 8px;color:#3B3641">Action needed: expenses missing a supplier name</h1>
          <p style="margin:0 0 14px;font-size:14px">Hi Marsha 💛 — during the finance clean-up we found <b>3 expenses that were entered without a supplier name</b>. Please open each one in Finance, check the receipt, and <b>add the correct supplier name</b>:</p>
          <table style="border-collapse:collapse;width:100%;font-size:13px"><tr style="background:#FDEAF4"><th style="padding:8px;border:1px solid #eee;text-align:left">Expense</th><th style="padding:8px;border:1px solid #eee;text-align:left">Date</th><th style="padding:8px;border:1px solid #eee;text-align:left">Amount</th><th style="padding:8px;border:1px solid #eee;text-align:left">What / receipt</th></tr>${list}</table>
          <p style="margin:16px 0 6px;font-size:14px;background:#FDEAF4;border-radius:10px;padding:12px"><b>Please remember going forward:</b> never save an expense without entering the supplier name. Every expense must have a supplier.</p>
          <p style="margin:14px 0 0;font-size:13px;color:#8a7f88">Thank you! — The Eventana Team</p>
        </td></tr>
      </table>
    </td></tr></table></body></html>`;

  const res = await sendEmail({
    to: 'marsha@eventanauae.com',
    cc: ['sheem@eventanauae.com', 'shaima-ak@hotmail.com'],
    subject: 'Action needed: 3 expenses missing a supplier name',
    html,
    skipMonitorBcc: true,
  });
  if (res.ok) {
    await pool.query(`INSERT INTO app_kv (k, v) VALUES ('marsha_missing_supplier_v1', now()) ON CONFLICT (k) DO UPDATE SET v = now()`).catch(() => {});
    console.log('[marsha-missing] sent to Marsha (CC owner)');
  } else {
    console.error('[marsha-missing] send failed:', res.error);
  }
}
