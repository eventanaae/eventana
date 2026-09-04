/**
 * Phone maintenance (owner-approved 2026-09-04):
 *  1. Safe cleanup — normalise every confidently-fixable number to +9715XXXXXXXX
 *     (never touches landlines / unclear numbers).
 *  2. Email Marsha the numbers that still need a HUMAN look, asking her to check
 *     and confirm the correct value.
 *
 * Gated by PHONE_MAINTENANCE: 'clean' cleans only; 'clean+email' also emails
 * Marsha. Runs once per boot when set.
 */
import { pool } from './pool.js';
import { config } from '../config.js';
import { sendEmail, emailEnabled } from '../integrations/email.js';
import { normalizePhones, normalizeUaePhone } from '../domain/maintenance.js';

const MARSHA = 'marsha@eventanauae.com';

interface ReviewRow { book: string; name: string; phone: string; field: string }

/** Numbers that are non-empty but can't be auto-fixed — for a human to verify. */
async function collectReviewNumbers(): Promise<ReviewRow[]> {
  const out: ReviewRow[] = [];
  const sources: Array<{ table: string; book: string; cols: Array<[string, string]> }> = [
    { table: 'customers', book: 'App', cols: [['phone', 'Phone'], ['backup_phone', 'Backup']] },
    { table: 'historical_customers', book: 'QuickBooks', cols: [['phone', 'Phone'], ['phone_alt', 'Alternate']] },
  ];
  for (const s of sources) {
    const { rows } = await pool.query(
      `SELECT name, ${s.cols.map(([c]) => c).join(', ')} FROM ${s.table}
        WHERE ${s.cols.map(([c]) => `COALESCE(${c},'') <> ''`).join(' OR ')}`,
    );
    for (const r of rows) {
      for (const [col, label] of s.cols) {
        const raw = String(r[col] ?? '').trim();
        if (!raw) continue;
        if (normalizeUaePhone(raw) === null) {
          out.push({ book: s.book, name: r.name ?? '(no name)', phone: raw, field: label });
        }
      }
    }
  }
  return out;
}

export async function phoneMaintenanceFromEnv(): Promise<void> {
  const mode = String(process.env.PHONE_MAINTENANCE ?? '').toLowerCase();
  if (mode !== 'clean' && mode !== 'clean+email') return;
  try {
    // 1) Safe cleanup first.
    const res = await normalizePhones();
    const changed = Object.values(res.summary as Record<string, { changed: number }>).reduce((s, v) => s + v.changed, 0);
    console.log(`[phone-fix] safe cleanup: ${changed} number(s) normalised to +9715XXXXXXXX`);

    // 2) Whatever still needs a human — collect + (optionally) email Marsha.
    const review = await collectReviewNumbers();
    console.log(`[phone-fix] numbers needing manual review: ${review.length}`);
    for (const r of review) console.log(`[phone-fix]   [${r.book}/${r.field}] ${r.name} · ${r.phone}`);

    if (mode === 'clean+email' && review.length > 0) {
      if (!emailEnabled()) { console.log('[phone-fix] email disabled — not sending to Marsha.'); return; }
      // Only email Marsha once per day, so repeated boots/deploys don't spam her.
      const guard = await pool.query(
        `INSERT INTO settings (key, value) VALUES ('phone.marshaEmailedOn', to_char(now(),'YYYY-MM-DD'))
         ON CONFLICT (key) DO UPDATE SET value = to_char(now(),'YYYY-MM-DD')
         WHERE settings.value IS DISTINCT FROM to_char(now(),'YYYY-MM-DD')
         RETURNING key`,
      );
      if (guard.rowCount === 0) { console.log('[phone-fix] Marsha already emailed today — skipping.'); return; }
      const rowsHtml = review
        .map(
          (r) =>
            `<tr><td style="padding:7px 10px;border-bottom:1px solid #eee">${r.book}</td>
             <td style="padding:7px 10px;border-bottom:1px solid #eee">${r.field}</td>
             <td style="padding:7px 10px;border-bottom:1px solid #eee">${r.name}</td>
             <td style="padding:7px 10px;border-bottom:1px solid #eee;font-weight:700">${r.phone}</td></tr>`,
        )
        .join('');
      const html = `<div style="font-family:Segoe UI,Arial,sans-serif;color:#3B3641;max-width:640px;margin:0 auto">
        <h2 style="color:#E94F9C">Phone numbers that need a check</h2>
        <p style="font-size:14px;line-height:1.6">Hi Marsha 👋 These ${review.length} customer numbers aren't in the standard <b>+9715XXXXXXXX</b> format and couldn't be fixed automatically (they may be landlines, foreign numbers, or typos). Could you please <b>check each one and confirm or correct it</b>?</p>
        <table style="width:100%;border-collapse:collapse;font-size:13px;margin-top:10px">
          <tr style="text-align:left;color:#8b7d84;font-size:11px;text-transform:uppercase">
            <th style="padding:7px 10px">Book</th><th style="padding:7px 10px">Field</th><th style="padding:7px 10px">Name</th><th style="padding:7px 10px">Number</th>
          </tr>
          ${rowsHtml}
        </table>
        <p style="font-size:12px;color:#b3a8a0;margin-top:18px">Automated from the Eventana dashboard · phone-number health.</p>
      </div>`;
      const r = await sendEmail({ to: MARSHA, subject: `Please check ${review.length} customer phone numbers`, html });
      console.log(`[phone-fix] emailed Marsha: ${r.ok ? 'ok' : r.error}`);
    }
    console.log('[phone-fix] done.');
  } catch (err) {
    console.error('[phone-fix] failed:', (err as Error).message);
  }
}
