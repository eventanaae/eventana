/** Debug: print the full raw text of Anthropic rows whose amount read as 0, so we
 *  can see why the USD amount wasn't parsed and fix it. Guarded per DUMP_ANTHZ_TAG. */
import { pool } from './pool.js';

export async function dumpAnthZeroFromEnv(): Promise<void> {
  if (String(process.env.RUN_MIGRATIONS_ON_BOOT ?? '').toLowerCase() !== 'true') return;
  const tag = process.env.DUMP_ANTHZ_TAG ?? 'v1';
  const guard = await pool.query(`SELECT 1 FROM app_kv WHERE k = $1`, [`dump_anthz_${tag}`]).catch(() => ({ rowCount: 0 }));
  if (guard.rowCount) return;
  const { rows } = await pool.query<any>(
    `SELECT id, amount_fils, to_char(posted_on,'YYYY-MM-DD') AS d, receipt_url,
            regexp_replace(raw_text, E'[\\r]+', '', 'g') AS raw
       FROM bank_transactions
      WHERE (source='anthropic' OR lower(coalesce(merchant,''))='anthropic') AND amount_fils = 0
      ORDER BY created_at DESC LIMIT 4`,
  );
  console.log(`[anthz] ${rows.length} zero-amount Anthropic rows`);
  for (const r of rows) {
    const raw = String(r.raw ?? '');
    console.log(`[anthz] id=${r.id} amount=${r.amount_fils} date=${r.d} rcpt=${r.receipt_url ? 'Y' : 'N'} len=${raw.length}`);
    for (let i = 0; i < raw.length && i < 4500; i += 500) {
      console.log(`[anthz] [${i}] ${raw.slice(i, i + 500)}`);
    }
  }
  await pool.query(`INSERT INTO app_kv (k, v) VALUES ($1, now()) ON CONFLICT (k) DO NOTHING`, [`dump_anthz_${tag}`]).catch(() => {});
}
