/**
 * Zoho Books → Bank Inbox bridge.
 *
 * Eventana's RAKBANK + Wio accounts are connected to Zoho Books (RAKBANK via
 * Yodlee, Wio as a direct partner feed). Zoho pulls every real bank movement
 * automatically — including charges that never trigger an SMS — and, unlike
 * QuickBooks, its API returns even the uncategorized feed lines. This job reads
 * those transactions on a schedule and drops each money-OUT (debit) into our
 * Bank Inbox as a PENDING row the owner approves with one tap (source='zoho'),
 * exactly like the Stripe fee sync.
 *
 * Only debits are queued: credits (customer money in) are already captured as
 * receipts/invoices, so queuing them would double-count income.
 *
 * Deduped by Zoho's transaction_id, so re-polling never doubles. Throttled to
 * every ~6h. No-op when Zoho isn't configured or a call fails — never throws
 * into the reconcile sweep.
 */
import { pool } from '../db/pool.js';
import { config } from '../config.js';
import { ingestExternalTxn, type ParsedAlert } from './bankInbox.js';
import { pushToOwner } from '../integrations/push.js';

const THROTTLE_MS = 6 * 60 * 60 * 1000;
// Feed history to consider. Yodlee/partner feeds rarely bring more than ~90
// days anyway; the watermark keeps steady-state runs cheap.
const FIRST_RUN_LOOKBACK_DAYS = 100;
const OVERLAP_DAYS = 3; // re-scan a few days each run so nothing slips the cutoff

/** Dubai "today" as YYYY-MM-DD. */
function dubaiToday(): string {
  return new Date(Date.now() + 4 * 3_600_000).toISOString().slice(0, 10);
}
function daysAgo(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

// Access token cached in memory for its lifetime (~1h), refreshed on demand.
let cachedToken: { token: string; exp: number } | null = null;

/** Refresh token from the env, else the one the bootstrap task stored in app_kv. */
async function refreshTokenValue(): Promise<string | null> {
  if (config.zoho.refreshToken) return config.zoho.refreshToken;
  const r = await pool.query<{ v: string }>(`SELECT v FROM app_secrets WHERE k = 'zoho_refresh_token'`).catch(() => ({ rows: [] as any[] }));
  return r.rows[0]?.v ?? null;
}

async function accessToken(): Promise<string | null> {
  const z = config.zoho;
  if (!z.clientId || !z.clientSecret) return null;
  const refreshToken = await refreshTokenValue();
  if (!refreshToken) return null;
  if (cachedToken && Date.now() < cachedToken.exp) return cachedToken.token;
  const qs = new URLSearchParams({
    refresh_token: refreshToken,
    client_id: z.clientId,
    client_secret: z.clientSecret,
    grant_type: 'refresh_token',
  });
  const res = await fetch(`https://${z.accountsHost}/oauth/v2/token?${qs}`, { method: 'POST' }).catch(() => null);
  if (!res || !res.ok) { console.error(`[zoho-sync] token request failed: ${res?.status ?? 'network'}`); return null; }
  const j: any = await res.json().catch(() => null);
  if (!j?.access_token) { console.error('[zoho-sync] no access_token in response:', j?.error ?? 'unknown'); return null; }
  cachedToken = { token: j.access_token, exp: Date.now() + (Number(j.expires_in ?? 3600) - 120) * 1000 };
  return cachedToken.token;
}

async function zohoGet(path: string, token: string): Promise<any | null> {
  const z = config.zoho;
  const sep = path.includes('?') ? '&' : '?';
  const url = `https://${z.apiHost}/books/v3/${path}${sep}organization_id=${encodeURIComponent(z.organizationId ?? '')}`;
  const res = await fetch(url, { headers: { Authorization: `Zoho-oauthtoken ${token}` } }).catch(() => null);
  if (!res || !res.ok) { console.error(`[zoho-sync] GET ${path} → ${res?.status ?? 'network'}`); return null; }
  return res.json().catch(() => null);
}

interface ZohoAccount { account_id: string; account_name: string; account_type: string; }

/** Bank / credit-card accounts to sync (config allow-list, else auto-discover). */
async function bankAccounts(token: string): Promise<ZohoAccount[]> {
  const j = await zohoGet('bankaccounts', token);
  const all: ZohoAccount[] = (j?.bankaccounts ?? []).map((a: any) => ({
    account_id: String(a.account_id),
    account_name: String(a.account_name ?? ''),
    account_type: String(a.account_type ?? ''),
  }));
  const allow = config.zoho.bankAccountIds;
  if (allow.length) return all.filter((a) => allow.includes(a.account_id));
  // Real money accounts only — not paypal/other-current-asset ledgers.
  return all.filter((a) => a.account_type === 'bank' || a.account_type === 'credit_card');
}

/** Direction from the bank-feed line. `debit_or_credit` is the reliable signal;
 *  fall back to the categorized transaction_type when it's absent. */
function isMoneyOut(t: any): boolean {
  const dc = String(t.debit_or_credit ?? '').toLowerCase();
  if (dc === 'debit') return true;
  if (dc === 'credit') return false;
  const tt = String(t.transaction_type ?? '').toLowerCase();
  // Money-out categorized types. Anything else (deposit, *_income, refund,
  // owner_contribution, sales_without_invoices, sales_return) is money in.
  return ['expense', 'card_payment', 'owner_drawings', 'vendor_payment', 'transfer_fund'].includes(tt);
}

export async function syncZohoBank(): Promise<void> {
  const z = config.zoho;
  if (!z.organizationId || !z.clientId || !z.clientSecret) return;

  const last = await pool.query<{ v: string }>(`SELECT v FROM app_kv WHERE k = 'zoho_bank_sync_at'`).catch(() => ({ rows: [] as any[] }));
  if (last.rows[0] && Date.now() - new Date(last.rows[0].v).getTime() < THROTTLE_MS) return;

  const token = await accessToken();
  if (!token) return;

  const accounts = await bankAccounts(token);
  if (!accounts.length) { console.log('[zoho-sync] no bank accounts to sync'); return; }

  // Only look back to the watermark (minus a small overlap), or the first-run
  // floor. ingestExternalTxn dedupes by transaction_id, so overlap is harmless.
  const wm = await pool.query<{ v: string }>(`SELECT v FROM app_kv WHERE k = 'zoho_bank_sync_since'`).catch(() => ({ rows: [] as any[] }));
  const floor = wm.rows[0]?.v
    ? daysAgo(String(wm.rows[0].v).slice(0, 10), OVERLAP_DAYS)
    : daysAgo(dubaiToday(), FIRST_RUN_LOOKBACK_DAYS);

  let pended = 0;
  let sampled = false;
  for (const acc of accounts) {
    for (let page = 1; page <= 50; page++) {
      const j = await zohoGet(`banktransactions?account_id=${encodeURIComponent(acc.account_id)}&sort_column=date&sort_order=D&page=${page}&per_page=200`, token);
      const list: any[] = j?.banktransactions ?? [];
      if (!list.length) break;
      // One-time visibility: log the raw shape of the first line so the exact
      // field names/values can be confirmed in Render logs after go-live.
      if (!sampled && list[0]) { console.log('[zoho-sync] sample txn:', JSON.stringify(list[0]).slice(0, 800)); sampled = true; }

      let hitFloor = false;
      for (const t of list) {
        const date = String(t.date ?? '').slice(0, 10);
        if (date && date < floor) { hitFloor = true; break; } // sorted desc → older ones follow
        if (!isMoneyOut(t)) continue;
        const amt = Number(t.amount ?? 0);
        const amountFils = Math.round(Math.abs(amt) * 100);
        if (amountFils <= 0) continue;
        const merchant = (String(t.payee ?? '').trim() || String(t.description ?? '').trim() || acc.account_name || 'Bank transaction').slice(0, 120);
        const tt = String(t.transaction_type ?? '').toLowerCase();
        const kind: ParsedAlert['kind'] = tt.includes('transfer') ? 'transfer' : tt.includes('drawings') ? 'withdrawal' : 'purchase';
        const ref = String(t.reference_number ?? '').trim();
        const raw = [
          `Zoho bank feed — ${acc.account_name}`,
          String(t.description ?? '').trim(),
          ref ? `Ref ${ref}` : '',
          `(zoho txn ${t.transaction_id})`,
        ].filter(Boolean).join(' · ').slice(0, 4000);
        const res = await ingestExternalTxn({
          amountFils,
          direction: 'debit',
          kind,
          merchant,
          postedOn: date || dubaiToday(),
          raw,
          source: 'zoho',
          dedupeKey: `zoho-${t.transaction_id}`,
        }).catch(() => null);
        if (res && !res.duplicate) pended++;
      }
      if (hitFloor) break;
      if (!(j?.page_context?.has_more_page)) break;
    }
  }

  await pool.query(`INSERT INTO app_kv (k, v) VALUES ('zoho_bank_sync_at', now()) ON CONFLICT (k) DO UPDATE SET v = now()`).catch(() => {});
  await pool.query(`INSERT INTO app_kv (k, v) VALUES ('zoho_bank_sync_since', $1) ON CONFLICT (k) DO UPDATE SET v = $1`, [dubaiToday()]).catch(() => {});

  if (pended > 0) {
    console.log(`[zoho-sync] queued ${pended} bank transaction(s) for approval in Bank Inbox`);
    const title = '🏦 New bank transactions — needs review';
    const bodyMsg = `${pended} transaction${pended === 1 ? '' : 's'} synced from your bank. Open Bank Inbox to review and approve.`;
    const targets = await pool.query<{ id: string }>(
      `SELECT id FROM team_members WHERE active AND (lower(name) = 'marsha' OR access_level = 'owner')`,
    ).catch(() => ({ rows: [] as { id: string }[] }));
    for (const t of targets.rows) {
      await pushToOwner('staff', t.id, title, bodyMsg, {}).catch(() => {});
    }
  }
}
