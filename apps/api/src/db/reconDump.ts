/**
 * READ-ONLY. Dumps live `customers` and `historical_customers` (the QuickBooks
 * import) as chunked JSON to the logs, so a full data reconciliation can compare
 * them offline against the fresh QuickBooks reports. Writes NOTHING. Gated by
 * RECON_DUMP=customers (add more sections later as needed).
 */
import { pool } from './pool.js';

export async function reconDumpFromEnv(): Promise<void> {
  const mode = String(process.env.RECON_DUMP ?? '').toLowerCase();
  if (mode !== 'customers' && mode !== 'true') return;
  const L = (s: string) => console.log(`[recon-dump] ${s}`);
  const chunkLog = async (tag: string, rows: any[], size = 50) => {
    const n = Math.max(1, Math.ceil(rows.length / size));
    for (let i = 0; i < n; i++) L(`${tag} ${i + 1}/${n} ${JSON.stringify(rows.slice(i * size, (i + 1) * size))}`);
  };
  try {
    const c = await pool.query(
      `SELECT id, name, email, phone, backup_phone, origin FROM customers ORDER BY lower(name), id`,
    );
    await chunkLog('CUST', c.rows);
    const h = await pool.query(
      `SELECT id, full_name, email, phone, phone_alt, emirate, bill_address FROM historical_customers ORDER BY lower(full_name), id`,
    );
    await chunkLog('HIST', h.rows);
    L(`DONE customers=${c.rows.length} historical=${h.rows.length}`);
  } catch (e) {
    L(`error: ${(e as Error).message.slice(0, 200)}`);
  }
}
