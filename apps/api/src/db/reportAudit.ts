/**
 * Read-only MONTHLY REPORT audit, logged to the boot log (no DB console needed).
 * Gated by REPORT_AUDIT=true. Sends NOTHING, changes NOTHING — pure SELECTs.
 *
 * Calls the REAL report code (computeSummary) for a spread of months + years so
 * the owner-facing figures (orders, total amount, top 5 items, top 3 emirates,
 * top 3 expenses) can be verified before the email goes out. No profit line —
 * the report shows operational numbers, not a P&L.
 */
import { computeSummary } from '../domain/financeReport.js';

const P = (s: string) => console.log(`[report-audit] ${s}`);
const aed = (fils: number) => (fils / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export async function reportAuditFromEnv(): Promise<void> {
  if (process.env.REPORT_AUDIT !== 'true') return;
  try {
    const now = new Date();
    const cur = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
    const prev = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
    const prevStr = `${prev.getUTCFullYear()}-${String(prev.getUTCMonth() + 1).padStart(2, '0')}`;
    // Current + last month (live data) and three historical QuickBooks months.
    const months = [cur, prevStr, '2026-07', '2025-12', '2024-06'];
    for (const m of months) {
      const s = await computeSummary(m);
      P(`── ${m} ──`);
      P(`  orders: ${s.ordersCount}   total: AED ${aed(s.revenueFils)}   expenses: AED ${aed(s.expensesFils)}   tips: AED ${aed(s.tipsFils)}`);
      P(`  top 5 items: ${s.topItems.length ? s.topItems.map((t) => `${t.name} (${t.count}x)`).join(' · ') : '(none)'}`);
      P(`  top 3 emirates: ${s.topEmirates.length ? s.topEmirates.map((e) => `${e.emirate} (${e.count})`).join(' · ') : '(none)'}`);
      P(`  top 3 expenses: ${s.byCategory.length ? s.byCategory.map((c) => `${c.category} AED ${aed(c.amountFils)}`).join(' · ') : '(none)'}`);
    }
    P('done.');
  } catch (err) {
    console.error('[report-audit] failed:', (err as Error).message);
  }
}
