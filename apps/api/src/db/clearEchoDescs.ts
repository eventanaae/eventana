/**
 * Clear expense descriptions that merely echo an old QuickBooks category name
 * (e.g. "Cost of sales", "Commissions and fees"). They carry no real info and
 * made the Chart-of-Accounts drill-down look like it still had old accounts.
 * The account (category) itself is already correct. One-shot guarded.
 */
import { pool } from './pool.js';

const ECHO = [
  'cost of sales', 'commissions and fees', 'shipping and delivery incom', 'shipping and delivery income',
  'meals and entertainment', 'purchase', 'purchases', 'supplies', 'part timers', 'uncategorised expense',
  'uncategorized expense', 'other general and administrative expenses', 'legal and professional fees',
  'travel expenses - general and admin expenses', 'other types of expenses-advertising expenses',
  'stationery and printing', 'bank charges', 'payroll expenses', 'office expenses', 'wage expenses',
  'salary', 'other', 'other expense',
];

export async function clearEchoDescsFromEnv(): Promise<void> {
  if (String(process.env.RUN_MIGRATIONS_ON_BOOT ?? '').toLowerCase() !== 'true') return;
  const guard = await pool.query(`SELECT 1 FROM app_kv WHERE k = 'clear_echo_descs_v1'`).catch(() => ({ rowCount: 0 }));
  if (guard.rowCount) return;
  const res = await pool.query(
    `UPDATE expenses SET description = '' WHERE lower(btrim(description)) = ANY($1::text[])`,
    [ECHO],
  );
  console.log(`[echo-desc] cleared ${res.rowCount} category-echo descriptions`);
  await pool.query(`INSERT INTO app_kv (k, v) VALUES ('clear_echo_descs_v1', now()) ON CONFLICT (k) DO NOTHING`).catch(() => {});
}
