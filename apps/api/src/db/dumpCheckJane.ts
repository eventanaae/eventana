/**
 * Diagnostic: list every individual expense row for the two "Check With Jane"
 * vendors (date, amount, description, payment method) so the owner can identify
 * what they were. Read-only. Runs once on boot; self-disables via app_kv guard.
 */
import { pool } from './pool.js';

export async function dumpCheckJaneFromEnv(): Promise<void> {
  if (String(process.env.RUN_MIGRATIONS_ON_BOOT ?? '').toLowerCase() !== 'true') return;
  const guard = await pool
    .query(`SELECT 1 FROM app_kv WHERE k = 'check_jane_v1'`)
    .catch(() => ({ rowCount: 0 }));
  if (guard.rowCount) return;

  const { rows } = await pool.query<{ vendor: string; id: string; aed: number; spent_on: string; description: string; pm: string }>(
    `SELECT vendor, id, round(amount_fils/100.0)::int aed, to_char(spent_on,'YYYY-MM-DD') spent_on,
            COALESCE(description,'') description, COALESCE(payment_method,'') pm
       FROM expenses
      WHERE lower(vendor) LIKE '%check with jane%'
      ORDER BY vendor, spent_on`,
  );
  console.log(`[cjane] ${rows.length} rows`);
  for (const r of rows) {
    console.log(`[cjane] "${r.vendor}" | #${r.id} | ${r.spent_on} | AED ${r.aed} | pm=${r.pm} | "${r.description.slice(0, 70)}"`);
  }
  await pool
    .query(`INSERT INTO app_kv (k, v) VALUES ('check_jane_v1', now()) ON CONFLICT (k) DO NOTHING`)
    .catch(() => {});
}
