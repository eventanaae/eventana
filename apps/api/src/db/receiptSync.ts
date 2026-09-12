/**
 * Repair sweep: reconcile every upcoming, converted receipt's PAID services onto
 * its event and (re)generate prep tasks, then report what was missing and which
 * jobs still have nobody assigned. Gated by RECEIPT_SYNC=1.
 *
 * This is the fix for the owner's 2026-09-12 incident: services a customer paid
 * for on the receipt weren't showing on the event page and never became prep
 * tasks (ensureEventForReceipt only copies items on the FIRST conversion). The
 * heavy lifting lives in finance.syncAllUpcomingReceipts (also used live on every
 * receipt edit); this just runs it at boot and prints the findings.
 */
import { syncAllUpcomingReceipts } from '../domain/finance.js';

const P = (s: string) => console.log(`[receipt-sync] ${s}`);

export async function receiptSyncFromEnv(): Promise<void> {
  if (String(process.env.RECEIPT_SYNC ?? '').trim() !== '1') return;
  try {
    const rep = await syncAllUpcomingReceipts();
    P(`scanned ${rep.scanned} upcoming converted receipt(s)`);
    if (rep.changed.length === 0) {
      P('no missing/changed services — every paid service is already on its event');
    } else {
      P(`repaired ${rep.changed.length} event(s) whose event page was out of sync with the paid receipt:`);
      for (const c of rep.changed) {
        const parts: string[] = [];
        if (c.added.length) parts.push(`ADDED: ${c.added.join(', ')}`);
        if (c.updated.length) parts.push(`QTY/PRICE FIXED: ${c.updated.join(', ')}`);
        if (c.removed.length) parts.push(`REMOVED (no longer on receipt): ${c.removed.join(', ')}`);
        P(`  ${c.eventId} · ${c.date} · ${c.customer} — ${parts.join(' | ')}`);
      }
    }
    if (rep.unassigned.length === 0) {
      P('all upcoming prep tasks have someone assigned');
    } else {
      P(`⚠️ ${rep.unassigned.length} upcoming event(s) STILL have prep tasks with nobody assigned:`);
      for (const u of rep.unassigned) {
        P(`  ${u.eventId} · ${u.date} — ${u.titles.join(', ')}`);
      }
    }
  } catch (err) {
    P(`failed: ${(err as Error).message}`);
  }
  P('DONE');
}
