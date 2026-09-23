/**
 * Web Push (browser/PWA notifications) over the standard VAPID + RFC 8291
 * (aes128gcm) protocol — no external library, just Node crypto. This is what
 * makes a notification pop up on a staff phone's screen (with the system sound)
 * even when the Eventana Ops app is closed, once they've installed it and
 * allowed notifications.
 *
 * Subscriptions are stored per staff member in `push_subscriptions`. It is a
 * no-op until VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY are configured, so the
 * subscribe endpoint always works and only delivery waits on the keys.
 */
import crypto from 'node:crypto';
import { pool } from '../db/pool.js';
import { config } from '../config.js';

function b64url(buf: Buffer | string): string {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function fromB64url(s: string): Buffer {
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

export function webPushEnabled(): boolean {
  return Boolean(config.vapid.publicKey && config.vapid.privateKey);
}

/** The VAPID private key as a Node KeyObject (rebuilt from the raw d + public x/y). */
let cachedKey: crypto.KeyObject | null = null;
function vapidPrivateKey(): crypto.KeyObject {
  if (cachedKey) return cachedKey;
  const pub = fromB64url(String(config.vapid.publicKey)); // 0x04 || X(32) || Y(32)
  cachedKey = crypto.createPrivateKey({
    format: 'jwk',
    key: {
      kty: 'EC', crv: 'P-256',
      d: String(config.vapid.privateKey),
      x: b64url(pub.subarray(1, 33)),
      y: b64url(pub.subarray(33, 65)),
    },
  });
  return cachedKey;
}

/** A signed VAPID JWT (ES256) for the given push-service origin. */
function vapidJwt(audience: string): string {
  const header = b64url(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const payload = b64url(JSON.stringify({
    aud: audience,
    exp: Math.floor(Date.now() / 1000) + 12 * 3600,
    sub: config.vapid.subject || 'mailto:bank@eventanauae.com',
  }));
  const input = `${header}.${payload}`;
  const sig = crypto.sign('sha256', Buffer.from(input), { key: vapidPrivateKey(), dsaEncoding: 'ieee-p1363' });
  return `${input}.${b64url(sig)}`;
}

/** Encrypt a payload for a subscription per RFC 8291 (Content-Encoding: aes128gcm). */
function encrypt(plaintext: Buffer, p256dh: Buffer, auth: Buffer): Buffer {
  const ecdh = crypto.createECDH('prime256v1');
  const serverPub = ecdh.generateKeys(); // uncompressed 65 bytes
  const shared = ecdh.computeSecret(p256dh);

  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), p256dh, serverPub]);
  const ikm = Buffer.from(crypto.hkdfSync('sha256', shared, auth, keyInfo, 32));
  const salt = crypto.randomBytes(16);
  const cek = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));

  const padded = Buffer.concat([plaintext, Buffer.from([0x02])]); // single record: 0x02 delimiter, no padding
  const cipher = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const ct = Buffer.concat([cipher.update(padded), cipher.final(), cipher.getAuthTag()]);

  const rs = Buffer.alloc(4); rs.writeUInt32BE(4096, 0);
  const idlen = Buffer.from([serverPub.length]); // 65
  return Buffer.concat([salt, rs, idlen, serverPub, ct]);
}

interface Sub { endpoint: string; p256dh: string; auth: string }

async function sendOne(sub: Sub, msg: object): Promise<number> {
  const body = encrypt(Buffer.from(JSON.stringify(msg)), fromB64url(sub.p256dh), fromB64url(sub.auth));
  const audience = new URL(sub.endpoint).origin;
  const res = await fetch(sub.endpoint, {
    method: 'POST',
    headers: {
      TTL: '86400',
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      Authorization: `vapid t=${vapidJwt(audience)}, k=${config.vapid.publicKey}`,
    },
    body: body as any,
  });
  return res.status;
}

export interface PushMessage { title: string; body: string; url?: string; tag?: string }

/**
 * Deliver a browser push to a staff member's devices (or, with no ownerId, every
 * staff subscription). Best-effort; prunes subscriptions the push service has
 * dropped (404/410). Never throws.
 */
export async function sendWebPush(ownerType: 'staff' | 'customer', ownerId: string | null, msg: PushMessage): Promise<void> {
  if (!webPushEnabled()) return;
  try {
    const { rows } = ownerId
      ? await pool.query<Sub>(`SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE owner_type = $1 AND owner_id = $2`, [ownerType, ownerId])
      : await pool.query<Sub>(`SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE owner_type = $1`, [ownerType]);
    const stale: string[] = [];
    for (const s of rows) {
      try {
        const status = await sendOne(s, msg);
        if (status === 404 || status === 410) stale.push(s.endpoint);
      } catch (err) {
        console.error('[webpush] send failed:', (err as Error).message);
      }
    }
    if (stale.length) {
      await pool.query(`DELETE FROM push_subscriptions WHERE endpoint = ANY($1)`, [stale]).catch(() => {});
    }
  } catch (err) {
    console.error('[webpush] delivery error:', (err as Error).message);
  }
}

/** Save (upsert) a browser push subscription for a staff member. */
export async function saveWebPushSubscription(
  ownerType: 'staff' | 'customer', ownerId: string,
  sub: { endpoint: string; keys: { p256dh: string; auth: string } },
): Promise<void> {
  if (!sub?.endpoint || !sub.keys?.p256dh || !sub.keys?.auth) throw new Error('invalid subscription');
  await pool.query(
    `INSERT INTO push_subscriptions (owner_type, owner_id, endpoint, p256dh, auth)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (endpoint) DO UPDATE
       SET owner_type = EXCLUDED.owner_type, owner_id = EXCLUDED.owner_id,
           p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth, last_seen = now()`,
    [ownerType, ownerId, sub.endpoint, sub.keys.p256dh, sub.keys.auth],
  );
}
