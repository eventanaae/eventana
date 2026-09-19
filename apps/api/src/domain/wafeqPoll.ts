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
import { ingestExternalTxn } from './bankInbox.js';
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
    hours: Math.max(1, Number(process.env.WAFEQ_POLL_HOURS ?? 3)),
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
    headers: { Authorization: `Api-Key ${key}`, Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`Wafeq ${path} → HTTP ${res.status}`);
  return res.json();
}

interface BankAccount { id: string; name: string; sub_classification?: string; currency?: string; }
interface StatementTxn { id: string; amount: number | string; date: string; description?: string; bank_reference?: string; reference?: string; }

// Log the account list + a sample transaction shape on the first cycle after
// boot (or whenever WAFEQ_DEBUG=true), so the field mapping can be verified.
let firstCycle = true;

/** One poll cycle: pull recent Wio (Wafeq) transactions into the pending queue. */
async function pollOnce(): Promise<{ scanned: number; ingested: number }> {
  const c = cfg();
  if (!c) return { scanned: 0, ingested: 0 };
  const verbose = c.debug || firstCycle;
  const cutoff = c.since ?? dubaiDaysAgo(7); // only recent txns, unless backfilling

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
      if (verbose && page === 1) console.log(`[wafeq] ${acc.name} sample: ${JSON.stringify(rows[0] ?? null)}`);
      if (rows.length === 0) break;

      let allOld = true;
      for (const t of rows) {
        scanned++;
        const date = String(t.date ?? '').slice(0, 10);
        if (!date || date < cutoff) continue; // outside our window
        allOld = false;
        const amt = Number(t.amount);
        if (!Number.isFinite(amt) || amt === 0) continue;
        const amountFils = Math.round(Math.abs(amt) * 100);
        const direction: 'debit' | 'credit' = amt < 0 ? 'debit' : 'credit';
        const merchant = (t.description || acc.name || 'Wio transaction').toString();
        const raw = [t.description, t.reference].filter(Boolean).join(' · ');
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

  firstCycle = false;

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
      if (r.ingested > 0 || c.debug) console.log(`[wafeq] cycle: scanned ${r.scanned}, ingested ${r.ingested}`);
    } catch (err) {
      console.error('[wafeq] cycle failed:', err instanceof Error ? err.message : err);
    } finally {
      running = false;
    }
  };
  console.log(`[wafeq] enabled — pulling Wio transactions every ${c.hours}h (since ${c.since ?? 'last 7 days'})`);
  setTimeout(tick, 15_000); // first run shortly after boot
  timer = setInterval(tick, intervalMs);
}

export function stopWafeqPolling(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
