/**
 * Re-parse the amount for Anthropic bank rows that came in at 0 (their email body
 * was mostly Stripe padding + links, so the amount wasn't read). Runs the improved
 * parseAnthropicReceipt over the stored raw_text and updates amount_fils + the
 * readable note. Pending rows only — never touches an approved expense. Guarded.
 */
import { pool } from './pool.js';
import { parseAnthropicReceipt } from '../domain/bankInbox.js';

export async function fixAnthZeroFromEnv(): Promise<void> {
  if (String(process.env.RUN_MIGRATIONS_ON_BOOT ?? '').toLowerCase() !== 'true') return;
  const tag = process.env.FIX_ANTHZ_TAG ?? 'v3';
  const guard = await pool.query(`SELECT 1 FROM app_kv WHERE k = $1`, [`fix_anthz_${tag}`]).catch(() => ({ rowCount: 0 }));
  if (guard.rowCount) return;

  // Any status — a frustrated tap may have already approved/ignored a 0-amount
  // row; if it was approved, fix the linked expense's amount too.
  const { rows } = await pool.query<{ id: string; raw_text: string; status: string; expense_id: string | null }>(
    `SELECT id, raw_text, status, expense_id FROM bank_transactions
      WHERE amount_fils = 0
        AND (source = 'anthropic' OR lower(coalesce(merchant,'')) = 'anthropic')`,
  );
  let fixed = 0;
  for (const r of rows) {
    const raw = String(r.raw_text ?? '');
    const a = parseAnthropicReceipt('', raw);
    if (a.amountFils > 0) {
      const nl = raw.indexOf('\n\n');
      const body = nl >= 0 ? raw.slice(nl) : `\n\n${raw}`;
      const newRaw = (a.note + body).slice(0, 4000);
      await pool.query(`UPDATE bank_transactions SET amount_fils = $2, raw_text = $3 WHERE id = $1`, [r.id, a.amountFils, newRaw]);
      if (r.expense_id) {
        await pool.query(`UPDATE expenses SET amount_fils = $2 WHERE id = $1`, [r.expense_id, a.amountFils]).catch(() => {});
      }
      fixed++;
      console.log(`[fix-anthz] ${r.id} (${r.status}${r.expense_id ? '+expense' : ''}) → ${a.note}`);
    } else {
      console.log(`[fix-anthz] ${r.id} (${r.status}) still no amount`);
    }
  }
  console.log(`[fix-anthz] fixed ${fixed}/${rows.length} zero-amount Anthropic rows`);

  // Rows the owner rejected only because they showed AED 0 — now they have a real
  // amount, put them back in the approval queue (not yet posted to expenses).
  const flip = await pool.query(
    `UPDATE bank_transactions SET status = 'pending', decided_by = NULL, decided_at = NULL
      WHERE status = 'ignored' AND amount_fils > 0 AND expense_id IS NULL
        AND (source = 'anthropic' OR lower(coalesce(merchant,'')) = 'anthropic')`,
  ).catch(() => ({ rowCount: 0 }));
  console.log(`[fix-anthz] restored ${flip.rowCount ?? 0} rejected Anthropic rows to approval`);
  await pool.query(`INSERT INTO app_kv (k, v) VALUES ($1, now()) ON CONFLICT (k) DO NOTHING`, [`fix_anthz_${tag}`]).catch(() => {});
}
