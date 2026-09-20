/**
 * One-shot debug dump: print recent bank_transactions, and the FULL raw text of
 * Anthropic rows, so we can see exactly why the amount read as 0 and whether a
 * receipt link/attachment exists. Gated on RUN_MIGRATIONS_ON_BOOT; runs once per
 * DUMP_BANK_TX_TAG (bump the tag to re-run).
 */
import { pool } from './pool.js';

export async function dumpBankTxFromEnv(): Promise<void> {
  if (String(process.env.RUN_MIGRATIONS_ON_BOOT ?? '').toLowerCase() !== 'true') return;
  const tag = process.env.DUMP_BANK_TX_TAG ?? 'v1';
  const guard = await pool.query(`SELECT 1 FROM app_kv WHERE k = $1`, [`dump_banktx_${tag}`]).catch(() => ({ rowCount: 0 }));
  if (guard.rowCount) return;

  const { rows } = await pool.query(
    `SELECT id, to_char(created_at,'MM-DD HH24:MI') AS at, status, source, kind,
            amount_fils, merchant, receipt_url,
            left(regexp_replace(raw_text, E'[\\n\\r]+', ' ', 'g'), 100) AS snippet
       FROM bank_transactions
      ORDER BY created_at DESC
      LIMIT 20`,
  );
  console.log(`[dump-banktx] last ${rows.length} rows:`);
  for (const r of rows) {
    console.log(`[dump-banktx] ${r.at} | ${r.status} | ${r.source} | AED ${(Number(r.amount_fils) / 100).toFixed(2)} | ${r.merchant ?? '—'} | rcpt=${r.receipt_url ? 'Y' : 'N'} | ${r.snippet ?? ''}`);
  }

  // Full raw of Anthropic rows so we can fix the USD amount / invoice-link parse.
  const anth = await pool.query(
    `SELECT id, amount_fils, receipt_url,
            regexp_replace(raw_text, E'[\\r]+', '', 'g') AS raw
       FROM bank_transactions
      WHERE lower(coalesce(merchant,'')) LIKE '%anthropic%' OR lower(coalesce(source,'')) = 'anthropic'
      ORDER BY created_at DESC LIMIT 2`,
  );
  for (const r of anth.rows) {
    const raw = String(r.raw ?? '');
    console.log(`[dump-banktx-anthropic] id=${r.id} amount=${r.amount_fils} rcpt=${r.receipt_url ?? 'none'} rawLen=${raw.length}`);
    // Chunk so nothing is truncated by the log line limit.
    for (let i = 0; i < raw.length && i < 4000; i += 500) {
      console.log(`[dump-banktx-anthropic] [${i}] ${raw.slice(i, i + 500)}`);
    }
  }
  await pool.query(`INSERT INTO app_kv (k, v) VALUES ($1, now()) ON CONFLICT (k) DO NOTHING`, [`dump_banktx_${tag}`]).catch(() => {});
}
