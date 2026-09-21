/** Debug: total Eventana has paid Anthropic/Claude — summed from the captured
 *  receipts (expenses) + any still-pending bank rows. Guarded; read via logs. */
import { pool } from './pool.js';

export async function anthropicSpendFromEnv(): Promise<void> {
  if (String(process.env.RUN_MIGRATIONS_ON_BOOT ?? '').toLowerCase() !== 'true') return;
  const tag = process.env.ANTHROPIC_SPEND_TAG ?? 'v1';
  const gk = `anthropic_spend_${tag}`;
  const guard = await pool.query(`SELECT 1 FROM app_kv WHERE k=$1`, [gk]).catch(() => ({ rowCount: 0 }));
  if (guard.rowCount) return;
  const aed = (f: number) => (f / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const like = `%anthropic%`;

  const exp = await pool.query<any>(
    `SELECT to_char(spent_on,'YYYY-MM-DD') sp, amount_fils, COALESCE(vendor,'—') v, COALESCE(source,'—') src
       FROM expenses WHERE vendor ILIKE $1 OR description ILIKE $1 OR description ILIKE '%claude%'
      ORDER BY spent_on`, [like]);
  let total = 0;
  console.log(`[anthropic-spend] recorded expenses: ${exp.rows.length}`);
  for (const r of exp.rows) { total += Number(r.amount_fils); console.log(`[anthropic-spend] ${r.sp} | AED ${aed(Number(r.amount_fils))} | ${r.v} | ${r.src}`); }
  console.log(`[anthropic-spend] TOTAL recorded = AED ${aed(total)} (${exp.rows.length} payments)`);

  const pend = await pool.query<any>(
    `SELECT COUNT(*)::int n, COALESCE(sum(amount_fils),0)::bigint s FROM bank_transactions
      WHERE status='pending' AND (source='anthropic' OR merchant ILIKE $1)`, [like]);
  console.log(`[anthropic-spend] still pending approval: ${pend.rows[0].n} rows · AED ${aed(Number(pend.rows[0].s))}`);

  await pool.query(`INSERT INTO app_kv (k,v) VALUES ($1, now()) ON CONFLICT (k) DO NOTHING`, [gk]).catch(() => {});
}
