/**
 * Auto-sync Stripe processing fees into the books, so nobody records them by hand.
 *
 * Runs from the periodic reconcile sweep (throttled to at most once / 12h). Each run
 * pulls Stripe balance transactions from the API, aggregates the `fee` by month, and
 * rewrites the monthly "Stripe fees — YYYY-MM" expenses under the Payments/Bank fees
 * account (vendor Stripe). It's a full re-sync (Stripe volume is small), so it is
 * self-healing: past months stay correct and the current month updates as fees settle.
 * No-op when Stripe isn't configured, and it never mutates if the API call fails.
 */
import { pool } from '../db/pool.js';
import { config } from '../config.js';

const ACCOUNT = 'Payments/Bank fees';
const THROTTLE_MS = 12 * 60 * 60 * 1000;

export async function syncStripeFees(): Promise<void> {
  const sk = config.providers.stripe.secretKey;
  if (!sk) return;

  // Throttle: at most once per 12h.
  const last = await pool.query<{ v: string }>(`SELECT v FROM app_kv WHERE k = 'stripe_fee_sync_at'`).catch(() => ({ rows: [] as any[] }));
  if (last.rows[0] && Date.now() - new Date(last.rows[0].v).getTime() < THROTTLE_MS) return;

  // Pull all balance transactions and aggregate fee by month.
  const feeByMonth: Record<string, number> = {};
  const dateByMonth: Record<string, string> = {};
  let startingAfter: string | undefined;
  try {
    for (let page = 0; page < 200; page++) {
      const qs = new URLSearchParams({ limit: '100' });
      if (startingAfter) qs.set('starting_after', startingAfter);
      const res = await fetch(`https://api.stripe.com/v1/balance_transactions?${qs}`, { headers: { Authorization: `Bearer ${sk}` } });
      if (!res.ok) { console.error(`[stripe-sync] API ${res.status} — skipping this run`); return; }
      const j: any = await res.json();
      for (const t of j.data ?? []) {
        const fee = Number(t.fee || 0);
        startingAfter = t.id;
        if (!fee) continue;
        const iso = new Date(Number(t.created) * 1000).toISOString().slice(0, 10);
        const m = iso.slice(0, 7);
        feeByMonth[m] = (feeByMonth[m] || 0) + fee;
        if (!dateByMonth[m] || iso > dateByMonth[m]) dateByMonth[m] = iso; // last fee date in the month
      }
      if (!j.has_more) break;
    }
  } catch (e) {
    console.error('[stripe-sync] fetch failed — skipping:', (e as Error).message);
    return;
  }

  const months = Object.keys(feeByMonth);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`DELETE FROM expenses WHERE vendor = 'Stripe' AND category = $1`, [ACCOUNT]);
    let total = 0;
    for (const m of months) {
      const fils = Math.round(feeByMonth[m]);
      total += fils;
      await client.query(
        `INSERT INTO expenses (category, description, amount_fils, vendor, spent_on, payment_method, source)
         VALUES ($1, $2, $3, 'Stripe', $4::date, 'card', 'stripe')`,
        [ACCOUNT, `Stripe fees — ${m} (auto)`, fils, dateByMonth[m]],
      );
    }
    await client.query(
      `INSERT INTO app_kv (k, v) VALUES ('stripe_fee_sync_at', now()) ON CONFLICT (k) DO UPDATE SET v = now()`,
    );
    await client.query('COMMIT');
    console.log(`[stripe-sync] synced ${months.length} month(s) of Stripe fees = AED ${(total / 100).toFixed(2)}`);
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[stripe-sync] write failed, rolled back:', (e as Error).message);
  } finally {
    client.release();
  }
}
