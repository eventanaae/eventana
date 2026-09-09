/**
 * Owner-approved customer reconciliation actions (2026-09-09). Gated by
 * RECON_APPLY=true; run once then turn the flag off. Safe + minimal:
 *  1. Backfill 10 verified phones onto existing customers — ONLY where the phone
 *     is currently blank (never overwrites). Matched by email. (Tanfeeth held —
 *     its QB number is the owner's own; Sara Alharbi held — typo'd email.)
 *  2. Add 2 QuickBooks customers that were never migrated.
 *  3. Email Marsha the 8 malformed/conflicting phones + their order & date for
 *     review, and create a manual task for her.
 */
import { pool } from './pool.js';
import { randomBytes } from 'node:crypto';
import { emailEnabled, sendEmail } from '../integrations/email.js';

// email -> verified phone (from the clean QuickBooks Excel). Tanfeeth excluded.
const PHONES: Array<[string, string]> = [
  ['asma.alshehhi@cbuae.gov.ae', '0557557517'],
  ['rodha.almansoori@edgegroup.ae', '0502299003'],
  ['halimahassan577@gmail.com', '0529531113'],
  ['m.asalganim@gmail.com', '0562626166'],
  ['emanbinthani@gmail.com', '0501883030'],
  ['gamasha_22@hotmail.com', '0528833003'],
  ['hania_khalid@hotmail.co.uk', '0551831551'],
  ['mh3a.77@gmail.com', '0555006063'],
  ['r3.alghubari@icloud.com', '0544999094'],
  ['rasha.younis44@gmail.com', '0554374155'],
  ['reemboushehri@yahoo.com', '0566411444'],
  ['sh.maj@hotmail.com', '0501157666'],
];

// name, email, phone — QB customers not in the system (Sara Alharbi held: typo email).
const NEW_CUSTOMERS: Array<[string, string, string]> = [
  ['Aisha Aldanhani', 'mohd.a.m@icloud.com', '0501933999'],
  ['Ameera Khalid', 'ameera.kh93@gmail.com', '0553163333'],
];

// The 8 for Marsha to review: name, system phone, QB phone, order, date.
const REVIEW: Array<[string, string, string, string, string]> = [
  ['Kaltham Alshamsi', '+971566368000', '0566368000 / 0509666644', '—', '—'],
  ['Hamda Khamis Alnabi', '+97156333303', '056333303 / 0507799574', '#1569', '10 Apr 2026'],
  ['Huda Alqadi', '054003230', '0544003230', '#1462', '28 Nov 2025'],
  ['Salama', '+971506006658', '0502222685', '#1458', '1 Nov 2025'],
  ['Maryam Al Shamsi', '+97150119700', '050119700 / 0522006999', '#1148', '28 Oct 2023'],
  ['Salim Alsuwaidi', '+97156901999', '056901999', '#1258', '3 Aug 2024'],
  ['Khadija Suliman', '1720770', '0501720770', '#1304', '22 Nov 2024'],
  ['Huwreya', '+97158198897', '058198897 / 0502722433', '#1037', '21 Jan 2023'],
];

function reviewHtml(): string {
  const P = '#E94F9C', INK = '#3B3641';
  const rows = REVIEW.map((r) => `<tr>
    <td style="padding:8px 10px;border-bottom:1px solid #eee;font-weight:700;color:${INK}">${r[0]}</td>
    <td style="padding:8px 10px;border-bottom:1px solid #eee;font-family:monospace;color:#c0392b">${r[1]}</td>
    <td style="padding:8px 10px;border-bottom:1px solid #eee;font-family:monospace">${r[2]}</td>
    <td style="padding:8px 10px;border-bottom:1px solid #eee">${r[3]}</td>
    <td style="padding:8px 10px;border-bottom:1px solid #eee">${r[4]}</td></tr>`).join('');
  return `<!doctype html><html><body style="margin:0;background:#FBF3F7;font-family:Segoe UI,Arial,sans-serif">
    <div style="max-width:640px;margin:0 auto;padding:24px 14px">
      <div style="background:#FDEFF6;border:1px solid #F0DCE7;border-radius:18px;padding:18px 20px">
        <div style="font-weight:700;color:${P};font-size:12px;letter-spacing:2px">EVENTANA · DATA REVIEW</div>
        <div style="font-weight:800;font-size:22px;color:${INK};margin:6px 0">📞 8 customer phones need your review</div>
        <div style="font-size:14px;color:#6b6169;line-height:1.6">Hi Marsha 💛 — during the QuickBooks reconciliation we found 8 customers whose phone number looks malformed (missing/extra digits) or conflicts. Could you check each against WhatsApp / the customer and confirm the correct number? Their order &amp; date are included to help you identify them.</div>
      </div>
      <table style="width:100%;border-collapse:collapse;margin-top:16px;background:#fff;border:1px solid #F0DCE7;border-radius:12px;overflow:hidden;font-size:12.5px">
        <tr style="background:#fff6fb"><th style="padding:8px 10px;text-align:left;color:#8a7f79;font-size:11px">Customer</th><th style="padding:8px 10px;text-align:left;color:#8a7f79;font-size:11px">In system</th><th style="padding:8px 10px;text-align:left;color:#8a7f79;font-size:11px">QuickBooks</th><th style="padding:8px 10px;text-align:left;color:#8a7f79;font-size:11px">Order</th><th style="padding:8px 10px;text-align:left;color:#8a7f79;font-size:11px">Date</th></tr>
        ${rows}
      </table>
      <div style="font-size:12.5px;color:#6b6169;margin-top:14px;line-height:1.6">Just reply with the correct number for each, and we'll update the system. Thank you 🤍<br>— Eventana</div>
    </div></body></html>`;
}

export async function reconApplyFromEnv(): Promise<void> {
  if (String(process.env.RECON_APPLY ?? '').toLowerCase() !== 'true') return;
  const L = (s: string) => console.log(`[recon-apply] ${s}`);
  try {
    // 1. Backfill phones (only where blank).
    let filled = 0;
    for (const [em, ph] of PHONES) {
      const r = await pool.query(
        `UPDATE customers SET phone = $2 WHERE lower(btrim(email)) = lower($1) AND coalesce(btrim(phone),'') = '' RETURNING id`,
        [em, ph],
      );
      filled += r.rowCount ?? 0;
      L(`phone ${em} -> ${ph}: updated ${r.rowCount}`);
    }
    L(`phones filled: ${filled}/${PHONES.length}`);

    // 2. Add missing customers (skip if the email already exists).
    for (const [nm, em, ph] of NEW_CUSTOMERS) {
      const ex = await pool.query(`SELECT 1 FROM customers WHERE lower(btrim(email)) = lower($1) LIMIT 1`, [em]);
      if (ex.rowCount) { L(`customer ${nm} <${em}> already exists — skip`); continue; }
      const id = 'CUST-' + randomBytes(4).toString('hex').toUpperCase();
      await pool.query(`INSERT INTO customers (id, name, phone, email, origin) VALUES ($1,$2,$3,$4,'quickbooks')`, [id, nm, ph, em]);
      L(`added customer ${nm} ${id}`);
    }

    // 3. Email Marsha the 8 + create her task.
    const m = (await pool.query(`SELECT id, email FROM team_members WHERE lower(name) = 'marsha' LIMIT 1`)).rows[0];
    const memail = (m?.email ?? '').trim() || 'marsha@eventanauae.com';
    if (emailEnabled()) {
      const res = await sendEmail({ to: memail, subject: '📞 8 customer phone numbers need your review', html: reviewHtml() });
      L(`marsha email <${memail}>: ${res.ok ? 'SENT ' + (res.id ?? '') : 'FAILED ' + (res as any).error}`);
    } else L('email disabled — Marsha email skipped');
    if (m?.id) {
      const { createManualTask } = await import('../domain/prep.js');
      const r = await createManualTask({
        title: 'Review 8 customer phone numbers (check email)',
        memberIds: [m.id],
        dueDate: null,
        note: '8 customers have malformed/conflicting phone numbers from QuickBooks — check the email and confirm the correct number for each.',
        actor: 'System',
        notify: true,
      });
      L(`marsha task: ${r ? r.id : 'FAILED'}`);
    } else L('Marsha not found — task skipped');

    L('DONE');
  } catch (e) {
    L(`error: ${(e as Error).message.slice(0, 200)}`);
  }
}
