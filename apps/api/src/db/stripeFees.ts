/** READ-ONLY: if Stripe is configured, pull all balance transactions from Stripe's
 *  API and sum the fees (total + by month). No writes to Stripe or the DB (only the
 *  guard key). Lets us record Stripe fees without an export from the owner. */
import { pool } from './pool.js';
import { config } from '../config.js';

export async function stripeFeesFromEnv(): Promise<void> {
  if (String(process.env.RUN_MIGRATIONS_ON_BOOT ?? '').toLowerCase() !== 'true') return;
  const tag = process.env.STRIPE_FEES_TAG ?? 'v1';
  const gk = `stripe_fees_${tag}`;
  const guard = await pool.query(`SELECT 1 FROM app_kv WHERE k=$1`, [gk]).catch(() => ({ rowCount: 0 }));
  if (guard.rowCount) return;

  const sk = config.providers.stripe.secretKey;
  if (!sk) { console.log('[stripe-fees] STRIPE_SECRET_KEY not set — no access; owner must export from Stripe.'); return; }
  console.log(`[stripe-fees] Stripe key present (${sk.slice(0, 7)}…) — pulling balance transactions…`);

  const byMonth: Record<string, number> = {};
  let totalFee = 0, count = 0, feeCount = 0, startingAfter: string | undefined;
  try {
    for (let page = 0; page < 200; page++) {
      const qs = new URLSearchParams({ limit: '100' });
      if (startingAfter) qs.set('starting_after', startingAfter);
      const res = await fetch(`https://api.stripe.com/v1/balance_transactions?${qs}`, {
        headers: { Authorization: `Bearer ${sk}` },
      });
      if (!res.ok) { console.error(`[stripe-fees] API ${res.status}: ${(await res.text()).slice(0, 200)}`); return; }
      const j: any = await res.json();
      for (const t of j.data ?? []) {
        count++;
        const fee = Number(t.fee || 0);
        if (fee) {
          feeCount++; totalFee += fee;
          const m = new Date(Number(t.created) * 1000).toISOString().slice(0, 7);
          byMonth[m] = (byMonth[m] || 0) + fee;
        }
        startingAfter = t.id;
      }
      if (!j.has_more) break;
    }
  } catch (e) {
    console.error('[stripe-fees] fetch failed:', (e as Error).message); return;
  }
  const aed = (f: number) => (f / 100).toLocaleString('en-US', { minimumFractionDigits: 2 });
  console.log(`[stripe-fees] scanned ${count} balance txns, ${feeCount} with fees. TOTAL FEES = AED ${aed(totalFee)}`);
  for (const m of Object.keys(byMonth).sort()) console.log(`[stripe-fees] ${m}: AED ${aed(byMonth[m])}`);
  await pool.query(`INSERT INTO app_kv (k,v) VALUES ($1, now()) ON CONFLICT (k) DO NOTHING`, [gk]).catch(() => {});
}
