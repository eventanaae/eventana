/** READ-ONLY: print current Cash on hand (all money in − all money out). Guarded per
 *  tag so bumping CASH_NOW_TAG re-runs it. Writes nothing. */
import { pool } from './pool.js';

export async function cashNowFromEnv(): Promise<void> {
  if (String(process.env.RUN_MIGRATIONS_ON_BOOT ?? '').toLowerCase() !== 'true') return;
  const tag = process.env.CASH_NOW_TAG ?? 'v1';
  const gk = `cash_now_${tag}`;
  const guard = await pool.query(`SELECT 1 FROM app_kv WHERE k=$1`, [gk]).catch(() => ({ rowCount: 0 }));
  if (guard.rowCount) return;
  const aed = (f: number) => (Number(f) / 100).toLocaleString('en-US', { minimumFractionDigits: 2 });
  const q = await pool.query<any>(`SELECT
     (SELECT COALESCE(sum(total_fils),0)::bigint FROM finance_receipts) rc,
     (SELECT COALESCE(sum(amount_paid_fils),0)::bigint FROM finance_invoices) ip,
     (SELECT COALESCE(sum(amount_fils),0)::bigint FROM expenses) ex,
     (SELECT COALESCE(sum(amount_fils),0)::bigint FROM refunds) rf`);
  const r = q.rows[0];
  const cash = Number(r.rc) + Number(r.ip) - Number(r.ex) - Number(r.rf);
  console.log(`[cash-now] receipts ${aed(r.rc)} + collected ${aed(r.ip)} - expenses ${aed(r.ex)} - refunds ${aed(r.rf)} = CASH ${aed(cash)}`);
  console.log(`[cash-now] gap to real 141,180.00 = ${aed(14118000 - cash)}`);
  await pool.query(`INSERT INTO app_kv (k,v) VALUES ($1, now()) ON CONFLICT (k) DO NOTHING`, [gk]).catch(() => {});
}
