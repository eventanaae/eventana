/**
 * Bring the QuickBooks past customers (historical_customers) into the live
 * `customers` table so we can market to them — as passwordless, claimable
 * records (origin='quickbooks'). Their invoices stay in historical_orders
 * untouched (financials/reconciliation don't move). Gated by QB_MIGRATE:
 *   list  → DRY RUN: how many have an email, how many already exist as a
 *           customer (skipped), how many NEW rows would be created. No changes.
 *   apply → create the new rows (deduped by email) + mint each one a win-back
 *           code. QB_MIGRATE_LIMIT caps rows per run (default 1000).
 * Only records WITH an email are migrated (no email = can't email them anyway).
 * Runs before the win-back campaign so those customers become eligible for it.
 */
import { randomBytes } from 'node:crypto';
import { pool } from './pool.js';

const P = (s: string) => console.log(`[qb-migrate] ${s}`);

/** Light title-case for a migrated display name. */
function tidyName(s: string): string {
  return (s || '').trim().replace(/\s+/g, ' ')
    .split(' ')
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w))
    .join(' ');
}

export async function qbMigrateFromEnv(): Promise<void> {
  const mode = String(process.env.QB_MIGRATE ?? '').toLowerCase();
  if (mode !== 'list' && mode !== 'apply') return;
  const limit = Math.max(1, Math.min(2000, Number(process.env.QB_MIGRATE_LIMIT ?? 1000) || 1000));

  try {
    // QuickBooks contacts with a usable email, that are NOT already a live
    // customer (matched case-insensitively by email).
    const newOnes = `
       FROM historical_customers h
      WHERE h.email IS NOT NULL AND h.email <> ''
        AND NOT EXISTS (SELECT 1 FROM customers c WHERE lower(c.email) = lower(h.email))`;

    const withEmail = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM historical_customers WHERE email IS NOT NULL AND email <> ''`);
    const already = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM historical_customers h
        WHERE h.email IS NOT NULL AND h.email <> ''
          AND EXISTS (SELECT 1 FROM customers c WHERE lower(c.email) = lower(h.email))`);
    const fresh = await pool.query<{ n: string }>(`SELECT count(*)::text AS n ${newOnes}`);
    P(`QB contacts with email: ${withEmail.rows[0].n} · already customers: ${already.rows[0].n} · NEW to create: ${fresh.rows[0].n}`);

    if (mode === 'list') {
      const sample = await pool.query<{ full_name: string; email: string }>(
        `SELECT h.full_name, h.email ${newOnes} ORDER BY h.full_name LIMIT 15`);
      P(`sample of NEW (first ${sample.rowCount}):`);
      for (const r of sample.rows) P(`  ${tidyName(r.full_name)} <${r.email}>`);
      P('DRY RUN — no rows created. Run QB_MIGRATE=apply to create them.');
      return;
    }

    const { issueWinbackCode } = await import('../domain/winback.js');
    const rows = await pool.query<{ full_name: string; phone: string | null; phone_alt: string | null; email: string; emirate: string | null }>(
      `SELECT h.full_name, h.phone, h.phone_alt, h.email, h.emirate ${newOnes} ORDER BY h.full_name LIMIT ${limit}`);
    P(`creating ${rows.rowCount} customer rows…`);
    let created = 0; let coded = 0; let failed = 0;
    for (const r of rows.rows) {
      try {
        // Re-check inside the loop in case two QB rows share an email.
        const dup = await pool.query(`SELECT 1 FROM customers WHERE lower(email) = lower($1) LIMIT 1`, [r.email]);
        if (dup.rowCount) continue;
        const id = `CUST-${randomBytes(4).toString('hex').toUpperCase()}`;
        await pool.query(
          `INSERT INTO customers (id, name, phone, email, origin)
           VALUES ($1, $2, $3, $4, 'quickbooks')`,
          [id, tidyName(r.full_name) || 'Guest', r.phone || r.phone_alt || '', r.email],
        );
        created++;
        const code = await issueWinbackCode(pool, id).catch(() => null);
        if (code) coded++;
      } catch (err) {
        failed++;
        if (failed <= 5) P(`  row failed (${r.email}): ${(err as Error).message}`);
      }
    }
    P(`DONE — created ${created}, coded ${coded}, failed ${failed}`);
  } catch (e) {
    P(`FAILED: ${(e as Error).message}`);
  }
}
