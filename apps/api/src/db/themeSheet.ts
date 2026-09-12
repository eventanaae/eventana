/**
 * One-off export for the "themes backfill" sheet. Gated by THEME_SHEET=1.
 * Dumps this year's events + QuickBooks sales (date, customer, phone, what was
 * booked, the theme already in the system) as tab-separated [theme-sheet] ROW
 * lines so we can read them from the logs and build a sheet for Marsha to fill
 * in the theme of each past party. Read-only.
 */
import { pool } from './pool.js';

const P = (s: string) => console.log(`[theme-sheet] ${s}`);
const clean = (s: any) => String(s ?? '').replace(/[\t\r\n]+/g, ' ').trim();

export async function themeSheetFromEnv(): Promise<void> {
  if (String(process.env.THEME_SHEET ?? '').trim() !== '1') return;
  try {
    const y = new Date(Date.now() + 4 * 3_600_000).getUTCFullYear();
    const from = `${y}-01-01`, to = `${y + 1}-01-01`;
    P(`year=${y} window ${from}..${to}`);

    // Live app events this year (theme already known).
    const live = await pool.query(
      `SELECT to_char(e.event_date,'YYYY-MM-DD') d, c.name, c.phone,
              COALESCE(th.name, CASE WHEN e.custom_theme THEN 'Custom theme' ELSE '' END) theme,
              e.celebration_type ctype
         FROM events e JOIN customers c ON c.id = e.customer_id
         LEFT JOIN themes th ON th.id = e.theme_id
        WHERE e.phase <> 'Cancelled' AND e.source IS DISTINCT FROM 'quickbooks_import'
          AND e.event_date >= $1 AND e.event_date < $2
        ORDER BY e.event_date`,
      [from, to],
    );

    // QuickBooks sales this year — one row per invoice; phone from the reviewed
    // customer book (de-duped to one per name).
    const qb = await pool.query(
      `SELECT to_char(min(ho.txn_date),'YYYY-MM-DD') d, ho.customer_name name,
              max(hc.phone) phone, string_agg(DISTINCT NULLIF(btrim(ho.product),''), ', ') product
         FROM historical_orders ho
         LEFT JOIN (
           SELECT DISTINCT ON (lower(btrim(full_name))) lower(btrim(full_name)) k, phone
             FROM historical_customers ORDER BY lower(btrim(full_name)), (phone IS NOT NULL) DESC, id
         ) hc ON hc.k = lower(btrim(ho.customer_name))
        WHERE ho.txn_date >= $1 AND ho.txn_date < $2 AND COALESCE(ho.txn_type,'') <> 'Payment'
        GROUP BY ho.doc_number, ho.customer_name
        ORDER BY 1`,
      [from, to],
    );

    P(`COUNT live=${live.rowCount} qb=${qb.rowCount}`);
    for (const r of live.rows) P(`ROW\t${r.d}\t${clean(r.name)}\t${clean(r.phone)}\t${clean(r.ctype)}\t${clean(r.theme)}\tapp`);
    for (const r of qb.rows) P(`ROW\t${r.d}\t${clean(r.name)}\t${clean(r.phone)}\t${clean(r.product)}\t\tquickbooks`);
    P('DONE');
  } catch (err) {
    P(`failed: ${(err as Error).message}`);
  }
}
