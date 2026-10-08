/**
 * One-shot cleanup: HIDE from the public website every service that is NOT part
 * of the curated code catalogue (packages/shared/src/catalogue.ts → SERVICES).
 *
 * WHY: importQbProducts.ts (one-time) pulled raw QuickBooks/internal products
 * into `services` as active ("10 ppl Ramadan Set up", "20 Tables & Chairs", …),
 * and the public /api/catalogue returns EVERY active service — so internal items
 * leaked onto eventanauae.com. syncCatalogueContent only upserts the code
 * catalogue; it never deactivates extras. This deactivates (active=false, NOT
 * delete — fully reversible from the dashboard) everything that isn't a curated
 * code service, restoring the website to the real product list.
 *
 * Triggered by reusing SET_SHAN_LEADER='hideqb' (Render 300 env-var cap blocks a
 * new key; setShanLeader runs on 'true' and the points email on 'send', so
 * 'hideqb' is inert for both and only this task reacts). Logs every item it
 * hides. Blank the env after.
 */
import { SERVICES } from '@eventana/shared';
import { pool } from './pool.js';

export async function hideImportedServicesFromEnv(): Promise<void> {
  if (process.env.SET_SHAN_LEADER !== 'hideqb') return;
  const codeIds = SERVICES.map((s) => s.id);
  // List exactly what will be hidden (active services not defined in code), so
  // the owner can re-enable any they actually want from the dashboard.
  const { rows } = await pool.query<{ id: string; name: string; category_id: string; price_fils: number }>(
    `SELECT id, name, category_id, price_fils FROM services
      WHERE active AND id <> ALL($1::text[]) ORDER BY category_id, name`,
    [codeIds],
  );
  for (const r of rows) {
    console.log(`[hide-imported] hiding: "${r.name}" (id=${r.id}, cat=${r.category_id}, AED ${(Number(r.price_fils) / 100).toFixed(0)})`);
  }
  const res = await pool.query(
    `UPDATE services SET active = false WHERE active AND id <> ALL($1::text[])`,
    [codeIds],
  );
  console.log(`[hide-imported] DONE — hid ${res.rowCount ?? 0} non-catalogue service(s); public site now shows the ${codeIds.length} curated services. Blank SET_SHAN_LEADER now.`);
}
