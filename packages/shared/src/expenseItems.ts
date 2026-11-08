/**
 * Owner's rule (Nov 2026): every expense that BUYS something must list the
 * items bought, one by one (name + quantity, price optional), under the
 * receipt — so the receipt photo, the amount and what was bought are all clear.
 * Accounts that are services or money movements (salaries, delivery, bank fees,
 * subscriptions, rent, ads…) don't buy items, so they are exempt.
 */
export interface ExpenseItem {
  name: string;
  qty: number;
  /** Optional unit price in fils. */
  unitFils?: number | null;
}

const EXEMPT = /ship|deliver|courier|taxi|transport|salar|part.?tim|wage|bank|fee|forex|dues|subscri|admin|advertis|marketing|meal|entertain|community|rent|fuel|petrol|utilit|electric|water bill|transfer|salik|fine|visa|licen|insur|phone|internet|telecom|commission|refund|tax/i;

/** True when this expense account must carry an itemised list. */
export function expenseNeedsItems(category: string | null | undefined): boolean {
  const c = String(category ?? '').trim();
  if (!c) return true;
  return !EXEMPT.test(c);
}

/** Clean a list from a form: trims names, drops empty rows, qty ≥ 1. */
export function cleanExpenseItems(raw: unknown): ExpenseItem[] {
  if (!Array.isArray(raw)) return [];
  const out: ExpenseItem[] = [];
  for (const r of raw.slice(0, 200)) {
    const name = String((r as any)?.name ?? '').trim().slice(0, 160);
    if (!name) continue;
    const qty = Math.max(1, Math.round(Number((r as any)?.qty) || 1));
    const u = Number((r as any)?.unitFils);
    out.push({ name, qty, unitFils: Number.isFinite(u) && u > 0 ? Math.round(u) : null });
  }
  return out;
}
