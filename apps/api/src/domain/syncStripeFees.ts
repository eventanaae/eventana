/**
 * Auto-detect Stripe processing fees and drop them into the Bank Inbox APPROVAL
 * queue (not straight into expenses) — the owner approves each with one tap, like
 * every other bank item. Runs from the periodic reconcile sweep (throttled to once
 * / 12h). Pulls Stripe balance transactions, aggregates the `fee` per month, and
 * creates one pending bank_transaction per COMPLETED month (deduped by month, so it
 * never doubles). The current, still-accruing month is left until it closes.
 * No-op when Stripe isn't configured or the API call fails.
 */
import { pool } from '../db/pool.js';
import { config } from '../config.js';
import { ingestExternalTxn } from './bankInbox.js';

const THROTTLE_MS = 12 * 60 * 60 * 1000;

export async function syncStripeFees(): Promise<void> {
  const sk = config.providers.stripe.secretKey;
  if (!sk) return;

  const last = await pool.query<{ v: string }>(`SELECT v FROM app_kv WHERE k = 'stripe_fee_sync_at'`).catch(() => ({ rows: [] as any[] }));
  if (last.rows[0] && Date.now() - new Date(last.rows[0].v).getTime() < THROTTLE_MS) return;

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
        if (!dateByMonth[m] || iso > dateByMonth[m]) dateByMonth[m] = iso;
      }
      if (!j.has_more) break;
    }
  } catch (e) {
    console.error('[stripe-sync] fetch failed — skipping:', (e as Error).message);
    return;
  }

  // One-time: remove any Stripe fees that were posted straight to expenses before
  // this became approval-gated, so they re-flow through the Bank Inbox for approval.
  const cleared = await pool.query(`SELECT 1 FROM app_kv WHERE k = 'stripe_fees_to_pending_v1'`).catch(() => ({ rowCount: 0 }));
  if (!cleared.rowCount) {
    await pool.query(`DELETE FROM expenses WHERE vendor = 'Stripe' AND category = 'Payments/Bank fees'`).catch(() => {});
    await pool.query(`INSERT INTO app_kv (k, v) VALUES ('stripe_fees_to_pending_v1', now()) ON CONFLICT (k) DO NOTHING`).catch(() => {});
  }

  const curMonth = new Date(Date.now() + 4 * 3_600_000).toISOString().slice(0, 7); // Dubai current month
  let pended = 0;
  for (const m of Object.keys(feeByMonth)) {
    if (m >= curMonth) continue; // only finalized months
    const fils = Math.round(feeByMonth[m]);
    if (fils <= 0) continue;
    const res = await ingestExternalTxn({
      amountFils: fils, direction: 'debit', kind: 'purchase', merchant: 'Stripe',
      postedOn: dateByMonth[m], raw: `Stripe fees — ${m} (auto from Stripe API)`,
      source: 'stripe', dedupeKey: `stripe-fee-${m}`,
    }).catch(() => null);
    if (res && !res.duplicate) pended++;
  }
  await pool.query(`INSERT INTO app_kv (k, v) VALUES ('stripe_fee_sync_at', now()) ON CONFLICT (k) DO UPDATE SET v = now()`);
  if (pended) console.log(`[stripe-sync] queued ${pended} month(s) of Stripe fees for approval in Bank Inbox`);
}
