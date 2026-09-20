/**
 * Comb pass after the mapping apply: (1) log every expense still on an off-chart
 * (old) category with its vendor/amount/description, (2) canonicalise the safe
 * old labels to the clean chart, (3) leave genuinely-unknown as Uncategorised and
 * log the big ones for the owner. Backed up already by the apply. Runs once.
 */
import { pool } from './pool.js';

const CLEAN = new Set([
  'Supplies/Purchase','Shipping and Delivery','Stationery and Printing','Meals and Entertainment',
  'Repairs and Maintenance','Fabric','Flowers','Balloons','Equipment','Furniture Rent','Advertising',
  'Salaries','Part Timers','Payments/Bank fees','Dues and Subscriptions','Administration Expense',
  'Insurance','Cost of sales','Forex','Assets','Cake Supply','Plush Account','Uncategorised',
]);
const OLD2NEW: [string, string][] = [
  ['purchase', 'Supplies/Purchase'],
  ['supplies', 'Supplies/Purchase'],
  ['meals and entertainment', 'Meals and Entertainment'],
  ['plush', 'Plush Account'],
  ['shipping and delivery incom', 'Shipping and Delivery'],
  ['travel expenses - general and admin expenses', 'Administration Expense'],
  ['other general and administrative expenses', 'Administration Expense'],
  ['legal and professional fees', 'Administration Expense'],
];

export async function combLeftoverFromEnv(): Promise<void> {
  if (String(process.env.RUN_MIGRATIONS_ON_BOOT ?? '').toLowerCase() !== 'true') return;
  const guard = await pool.query(`SELECT 1 FROM app_kv WHERE k = 'comb_leftover_v1'`).catch(() => ({ rowCount: 0 }));
  if (guard.rowCount) return;

  // 1) log off-chart rows
  const off = await pool.query<{ id: string; vendor: string; aed: number; category: string; description: string; spent_on: string }>(
    `SELECT id, COALESCE(vendor,'(blank)') vendor, round(amount_fils/100.0)::int aed, category,
            COALESCE(description,'') description, to_char(spent_on,'YYYY-MM-DD') spent_on
       FROM expenses
      WHERE category <> ALL($1::text[])
      ORDER BY amount_fils DESC`,
    [Array.from(CLEAN)],
  );
  console.log(`[comb] off-chart rows: ${off.rows.length}`);
  for (const r of off.rows.slice(0, 40))
    console.log(`[comb] #${r.id} | ${r.spent_on} | AED ${r.aed} | cat="${r.category}" | vend="${r.vendor}" | "${r.description.slice(0,50)}"`);

  // 2) canonicalise safe old labels
  let fixed = 0;
  for (const [oldc, newc] of OLD2NEW) {
    const res = await pool.query(`UPDATE expenses SET category = $2 WHERE lower(btrim(category)) = $1`, [oldc, newc]);
    fixed += res.rowCount ?? 0;
  }
  console.log(`[comb] canonicalised ${fixed} rows to clean chart`);

  // 3) remaining off-chart (should be only genuine Uncategorised now)
  const rem = await pool.query<{ category: string; n: number; aed: number }>(
    `SELECT category, count(*)::int n, round(sum(amount_fils)/100.0)::int aed
       FROM expenses WHERE category <> ALL($1::text[]) GROUP BY category ORDER BY sum(amount_fils) DESC`,
    [Array.from(CLEAN)],
  );
  console.log('[comb] ── remaining off-chart after fix ──');
  for (const r of rem.rows) console.log(`[comb] "${r.category}" ${r.n} · AED ${r.aed}`);

  // big uncategorised rows detail
  const big = await pool.query<{ id: string; vendor: string; aed: number; description: string; spent_on: string }>(
    `SELECT id, COALESCE(vendor_bk,vendor,'(blank)') vendor, round(amount_fils/100.0)::int aed,
            COALESCE(description,'') description, to_char(spent_on,'YYYY-MM-DD') spent_on
       FROM expenses WHERE lower(btrim(category)) LIKE 'uncategor%' ORDER BY amount_fils DESC LIMIT 15`,
  );
  console.log('[comb] ── uncategorised detail (orig vendor) ──');
  for (const r of big.rows) console.log(`[comb] #${r.id} | ${r.spent_on} | AED ${r.aed} | vend="${r.vendor}" | "${r.description.slice(0,60)}"`);

  await pool.query(`INSERT INTO app_kv (k, v) VALUES ('comb_leftover_v1', now()) ON CONFLICT (k) DO NOTHING`).catch(() => {});
  console.log('[comb] DONE');
}
