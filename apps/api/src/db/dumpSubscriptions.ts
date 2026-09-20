/**
 * One-shot report: everything spent on software / the app / subscriptions, so the
 * owner can see (and cancel) what she's paying. Two views:
 *  (A) the whole "Dues and Subscriptions" account, by vendor, with per-year split.
 *  (B) any vendor anywhere that looks like a tech/app/subscription cost (in case
 *      one was filed under another account).
 * Read via list_logs. Guarded once per DUMP_SUBS_TAG.
 */
import { pool } from './pool.js';

const TECH_RE = `anthropic|claude|render|cloudinar|stripe|namecheap|wix|quickbook|quick book|wio|shutter|handy customs|greet island|etisalat|du |dubizzle|google|meta|facebook|instagram|snap|adobe|canva|figma|microsoft|office 365|apple|icloud|aws|amazon web|godaddy|hostinger|zoom|slack|notion|openai|gemini|twilio|resend|sendgrid|vercel|netlify|domain|hosting|subscription|saas|software`;

export async function dumpSubscriptionsFromEnv(): Promise<void> {
  if (String(process.env.RUN_MIGRATIONS_ON_BOOT ?? '').toLowerCase() !== 'true') return;
  const tag = process.env.DUMP_SUBS_TAG ?? 'v1';
  const guard = await pool.query(`SELECT 1 FROM app_kv WHERE k = $1`, [`dump_subs_${tag}`]).catch(() => ({ rowCount: 0 }));
  if (guard.rowCount) return;

  const aed = (f: number) => (Number(f) / 100).toLocaleString('en-AE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  // (A) The Dues and Subscriptions account, by vendor, per year.
  const a = await pool.query<any>(
    `SELECT COALESCE(NULLIF(btrim(vendor),''),'(no vendor)') AS vendor,
            count(*)::int AS n, sum(amount_fils)::bigint AS total,
            sum(amount_fils) FILTER (WHERE extract(year from spent_on)=2026)::bigint AS y26,
            sum(amount_fils) FILTER (WHERE extract(year from spent_on)=2025)::bigint AS y25,
            sum(amount_fils) FILTER (WHERE extract(year from spent_on)=2024)::bigint AS y24,
            sum(amount_fils) FILTER (WHERE extract(year from spent_on)<2024)::bigint AS yold
       FROM expenses
      WHERE lower(btrim(category)) = 'dues and subscriptions'
      GROUP BY 1 ORDER BY total DESC`,
  );
  console.log(`[subs] === (A) Dues and Subscriptions account — ${a.rows.length} vendors ===`);
  let gt = 0;
  for (const r of a.rows) {
    gt += Number(r.total);
    console.log(`[subs] ${r.vendor} | ${r.n}x | TOTAL AED ${aed(r.total)} | 2026 ${aed(r.y26 ?? 0)} · 2025 ${aed(r.y25 ?? 0)} · 2024 ${aed(r.y24 ?? 0)} · older ${aed(r.yold ?? 0)}`);
  }
  console.log(`[subs] (A) GRAND TOTAL AED ${aed(gt)}`);

  // (B) Anything tech/app/subscription-looking, in ANY account (catch mis-filed ones).
  const b = await pool.query<any>(
    `SELECT COALESCE(NULLIF(btrim(vendor),''),'(no vendor)') AS vendor,
            btrim(category) AS account, count(*)::int AS n, sum(amount_fils)::bigint AS total
       FROM expenses
      WHERE (lower(coalesce(vendor,'')) ~ $1 OR lower(coalesce(description,'')) ~ $1)
        AND lower(btrim(category)) <> 'dues and subscriptions'
      GROUP BY 1,2 ORDER BY total DESC`,
    [TECH_RE],
  );
  console.log(`[subs] === (B) tech/app-looking spend filed under OTHER accounts — ${b.rows.length} rows ===`);
  for (const r of b.rows) {
    console.log(`[subs] ${r.vendor} | acct: ${r.account} | ${r.n}x | AED ${aed(r.total)}`);
  }

  await pool.query(`INSERT INTO app_kv (k, v) VALUES ($1, now()) ON CONFLICT (k) DO NOTHING`, [`dump_subs_${tag}`]).catch(() => {});
}
