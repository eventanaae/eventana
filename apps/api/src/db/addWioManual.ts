/** One-time: add the card payment alerts the owner pasted manually (not captured by the
 *  mail poller) to the approval queue as pending bank_transactions. Guarded per-item by
 *  dedupe_key + a single boot guard so re-runs never duplicate. */
import { ingestExternalTxn } from '../domain/bankInbox.js';
import { pool } from './pool.js';

type ManualTxn = {
  amountFils: number;
  merchant: string;
  postedOn: string;   // YYYY-MM-DD
  source: string;     // 'wio' | 'rakbank'
  raw: string;
  dedupeKey: string;
};

// Owner-pasted card alerts (2026-09-22). Debits only. Dates from the day/date she gave;
// the Zed 39.45 alert carried no date, so it's tagged today and noted for her to confirm.
const ITEMS: ManualTxn[] = [
  {
    amountFils: 3945, merchant: 'Zed Mobility', postedOn: '2026-09-22', source: 'wio',
    raw: 'Payment of 39.45 AED at Zed Mobility using your Wio card 6295 with Own AED funds. (owner-added; date not stated — please confirm)',
    dedupeKey: 'wio|zed-mobility|3945|owner-added',
  },
  {
    amountFils: 20000, merchant: 'ADNOC', postedOn: '2026-09-20', source: 'wio',
    raw: 'Payment of 200 AED at ADNOC using your Wio card 6295 with Own AED funds. (Sunday, owner-added)',
    dedupeKey: 'wio|adnoc|20000|owner-2026-09-20',
  },
  {
    amountFils: 3085, merchant: 'Zed Mobility', postedOn: '2026-09-19', source: 'rakbank',
    raw: 'مبلغ بقيمة 30.85 AED تم charged على بطاقتكم رقم 546750******4008 من ZED MOBILITY بتاريخ 19/09. (Saturday, owner-added)',
    dedupeKey: 'rakbank|zed-mobility|3085|owner-2026-09-19',
  },
  {
    amountFils: 16600, merchant: 'Party Zone LLC Beach', postedOn: '2026-09-18', source: 'rakbank',
    raw: 'مبلغ بقيمة 166.00 AED تم charged على بطاقتكم رقم 546750******4008 من PARTY ZONE LLC BEACH بتاريخ 18/09. (Friday, owner-added)',
    dedupeKey: 'rakbank|party-zone-beach|16600|owner-2026-09-18',
  },
];

export async function addWioManualFromEnv(): Promise<void> {
  if (String(process.env.RUN_MIGRATIONS_ON_BOOT ?? '').toLowerCase() !== 'true') return;
  const tag = process.env.ADD_WIO_MANUAL_TAG ?? 'v1';
  const guardKey = `add_wio_manual_${tag}`;
  const guard = await pool.query(`SELECT 1 FROM app_kv WHERE k = $1`, [guardKey]).catch(() => ({ rowCount: 0 }));
  if (guard.rowCount) return;
  for (const t of ITEMS) {
    try {
      const res = await ingestExternalTxn({
        amountFils: t.amountFils,
        direction: 'debit',
        kind: 'purchase',
        merchant: t.merchant,
        postedOn: t.postedOn,
        raw: t.raw,
        source: t.source,
        dedupeKey: t.dedupeKey,
      });
      console.log(`[add-wio-manual] ${t.merchant} AED ${(t.amountFils / 100).toFixed(2)} @ ${t.postedOn} → id ${res.id}${res.duplicate ? ' (already existed)' : ''}`);
    } catch (e) {
      console.error(`[add-wio-manual] FAILED ${t.merchant} AED ${(t.amountFils / 100).toFixed(2)}:`, (e as Error).message);
    }
  }
  await pool.query(`INSERT INTO app_kv (k, v) VALUES ($1, now()) ON CONFLICT (k) DO NOTHING`, [guardKey]).catch(() => {});
}
