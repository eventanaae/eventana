/**
 * READ-ONLY. Dumps live `customers` and `historical_customers` (the QuickBooks
 * import) as chunked JSON to the logs, so a full data reconciliation can compare
 * them offline against the fresh QuickBooks reports. Writes NOTHING. Gated by
 * RECON_DUMP=customers (add more sections later as needed).
 */
import { pool } from './pool.js';

export async function reconDumpFromEnv(): Promise<void> {
  const mode = String(process.env.RECON_DUMP ?? '').toLowerCase();
  if (!['customers', 'expenses', 'orders', 'strategy', 'all', 'true'].includes(mode)) return;
  const L = (s: string) => console.log(`[recon-dump] ${s}`);
  const chunkLog = async (tag: string, rows: any[], size = 50) => {
    const n = Math.max(1, Math.ceil(rows.length / size));
    for (let i = 0; i < n; i++) L(`${tag} ${i + 1}/${n} ${JSON.stringify(rows.slice(i * size, (i + 1) * size))}`);
  };
  try {
    if (mode === 'customers' || mode === 'all' || mode === 'true') {
      const c = await pool.query(`SELECT id, name, email, phone, backup_phone, origin FROM customers ORDER BY lower(name), id`);
      await chunkLog('CUST', c.rows);
      const h = await pool.query(`SELECT id, full_name, email, phone, phone_alt, emirate, bill_address FROM historical_customers ORDER BY lower(full_name), id`);
      await chunkLog('HIST', h.rows);
      L(`customers=${c.rows.length} historical=${h.rows.length}`);
    }
    if (mode === 'orders' || mode === 'all') {
      const r = await pool.query(
        `SELECT number, customer_name, to_char(date,'MM/DD/YYYY') AS date, subtotal_fils, discount_fils, shipping_fils, total_fils, paid_with, jsonb_array_length(line_items) AS nlines FROM finance_receipts ORDER BY number`,
      );
      await chunkLog('RCPT', r.rows, 60);
      const ev = await pool.query(`SELECT count(*) n FROM events`);
      const od = await pool.query(`SELECT count(*) n FROM orders`);
      L(`receipts=${r.rows.length} events=${ev.rows[0].n} orders=${od.rows[0].n}`);
    }
    if (mode === 'expenses' || mode === 'all') {
      const e = await pool.query(
        `SELECT id, to_char(spent_on,'MM/DD/YYYY') AS spent_on, vendor, category, description, amount_fils, event_id, recorded_by FROM expenses ORDER BY spent_on, id`,
      );
      await chunkLog('EXP', e.rows, 60);
      L(`expenses=${e.rows.length}`);
    }

    /* ── strategy baseline (READ-ONLY aggregates) ───────────────────────────
     * Feeds the Revenue & Profit strategy: what sold, where, when, and what the
     * business actually spent. Aggregates only — no customer rows, no PII.
     *
     * The business has no per-product cost card, so true per-line profit cannot
     * be computed. What CAN be established from here is revenue per product and
     * the real total spend, plus how much of that spend is attributable to a
     * specific job at all (S-EXPCOVER) — which decides whether any per-event
     * cost figure is measured or merely allocated.
     */
    if (mode === 'strategy' || mode === 'all') {
      const q = async (tag: string, sql: string) => {
        const r = await pool.query(sql);
        await chunkLog(tag, r.rows, 40);
        L(`${tag} rows=${r.rows.length}`);
      };

      // Revenue by product across the migrated QuickBooks invoice lines.
      await q('S-QBPROD', `SELECT coalesce(nullif(trim(product),''),'(blank)') AS product,
                 count(*) AS lines, sum(total_fils) AS total_fils, sum(discount_fils) AS disc_fils,
                 min(txn_date) AS first_seen, max(txn_date) AS last_seen
            FROM historical_orders
           GROUP BY 1 ORDER BY 3 DESC`);

      // Same, split by year — growth and seasonality per product.
      await q('S-QBYEAR', `SELECT to_char(txn_date,'YYYY') AS yr,
                 coalesce(nullif(trim(product),''),'(blank)') AS product,
                 count(*) AS lines, sum(total_fils) AS total_fils
            FROM historical_orders WHERE txn_date IS NOT NULL
           GROUP BY 1,2 ORDER BY 1,4 DESC`);

      // Live finance receipts, itemised.
      await q('S-RCPTITEM', `SELECT coalesce(nullif(trim(li->>'name'),''),'(blank)') AS item,
                 count(*) AS lines, sum(coalesce((li->>'amountFils')::bigint,0)) AS total_fils
            FROM finance_receipts, jsonb_array_elements(line_items) li
           GROUP BY 1 ORDER BY 3 DESC`);

      // Events: volume by celebration type and emirate — the demand map.
      await q('S-EVTYPE', `SELECT coalesce(nullif(celebration_type,''),'(blank)') AS celebration,
                 coalesce(nullif(emirate,''),'(blank)') AS emirate,
                 count(*) AS events, count(cancelled_at) AS cancelled
            FROM events GROUP BY 1,2 ORDER BY 3 DESC`);

      await q('S-EVMONTH', `SELECT to_char(event_date,'YYYY-MM') AS ym, count(*) AS events,
                 count(cancelled_at) AS cancelled
            FROM events WHERE event_date IS NOT NULL GROUP BY 1 ORDER BY 1`);

      await q('S-EVPKG', `SELECT coalesce(nullif(package_id,''),'(none)') AS package_id,
                 count(*) AS events
            FROM events GROUP BY 1 ORDER BY 2 DESC`);

      // Spend by category and year, split by provenance. 'manual' rows are the
      // live ledger; 'quickbooks' rows already sit inside the imported P&L.
      await q('S-EXPCAT', `SELECT to_char(spent_on,'YYYY') AS yr, category, source,
                 count(*) AS n, sum(amount_fils) AS total_fils,
                 count(event_id) AS tied_to_event
            FROM expenses GROUP BY 1,2,3 ORDER BY 1,5 DESC`);

      // How much spend can be attributed to a specific job at all.
      await q('S-EXPCOVER', `SELECT source, count(*) AS rows_total, count(event_id) AS with_event,
                 sum(amount_fils) AS total_fils,
                 sum(CASE WHEN event_id IS NOT NULL THEN amount_fils ELSE 0 END) AS fils_with_event
            FROM expenses GROUP BY 1`);

      // The imported profit-and-loss — the only place true COGS exists.
      await q('S-PL', `SELECT period, period_kind, income_fils, cogs_fils, expenses_fils,
                 gross_profit_fils, net_income_fils
            FROM historical_financials ORDER BY period_kind, period`);

      // Repeat business, from the migrated invoice history.
      await q('S-REPEAT', `SELECT bucket, count(*) AS customers FROM (
              SELECT customer_name,
                     CASE WHEN count(DISTINCT doc_number) = 1 THEN '1 order'
                          WHEN count(DISTINCT doc_number) BETWEEN 2 AND 3 THEN '2-3 orders'
                          ELSE '4+ orders' END AS bucket
                FROM historical_orders WHERE customer_name IS NOT NULL GROUP BY 1) t
             GROUP BY 1 ORDER BY 1`);

      // Part-timer and driver payouts — the labour line, by month.
      await q('S-LABOUR', `SELECT month, person_kind, count(*) AS people,
                 sum(amount_fils) AS total_fils
            FROM staff_payments GROUP BY 1,2 ORDER BY 1`);
    }

    L('DONE');
  } catch (e) {
    L(`error: ${(e as Error).message.slice(0, 200)}`);
  }
}
