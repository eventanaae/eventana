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
  // WhatsApp mirror first — it must reach the team even when FCM isn't
  // configured or a phone has no app installed (iOS push is unreliable).
  void staffWhatsApp(title, body);
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
  // Mirror staff-directed notifications to that member's WhatsApp too.
  if (ownerType === 'staff') void staffWhatsApp(title, body, ownerId);
  if (!pushEnabled()) return;
  try {
    await sendToTokens(await tokensFor(ownerType, ownerId), { title, body, data });
  } catch (err) {
    console.error('[push] owner push failed:', (err as Error).message);
  }
}

/** WhatsApp digits for a UAE number, or null if it doesn't look sendable. */
function waPhone(raw: string | null): string | null {
  if (!raw) return null;
  let d = String(raw).replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  if (d.startsWith('0') && d.length === 10) d = '971' + d.slice(1); // 05xxxxxxxx
  else if (d.startsWith('5') && d.length === 9) d = '971' + d;      // 5xxxxxxxx
  return d.length >= 11 && d.length <= 15 ? d : null;
}

/**
 * Mirror a staff notification to the team's WhatsApp via the English
 * `staff_alert` template. `memberId` targets one member; omitting it sends to
 * the whole active crew. Gated by WHATSAPP_STAFF_NOTIFY; non-fatal.
 */
export async function staffWhatsApp(headline: string, details: string, memberId?: string): Promise<void> {
  if (!config.whatsapp.staffNotify) return;
  try {
    // Night guard (owner's rule): staff WhatsApps only 10:00–23:00 Dubai. A
    // message that fires outside that window is NOT lost — it's queued for the
    // next 10:00 Dubai (a `staff_wa` notification row, delivered by the sweep).
    const { rows: hr } = await pool.query<{ h: number }>(`SELECT extract(hour from now() AT TIME ZONE 'Asia/Dubai')::int AS h`);
    const hour = hr[0]?.h ?? 12;
    if (hour < 10 || hour >= 23) {
      await pool.query(
        `INSERT INTO notifications (channel, template, scheduled_for, payload)
         VALUES ('staff_wa','staff_notify',
           (CASE WHEN (date_trunc('day', now() AT TIME ZONE 'Asia/Dubai') + time '10:00') AT TIME ZONE 'Asia/Dubai' > now()
                 THEN (date_trunc('day', now() AT TIME ZONE 'Asia/Dubai') + time '10:00') AT TIME ZONE 'Asia/Dubai'
                 ELSE (date_trunc('day', now() AT TIME ZONE 'Asia/Dubai') + interval '1 day' + time '10:00') AT TIME ZONE 'Asia/Dubai' END),
           $1::jsonb)`,
        [JSON.stringify({ memberId: memberId ?? null, headline, details })],
      ).catch(() => {});
      return;
    }
    await deliverStaffWhatsApp(headline, details, memberId);
  } catch (err) {
    console.error('[staff-wa] failed:', (err as Error).message);
  }
}

/** The actual send (no time guard) — used for immediate sends and by the night queue sweep. */
export async function deliverStaffWhatsApp(headline: string, details: string, memberId?: string | null): Promise<void> {
  // A member on APPROVED annual leave today must not get work messages (owner's
  // rule). leave_requests holds annual leave; exclude anyone whose approved range
  // covers today.
  const notOnLeave =
    `NOT EXISTS (SELECT 1 FROM leave_requests l
                  WHERE l.member_id = team_members.id AND l.status = 'approved'
                    AND l.start_date <= CURRENT_DATE AND l.end_date >= CURRENT_DATE)`;
  const { rows } = memberId
    ? await pool.query<{ name: string | null; phone: string | null }>(`SELECT name, phone FROM team_members WHERE id = $1 AND active AND ${notOnLeave}`, [memberId])
    : await pool.query<{ name: string | null; phone: string | null }>(`SELECT name, phone FROM team_members WHERE active AND phone IS NOT NULL AND phone <> '' AND ${notOnLeave}`);
  const { sendWhatsAppTemplate } = await import('./whatsapp.js');
  const seen = new Set<string>();
  for (const r of rows) {
    const to = waPhone(r.phone);
    if (!to || seen.has(to)) continue;
    seen.add(to);
    const first = (r.name || '').trim().split(/\s+/)[0] || 'there';
    // staff_notify params: {{1}} first name, {{2}} headline, {{3}} details.
    // WhatsApp template variables may not contain newlines — collapse them.
    const oneLine = (s: string) => s.replace(/\s*\n+\s*/g, ' • ').trim();
    await sendWhatsAppTemplate({
      to, name: 'staff_notify', language: 'en',
      params: [first, oneLine(headline) || '—', details && details.trim() ? oneLine(details) : '—'],
      fromStaff: true,
    }).catch(() => {});
  }
}

/** Deliver any staff WhatsApps that were deferred overnight and are now due. */
export async function sweepStaffWaQueue(): Promise<void> {
  if (!config.whatsapp.staffNotify) return;
  try {
    const { rows } = await pool.query<{ id: string; payload: any }>(
      `SELECT id, payload FROM notifications
        WHERE channel = 'staff_wa' AND sent_at IS NULL AND (scheduled_for IS NULL OR scheduled_for <= now())
        ORDER BY scheduled_for LIMIT 50`,
    );
    for (const r of rows) {
      const p = r.payload || {};
      await deliverStaffWhatsApp(String(p.headline ?? ''), String(p.details ?? ''), p.memberId ?? null).catch(() => {});
      await pool.query(`UPDATE notifications SET sent_at = now() WHERE id = $1`, [r.id]).catch(() => {});
    }
    if (rows.length) console.log(`[staff-wa] delivered ${rows.length} deferred night message(s)`);
  } catch (err) {
    console.error('[staff-wa] queue sweep failed:', (err as Error).message);
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
