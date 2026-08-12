/**
 * Loads the live configuration the pricing engine runs against.
 *
 * Nothing here is cached beyond a short TTL: an admin who changes the
 * delivery fee for Fujairah on the dashboard must see it applied to the
 * next checkout without a deploy or a restart.
 */
import {
  DEFAULT_PRICING_RULES,
  type DeliveryZone,
  type Emirate,
  type PackageDefinition,
  type PricingContext,
  type PricingRules,
  type ServiceDefinition,
} from '@eventana/shared';
import { pool, type Db } from '../db/pool.js';

const CACHE_TTL_MS = 5_000;
let cache: { at: number; value: LoadedConfig } | null = null;

export interface LoadedConfig {
  rules: PricingRules;
  zones: DeliveryZone[];
  services: Map<string, ServiceDefinition>;
  packages: Map<string, PackageDefinition>;
}

function rowToService(r: any): ServiceDefinition {
  return {
    id: r.id,
    name: r.name,
    categoryId: r.category_id,
    priceFils: Number(r.price_fils),
    shortDescription: r.short_description,
    detail: r.detail,
    pricing: r.pricing,
    requiresAssets: r.requires_assets ?? [],
    isInflatable: r.is_inflatable,
    isFoodStation: r.is_food_station,
    extraServingFils: r.extra_serving_fils === null ? null : Number(r.extra_serving_fils),
    needsAdminReview: r.needs_admin_review,
    celebrationTypes: r.celebration_types,
    badge: r.badge,
    gradient: r.gradient,
  };
}

export async function loadConfig(db: Db = pool, { fresh = false } = {}): Promise<LoadedConfig> {
  if (!fresh && cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.value;

  const [settingsRes, zonesRes, servicesRes, packagesRes, itemsRes] = await Promise.all([
    db.query(`SELECT value FROM settings WHERE key = 'pricing_rules'`),
    db.query(`SELECT * FROM delivery_zones ORDER BY zone_name`),
    db.query(`SELECT * FROM services WHERE active ORDER BY id`),
    db.query(`SELECT * FROM packages WHERE active ORDER BY price_fils DESC`),
    db.query(`SELECT * FROM package_items ORDER BY package_id, sort_order`),
  ]);

  const rules: PricingRules = {
    ...DEFAULT_PRICING_RULES,
    ...(settingsRes.rows[0]?.value ?? {}),
  };

  const zones: DeliveryZone[] = zonesRes.rows.map((r) => ({
    zoneName: r.zone_name,
    emirate: r.emirate as Emirate,
    areas: r.areas,
    feeFils: r.fee_fils === null ? null : Number(r.fee_fils),
    available: r.available,
    specialConditions: r.special_conditions,
    effectiveDate: r.effective_date instanceof Date
      ? r.effective_date.toISOString().slice(0, 10)
      : String(r.effective_date),
  }));

  const services = new Map(servicesRes.rows.map((r) => [r.id as string, rowToService(r)]));

  const packages = new Map<string, PackageDefinition>(
    packagesRes.rows.map((r) => [
      r.id as string,
      {
        id: r.id,
        name: r.name,
        priceFils: Number(r.price_fils),
        capacity: r.capacity,
        durationHours: r.duration_hours,
        tag: r.tag,
        gradient: r.gradient,
        hasCastleChoice: r.has_castle_choice,
        items: itemsRes.rows
          .filter((i) => i.package_id === r.id)
          .map((i) => ({ name: i.name, detail: i.detail, assets: i.assets ?? [] })),
      },
    ]),
  );

  const value: LoadedConfig = { rules, zones, services, packages };
  cache = { at: Date.now(), value };
  return value;
}

/** Drops the cache — called whenever admin writes a setting or a price. */
export function invalidateConfigCache(): void {
  cache = null;
}

export function toPricingContext(
  cfg: LoadedConfig,
  unavailableAssets?: Set<string>,
): PricingContext {
  return {
    rules: cfg.rules,
    services: cfg.services,
    packages: cfg.packages,
    zones: cfg.zones,
    unavailableAssets,
  };
}

export async function savePricingRules(rules: Partial<PricingRules>, updatedBy: string) {
  const current = (await loadConfig(pool, { fresh: true })).rules;
  const next = { ...current, ...rules };
  await pool.query(
    `INSERT INTO settings (key, value, updated_by) VALUES ('pricing_rules', $1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`,
    [JSON.stringify(next), updatedBy],
  );
  invalidateConfigCache();
  return next;
}
