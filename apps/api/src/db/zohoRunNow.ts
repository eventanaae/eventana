/**
 * TEMP: run the Zoho bank sync immediately on boot (clears the 6h throttle first)
 * so we can verify a real transaction flows Zoho → Bank Inbox without waiting for
 * the next sweep. Gated by ZOHO_RUN_NOW=run. Remove once verified.
 */
import { pool } from './pool.js';

export async function zohoRunNowFromEnv(): Promise<void> {
  if ((process.env.RUN_MIGRATIONS_ON_BOOT ?? '').toLowerCase() !== 'true') return;
  if ((process.env.ZOHO_RUN_NOW ?? '') !== 'run') return;
  await pool.query(`DELETE FROM app_kv WHERE k='zoho_bank_sync_at'`).catch(() => {});
  console.log('[zoho-run-now] throttle cleared — running syncZohoBank now...');
  try {
    const { syncZohoBank } = await import('../domain/syncZohoBank.js');
    await syncZohoBank();
    console.log('[zoho-run-now] syncZohoBank finished');
  } catch (e) {
    console.error('[zoho-run-now] failed:', (e as Error).message);
  }
}
