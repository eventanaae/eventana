/**
 * One-time Zoho OAuth bootstrap (secure, server-side).
 *
 * The owner pastes the Self Client's CLIENT_ID + CLIENT_SECRET and a freshly
 * generated grant code (ZOHO_GRANT_CODE) into the server environment — the
 * secret never passes through chat or a screen scrape. On boot this exchanges
 * the short-lived grant code for a PERMANENT refresh token and stores it in
 * app_kv ('zoho_refresh_token'), which syncZohoBank reads. Idempotent: once a
 * refresh token exists it never re-runs, and a re-used grant code is skipped.
 *
 * After it succeeds, ZOHO_GRANT_CODE can be removed from the environment (it's
 * single-use and already spent). Never logs the secret or the tokens.
 */
import { pool } from './pool.js';

export async function zohoBootstrapFromEnv(): Promise<void> {
  const clientId = process.env.ZOHO_CLIENT_ID ?? '';
  const clientSecret = process.env.ZOHO_CLIENT_SECRET ?? '';
  const code = (process.env.ZOHO_GRANT_CODE ?? '').trim();
  const accountsHost = process.env.ZOHO_ACCOUNTS_HOST ?? 'accounts.zoho.com';
  if (!clientId || !clientSecret || !code) return;

  // If a refresh token is already configured (env) or stored, nothing to do.
  if (process.env.ZOHO_REFRESH_TOKEN) { console.log('[zoho-bootstrap] refresh token already in env — skipping'); return; }
  const have = await pool.query(`SELECT 1 FROM app_kv WHERE k = 'zoho_refresh_token'`).catch(() => ({ rowCount: 0 }));
  if (have.rowCount) { console.log('[zoho-bootstrap] refresh token already stored — skipping'); return; }

  // Don't burn the same (already-tried) grant code twice.
  const used = await pool.query<{ v: string }>(`SELECT v FROM app_kv WHERE k = 'zoho_grant_used'`).catch(() => ({ rows: [] as any[] }));
  if (used.rows[0]?.v === code) { console.log('[zoho-bootstrap] this grant code was already used — generate a new one'); return; }

  const qs = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: clientId,
    client_secret: clientSecret,
    code,
  });
  const res = await fetch(`https://${accountsHost}/oauth/v2/token?${qs}`, { method: 'POST' }).catch(() => null);
  if (!res) { console.error('[zoho-bootstrap] token request failed (network)'); return; }
  const j: any = await res.json().catch(() => null);
  // Record that we tried this code, so a redeploy doesn't loop on a spent code.
  await pool.query(`INSERT INTO app_kv (k, v) VALUES ('zoho_grant_used', $1) ON CONFLICT (k) DO UPDATE SET v = $1`, [code]).catch(() => {});

  if (!j?.refresh_token) {
    console.error(`[zoho-bootstrap] no refresh_token returned (error: ${j?.error ?? res.status}). Generate a fresh grant code and set ZOHO_GRANT_CODE again.`);
    return;
  }
  await pool.query(
    `INSERT INTO app_kv (k, v) VALUES ('zoho_refresh_token', $1) ON CONFLICT (k) DO UPDATE SET v = $1`,
    [String(j.refresh_token)],
  );
  console.log('[zoho-bootstrap] ✅ refresh token obtained and stored — bank sync is now live. You can remove ZOHO_GRANT_CODE.');
}
