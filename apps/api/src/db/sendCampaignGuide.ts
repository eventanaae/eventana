/**
 * One-time: email Marsha (CC the owner) a clear guide to the B2B corporate
 * campaign system — what it is, timings, what was set up, how/where/why, and
 * her role handling replies. In ENGLISH (Marsha). Guarded by app_kv.
 */
import { pool } from './pool.js';
import { config } from '../config.js';

export async function sendCampaignGuideOnce(): Promise<void> {
  const guard = await pool.query(`SELECT 1 FROM app_kv WHERE k = 'campaign_guide_sent_v3'`).catch(() => ({ rowCount: 0 }));
  if (guard.rowCount) return;

  const { sendEmail } = await import('../integrations/email.js');
  const logo = config.emailLogoUrl;
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
  <body style="margin:0;background:#FFF8FB;font-family:'Segoe UI',Tahoma,Arial,sans-serif;color:#3B3641;line-height:1.7">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:26px 14px 40px">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px">
        <tr><td style="text-align:center;padding:0 0 16px">${logo ? `<img src="${logo}" alt="Eventana" width="200" style="width:200px;max-width:66%">` : `<b style="font-size:24px;color:#E94F9C">Eventana</b>`}</td></tr>
        <tr><td style="background:#fff;border:1px solid #F3DEEA;border-radius:20px;padding:24px 22px">
          <div style="height:6px;border-radius:4px;background:linear-gradient(90deg,#7FD8C4,#F7D06B,#F7A98C,#F080A8,#B79BE0);margin-bottom:18px"></div>
          <h1 style="font-size:22px;margin:0 0 6px;color:#3B3641">Corporate Campaign Guide (B2B) 📣</h1>
          <p style="margin:0 0 16px;color:#6E6470;font-size:14px">Hi Marsha 💛 — here's a full guide to our company email campaign: what it is, when it sends, what we set up, and your role.</p>

          <h2 style="font-size:16px;margin:18px 0 4px;color:#E94F9C">🎯 What it is</h2>
          <p style="margin:0;font-size:14px">The system <b>automatically</b> emails companies (schools, universities, hospitals, clinics, banks, government, companies, nurseries, new shops) to win event bookings from their budgets — no manual work.</p>

          <h2 style="font-size:16px;margin:18px 0 4px;color:#E94F9C">🏢 Where the companies come from</h2>
          <p style="margin:0;font-size:14px">The system collects new companies from Google every day (those with a published email) and auto-categorises them by type.</p>

          <h2 style="font-size:16px;margin:18px 0 4px;color:#E94F9C">✉️ What we send</h2>
          <p style="margin:0;font-size:14px">A tailored first email per sector: an intro to Eventana + our services + the occasions + a <b>link to our company profile</b> + a question asking who the right contact is (procurement / events). All branded, in our style.</p>

          <h2 style="font-size:16px;margin:18px 0 4px;color:#E94F9C">📅 Occasion campaigns (important)</h2>
          <p style="margin:0;font-size:14px">About <b>one month before each occasion</b> (National Day, Ramadan, Eid, Women's Day, and more), the system automatically <b>prepares a ready draft email — with the right services already selected</b> — and sends you a <b>notification to review &amp; approve</b>. Nothing is scheduled or sent until you approve it.</p>

          <h2 style="font-size:16px;margin:18px 0 4px;color:#E94F9C">🕐 Timing</h2>
          <p style="margin:0;font-size:14px">
            • <b>Company</b> emails: Mon–Fri, <b>10:00 AM – 2:00 PM</b>.<br>
            • <b>Customer</b> emails: <b>4:00 PM – 10:30 PM</b>.<br>
            • We start at 100 companies/day (first batch of 20 to watch it) and ramp up to 200 — to protect hello@'s sending reputation.
          </p>

          <h2 style="font-size:16px;margin:18px 0 4px;color:#E94F9C">🔁 Follow-up</h2>
          <p style="margin:0;font-size:14px">If a company doesn't reply within <b>2 weeks</b> → one automatic reminder is sent (asking again for the right contact). One reminder only.</p>

          <h2 style="font-size:16px;margin:18px 0 4px;color:#E94F9C">💬 Replies — your role, Marsha</h2>
          <p style="margin:0;font-size:14px">
            • When a company replies and is <b>interested</b> (or gives us the right department email) → you both get a <b>notification</b> "Company X is interested" + a <b>ready suggested reply</b>.<br>
            • Review the suggested reply, edit if needed, and send it from hello@.<br>
            • Auto-replies (out of office) and simple greetings <b>don't count</b> — the system only alerts you to genuine interest.
          </p>

          <h2 style="font-size:16px;margin:18px 0 4px;color:#E94F9C">📍 Where to see everything</h2>
          <p style="margin:0;font-size:14px">Dashboard → <b>Marketing → Companies</b>: each company has a status (New / Contacted / Interested / Booked) + a filter + the emailed/replied dates.</p>

          <h2 style="font-size:16px;margin:18px 0 4px;color:#E94F9C">📄 Company profile</h2>
          <p style="margin:0;font-size:14px">A full page about Eventana (who we are, services, clients, 500+ events):<br>
          <a href="https://eventanauae.com/company-profile.html" style="color:#E94F9C;font-weight:700">eventanauae.com/company-profile.html</a> — you can send it to any company.</p>

          <h2 style="font-size:16px;margin:18px 0 4px;color:#E94F9C">⭐ Why</h2>
          <p style="margin:0 0 4px;font-size:14px">To grow our B2B client base — clients who pay from a budget and reorder — automatically and consistently, with every reply reviewed before it goes out.</p>

          <p style="margin:20px 0 0;font-size:13px;color:#8a7f88">Any questions, just ask 💕<br>— The Eventana Team</p>
        </td></tr>
      </table>
    </td></tr></table>
  </body></html>`;

  const res = await sendEmail({
    to: 'marsha@eventanauae.com',
    cc: ['sheem@eventanauae.com', 'shaima-ak@hotmail.com'],
    subject: 'Corporate Campaign Guide (B2B) — how it works & your role',
    html,
    skipMonitorBcc: true,
  });
  if (res.ok) {
    await pool.query(`INSERT INTO app_kv (k, v) VALUES ('campaign_guide_sent_v3', now()) ON CONFLICT (k) DO UPDATE SET v = now()`).catch(() => {});
    console.log('[campaign-guide] sent to Marsha in English (CC owner)');
  } else {
    console.error('[campaign-guide] send failed:', res.error);
  }
}
