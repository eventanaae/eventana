/**
 * One-time: email a preview of every sector's B2B first-touch email to the owner
 * and Marsha for review — BEFORE any live sending is switched on. Guarded by
 * app_kv so it sends once; bump the key to re-send after edits.
 */
import { pool } from './pool.js';
import type { CorpCategory } from '../domain/corporateOutreach.js';

const SAMPLES: Record<CorpCategory, string> = {
  school: 'Al Noor School',
  nursery: 'Little Stars Nursery',
  university: 'Gulf University',
  hospital: 'City Hospital',
  clinic: 'Wellness Clinic',
  bank: 'Emirates Bank',
  government: 'Dubai Municipality',
  company: 'ACME Company',
  new_shop: 'The New Boutique',
  other: 'Sample Organisation',
};

export async function sendCorpPreviewsOnce(): Promise<void> {
  const guard = await pool.query(`SELECT 1 FROM app_kv WHERE k = 'corp_previews_sent_v4'`).catch(() => ({ rowCount: 0 }));
  if (guard.rowCount) return;

  const { sendEmail } = await import('../integrations/email.js');
  const { firstTouchPreview } = await import('../domain/corporateOutreach.js');
  // Send each sector to the owner + Marsha (+ owner's personal inbox for safety).
  const to = 'sheem@eventanauae.com';
  const cc = ['marsha@eventanauae.com', 'shaima-ak@hotmail.com'];

  let sent = 0;
  for (const cat of Object.keys(SAMPLES) as CorpCategory[]) {
    if (cat === 'other') continue; // skip the generic fallback in the review set
    const { subject, html } = firstTouchPreview(cat, SAMPLES[cat]);
    const res = await sendEmail({ to, cc, subject: `[Preview – ${cat}] ${subject}`, html, skipMonitorBcc: true });
    if (res.ok) sent++;
    await new Promise((r) => setTimeout(r, 400));
  }
  await pool.query(`INSERT INTO app_kv (k, v) VALUES ('corp_previews_sent_v4', now()) ON CONFLICT (k) DO UPDATE SET v = now()`).catch(() => {});
  console.log(`[corp-previews] sent ${sent} sector preview email(s) to owner + Marsha`);
}
