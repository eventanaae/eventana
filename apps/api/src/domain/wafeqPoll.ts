/**
 * Wio bank feed → Eventana, via Wafeq's Open API.
 *
 * Wio doesn't expose a public API to custom apps; its only self-serve automatic
 * feed is through a certified partner (Wafeq) using OTP. So the owner connects
 * Wio inside Wafeq (transactions sync automatically), and we pull them out of
 * Wafeq here and drop each into the "Expenses needing approval" queue.
 *
 * Fully automatic: every few hours we list the connected bank accounts, read
 * their recent ledger transactions, and ingest new ones as PENDING rows (nothing
 * posts to expenses until the owner/Marsha approves). De-duped by Wafeq's own
 * transaction id, so re-polling never double-records.
 *
 * Enable by setting in Render (API service):
 *   WAFEQ_API_KEY=<the Wafeq API key>     (required — the only thing needed)
 *   WAFEQ_POLL=false                        (optional kill switch)
 *   WAFEQ_POLL_HOURS=3                       (optional; default 3)
 *   WAFEQ_SINCE=YYYY-MM-DD                   (optional; backfill from this date)
 *   WAFEQ_DEBUG=true                         (optional; log raw shapes once)
 */
import { ingestExternalTxn, noteFeedSuccess, checkFeedStale } from './bankInbox.js';
import { pool } from '../db/pool.js';
import { pushToOwner } from '../integrations/push.js';

const BASE = 'https://api.wafeq.com/v1';

interface WafeqCfg { key: string; hours: number; since: string | null; debug: boolean; }

function cfg(): WafeqCfg | null {
  const key = process.env.WAFEQ_API_KEY ?? '';
  if (!key) return null;
  if (String(process.env.WAFEQ_POLL ?? '').toLowerCase() === 'false') return null;
  return {
    key: key.trim(),
    hours: Math.max(1, Number(process.env.WAFEQ_POLL_HOURS ?? 1)),
    since: process.env.WAFEQ_SINCE ? String(process.env.WAFEQ_SINCE).slice(0, 10) : null,
    debug: String(process.env.WAFEQ_DEBUG ?? '').toLowerCase() === 'true',
  };
}

/** Dubai "today" as YYYY-MM-DD. */
function dubaiToday(): string {
  return new Date(Date.now() + 4 * 3_600_000).toISOString().slice(0, 10);
}
/** YYYY-MM-DD `days` before Dubai today. */
function dubaiDaysAgo(days: number): string {
  return new Date(Date.now() + 4 * 3_600_000 - days * 86_400_000).toISOString().slice(0, 10);
}

async function wafeqGet(path: string, key: string): Promise<any> {
  const res = await fetch(`${BASE}${path}`, {
    signal: AbortSignal.timeout(15000),
    headers: { Authorization: `Api-Key ${key}`, Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`Wafeq ${path} → HTTP ${res.status}`);
  return res.json();
}

interface BankAccount { id: string; name: string; sub_classification?: string; currency?: string; }
interface StatementTxn { id: string; amount: number | string; date: string; description?: string; bank_reference?: string; reference?: string; category?: string; }

/**
 * A transfer between our OWN accounts (e.g. Wio → RAKBANK top-up) is not a spend
 * — the money just moves to another of our accounts. Same rule the Zoho sync
 * applies to 'transfer_fund': never queue it as an expense (it would wrongly cut
 * Cash on hand). Detected by transfer wording in the description/category that
 * names RAKBANK, another of our connected accounts, or an own-account transfer.
 */
function isOwnAccountTransfer(t: StatementTxn, self: BankAccount, accounts: BankAccount[]): boolean {
  const hay = `${t.description ?? ''} ${t.category ?? ''} ${t.reference ?? ''}`.toLowerCase();
  if (!/transfer/.test(hay)) return false;
  if (/rak\s?bank|own account|between (?:own |my |our )?accounts|internal transfer|self transfer/.test(hay)) return true;
  return accounts.some((a) => {
    if (a.id === self.id) return false;
    const name = String(a.name ?? '').toLowerCase().trim();
    return name.length >= 4 && hay.includes(name);
  });
}

/** One poll cycle: pull recent Wio (Wafeq) transactions into the pending queue. */
async function pollOnce(): Promise<{ scanned: number; ingested: number }> {
  const c = cfg();
  if (!c) return { scanned: 0, ingested: 0 };
  const verbose = c.debug; // set WAFEQ_DEBUG=true to trace shapes again
  // 30-day window (not 7): Wafeq/Wio can sync late (re-auth, outages), and a
  // line older than the window would be skipped forever. Re-scanning is free —
  // dedupe_key `wafeq|<id>` (UNIQUE) blocks any re-insert, even of ignored rows.
  const cutoff = c.since ?? dubaiDaysAgo(30);

  // 1) List connected bank accounts.
  const accRes = await wafeqGet('/bank-accounts/?page_size=100', c.key);
  const accounts: BankAccount[] = accRes?.results ?? [];
  if (verbose) console.log(`[wafeq] accounts: ${JSON.stringify(accounts.map((a) => ({ id: a.id, name: a.name, sub: a.sub_classification })))}`);

  let scanned = 0;
  let ingested = 0;

  for (const acc of accounts) {
    // 2) Page through this account's statement transactions (the bank feed).
    for (let page = 1; page <= 20; page++) {
      const data = await wafeqGet(`/bank-accounts/${encodeURIComponent(acc.id)}/statement-transactions/?page=${page}&page_size=100`, c.key);
      const rows: StatementTxn[] = data?.results ?? [];
      if (verbose) console.log(`[wafeq] ${acc.name} p${page}: count=${data?.count ?? '?'} got=${rows.length} :: ${JSON.stringify(rows.slice(0, 25).map((x) => `${x.date}|${x.amount}|${String(x.description ?? '').slice(0, 45)}`))}`);
      if (rows.length === 0) break;

      let allOld = true;
      for (const t of rows) {
        scanned++;
        const date = String(t.date ?? '').slice(0, 10);
        if (!date || date < cutoff) continue; // outside our window
        allOld = false;
        const amt = Number(t.amount);
        // Only money OUT is an expense. Skip credits (incoming money / transfers)
        // — they aren't expenses and shouldn't sit in the approval queue.
        if (!Number.isFinite(amt) || amt >= 0) continue;
        if (isOwnAccountTransfer(t, acc, accounts)) {
          if (verbose) console.log(`[wafeq] skipped own-account transfer ${t.id}: ${String(t.description ?? '').slice(0, 60)}`);
          continue;
        }
        // Honour the account's currency: AED 1:1, USD at the fixed peg; any other
        // currency is NOT booked at rate 1 — amount 0, flagged for review.
        const cur = String(acc.currency ?? 'AED').trim().toUpperCase() || 'AED';
        const rate = cur === 'AED' ? 1 : cur === 'USD' ? 3.6725 : null;
        const amountFils = rate != null ? Math.round(Math.abs(amt) * rate * 100) : 0;
        const direction: 'debit' | 'credit' = 'debit';
        const merchant = (t.description || acc.name || 'Wio transaction').toString();
        const fxNote = cur === 'AED' ? null
          : rate != null ? `${cur} ${Math.abs(amt).toFixed(2)} → AED ${(amountFils / 100).toFixed(2)} (converted at ${rate})`
          : `⚠️ NEEDS REVIEW — amount is ${cur} ${Math.abs(amt).toFixed(2)}; convert it to AED and set the amount before approving.`;
        const raw = [fxNote, t.description, t.reference].filter(Boolean).join(' · ');
        const res = await ingestExternalTxn({
          amountFils,
          direction,
          kind: direction === 'debit' ? 'purchase' : 'other',
          merchant,
          postedOn: date,
          raw: raw || merchant,
          source: 'wio',
          dedupeKey: `wafeq|${t.id}`,
        });
        if (!res.duplicate) ingested++;
      }
      // If a full page fell outside the window, older pages will too — stop.
      if (allOld) break;
      if (!data?.next) break;
    }
  }

  if (ingested > 0) {
    const targets = await pool.query<{ id: string }>(
      `SELECT id FROM team_members WHERE active AND (lower(name) = 'marsha' OR access_level = 'owner')`,
    );
    const title = '🏦 New Wio transactions — needs review';
    const body = `${ingested} new transaction${ingested === 1 ? '' : 's'} from your Wio account. Open Expenses to review and approve.`;
    for (const t of targets.rows) {
      await pushToOwner('staff', t.id, title, body, {}).catch(() => {});
    }
  }
  return { scanned, ingested };
}

let running = false;
let timer: NodeJS.Timeout | null = null;

export function startWafeqPolling(): void {
  const c = cfg();
  if (!c) return;
  const intervalMs = c.hours * 3_600_000;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const r = await pollOnce();
      await noteFeedSuccess('wafeq');
      if (r.ingested > 0 || c.debug) console.log(`[wafeq] cycle: scanned ${r.scanned}, ingested ${r.ingested}`);
    } catch (err) {
      console.error('[wafeq] cycle failed:', err instanceof Error ? err.message : err);
    } finally {
      await checkFeedStale('wafeq', 'The Wio (Wafeq) bank feed');
      running = false;
    }
  };
  console.log(`[wafeq] enabled — pulling Wio transactions every ${c.hours}h (since ${c.since ?? 'last 30 days'})`);
  setTimeout(tick, 15_000); // first run shortly after boot
  timer = setInterval(tick, intervalMs);
}

export function stopWafeqPolling(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
