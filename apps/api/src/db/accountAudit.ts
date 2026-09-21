/** READ-ONLY: full picture of the expense accounts, to resolve concerns about
 *  Payment Fees / Wio. Lists every category (account), the full Payment Fees
 *  content, and anything mentioning "wio". Writes nothing. Guarded. */
import { pool } from './pool.js';

export async function accountAuditFromEnv(): Promise<void> {
  if (String(process.env.RUN_MIGRATIONS_ON_BOOT ?? '').toLowerCase() !== 'true') return;
  const tag = process.env.ACCT_AUDIT_TAG ?? 'v1';
  const gk = `acct_audit_${tag}`;
  const guard = await pool.query(`SELECT 1 FROM app_kv WHERE k=$1`, [gk]).catch(() => ({ rowCount: 0 }));
  if (guard.rowCount) return;
  const aed = (f: number) => (Number(f) / 100).toLocaleString('en-US', { minimumFractionDigits: 2 });

  // 1) Every expense account (category), all sources.
  const cats = await pool.query<any>(`SELECT COALESCE(category,'(none)') c, count(*)::int n, COALESCE(sum(amount_fils),0)::bigint v FROM expenses GROUP BY category ORDER BY v DESC`);
  console.log(`[acct-audit] === ${cats.rows.length} expense accounts ===`);
  for (const r of cats.rows) console.log(`[acct-audit] ACCOUNT ${r.c}: ${r.n} rows · AED ${aed(r.v)}`);

  // 2) Payment Fees — full breakdown by vendor + source.
  const pf = await pool.query<any>(`SELECT COALESCE(vendor,'(none)') vn, COALESCE(source,'—') s, count(*)::int n, COALESCE(sum(amount_fils),0)::bigint v
     FROM expenses WHERE category='Payment Fees' GROUP BY vendor, source ORDER BY v DESC`);
  console.log(`[acct-audit] === Payment Fees: ${pf.rows.length} vendor/source groups ===`);
  for (const r of pf.rows) console.log(`[acct-audit] PF ${r.vn} · ${r.s} · ${r.n} rows · AED ${aed(r.v)}`);

  // 3) Anything mentioning Wio — expenses and bank rows.
  const wioE = await pool.query<any>(`SELECT COALESCE(category,'—') c, COALESCE(vendor,'—') vn, COALESCE(source,'—') s, count(*)::int n, COALESCE(sum(amount_fils),0)::bigint v
     FROM expenses WHERE vendor ILIKE '%wio%' OR description ILIKE '%wio%' OR category ILIKE '%wio%' GROUP BY category, vendor, source ORDER BY v DESC`);
  console.log(`[acct-audit] === Wio in expenses: ${wioE.rows.length} groups ===`);
  for (const r of wioE.rows) console.log(`[acct-audit] WIO-exp ${r.c} / ${r.vn} · ${r.s} · ${r.n} rows · AED ${aed(r.v)}`);
  const wioB = await pool.query<any>(`SELECT status, count(*)::int n, COALESCE(sum(amount_fils),0)::bigint v FROM bank_transactions WHERE source ILIKE '%wio%' OR merchant ILIKE '%wio%' OR raw_text ILIKE '%wio%' GROUP BY status`);
  console.log(`[acct-audit] === Wio in bank_transactions: ${wioB.rows.length} groups ===`);
  for (const r of wioB.rows) console.log(`[acct-audit] WIO-bank ${r.status} · ${r.n} rows · AED ${aed(r.v)}`);

  await pool.query(`INSERT INTO app_kv (k,v) VALUES ($1, now()) ON CONFLICT (k) DO NOTHING`, [gk]).catch(() => {});
}
