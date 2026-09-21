/** One-time correction: the forwarded ENOC card charge came through as AED 8.00
 *  credit (its "AED 170 is charged" line didn't extract from the forward, so a
 *  footer number was grabbed). Set it to the real AED 170.00 debit and put it
 *  back in the approval queue. Guarded. */
import { pool } from './pool.js';

export async function fixEnocFromEnv(): Promise<void> {
  if (String(process.env.RUN_MIGRATIONS_ON_BOOT ?? '').toLowerCase() !== 'true') return;
  const tag = process.env.FIX_ENOC_TAG ?? 'v1';
  const guard = await pool.query(`SELECT 1 FROM app_kv WHERE k = $1`, [`fix_enoc_${tag}`]).catch(() => ({ rowCount: 0 }));
  if (guard.rowCount) return;
  const r = await pool.query(
    `UPDATE bank_transactions
        SET amount_fils = 17000, direction = 'debit', kind = 'purchase',
            merchant = 'ENOC SITE 754 TASJEEL', status = 'pending',
            decided_by = NULL, decided_at = NULL
      WHERE merchant ~* 'enoc' AND amount_fils = 800 AND direction = 'credit'`,
  ).catch((e) => { console.error('[fix-enoc]', (e as Error).message); return { rowCount: 0 }; });
  console.log(`[fix-enoc] corrected ${r.rowCount ?? 0} ENOC row(s) to AED 170.00 debit (pending)`);
  await pool.query(`INSERT INTO app_kv (k, v) VALUES ($1, now()) ON CONFLICT (k) DO NOTHING`, [`fix_enoc_${tag}`]).catch(() => {});
}
