/**
 * One-shot: force an IMMEDIATE Zoho bank sync, instead of waiting for the ~6h
 * throttle — used right after the owner reconnects the RAKBANK/Wio feed in
 * Zoho Books so the backfilled transactions land in the Bank Inbox now.
 *
 * Triggered by reusing SET_SHAN_LEADER='zohosync' (Render caps the service at
 * 300 env vars, which blocks a dedicated key). It clears the throttle watermark
 * so syncZohoBank() isn't skipped, then runs it directly. Blank SET_SHAN_LEADER
 * afterwards. Safe to re-run any time: ingestExternalTxn dedupes by Zoho
 * transaction_id, so a re-scan can never double-count. (The 30-day re-scan
 * overlap means this also sweeps up anything the feed backfilled with an older
 * date while it was disconnected.)
 */
import { pool } from './pool.js';

export async function forceZohoSyncFromEnv(): Promise<void> {
  if (process.env.SET_SHAN_LEADER !== 'zohosync') return;
  // Drop the 6h throttle marker so the sync runs now rather than returning early.
  await pool
    .query(`DELETE FROM app_kv WHERE k = 'zoho_bank_sync_at'`)
    .catch((e) => console.error('[zoho-force] clear throttle failed:', e));
  console.log('[zoho-force] running an immediate Zoho bank sync (owner reconnected the feed)…');
  const { syncZohoBank } = await import('../domain/syncZohoBank.js');
  await syncZohoBank().catch((e) => console.error('[zoho-force] sync failed:', e));
  console.log('[zoho-force] DONE — look for "[zoho-sync] queued N bank transaction(s)" above. Blank SET_SHAN_LEADER now.');
}
