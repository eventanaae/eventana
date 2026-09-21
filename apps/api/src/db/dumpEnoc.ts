/** Debug: print the full raw text of ENOC rows to see why AED 170 was misread as
 *  8.00/credit. Guarded per DUMP_ENOC_TAG. */
import { pool } from './pool.js';

export async function dumpEnocFromEnv(): Promise<void> {
  if (String(process.env.RUN_MIGRATIONS_ON_BOOT ?? '').toLowerCase() !== 'true') return;
  const tag = process.env.DUMP_ENOC_TAG ?? 'v1';
  const guard = await pool.query(`SELECT 1 FROM app_kv WHERE k = $1`, [`dump_enoc_${tag}`]).catch(() => ({ rowCount: 0 }));
  if (guard.rowCount) return;
  const { rows } = await pool.query<any>(
    `SELECT id, status, direction, amount_fils,
            regexp_replace(raw_text, E'[\\r]+', '', 'g') AS raw
       FROM bank_transactions
      WHERE merchant ~* 'enoc' OR raw_text ~* 'enoc'
      ORDER BY created_at DESC LIMIT 3`,
  );
  console.log(`[dump-enoc] ${rows.length} ENOC rows`);
  for (const r of rows) {
    const raw = String(r.raw ?? '');
    console.log(`[dump-enoc] id=${r.id} ${r.status} ${r.direction} AED ${(Number(r.amount_fils) / 100).toFixed(2)} len=${raw.length}`);
    for (let i = 0; i < raw.length && i < 3000; i += 500) {
      console.log(`[dump-enoc] [${i}] ${raw.slice(i, i + 500)}`);
    }
  }
  await pool.query(`INSERT INTO app_kv (k, v) VALUES ($1, now()) ON CONFLICT (k) DO NOTHING`, [`dump_enoc_${tag}`]).catch(() => {});
}
