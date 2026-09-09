/**
 * READ-ONLY. Dumps live `customers` and `historical_customers` (the QuickBooks
 * import) as chunked JSON to the logs, so a full data reconciliation can compare
 * them offline against the fresh QuickBooks reports. Writes NOTHING. Gated by
 * RECON_DUMP=customers (add more sections later as needed).
 */
import { pool } from './pool.js';

export async function reconDumpFromEnv(): Promise<void> {
  const mode = String(process.env.RECON_DUMP ?? '').toLowerCase();
  if (!['customers', 'expenses', 'orders', 'all', 'true'].includes(mode)) return;
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
    L('DONE');
  } catch (e) {
    L(`error: ${(e as Error).message.slice(0, 200)}`);
  }
}
