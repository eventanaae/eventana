/**
 * Applies schema.sql in a single transaction. Idempotent — statements are
 * CREATE ... IF NOT EXISTS and data backfills are one-time (app_kv markers),
 * so running it against an existing database is safe.
 *
 *   npm run db:migrate            apply the schema
 *   npm run db:migrate -- --drop  drop everything first (development only)
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { closePool, pool } from './pool.js';
import { isMain } from './is-main.js';
import { config } from '../config.js';

const here = dirname(fileURLToPath(import.meta.url));

const DROP = `
DROP TABLE IF EXISTS notifications, loyalty_transactions, designs, messages,
  event_tasks, event_team, team_members, inventory_holds, event_setup_photos,
  event_services, events, webhook_deliveries, payment_events, payments, orders,
  customers, inventory_assets, theme_inspiration, themes, package_items,
  packages, services, service_categories, delivery_zones, settings CASCADE;
DROP SEQUENCE IF EXISTS order_ref_seq, event_ref_seq;
`;

export async function migrate({ drop = false } = {}): Promise<void> {
  if (drop) {
    if (config.nodeEnv === 'production') {
      throw new Error('Refusing to drop tables in production.');
    }
    await pool.query(DROP);
  }
  const sql = await readFile(join(here, 'schema.sql'), 'utf8');
  // The schema is all CREATE/ALTER ... IF NOT EXISTS, so re-running is safe.
  // It runs as ONE transaction on a dedicated client, so a failure part-way
  // never leaves a half-applied schema. During a zero-downtime deploy the NEW
  // instance applies DDL (AccessExclusiveLock) while the OLD instance is still
  // serving reads — those can deadlock (40P01, seen 2026-10-16) or queue behind
  // a long reader. lock_timeout makes the DDL give up quickly (55P03) instead
  // of stalling every query queued behind its lock request; both are retried
  // with backoff so the collision self-heals instead of failing the deploy.
  const RETRYABLE = new Set(['40P01', '55P03']);
  for (let attempt = 1; ; attempt++) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SET LOCAL lock_timeout = '5s'");
      await client.query(sql);
      await client.query('COMMIT');
      return;
    } catch (err: any) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // Connection is broken; releasing it below is enough.
      }
      if (RETRYABLE.has(err?.code) && attempt < 5) {
        console.warn(`[migrate] ${err.code} on attempt ${attempt} — retrying in ${attempt}s…`);
        await new Promise((r) => setTimeout(r, attempt * 1000));
        continue;
      }
      throw err;
    } finally {
      client.release();
    }
  }
}

if (isMain(import.meta.url)) {
  const drop = process.argv.includes('--drop');
  migrate({ drop })
    .then(() => {
      console.log(drop ? 'Schema dropped and recreated.' : 'Schema applied.');
      return closePool();
    })
    .catch(async (err) => {
      console.error('Migration failed:', err);
      await closePool();
      process.exit(1);
    });
}
