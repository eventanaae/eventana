/**
 * Push notifications via Firebase Cloud Messaging (HTTP v1).
 *
 * A Firebase service account signs a short-lived JWT (RS256), exchanges it for
 * an access token, and posts messages to FCM. No SDK. A no-op until the
 * service account + project id are configured, so registration always works
 * and only delivery waits on credentials.
 */
import { createSign } from 'node:crypto';
import { pool } from '../db/pool.js';
import { config } from '../config.js';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';

interface ServiceAccount {
  client_email: string;
  private_key: string;
}

function creds(): { sa: ServiceAccount; projectId: string } | null {
  const { serviceAccountJson, projectId } = config.fcm;
  if (!serviceAccountJson || !projectId) return null;
  try {
    const sa = JSON.parse(serviceAccountJson) as ServiceAccount;
    if (!sa.client_email || !sa.private_key) return null;
    return { sa, projectId };
  } catch {
    console.error('[push] FCM service account is not valid JSON');
    return null;
  }
}

export function pushEnabled(): boolean {
  return creds() !== null;
}

let cachedToken: { value: string; expiresAt: number } | null = null;

async function accessToken(sa: ServiceAccount): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.value;
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const claims = Buffer.from(
    JSON.stringify({ iss: sa.client_email, scope: SCOPE, aud: TOKEN_URL, iat: now, exp: now + 3600 }),
  ).toString('base64url');
  const input = `${header}.${claims}`;
  const signer = createSign('RSA-SHA256');
  signer.update(input);
  signer.end();
  const signature = signer.sign(sa.private_key).toString('base64url');
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${input}.${signature}`,
    }),
  });
  if (!res.ok) throw new Error(`fcm token exchange failed: ${res.status}`);
  const json = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = { value: json.access_token, expiresAt: Date.now() + json.expires_in * 1000 };
  return json.access_token;
}

async function sendToTokens(
  tokens: string[],
  msg: { title: string; body: string; data?: Record<string, string> },
): Promise<void> {
  const c = creds();
  if (!c || tokens.length === 0) return;
  let token: string;
  try {
    token = await accessToken(c.sa);
  } catch (err) {
    console.error('[push]', (err as Error).message);
    return;
  }
  const url = `https://fcm.googleapis.com/v1/projects/${c.projectId}/messages:send`;
  const stale: string[] = [];
  for (const t of tokens) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          message: { token: t, notification: { title: msg.title, body: msg.body }, data: msg.data ?? {} },
        }),
      });
      // A token FCM no longer knows is dead — prune it.
      if (res.status === 404 || res.status === 400) stale.push(t);
    } catch {
      /* transient — leave the token, try next time */
    }
  }
  if (stale.length) {
    await pool.query(`DELETE FROM device_tokens WHERE token = ANY($1)`, [stale]).catch(() => {});
  }
}

async function tokensFor(ownerType: 'staff' | 'customer', ownerId?: string): Promise<string[]> {
  const { rows } = ownerId
    ? await pool.query<{ token: string }>(
        `SELECT token FROM device_tokens WHERE owner_type = $1 AND owner_id = $2`,
        [ownerType, ownerId],
      )
    : await pool.query<{ token: string }>(`SELECT token FROM device_tokens WHERE owner_type = $1`, [
        ownerType,
      ]);
  return rows.map((r) => r.token);
}

/** Push to every registered staff device. Non-fatal. */
export async function pushToStaff(
  title: string,
  body: string,
  data?: Record<string, string>,
): Promise<void> {
  if (!pushEnabled()) return;
  try {
    await sendToTokens(await tokensFor('staff'), { title, body, data });
  } catch (err) {
    console.error('[push] staff push failed:', (err as Error).message);
  }
}

/** Push to a specific customer's devices, or a single staff member's. */
export async function pushToOwner(
  ownerType: 'staff' | 'customer',
  ownerId: string,
  title: string,
  body: string,
  data?: Record<string, string>,
): Promise<void> {
  if (!pushEnabled()) return;
  try {
    await sendToTokens(await tokensFor(ownerType, ownerId), { title, body, data });
  } catch (err) {
    console.error('[push] owner push failed:', (err as Error).message);
  }
}

/** Upsert a device token for its owner. */
export async function registerDevice(
  ownerType: 'staff' | 'customer',
  ownerId: string,
  token: string,
  platform: string,
): Promise<void> {
  await pool.query(
    `INSERT INTO device_tokens (owner_type, owner_id, token, platform)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (token) DO UPDATE
       SET owner_type = EXCLUDED.owner_type, owner_id = EXCLUDED.owner_id,
           platform = EXCLUDED.platform, last_seen = now()`,
    [ownerType, ownerId, token, platform],
  );
}
