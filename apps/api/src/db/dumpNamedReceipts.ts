/**
 * Diagnostic: for a few specific expense vendors the owner is reviewing, dump the
 * raw expense row (id, vendor, amount, date, description, source, payment method,
 * receipt_url) straight from the expenses table — including ones that were never
 * OCR'd — so we can pull up any receipt image that exists. Read-only.
 *
 * Runs once on boot (RUN_MIGRATIONS_ON_BOOT on) — self-disables via app_kv guard.
 */
import { pool } from './pool.js';

export async function dumpNamedReceiptsFromEnv(): Promise<void> {
  if (String(process.env.RUN_MIGRATIONS_ON_BOOT ?? '').toLowerCase() !== 'true') return;
  const guard = await pool
    .query(`SELECT 1 FROM app_kv WHERE k = 'named_receipts_v1'`)
    .catch(() => ({ rowCount: 0 }));
  if (guard.rowCount) return;

  const { rows } = await pool.query<{
    id: string; vendor: string; aed: number; spent_on: string; description: string;
    source: string; pm: string; url: string;
  }>(
    `SELECT id, vendor, round(amount_fils/100.0)::int aed, to_char(spent_on,'YYYY-MM-DD') spent_on,
            COALESCE(description,'') description, COALESCE(source,'manual') source,
            COALESCE(payment_method,'') pm, COALESCE(receipt_url,'') url
       FROM expenses
      WHERE lower(vendor) ~ '(razib|mamunur|rashi|abdulhamid|toon|hafeeth|\\mdan\\M)'
      ORDER BY vendor, spent_on`,
  );
  console.log(`[named-rcpt] ${rows.length} rows`);
  for (const r of rows) {
    console.log(`[named-rcpt] #${r.id} | "${r.vendor}" | AED ${r.aed} | ${r.spent_on} | src=${r.source} | pm=${r.pm} | desc="${r.description.slice(0, 60)}" | url=${r.url || '(none)'}`);
  }
  await pool
    .query(`INSERT INTO app_kv (k, v) VALUES ('named_receipts_v1', now()) ON CONFLICT (k) DO NOTHING`)
    .catch(() => {});
}
