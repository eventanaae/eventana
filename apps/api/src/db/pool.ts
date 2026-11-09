import pg from 'pg';
import { createHash } from 'node:crypto';
import { config } from '../config.js';

/**
 * Money is stored as BIGINT fils. node-postgres hands BIGINT back as a
 * string to avoid silent precision loss; every Eventana amount is far
 * inside Number.MAX_SAFE_INTEGER, so parse it to a number once here
 * rather than sprinkling Number() across the code.
 */
pg.types.setTypeParser(pg.types.builtins.INT8, (v) => Number(v));
/** NUMERIC is not used for money; keep it a string where it does appear. */

/**
 * Managed Postgres (Render, Heroku, Supabase…) terminates TLS with a
 * certificate chain Node does not ship a root for, so verification is
 * relaxed for remote hosts while still encrypting the connection. Local
 * development connects plaintext. Override explicitly with DATABASE_SSL.
 */
function sslOption(): pg.PoolConfig['ssl'] {
  const explicit = (process.env.DATABASE_SSL ?? '').toLowerCase();
  if (explicit === 'false') return undefined;
  if (explicit === 'true') return { rejectUnauthorized: false };

  try {
    const host = new URL(config.databaseUrl).hostname;
    const local = host === 'localhost' || host === '127.0.0.1' || host.endsWith('.internal');
    return local ? undefined : { rejectUnauthorized: false };
  } catch {
    return undefined;
  }
}

export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  ssl: sslOption(),
  max: Number(process.env.DATABASE_POOL_MAX ?? 10),
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 15_000,
  // Session time zone = Dubai (UTC+4, no DST), so current_date, now()::date,
  // date_trunc(..., now()) and to_char(timestamptz) give the Dubai calendar day
  // the business runs on, not UTC. timestamptz values themselves are absolute
  // and unaffected; code that needs UTC text must say AT TIME ZONE 'UTC'.
  options: '-c timezone=Asia/Dubai',
});

// A pooled client can die between checkouts (a managed database restart,
// an idle timeout). Without a listener, that surfaces as an unhandled
// 'error' event and takes the process down.
pool.on('error', (err) => {
  console.error('[db] idle client error:', err.message);
});

export type Db = pg.Pool | pg.PoolClient;

/**
 * Runs `fn` inside a single transaction. Booking confirmation, inventory
 * holds and payment transitions all go through here — the spec requires
 * that a hold and its order are created atomically, and that confirmation
 * writes the event, tasks and reservations in one commit or none of them.
 */
export async function withTransaction<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // The connection is already broken; releasing it is enough.
    }
    throw err;
  } finally {
    client.release();
  }
}

/**
 * One-time guard for env-gated boot one-shots. Claims `app_kv` key `key` by
 * writing the marker FIRST (atomic INSERT … ON CONFLICT DO NOTHING), and returns
 * true only to the caller that wrote it — so a one-shot whose env var is left
 * set does not repeat on every boot/deploy, and two instances booting at once
 * cannot both run it. Include the env value in the key so a NEW value runs once.
 * If the marker cannot be read/written (DB error), returns false: skip, never
 * risk a repeat.
 */
export async function claimOneShot(rawKey: string): Promise<boolean> {
  // Keep the primary key short even when the env value is long (e.g. SET_BOOKED).
  const key = rawKey.length > 200
    ? `${rawKey.slice(0, 120)}#${createHash('sha256').update(rawKey).digest('hex')}`
    : rawKey;
  try {
    const r = await pool.query(
      `INSERT INTO app_kv (k, v) VALUES ($1, now()) ON CONFLICT (k) DO NOTHING RETURNING k`,
      [key],
    );
    if (!r.rowCount) {
      console.log(`[one-shot] ${key} already ran — skipping (unset its env var).`);
      return false;
    }
    return true;
  } catch (err) {
    console.error(`[one-shot] ${key} marker check failed — skipping:`, (err as Error).message);
    return false;
  }
}

export async function closePool(): Promise<void> {
  await pool.end();
}
