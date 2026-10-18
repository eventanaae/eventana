/**
 * One-shot, owner-approved reply to the customer feedback on EV-1757 (guest of
 * honour "Roudha", booked by Noora Alhebsei). Sent on the approved Eventana
 * booking-email shell, CC'ing Marsha. The customer's own words are quoted back,
 * with a concise 3-point response (ice cream is a single-flavour machine but the
 * team served two flavours; approved ingredients; cup sizes to be reviewed;
 * started 5:00 PM on time; early finish was at the customer's request).
 *
 * Gated by SET_SHAN_LEADER='ev1757mail' (reuses the one-shot trigger key — the
 * env has a 300-var cap). Resolves the customer email from the receipt EV-1757,
 * falling back to the address on the booking. Dedup-guarded via app_kv so a
 * restart with the flag still set can never send twice. Blank the flag after.
 */
import { pool } from './pool.js';
import { emailEnabled, sendEmail } from '../integrations/email.js';

const KNOWN_EMAIL = 'law-student@hotmail.com';
const KNOWN_NAME = 'Noora';
const MARSHA = 'marsha@eventanauae.com';
const GUARD = 'complaint_ev1757_sent';

function emailHtml(): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<link href="https://fonts.googleapis.com/css2?family=Fredoka:wght@500;600;700&family=Baloo+Bhaijaan+2:wght@500;600;700;800&display=swap" rel="stylesheet"></head>
<body style="margin:0;padding:0;background:#FBEAF2;font-family:'Segoe UI',-apple-system,BlinkMacSystemFont,Arial,sans-serif;color:#4A3540;-webkit-font-smoothing:antialiased">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#FBEAF2">
    <tr><td align="center" style="padding:30px 16px 44px">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px">
        <tr><td style="text-align:center;padding:2px 0 22px">
          <div style="font-family:'Fredoka','Baloo Bhaijaan 2','Segoe UI',Arial,sans-serif;font-size:30px;font-weight:700;letter-spacing:.5px;color:#4A3540">Eventana</div>
          <div style="font-family:'Fredoka','Segoe UI',Arial,sans-serif;font-size:13px;font-weight:500;color:#EF5D95;letter-spacing:3px;text-transform:uppercase;margin-top:2px">Events</div>
        </td></tr>
        <tr><td style="background:#ffffff;border-radius:26px;overflow:hidden;border:1px solid #F6E4EF;box-shadow:0 10px 34px rgba(214,49,127,.10)">
          <div style="height:7px;background:linear-gradient(90deg,#7FD8C4,#BFE29A,#F7D06B,#F7A98C,#F080A8,#B79BE0)"></div>
          <div style="padding:34px 30px 36px">
            <div style="text-align:center;font-size:46px;line-height:1;margin-bottom:10px">&#128155;</div>
            <div style="text-align:center;font-size:11.5px;font-weight:700;letter-spacing:2.5px;text-transform:uppercase;color:#EF5D95;margin-bottom:8px">A note from Eventana</div>
            <h1 style="margin:0;text-align:center;font-family:'Fredoka','Baloo Bhaijaan 2','Segoe UI',Arial,sans-serif;font-size:25px;font-weight:700;color:#4A3540;line-height:1.3">Thank you for your feedback</h1>

            <p style="margin:22px 0 14px;font-size:15px;line-height:1.65">Dear ${KNOWN_NAME},</p>
            <p style="margin:0 0 6px;font-size:15px;line-height:1.65">Thank you for your feedback. We reviewed each point with our team.</p>

            <div style="margin:16px 0 6px;font-size:11.5px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#9B8A94">Your feedback</div>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#FCEEF6;border:1px solid #F4DDEC;border-radius:16px;margin:0 0 6px">
              <tr><td style="padding:16px 18px">
                <div dir="rtl" style="text-align:right;font-size:14.5px;line-height:1.9;color:#4A3540">&#8220;&#1575;&#1604;&#1575;&#1610;&#1587;&#1603;&#1585;&#1610;&#1605; &#1591;&#1593;&#1605;&#1607; &#1587;&#1610;&#1569; &#1587;&#1593;&#1585;&#1607; &#1594;&#1575;&#1604;&#1610; &#1606;&#1608;&#1593; &#1608;&#1575;&#1581;&#1583; &#1601;&#1602;&#1591;&#1548; &#1594;&#1586;&#1604; &#1575;&#1604;&#1576;&#1606;&#1575;&#1578; &#1591;&#1593;&#1605;&#1607; &#1587;&#1610;&#1569;&#1548; &#1571;&#1603;&#1608;&#1575;&#1576; &#1575;&#1604;&#1576;&#1608;&#1576; &#1603;&#1608;&#1585;&#1606; &#1603;&#1575;&#1606;&#1578; &#1571;&#1603;&#1608;&#1575;&#1576; &#1589;&#1594;&#1610;&#1585;&#1577; &#1580;&#1583;&#1575;&#1611; &#1608;&#1594;&#1610;&#1585; &#1605;&#1582;&#1589;&#1589;&#1577; &#1604;&#1604;&#1576;&#1608;&#1576; &#1603;&#1608;&#1585;&#1606;&#1548; &#1578;&#1571;&#1582;&#1585; &#1575;&#1604;&#1601;&#1585;&#1610;&#1602; &#1604;&#1610;&#1606; &#1608;&#1589;&#1604;&#1548; &#1582;&#1604;&#1589;&#1578; &#1575;&#1604;&#1601;&#1593;&#1575;&#1604;&#1610;&#1575;&#1578; &#1601;&#1610; &#1571;&#1602;&#1604; &#1605;&#1606; &#1587;&#1575;&#1593;&#1578;&#1610;&#1606; &#1608;&#1602;&#1575;&#1604;&#1608;&#1575; &#1607;&#1584;&#1575; &#1603;&#1604; &#1575;&#1604;&#1604;&#1610; &#1593;&#1606;&#1583;&#1606;&#1575;&#1548; &#1602;&#1604;&#1578; &#1604;&#1607;&#1605; &#1578;&#1608;&#1603;&#1604;&#1608;&#1575; &#1578;&#1602;&#1583;&#1585;&#1608;&#1606; &#1578;&#1585;&#1608;&#1581;&#1608;&#1606; &#1605;&#1575;&#1583;&#1575;&#1605; &#1607;&#1584;&#1575; &#1603;&#1604; &#1575;&#1604;&#1604;&#1610; &#1593;&#1606;&#1583;&#1603;&#1605;.&#8221;</div>
              </td></tr>
            </table>

            <div style="margin:22px 0 8px">
              <span style="display:inline-block;width:24px;height:24px;border-radius:50%;background:#EF5D95;color:#fff;font-weight:800;font-size:13px;text-align:center;line-height:24px;margin-right:8px">1</span>
              <span style="font-family:'Fredoka','Segoe UI',Arial,sans-serif;font-weight:700;font-size:16px;color:#4A3540;vertical-align:middle">Food &amp; popcorn cups</span>
            </div>
            <p style="margin:0 0 8px;font-size:14.5px;line-height:1.7">Our ice cream machine serves a single flavour (as shown in our photos) &mdash; yet on the day our team prepared <b>two flavours for you: vanilla and chocolate</b>. The ice cream, cotton candy and popcorn all use the same approved ingredients we serve at every event. If you can tell us what tasted off, we'll gladly look into it.</p>
            <p style="margin:0 0 4px;font-size:14.5px;line-height:1.7">On the popcorn cups &mdash; these are our standard cups, and we'll review and improve the sizes. Thank you for pointing it out.</p>

            <div style="margin:22px 0 8px">
              <span style="display:inline-block;width:24px;height:24px;border-radius:50%;background:#EF5D95;color:#fff;font-weight:800;font-size:13px;text-align:center;line-height:24px;margin-right:8px">2</span>
              <span style="font-family:'Fredoka','Segoe UI',Arial,sans-serif;font-weight:700;font-size:16px;color:#4A3540;vertical-align:middle">Timing</span>
            </div>
            <p style="margin:0 0 4px;font-size:14.5px;line-height:1.7">Your event was booked <b>5:00&ndash;9:00 PM</b>, and our team started exactly at <b>5:00 PM</b> with no delay.</p>

            <div style="margin:22px 0 8px">
              <span style="display:inline-block;width:24px;height:24px;border-radius:50%;background:#EF5D95;color:#fff;font-weight:800;font-size:13px;text-align:center;line-height:24px;margin-right:8px">3</span>
              <span style="font-family:'Fredoka','Segoe UI',Arial,sans-serif;font-weight:700;font-size:16px;color:#4A3540;vertical-align:middle">Early finish</span>
            </div>
            <p style="margin:0 0 4px;font-size:14.5px;line-height:1.7">Our team noted that you let them know only <b>three children</b> would join (as some were unwell), and that you asked them to pack up at around <b>8:00 PM</b> instead of 9:00 PM. Our team only ever leaves early at the customer's request.</p>

            <div style="height:1px;background:#F4DDEC;margin:24px 0"></div>

            <p style="margin:0 0 14px;font-size:14.5px;line-height:1.7">We truly value your feedback and will take the food presentation and cup sizes into account. Thank you for choosing Eventana. &#128155;</p>
            <p style="margin:0;font-size:14.5px;line-height:1.7">Warm regards,<br><b>Team Eventana</b></p>
          </div>
        </td></tr>
        <tr><td style="text-align:center;color:#b8a6b0;font-size:11.5px;padding:24px 12px 0;line-height:1.8">
          Eventana Events &middot; Abu Dhabi &amp; Dubai, UAE<br>
          Need anything? We're always here to help. &#128155;
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

export async function sendComplaintEv1757FromEnv(): Promise<void> {
  if (String(process.env.SET_SHAN_LEADER ?? '').toLowerCase() !== 'ev1757mail') return;
  if (!emailEnabled()) { console.log('[ev1757-reply] email disabled'); return; }

  // Dedup claim: insert the guard key; if it already existed, we've sent before.
  const claim = await pool.query(
    `INSERT INTO app_kv (k) VALUES ($1) ON CONFLICT (k) DO NOTHING RETURNING k`,
    [GUARD],
  );
  if (claim.rowCount === 0) { console.log('[ev1757-reply] already sent — skipping'); return; }

  // Resolve the customer's email from the EV-1757 receipt; fall back to the
  // address on the booking if the receipt join comes up empty.
  let to = KNOWN_EMAIL;
  let name = KNOWN_NAME;
  try {
    const { rows } = await pool.query<{ email: string | null; name: string | null }>(
      `SELECT c.email, c.name
         FROM finance_receipts r
         JOIN events e    ON e.id = r.event_id
         JOIN customers c ON c.id = e.customer_id
        WHERE r.number = '1757'
        LIMIT 1`,
    );
    const dbEmail = (rows[0]?.email ?? '').trim();
    if (dbEmail && dbEmail.includes('@')) { to = dbEmail; }
    const dbName = (rows[0]?.name ?? '').trim();
    if (dbName) { name = dbName.split(/\s+/)[0]; }
    console.log(`[ev1757-reply] resolved to=${to} (db="${dbEmail}") name="${name}"`);
  } catch (err) {
    console.error('[ev1757-reply] lookup failed, using fallback:', (err as Error).message);
  }

  if (!to.includes('@')) { console.log('[ev1757-reply] no valid email — aborting'); return; }

  const res = await sendEmail({
    to,
    cc: MARSHA,
    subject: 'Thank you for your feedback — Eventana Events (EV-1757)',
    html: emailHtml(),
  });
  if (res.ok) {
    console.log(`[ev1757-reply] SENT to ${to} (cc ${MARSHA}) id=${res.id ?? ''}`);
  } else {
    // Release the guard so a corrected retry can send.
    await pool.query(`DELETE FROM app_kv WHERE k = $1`, [GUARD]).catch(() => {});
    console.log(`[ev1757-reply] FAILED: ${(res as any).error}`);
  }
}
