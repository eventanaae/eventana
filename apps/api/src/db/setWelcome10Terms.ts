/**
 * One-shot: set the live WELCOME10 code's terms to match what the site now
 * advertises — 10% off, minimum spend AED 2,000, first booking only (campaign
 * 'welcome', enforced in validatePromo), active. The schema seed carries these
 * for fresh DBs but ON CONFLICT DO NOTHING won't update the existing row, so
 * this updates it. Triggered by SET_SHAN_LEADER='welcome10'; blank after.
 */
import { pool } from './pool.js';

export async function setWelcome10TermsFromEnv(): Promise<void> {
  if (process.env.SET_SHAN_LEADER !== 'welcome10') return;
  try {
    const r = await pool.query(
      `UPDATE promo_codes
          SET min_spend_fils = 200000, campaign = 'welcome', active = true
        WHERE code = 'WELCOME10'`,
    );
    console.log(`[welcome10] updated ${r.rowCount ?? 0} row — 10% off, min AED 2,000, first-booking only, active. Blank SET_SHAN_LEADER now.`);
  } catch (err) {
    console.error('[welcome10] failed:', (err as Error).message);
  }
}
