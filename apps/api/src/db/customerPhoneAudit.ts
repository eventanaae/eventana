/**
 * READ-ONLY. Reports how many live `customers` are missing a phone, and how many
 * of those can be BACKFILLED from the QuickBooks-migrated `historical_customers`
 * table (which holds phone / phone_alt) — matched by email (safe) or by exact
 * name (riskier). Writes NOTHING. Gated by CUSTOMER_PHONE_AUDIT=true.
 *
 * This tells us whether the missing numbers already exist in our DB (and can be
 * filled), or whether a fresh QuickBooks export is needed to repopulate them.
 */
import { pool } from './pool.js';

export async function customerPhoneAuditFromEnv(): Promise<void> {
  if (String(process.env.CUSTOMER_PHONE_AUDIT ?? '').toLowerCase() !== 'true') return;
  const L = (s: string) => console.log(`[phone-audit] ${s}`);
  try {
    // 1. Live customer phone coverage.
    const cov = (await pool.query(
      `SELECT count(*) AS total,
              count(*) FILTER (WHERE coalesce(btrim(phone),'') <> '') AS with_phone,
              count(*) FILTER (WHERE coalesce(btrim(phone),'') = '') AS no_phone,
              count(*) FILTER (WHERE coalesce(btrim(phone),'') = '' AND origin = 'quickbooks') AS no_phone_qb,
              count(*) FILTER (WHERE coalesce(btrim(phone),'') = '' AND (origin IS NULL OR origin <> 'quickbooks')) AS no_phone_app,
              count(*) FILTER (WHERE coalesce(btrim(phone),'') = '' AND coalesce(btrim(email),'') <> '') AS no_phone_has_email
         FROM customers`,
    )).rows[0];
    L(`LIVE customers: total=${cov.total}, with_phone=${cov.with_phone}, MISSING=${cov.no_phone} (qb-origin=${cov.no_phone_qb}, in-app=${cov.no_phone_app}, of missing have-email=${cov.no_phone_has_email})`);

    // 2. historical_customers (QuickBooks) phone coverage.
    const hist = (await pool.query(
      `SELECT count(*) AS total,
              count(*) FILTER (WHERE coalesce(btrim(phone),'') <> '' OR coalesce(btrim(phone_alt),'') <> '') AS with_phone,
              count(*) FILTER (WHERE coalesce(btrim(email),'') <> '') AS with_email
         FROM historical_customers`,
    )).rows[0];
    L(`HISTORICAL (QuickBooks): total=${hist.total}, with_phone=${hist.with_phone}, with_email=${hist.with_email}`);

    // 3. Backfillable NOW by EMAIL (safe): live customer has no phone, a historical
    //    row with the same email has a phone.
    const byEmail = (await pool.query(
      `SELECT count(DISTINCT c.id) AS n
         FROM customers c
         JOIN historical_customers h
           ON coalesce(btrim(c.email),'') <> '' AND lower(btrim(h.email)) = lower(btrim(c.email))
        WHERE coalesce(btrim(c.phone),'') = ''
          AND coalesce(btrim(coalesce(h.phone, h.phone_alt)),'') <> ''`,
    )).rows[0];
    L(`>>> BACKFILLABLE by EMAIL (safe) = ${byEmail.n} customer(s)`);

    // 4. Backfillable by exact NAME where it maps to exactly ONE phone (riskier —
    //    common names can collide; shown for information only).
    const byName = (await pool.query(
      `SELECT count(*) AS n FROM (
         SELECT c.id
           FROM customers c
           JOIN historical_customers h ON lower(btrim(h.full_name)) = lower(btrim(c.name))
          WHERE coalesce(btrim(c.phone),'') = ''
            AND (coalesce(btrim(c.email),'') = '' OR NOT EXISTS (
                  SELECT 1 FROM historical_customers h2
                   WHERE lower(btrim(h2.email)) = lower(btrim(c.email))
                     AND coalesce(btrim(coalesce(h2.phone,h2.phone_alt)),'') <> ''))
            AND coalesce(btrim(coalesce(h.phone,h.phone_alt)),'') <> ''
          GROUP BY c.id
         HAVING count(DISTINCT regexp_replace(coalesce(h.phone,h.phone_alt),'[^0-9]','','g')) = 1
       ) t`,
    )).rows[0];
    L(`>>> ADDITIONALLY backfillable by unique NAME (riskier) = ${byName.n} customer(s)`);

    // 5. A few concrete email-match examples so the owner can sanity-check.
    const ex = await pool.query(
      `SELECT c.name, c.email, coalesce(h.phone, h.phone_alt) AS qb_phone
         FROM customers c
         JOIN historical_customers h
           ON coalesce(btrim(c.email),'') <> '' AND lower(btrim(h.email)) = lower(btrim(c.email))
        WHERE coalesce(btrim(c.phone),'') = ''
          AND coalesce(btrim(coalesce(h.phone, h.phone_alt)),'') <> ''
        LIMIT 8`,
    );
    for (const r of ex.rows) L(`  e.g. ${r.name} <${r.email}> → ${String(r.qb_phone).replace(/.(?=.{3})/g, '•')}`);

    L('===== END (read-only — nothing changed) =====');
  } catch (e) {
    L(`error: ${(e as Error).message.slice(0, 200)}`);
  }
}
