/**
 * Diagnostic: audit petrol / transport expenses for the owner's supplier review.
 * Answers two questions: (1) are the big petrol totals real, and (2) is anything
 * double-counted? Shows totals by source (manual vs imported), exact-duplicate
 * groups (same vendor+date+amount), and the biggest individual rows. Read-only.
 *
 * Runs once on boot (RUN_MIGRATIONS_ON_BOOT on) — self-disables via app_kv guard.
 */
import { pool } from './pool.js';

export async function dumpExpenseAuditFromEnv(): Promise<void> {
  if (String(process.env.RUN_MIGRATIONS_ON_BOOT ?? '').toLowerCase() !== 'true') return;
  const guard = await pool
    .query(`SELECT 1 FROM app_kv WHERE k = 'expense_audit_v1'`)
    .catch(() => ({ rowCount: 0 }));
  if (guard.rowCount) return;

  const FUEL = `(lower(vendor) ~ '(adnoc|adnog|enoc|emarat|petrol|eppco|fuel)')`;
  const TRANSPORT = `(lower(vendor) ~ '(taxi|careem|uber|bolt|porter|hala|rta|\\mcab\\M|\\mmetro\\M)')`;

  // 1) totals by source for fuel + transport
  const bySrc = await pool.query<{ grp: string; source: string; n: number; aed: number }>(
    `SELECT CASE WHEN ${FUEL} THEN 'FUEL' ELSE 'TRANSPORT' END AS grp,
            COALESCE(source,'manual') AS source, count(*)::int n, round(sum(amount_fils)/100.0)::int aed
       FROM expenses WHERE ${FUEL} OR ${TRANSPORT}
      GROUP BY 1,2 ORDER BY 1,2`,
  );
  console.log('[exp-audit] ── totals by source ──');
  for (const r of bySrc.rows) console.log(`[exp-audit] ${r.grp.padEnd(10)} ${r.source.padEnd(11)} n=${String(r.n).padStart(4)} AED ${r.aed}`);

  // 2) exact duplicate groups (same normalized vendor + date + amount, >1 row)
  const dups = await pool.query<{ vendor: string; spent_on: string; aed: number; n: number; ids: string; sources: string }>(
    `SELECT max(vendor) vendor, to_char(spent_on,'YYYY-MM-DD') spent_on,
            round(amount_fils/100.0)::int aed, count(*)::int n,
            string_agg(id::text, ',') ids, string_agg(DISTINCT COALESCE(source,'manual'), '+') sources
       FROM expenses
      WHERE (${FUEL} OR ${TRANSPORT})
      GROUP BY lower(btrim(vendor)), spent_on, amount_fils
      HAVING count(*) > 1
      ORDER BY (round(amount_fils/100.0)::int * count(*)) DESC
      LIMIT 40`,
  );
  const dupTotal = dups.rows.reduce((s, r) => s + r.aed * (r.n - 1), 0);
  console.log(`[exp-audit] ── exact duplicate groups: ${dups.rows.length} · overcount ≈ AED ${dupTotal} ──`);
  for (const r of dups.rows)
    console.log(`[exp-audit] DUP x${r.n} · AED ${r.aed} · ${r.spent_on} · "${r.vendor}" · [${r.sources}] ids=${r.ids}`);

  // 3) per-vendor rollup for fuel (so owner sees the real picture)
  const roll = await pool.query<{ vendor: string; n: number; aed: number; mn: number; qb: number }>(
    `SELECT vendor, count(*)::int n, round(sum(amount_fils)/100.0)::int aed,
            round(sum(amount_fils) FILTER (WHERE COALESCE(source,'manual')='manual')/100.0)::int mn,
            round(sum(amount_fils) FILTER (WHERE source<>'manual')/100.0)::int qb
       FROM expenses WHERE ${FUEL}
      GROUP BY vendor ORDER BY sum(amount_fils) DESC LIMIT 25`,
  );
  console.log('[exp-audit] ── fuel by vendor (manual vs imported) ──');
  for (const r of roll.rows)
    console.log(`[exp-audit] "${r.vendor}" n=${r.n} total=${r.aed} (manual=${r.mn} imported=${r.qb})`);

  await pool
    .query(`INSERT INTO app_kv (k, v) VALUES ('expense_audit_v1', now()) ON CONFLICT (k) DO NOTHING`)
    .catch(() => {});
  console.log('[exp-audit] DONE');
}
