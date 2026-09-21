/** READ-ONLY: how far are QuickBooks (Intuit) subscription receipts recorded, and is
 *  there API access? Lists recorded QB-subscription expenses (dates, gaps), any
 *  QB/Intuit receipts sitting in the bank inbox, and the QB connection status.
 *  Writes nothing. Guarded. */
import { pool } from './pool.js';

export async function qbSubAuditFromEnv(): Promise<void> {
  if (String(process.env.RUN_MIGRATIONS_ON_BOOT ?? '').toLowerCase() !== 'true') return;
  const tag = process.env.QB_SUB_AUDIT_TAG ?? 'v1';
  const gk = `qb_sub_audit_${tag}`;
  const guard = await pool.query(`SELECT 1 FROM app_kv WHERE k=$1`, [gk]).catch(() => ({ rowCount: 0 }));
  if (guard.rowCount) return;
  const aed = (f: number) => (Number(f) / 100).toFixed(2);
  const like = `%quickbook%`, like2 = `%intuit%`;

  // Recorded QB-subscription expenses.
  const exp = await pool.query<any>(
    `SELECT to_char(spent_on,'YYYY-MM-DD') d, category, COALESCE(vendor,'—') v, amount_fils, COALESCE(source,'—') s
       FROM expenses WHERE vendor ILIKE $1 OR vendor ILIKE $2 OR description ILIKE $1 OR description ILIKE $2
      ORDER BY spent_on`, [like, like2]);
  let tot = 0;
  console.log(`[qb-sub] recorded QuickBooks/Intuit expenses: ${exp.rows.length}`);
  for (const r of exp.rows) { tot += Number(r.amount_fils); console.log(`[qb-sub]   ${r.d} | ${r.category} | ${r.v} | AED ${aed(r.amount_fils)} | ${r.s}`); }
  if (exp.rows.length) console.log(`[qb-sub] range ${exp.rows[0].d} → ${exp.rows[exp.rows.length-1].d} · total AED ${aed(tot)}`);

  // Any QB/Intuit receipts captured in the bank inbox (forwarded like Anthropic).
  const bank = await pool.query<any>(
    `SELECT status, count(*)::int n, COALESCE(sum(amount_fils),0)::bigint v FROM bank_transactions
      WHERE merchant ILIKE $1 OR merchant ILIKE $2 OR raw_text ILIKE $1 OR raw_text ILIKE $2 GROUP BY status`, [like, like2]);
  console.log(`[qb-sub] QB/Intuit in bank inbox: ${bank.rows.length} status group(s)`);
  for (const r of bank.rows) console.log(`[qb-sub]   bank ${r.status} · ${r.n} rows · AED ${aed(Number(r.v))}`);

  // Do we have QuickBooks API access?
  const conn = await pool.query<any>(`SELECT * FROM quickbooks_connection LIMIT 1`).catch(() => ({ rows: [] as any[] }));
  if (!conn.rows.length) console.log('[qb-sub] QuickBooks API: NO connection row — not connected (no live access).');
  else {
    const c = conn.rows[0];
    console.log(`[qb-sub] QuickBooks connection row present: realm=${c.realm_id ?? c.realmId ?? '—'} has_token=${!!(c.access_token ?? c.accessToken)} updated=${c.updated_at ?? '—'}`);
  }

  await pool.query(`INSERT INTO app_kv (k,v) VALUES ($1, now()) ON CONFLICT (k) DO NOTHING`, [gk]).catch(() => {});
}
