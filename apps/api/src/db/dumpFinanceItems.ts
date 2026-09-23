/** TEMP: dump all finance_items (the invoicing "Products" — incl. imported/
 *  historical items) to the logs so we can review names/prices/descriptions.
 *  Gated by DUMP_FINANCE_ITEMS=run. Read-only. Remove after review. */
import { pool } from './pool.js';

export async function dumpFinanceItemsFromEnv(): Promise<void> {
  if ((process.env.RUN_MIGRATIONS_ON_BOOT ?? '').toLowerCase() !== 'true') return;
  if ((process.env.DUMP_FINANCE_ITEMS ?? '') !== 'run') return;
  const { rows } = await pool.query<{ id: string; name: string; price_fils: string; description: string | null }>(
    `SELECT id, name, price_fils, description FROM finance_items ORDER BY lower(name)`,
  ).catch((e) => { console.error('[dump-finance-items] query failed:', (e as Error).message); return { rows: [] as any[] }; });
  const withDesc = rows.filter((r) => r.description && String(r.description).trim() !== '').length;
  console.log(`[dump-finance-items] count=${rows.length} withDescription=${withDesc}`);
  // Emit as compact JSON lines so we can copy them out of the logs.
  for (const r of rows) {
    console.log(`[dump-finance-items] ${JSON.stringify({ id: Number(r.id), name: r.name, priceAed: Math.round(Number(r.price_fils)) / 100, description: r.description ?? '' })}`);
  }
  console.log('[dump-finance-items] done');
}
