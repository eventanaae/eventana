/**
 * TEMP diagnostic: verify the Zoho bank bridge end-to-end and print what it sees
 * (no secrets — only booleans, counts and non-sensitive transaction fields).
 * Gated by ZOHO_DIAG=run. Also clears the sync throttle so the next reconcile
 * sweep re-runs syncZohoBank. Remove once the feed is confirmed working.
 */
import { pool } from './pool.js';
import { config } from '../config.js';

export async function zohoDiagFromEnv(): Promise<void> {
  if ((process.env.RUN_MIGRATIONS_ON_BOOT ?? '').toLowerCase() !== 'true') return;
  if ((process.env.ZOHO_DIAG ?? '') !== 'run') return;
  const z = config.zoho;
  console.log(`[zoho-diag] cfg org=${!!z.organizationId} clientId=${!!z.clientId} secret=${!!z.clientSecret} refreshEnv=${!!z.refreshToken} accountsHost=${z.accountsHost} apiHost=${z.apiHost}`);

  const sec = await pool.query<{ v: string }>(`SELECT v FROM app_secrets WHERE k='zoho_refresh_token'`).catch((e) => { console.log('[zoho-diag] app_secrets read error:', (e as Error).message); return { rows: [] as any[] }; });
  console.log(`[zoho-diag] refresh token in app_secrets: ${sec.rows[0] ? 'yes' : 'no'}`);
  const refreshToken = z.refreshToken || sec.rows[0]?.v || null;
  if (!refreshToken) { console.log('[zoho-diag] NO refresh token available — stop'); return; }

  // Access token
  const qs = new URLSearchParams({ refresh_token: refreshToken, client_id: z.clientId ?? '', client_secret: z.clientSecret ?? '', grant_type: 'refresh_token' });
  const tr = await fetch(`https://${z.accountsHost}/oauth/v2/token?${qs}`, { method: 'POST' }).catch(() => null);
  const tj: any = tr ? await tr.json().catch(() => null) : null;
  console.log(`[zoho-diag] token status=${tr?.status} hasAccess=${!!tj?.access_token} err=${tj?.error ?? 'none'} apiDomain=${tj?.api_domain ?? 'none'}`);
  if (!tj?.access_token) return;
  const token = tj.access_token as string;

  // Bank accounts
  const acctRes = await fetch(`https://${z.apiHost}/books/v3/bankaccounts?organization_id=${z.organizationId}`, { headers: { Authorization: `Zoho-oauthtoken ${token}` } }).catch(() => null);
  const acctJson: any = acctRes ? await acctRes.json().catch(() => null) : null;
  console.log(`[zoho-diag] bankaccounts status=${acctRes?.status} code=${acctJson?.code} msg=${acctJson?.message}`);
  const accounts: any[] = acctJson?.bankaccounts ?? [];
  console.log(`[zoho-diag] account count=${accounts.length}`);
  for (const a of accounts) {
    console.log(`[zoho-diag]  acct id=${a.account_id} type=${a.account_type} name="${a.account_name}" balance=${a.balance ?? a.bank_balance ?? '?'}`);
  }
  // Transactions for EVERY account (all statuses + uncategorized feed).
  for (const acct of accounts) {
    for (const extra of ['', '&status=uncategorized']) {
      const txRes = await fetch(`https://${z.apiHost}/books/v3/banktransactions?account_id=${encodeURIComponent(acct.account_id)}&organization_id=${z.organizationId}&per_page=5${extra}`, { headers: { Authorization: `Zoho-oauthtoken ${token}` } }).catch(() => null);
      const txJson: any = txRes ? await txRes.json().catch(() => null) : null;
      const txns: any[] = txJson?.banktransactions ?? [];
      console.log(`[zoho-diag] acct "${acct.account_name}" filter="${extra || 'all'}" status=${txRes?.status} code=${txJson?.code} count=${txns.length}`);
      if (txns[0]) {
        console.log(`[zoho-diag]   keys: ${Object.keys(txns[0]).join(',')}`);
        for (const t of txns.slice(0, 3)) {
          console.log(`[zoho-diag]   txn date=${t.date} amount=${t.amount} dc=${t.debit_or_credit} type=${t.transaction_type} status=${t.status} payee="${t.payee ?? t.description ?? ''}"`);
        }
      }
    }
  }

  // Clear the throttle so the next sweep re-runs the real sync.
  await pool.query(`DELETE FROM app_kv WHERE k='zoho_bank_sync_at'`).catch(() => {});
  console.log('[zoho-diag] cleared zoho_bank_sync_at — next sweep will re-run syncZohoBank');
}
