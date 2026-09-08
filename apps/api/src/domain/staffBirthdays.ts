/**
 * Staff birthday greetings.
 *
 * Once a day the reconcile sweep calls this: every active team member whose
 * birthday is today and who has an email gets one warm "happy birthday from
 * Eventana" message. Idempotent per member per year (a 'staff_birthday'
 * notification row is the marker), so repeated sweeps never double-send.
 */
import { pool } from '../db/pool.js';
import { emailEnabled, sendEmail } from '../integrations/email.js';
import { pushToOwner } from '../integrations/push.js';
import { STAFF_BIRTHDAY_TEMPLATE } from '../db/seedStaffBirthday.js';

const BRAND = '#EF5D95';
const INK = '#4A3540';
const GROUND = '#FBEAF2';
const RAINBOW = 'linear-gradient(90deg,#7FD8C4,#BFE29A,#F7D06B,#F7A98C,#F080A8,#B79BE0)';
const DISPLAY = "'Fredoka','Baloo 2','Segoe UI',Arial,sans-serif";

function html(first: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <link href="https://fonts.googleapis.com/css2?family=Fredoka:wght@500;600;700&display=swap" rel="stylesheet"></head>
  <body style="margin:0;padding:0;background:${GROUND};font-family:'Segoe UI',Arial,sans-serif;color:${INK}">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${GROUND}">
      <tr><td align="center" style="padding:30px 16px 44px">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px">
          <tr><td style="text-align:center;padding:2px 0 22px"><span style="font-family:${DISPLAY};font-size:28px;font-weight:700;color:${BRAND}">Eventana</span></td></tr>
          <tr><td style="background:#ffffff;border-radius:26px;overflow:hidden;border:1px solid #F6E4EF;box-shadow:0 10px 34px rgba(214,49,127,.10)">
            <div style="height:7px;background:${RAINBOW}"></div>
            <div style="padding:34px 30px 36px;text-align:center">
              <div style="font-size:54px;line-height:1;margin-bottom:10px">🎂🎉</div>
              <h1 style="margin:0 0 6px;font-family:${DISPLAY};font-size:26px;font-weight:700;color:${INK}">Happy Birthday, ${first}!</h1>
              <p style="margin:14px 0 0;font-size:15.5px;line-height:1.65">Wishing you the happiest of birthdays from all of us at the Eventana family! 💕 Thank you for everything you bring to our team — today we're celebrating <b>you</b>. 🎈</p>
              <p style="margin:14px 0 0;font-size:15.5px;line-height:1.65">Have a wonderful day filled with joy, cake, and all your favourite things. 🥳🎁</p>
              <p style="margin:20px 0 0;font-size:14px;color:${BRAND};font-weight:700">With love, the Eventana team 💐</p>
            </div>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body></html>`;
}

export async function sendStaffBirthdayEmails(): Promise<{ sent: number }> {
  const year = new Date().getFullYear();
  // Anyone with a birthday today who has an email OR a phone — so a member with
  // only a phone still gets their WhatsApp greeting.
  const { rows } = await pool.query<{ id: string; name: string; email: string | null; phone: string | null }>(
    `SELECT id, name, email, phone FROM team_members
      WHERE active AND birthday IS NOT NULL
        AND (COALESCE(btrim(email),'') <> '' OR COALESCE(btrim(phone),'') <> '')
        AND to_char(birthday,'MM-DD') = to_char(CURRENT_DATE,'MM-DD')
        AND NOT EXISTS (
          SELECT 1 FROM notifications n
           WHERE n.template = 'staff_birthday'
             AND (n.payload->>'memberId') = team_members.id
             AND (n.payload->>'year') = $1)`,
    [String(year)],
  );
  if (!rows.length) return { sent: 0 };
  const { whatsappEnabled, sendWhatsAppTemplate } = await import('../integrations/whatsapp.js');
  const canEmail = emailEnabled();
  const canWa = whatsappEnabled();
  let sent = 0;
  for (const m of rows) {
    const first = String(m.name || '').trim().split(/\s+/)[0] || 'there';
    let delivered = false;
    // Warm Eventana birthday email.
    if (canEmail && (m.email || '').trim()) {
      const res = await sendEmail({ to: m.email!, subject: `🎂 Happy Birthday, ${first}!`, html: html(first) });
      if (res.ok) delivered = true;
    }
    // Warm Eventana birthday WhatsApp — independent of the operational
    // WHATSAPP_STAFF_NOTIFY switch (a once-a-year greeting is always welcome).
    const to = String(m.phone || '').replace(/\D+/g, '');
    if (canWa && to) {
      const res = await sendWhatsAppTemplate({ to, name: STAFF_BIRTHDAY_TEMPLATE, language: 'en', params: [first], fromStaff: true }).catch(() => null);
      if ((res as any)?.ok) delivered = true;
    }
    if (delivered) {
      sent++;
      await pool.query(
        `INSERT INTO notifications (channel, template, scheduled_for, payload)
         VALUES ('email','staff_birthday', now(), $1)`,
        [JSON.stringify({ memberId: m.id, year: String(year) })],
      ).catch(() => {});
      // Also a warm in-app push to their own device (best-effort).
      await pushToOwner('staff', m.id, `Happy Birthday, ${first}! 🎂`, 'Wishing you a wonderful day from the Eventana family 💕').catch(() => {});
    }
  }
  if (sent) console.log(`[birthday] sent ${sent} staff birthday greeting(s)`);
  return { sent };
}
