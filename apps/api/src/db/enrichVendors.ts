/**
 * Auto-enrich the vendors directory with real contact info found on Google
 * (phone, email, emirate, area, and a 2-3 word "what they provide"). Shops &
 * companies only — individuals are skipped. Applied in batches; bump the guard
 * version (enrich_vendors_vN) when a new batch is added. Idempotent.
 */
import { pool } from './pool.js';

type Enrich = { names: string[]; phone?: string; email?: string; provides?: string; emirate?: string; area?: string };

const BATCH: Enrich[] = [
  { names: ['eon print solutions', 'eon print solutions llc'], phone: '+971 4 321 4422', email: 'infodxb@eonprint.co', provides: 'Printing & signage', emirate: 'Dubai', area: 'Al Quoz' },
  { names: ['black tulip flowers llc', 'black tulip flowers l.l.c'], phone: '+971 56 414 2431', email: 'trade@btfgroup.com', provides: 'Flowers', emirate: 'Dubai', area: 'Al Qusais' },
  { names: ['hot pack packaging llc', 'hotpack packaging llc'], phone: '+971 4 805 1888', email: 'marketing@hotpackuae.com', provides: 'Food packaging', emirate: 'Dubai', area: 'Dubai Investment Park' },
  { names: ['al qadah trading llc', 'al qadah trading co llc', 'al qadah trading co. llc'], phone: '+971 4 225 8877', email: '', provides: 'Party supplies', emirate: 'Dubai' },
  { names: ['vases flower trading fzco'], phone: '', email: '', provides: 'Vases & décor', emirate: 'Dubai', area: 'Dragon Mart' },
  { names: ['miz company', 'miz shop fittings trading l.l.c', 'miz shop fittings trading llc'], phone: '+971 50 218 9663', email: 'info@mizco.ae', provides: 'Popcorn/cotton-candy machines', emirate: 'Dubai', area: 'Deira' },
  { names: ['blue rhine general trading llc'], phone: '+971 4 885 7599', email: 'dercrm@bluerhine.com', provides: 'Signage & forex boards', emirate: 'Dubai', area: 'Dubai Investment Park' },
];

export async function enrichVendorsFromEnv(): Promise<void> {
  if (String(process.env.RUN_MIGRATIONS_ON_BOOT ?? '').toLowerCase() !== 'true') return;
  const guard = await pool.query(`SELECT 1 FROM app_kv WHERE k = 'enrich_vendors_v1'`).catch(() => ({ rowCount: 0 }));
  if (guard.rowCount) return;
  let n = 0;
  for (const e of BATCH) {
    const loc = [e.emirate, e.area].filter(Boolean).join(' · ');
    const r = await pool.query(
      `UPDATE suppliers SET
         phone = COALESCE(NULLIF($2,''), phone),
         email = COALESCE(NULLIF($3,''), email),
         supplies = COALESCE(NULLIF($4,''), supplies),
         location = COALESCE(NULLIF($5,''), location)
       WHERE lower(btrim(name)) = ANY($1::text[])`,
      [e.names, e.phone ?? '', e.email ?? '', e.provides ?? '', loc],
    );
    if (r.rowCount) n += r.rowCount;
    else {
      // not in directory yet — insert it active so it shows on the Vendors page
      await pool.query(
        `INSERT INTO suppliers (name, phone, email, supplies, location, active, created_by)
         VALUES (initcap($1), NULLIF($2,''), NULLIF($3,''), NULLIF($4,''), NULLIF($5,''), true, 'Google enrich')`,
        [e.names[0], e.phone ?? '', e.email ?? '', e.provides ?? '', loc],
      );
      n++;
    }
  }
  console.log(`[enrich] enriched/added ${n} vendors (batch 1)`);
  await pool.query(`INSERT INTO app_kv (k, v) VALUES ('enrich_vendors_v1', now()) ON CONFLICT (k) DO NOTHING`).catch(() => {});
}
