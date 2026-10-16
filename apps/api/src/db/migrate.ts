/**
 * Applies schema.sql. Idempotent — every statement is CREATE ... IF NOT
 * EXISTS, so running it against an existing database is safe.
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
  // During a zero-downtime deploy the NEW instance applies DDL (which takes
  // AccessExclusiveLock) while the OLD instance is still serving reads
  // (AccessShareLock) — those can deadlock (Postgres 40P01). Uncaught, that
  // crashes boot and FAILS the whole deploy (seen 2026-10-16). The DDL is the
  // victim, so retry a few times with backoff and the collision self-heals.
  for (let attempt = 1; ; attempt++) {
    try {
      await pool.query(sql);
      return;
    } catch (err: any) {
      if (err?.code === '40P01' && attempt < 5) {
        console.warn(`[migrate] deadlock (40P01) on attempt ${attempt} — retrying in ${attempt}s…`);
        await new Promise((r) => setTimeout(r, attempt * 1000));
        continue;
      }
      throw err;
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
