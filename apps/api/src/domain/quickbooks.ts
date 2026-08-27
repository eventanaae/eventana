/**
 * QuickBooks Online integration — OAuth 2.0 (authorization_code) + token storage
 * and refresh, and an authenticated fetch helper for the Accounting API.
 *
 * Endpoints and the flow follow developer.intuit.com (OAuth 2.0). The client
 * secret is read from config (env only) and never logged. Access tokens last ~1h
 * and are refreshed with the ~100-day refresh token before every call when near
 * expiry, so a one-time consent keeps the connection alive.
 */
import { createHmac } from 'node:crypto';
import { config } from '../config.js';
import { pool } from '../db/pool.js';

const AUTHORIZE_URL = 'https://appcenter.intuit.com/connect/oauth2';
const TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';
const REVOKE_URL = 'https://developer.api.intuit.com/v2/oauth2/tokens/revoke';
// Minimal scope for reading the books (expenses, invoices, attachments) + who
// connected. Payments are not needed to read the ledger.
const SCOPES = 'com.intuit.quickbooks.accounting openid profile email';

function apiBase(): string {
  return config.quickbooks.environment === 'production'
    ? 'https://quickbooks.api.intuit.com'
    : 'https://sandbox-quickbooks.api.intuit.com';
}

export function quickbooksConfigured(): boolean {
  return Boolean(config.quickbooks.clientId && config.quickbooks.clientSecret);
}

/** Stateless CSRF: a state value signed with the server's trust anchor. */
export function makeState(): string {
  const nonce = `${Date.now()}.${Math.round(performance.now())}`;
  const sig = createHmac('sha256', config.staffToken).update(nonce).digest('hex').slice(0, 24);
  return `${nonce}.${sig}`;
}
export function verifyState(state: string | undefined): boolean {
  if (!state) return false;
  const i = state.lastIndexOf('.');
  if (i < 0) return false;
  const nonce = state.slice(0, i);
  const sig = state.slice(i + 1);
  const expected = createHmac('sha256', config.staffToken).update(nonce).digest('hex').slice(0, 24);
  return sig === expected;
}

/** The Intuit consent URL to send the owner to. */
export function authorizeUrl(state: string): string {
  const p = new URLSearchParams({
    client_id: config.quickbooks.clientId ?? '',
    response_type: 'code',
    scope: SCOPES,
    redirect_uri: config.quickbooks.redirectUri,
    state,
  });
  return `${AUTHORIZE_URL}?${p.toString()}`;
}

function basicAuth(): string {
  return Buffer.from(`${config.quickbooks.clientId}:${config.quickbooks.clientSecret}`).toString('base64');
}

type TokenResponse = { access_token: string; refresh_token: string; expires_in: number; x_refresh_token_expires_in?: number };

async function postToken(body: URLSearchParams): Promise<TokenResponse> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basicAuth()}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: body.toString(),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`QuickBooks token endpoint ${res.status}: ${text.slice(0, 300)}`);
  }
  return (await res.json()) as TokenResponse;
}

/** Exchange the authorization code for tokens and persist the connection. */
export async function exchangeCode(code: string, realmId: string, connectedBy: string): Promise<void> {
  const t = await postToken(new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: config.quickbooks.redirectUri,
  }));
  await saveTokens(realmId, t, connectedBy);
}

async function saveTokens(realmId: string, t: TokenResponse, connectedBy?: string): Promise<void> {
  const expiresAt = new Date(Date.now() + (t.expires_in - 60) * 1000);
  const refreshExpiresAt = t.x_refresh_token_expires_in
    ? new Date(Date.now() + t.x_refresh_token_expires_in * 1000)
    : null;
  await pool.query(
    `INSERT INTO quickbooks_connection (id, realm_id, access_token, refresh_token, expires_at, refresh_expires_at, environment, connected_by, updated_at)
     VALUES (1,$1,$2,$3,$4,$5,$6,$7,now())
     ON CONFLICT (id) DO UPDATE SET
       realm_id=EXCLUDED.realm_id, access_token=EXCLUDED.access_token, refresh_token=EXCLUDED.refresh_token,
       expires_at=EXCLUDED.expires_at, refresh_expires_at=EXCLUDED.refresh_expires_at,
       environment=EXCLUDED.environment,
       connected_by=COALESCE(EXCLUDED.connected_by, quickbooks_connection.connected_by), updated_at=now()`,
    [realmId, t.access_token, t.refresh_token, expiresAt, refreshExpiresAt, config.quickbooks.environment, connectedBy ?? null],
  );
}

type Connection = { realm_id: string; access_token: string; refresh_token: string; expires_at: string };

async function getConnection(): Promise<Connection | null> {
  const { rows } = await pool.query(`SELECT realm_id, access_token, refresh_token, expires_at FROM quickbooks_connection WHERE id=1`);
  return rows[0] ?? null;
}

/** A valid access token, refreshing first if it is at/near expiry. */
async function getAccessToken(): Promise<{ token: string; realmId: string }> {
  const conn = await getConnection();
  if (!conn) throw new Error('QuickBooks is not connected.');
  if (new Date(conn.expires_at).getTime() > Date.now()) {
    return { token: conn.access_token, realmId: conn.realm_id };
  }
  const t = await postToken(new URLSearchParams({ grant_type: 'refresh_token', refresh_token: conn.refresh_token }));
  await saveTokens(conn.realm_id, t);
  return { token: t.access_token, realmId: conn.realm_id };
}

/** Authenticated GET against the Accounting API for the connected company. */
export async function qbGet(path: string): Promise<any> {
  const { token, realmId } = await getAccessToken();
  const url = `${apiBase()}/v3/company/${realmId}${path}${path.includes('?') ? '&' : '?'}minorversion=73`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`QuickBooks API ${res.status}: ${text.slice(0, 300)}`);
  }
  return res.json();
}

/** Connection status for the dashboard (never returns tokens). */
export async function status(): Promise<{ connected: boolean; realmId?: string; environment: string; companyName?: string }> {
  const conn = await getConnection();
  if (!conn) return { connected: false, environment: config.quickbooks.environment };
  let companyName: string | undefined;
  try {
    const info = await qbGet(`/companyinfo/${conn.realm_id}`);
    companyName = info?.CompanyInfo?.CompanyName;
  } catch { /* token may need reconnect */ }
  return { connected: true, realmId: conn.realm_id, environment: config.quickbooks.environment, companyName };
}

/** Disconnect: revoke the refresh token at Intuit and drop the stored row. */
export async function disconnect(): Promise<void> {
  const conn = await getConnection();
  if (conn) {
    await fetch(REVOKE_URL, {
      method: 'POST',
      headers: { Authorization: `Basic ${basicAuth()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: conn.refresh_token }),
    }).catch(() => {});
  }
  await pool.query(`DELETE FROM quickbooks_connection WHERE id=1`);
}
