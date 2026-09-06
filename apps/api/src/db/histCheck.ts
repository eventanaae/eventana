/**
 * Verify the "past QuickBooks celebrations" join works: given a customer email,
 * log how many historical orders it matches (the same email-anchored query the
 * profile uses). Gated by HIST_CHECK=<email>[,<email>...]. Read-only.
 */
import { pool } from './pool.js';

const P = (s: string) => console.log(`[hist-check] ${s}`);

export async function histCheckFromEnv(): Promise<void> {
  const raw = String(process.env.HIST_CHECK ?? '').trim();
  if (!raw) return;
  for (const email of raw.split(',').map((s) => s.trim()).filter(Boolean)) {
    try {
      const h = await pool.query(
        `SELECT to_char(ho.txn_date,'YYYY-MM-DD') AS d, ho.product, ho.total_fils
           FROM historical_customers hc
           JOIN historical_orders ho ON lower(btrim(ho.customer_name)) = lower(btrim(hc.full_name))
          WHERE lower(hc.email) = lower($1)
            AND ho.txn_type IN ('Invoice', 'Sales Receipt')
            AND ho.total_fils > 0
          ORDER BY ho.txn_date DESC NULLS LAST LIMIT 8`,
        [email],
      );
      P(`${email}: ${h.rowCount} past order(s)`);
      for (const r of h.rows) P(`   ${r.d} · ${r.product ?? '—'} · ${Number(r.total_fils) / 100} AED`);
    } catch (e) {
      P(`${email} failed: ${(e as Error).message}`);
    }
  }
  P('DONE');
}
