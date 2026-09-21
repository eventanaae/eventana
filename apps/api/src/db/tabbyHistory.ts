/** Debug: after clearing Tabby expenses, find the earliest Tabby record and whether
 *  the deleted rows can be recovered from the imported source (historical_orders).
 *  Guarded; read via logs. */
import { pool } from './pool.js';

export async function tabbyHistoryFromEnv(): Promise<void> {
  if (String(process.env.RUN_MIGRATIONS_ON_BOOT ?? '').toLowerCase() !== 'true') return;
  const tag = process.env.TABBY_HISTORY_TAG ?? 'v1';
  const gk = `tabby_history_${tag}`;
  const guard = await pool.query(`SELECT 1 FROM app_kv WHERE k=$1`, [gk]).catch(() => ({ rowCount: 0 }));
  if (guard.rowCount) return;
  const aed = (f: number) => (Number(f) / 100).toFixed(2);

  // Any Tabby left in expenses now (should be 0 after clear).
  const exp = await pool.query<any>(
    `SELECT count(*)::int n, to_char(min(spent_on),'YYYY-MM-DD') mn, to_char(max(spent_on),'YYYY-MM-DD') mx,
            COALESCE(sum(amount_fils),0)::bigint s FROM expenses WHERE vendor ILIKE '%tabby%'`);
  console.log(`[tabby-history] expenses now: ${exp.rows[0].n} rows · ${exp.rows[0].mn ?? '—'} → ${exp.rows[0].mx ?? '—'} · AED ${aed(exp.rows[0].s)}`);

  // Source import (historical_orders) — can we recover, and what's the earliest date?
  const hist = await pool.query<any>(
    `SELECT count(*)::int n, to_char(min(txn_date),'YYYY-MM-DD') mn, to_char(max(txn_date),'YYYY-MM-DD') mx,
            COALESCE(sum(total_fils),0)::bigint s
       FROM historical_orders
      WHERE vendor ILIKE '%tabby%' OR product ILIKE '%tabby%' OR memo ILIKE '%tabby%'`);
  console.log(`[tabby-history] historical_orders (import source): ${hist.rows[0].n} rows · earliest ${hist.rows[0].mn ?? '—'} → ${hist.rows[0].mx ?? '—'} · AED ${aed(hist.rows[0].s)}`);

  // Per-year breakdown from the source, to see the span.
  const byYear = await pool.query<any>(
    `SELECT to_char(txn_date,'YYYY') y, count(*)::int n, COALESCE(sum(total_fils),0)::bigint s
       FROM historical_orders WHERE vendor ILIKE '%tabby%' OR product ILIKE '%tabby%' OR memo ILIKE '%tabby%'
      GROUP BY 1 ORDER BY 1`);
  for (const r of byYear.rows) console.log(`[tabby-history] source ${r.y}: ${r.n} rows · AED ${aed(r.s)}`);

  await pool.query(`INSERT INTO app_kv (k,v) VALUES ($1, now()) ON CONFLICT (k) DO NOTHING`, [gk]).catch(() => {});
}
