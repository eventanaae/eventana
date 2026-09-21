/** READ-ONLY: pinpoint the gap between computed Cash on hand and the owner's real
 *  balance (141,180). Breaks the live side down fully, hunts duplicate live
 *  expenses, and shows what the opening balance would need to be. Writes nothing. */
import { pool } from './pool.js';

const REAL_CASH_FILS = 14118000; // owner's stated real balance

export async function cashReconcileFromEnv(): Promise<void> {
  if (String(process.env.RUN_MIGRATIONS_ON_BOOT ?? '').toLowerCase() !== 'true') return;
  const tag = process.env.CASH_RECON_TAG ?? 'v1';
  const gk = `cash_recon_${tag}`;
  const guard = await pool.query(`SELECT 1 FROM app_kv WHERE k=$1`, [gk]).catch(() => ({ rowCount: 0 }));
  if (guard.rowCount) return;
  const aed = (f: number) => (Number(f) / 100).toLocaleString('en-US', { minimumFractionDigits: 2 });

  const q = await pool.query<any>(`SELECT
    (SELECT value FROM settings WHERE key='finance.cashOpeningFils') op,
    (SELECT COALESCE(sum(total_fils),0)::bigint FROM finance_receipts WHERE source<>'quickbooks') rc,
    (SELECT COALESCE(sum(amount_paid_fils),0)::bigint FROM finance_invoices WHERE (source IS NULL OR source<>'quickbooks')) ip,
    (SELECT COALESCE(sum(amount_fils),0)::bigint FROM expenses WHERE source<>'quickbooks') ex,
    (SELECT COALESCE(sum(amount_fils),0)::bigint FROM refunds) rf`);
  const r = q.rows[0];
  const op = Number(r.op ?? 0);
  const cash = op + Number(r.rc) + Number(r.ip) - Number(r.ex) - Number(r.rf);
  console.log(`[cash-recon] opening ${aed(op)} + live receipts ${aed(r.rc)} + collected ${aed(r.ip)} - live expenses ${aed(r.ex)} - refunds ${aed(r.rf)} = CASH ${aed(cash)}`);
  console.log(`[cash-recon] real cash ${aed(REAL_CASH_FILS)} - computed ${aed(cash)} = GAP ${aed(REAL_CASH_FILS - cash)}`);
  console.log(`[cash-recon] opening needed for cash=real: ${aed(op + (REAL_CASH_FILS - cash))}`);

  // Live receipts (money in) detail.
  const rcpt = await pool.query<any>(`SELECT COALESCE(source,'—') s, count(*)::int n, COALESCE(sum(total_fils),0)::bigint v FROM finance_receipts WHERE source<>'quickbooks' GROUP BY source ORDER BY v DESC`);
  console.log(`[cash-recon] --- live receipts (money in) ---`);
  for (const x of rcpt.rows) console.log(`[cash-recon] in ${x.s}: ${x.n} · AED ${aed(x.v)}`);

  // Live expenses (money out) by category + source.
  const exp = await pool.query<any>(`SELECT COALESCE(category,'—') c, COALESCE(source,'—') s, count(*)::int n, COALESCE(sum(amount_fils),0)::bigint v FROM expenses WHERE source<>'quickbooks' GROUP BY category, source ORDER BY v DESC`);
  console.log(`[cash-recon] --- live expenses (money out) ---`);
  for (const x of exp.rows) console.log(`[cash-recon] out ${x.c} · ${x.s}: ${x.n} · AED ${aed(x.v)}`);

  // Duplicate live expenses (same vendor+amount+date more than once) — like the van was.
  const dup = await pool.query<any>(`SELECT COALESCE(vendor,'—') vn, amount_fils, to_char(spent_on,'YYYY-MM-DD') d, count(*)::int n
     FROM expenses WHERE source<>'quickbooks' GROUP BY vendor, amount_fils, spent_on HAVING count(*)>1 ORDER BY (count(*)-1)*amount_fils DESC LIMIT 20`);
  console.log(`[cash-recon] --- duplicate live expenses: ${dup.rows.length} ---`);
  let over = 0;
  for (const x of dup.rows) { over += (x.n - 1) * Number(x.amount_fils); console.log(`[cash-recon] DUP ${x.vn} · AED ${aed(x.amount_fils)} · ${x.d} ×${x.n}`); }
  console.log(`[cash-recon] duplicate over-count total: AED ${aed(over)}`);

  await pool.query(`INSERT INTO app_kv (k,v) VALUES ($1, now()) ON CONFLICT (k) DO NOTHING`, [gk]).catch(() => {});
}
