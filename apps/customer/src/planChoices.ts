/**
 * Helpers for dropping an AI-generated plan (Assistant planner, AI Party
 * Designer) into the cart. The server's plan can name services without the
 * choices the cart needs, and with per-child quantities below the activity
 * minimum — both made the cart unbookable at checkout with no hint why.
 */
import type { Catalogue } from './api';

type Services = Record<string, number>;

/** Raise every quantity to what the service can actually be booked at: per-child
 *  activities to their minimum head count (20), per-piece items to their
 *  minimum order. A 10-child plan otherwise failed "requires a minimum of 20". */
export function clampPlanServices(services: Services, catalogue: Catalogue): Services {
  const byId = new Map(catalogue.services.map((s) => [s.id, s]));
  const out: Services = {};
  for (const [id, raw] of Object.entries(services ?? {})) {
    const qty = Math.floor(Number(raw) || 0);
    if (qty <= 0) continue;
    const s = byId.get(id);
    const min =
      s?.pricing.kind === 'per_child' ? Math.max(1, s.pricing.minChildren ?? 1)
        : s?.pricing.kind === 'per_piece' ? Math.max(1, s.pricing.minQuantity ?? 1)
        : 1;
    out[id] = Math.max(qty, min);
  }
  return out;
}

/** Glam Dolls need one look per doll — size the list to the booked quantity so
 *  the Build screen shows a picker for each. */
export function glamDollsFor(services: Services): Array<{ skin: string; dress: string }> {
  const n = Math.min(2, Math.max(0, services.glamdolls ?? 0));
  return Array.from({ length: n }, () => ({ skin: '', dress: '' }));
}

/**
 * Choices the customer still has to make before this cart can be booked:
 * kiosk colour per food/games station, the mascot character, each Glam Doll's
 * look, the castle colour (Build castle, or a package with a castle choice).
 */
export function missingPlanChoices(
  services: Services,
  packageId: string | null,
  catalogue: Catalogue,
  lang: 'en' | 'ar',
): string[] {
  const ar = lang === 'ar';
  const byId = new Map(catalogue.services.map((s) => [s.id, s]));
  const out: string[] = [];
  for (const id of Object.keys(services)) {
    const s = byId.get(id);
    if (!s) continue;
    if (s.categoryId === 'food' || s.categoryId === 'games') out.push(ar ? `لون كشك ${s.name}` : `${s.name} colour`);
    if (id === 'mascot') out.push(ar ? 'الشخصية الكرتونية' : 'mascot character');
    if (id === 'glamdolls') out.push(ar ? 'شكل الدمى' : 'Glam Doll looks');
    if (id === 'castle') out.push(ar ? 'لون القلعة' : 'castle colour');
  }
  const pkg = packageId ? catalogue.packages.find((p) => p.id === packageId) : null;
  if (pkg?.hasCastleChoice) out.push(ar ? 'لون القلعة' : 'castle colour');
  return out;
}
