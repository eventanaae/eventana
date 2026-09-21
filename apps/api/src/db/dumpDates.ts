/** Debug: show posted_on for recent bank rows to verify dates read correctly. Guarded. */
import { pool } from './pool.js';

export async function dumpDatesFromEnv(): Promise<void> {
  if (String(process.env.RUN_MIGRATIONS_ON_BOOT ?? '').toLowerCase() !== 'true') return;
  const tag = process.env.DUMP_DATES_TAG ?? 'v1';
  const guard = await pool.query(`SELECT 1 FROM app_kv WHERE k = $1`, [`dump_dates_${tag}`]).catch(() => ({ rowCount: 0 }));
  if (guard.rowCount) return;
  const { rows } = await pool.query<any>(
    `SELECT to_char(created_at,'MM-DD HH24:MI') AS at, status, source,
            to_char(posted_on,'YYYY-MM-DD') AS posted_on, amount_fils, merchant
       FROM bank_transactions ORDER BY created_at DESC LIMIT 15`,
  );
  for (const r of rows) {
    console.log(`[dump-dates] ${r.at} | ${r.status} | ${r.source} | posted_on=${r.posted_on} | AED ${(Number(r.amount_fils) / 100).toFixed(2)} | ${r.merchant ?? '—'}`);
  }
  await pool.query(`INSERT INTO app_kv (k, v) VALUES ($1, now()) ON CONFLICT (k) DO NOTHING`, [`dump_dates_${tag}`]).catch(() => {});
}
