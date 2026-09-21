/** One-time: owner confirmed the Zed Mobility AED 39.45 (Wio 6295) payment date is
 *  the 20th. Set posted_on and clean the "date not stated" note. Guarded. */
import { pool } from './pool.js';

export async function fixZedDateFromEnv(): Promise<void> {
  if (String(process.env.RUN_MIGRATIONS_ON_BOOT ?? '').toLowerCase() !== 'true') return;
  const gk = 'fix_zed_date_v1';
  const guard = await pool.query(`SELECT 1 FROM app_kv WHERE k=$1`, [gk]).catch(() => ({ rowCount: 0 }));
  if (guard.rowCount) return;
  const res = await pool.query(
    `UPDATE bank_transactions
        SET posted_on = '2026-09-20'::date,
            raw_text = 'Payment of 39.45 AED at Zed Mobility using your Wio card 6295 with Own AED funds. (owner-added; date confirmed 2026-09-20)'
      WHERE dedupe_key = 'wio|zed-mobility|3945|owner-added' AND status = 'pending'`,
  );
  console.log(`[fix-zed-date] updated ${res.rowCount} row(s) → posted_on 2026-09-20`);
  await pool.query(`INSERT INTO app_kv (k,v) VALUES ($1, now()) ON CONFLICT (k) DO NOTHING`, [gk]).catch(() => {});
}
