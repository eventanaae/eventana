/** Shared domain types for the Eventana customer app, dashboard and engine. */

export type CelebrationType =
  | 'kids'
  | 'graduation'
  | 'bride'
  | 'baby'
  | 'gender'
  | 'adult'
  | 'customc';

export type Emirate =
  | 'Dubai'
  | 'Abu Dhabi'
  | 'Al Ain'
  | 'Ajman'
  | 'Sharjah'
  | 'Umm Al Quwain'
  | 'Ras Al Khaimah'
  | 'Fujairah'
  | 'Al Gharbia';

/** A delivery zone row. Admin-editable — never hard-coded in the client. */
export interface DeliveryZone {
  zoneName: string;
  emirate: Emirate;
  areas: string[] | null;
  /** Fils. `null` means Eventana does not deliver to this zone. */
  feeFils: number | null;
  available: boolean;
  specialConditions: string | null;
  effectiveDate: string;
}

/** How a service is priced. */
export type PricingUnit =
  | { kind: 'flat' }
  /** Priced per child, with a floor on the billable head count. */
  | { kind: 'per_child'; minChildren: number }
  /** Priced per piece, with a minimum order quantity. */
  | { kind: 'per_piece'; minQuantity: number };

export interface ServiceDefinition {
  id: string;
  name: string;
  categoryId: string;
  /** Fils. For per_child/per_piece this is the price of ONE unit. */
  priceFils: number;
  shortDescription: string;
  /** The one clean description shown on the item card (spec item 10). */
  detail: string | null;
  pricing: PricingUnit;
  /** Physical asset codes this service consumes; drives availability. */
  requiresAssets: string[];
  isInflatable: boolean;
  isFoodStation: boolean;
  /** Extra-servings price per +10 servings, fils. Null when not applicable. */
  extraServingFils: number | null;
  /** Price not yet confirmed by Eventana admin — surfaced in the UI. */
  needsAdminReview: boolean;
  celebrationTypes: CelebrationType[];
  badge: string | null;
  gradient: string;
}

export interface ServiceCategory {
  id: string;
  name: string;
  note: string;
  celebrationTypes: CelebrationType[];
  sortOrder: number;
}

export interface PackageItem {
  name: string;
  detail: string;
  assets: string[];
}

export interface PackageDefinition {
  id: string;
  name: string;
  priceFils: number;
  capacity: string;
  durationHours: number;
  tag: string;
  gradient: string;
  hasCastleChoice: boolean;
  items: PackageItem[];
}

export interface ThemeDefinition {
  id: string;
  name: string;
  tags: string[];
  colors: [string, string, string];
  gradient: string;
  popular: boolean;
  featured: boolean;
  active: boolean;
  celebrationType: CelebrationType;
  sortOrder: number;
}

/** A physical, bookable unit. Two customers can never hold the same one. */
export interface InventoryAsset {
  code: string;
  name: string;
  /** Variant of a shared asset, e.g. a bouncy castle colour. */
  variant: string | null;
  units: number;
  /** Minutes of prep/transport/cleaning reserved around the event window. */
  bufferBeforeMinutes: number;
  bufferAfterMinutes: number;
}

/* ------------------------------------------------------------------ */
/* Cart + quote                                                        */
/* ------------------------------------------------------------------ */

export interface CartServiceLine {
  serviceId: string;
  /** Children for per_child services; pieces for per_piece; else 1. */
  quantity: number;
}

export interface CartInput {
  celebrationType: CelebrationType;
  /** Set for a fixed-package booking; null for Build Your Own. */
  packageId: string | null;
  /** Build-Your-Own services, or paid extras added onto a package. */
  services: CartServiceLine[];
  themeId: string | null;
  customTheme: boolean;
  emirate: Emirate | null;
  /** "17:00" — 24h local time. */
  startTime: string | null;
  eventDate: string | null;
  childrenCount: number;
  castleVariant?: string | null;
}

export type QuoteLineKind =
  | 'package'
  | 'service'
  | 'custom_theme'
  | 'discount'
  | 'delivery'
  | 'surcharge'
  | 'addon';

export interface QuoteLine {
  kind: QuoteLineKind;
  /** Service/package id where one exists. */
  refId: string | null;
  label: string;
  quantity: number;
  unitFils: number;
  amountFils: number;
  /** Counts toward the Build-Your-Own discount threshold and the discount. */
  discountEligible: boolean;
}

export interface QuoteProblem {
  code:
    | 'not_serviced'
    | 'missing_emirate'
    | 'missing_time'
    | 'end_after_midnight'
    | 'below_minimum'
    | 'unavailable'
    | 'empty_cart'
    | 'unknown_service'
    | 'missing_map_pin'
    | 'missing_date'
    | 'too_soon'
    | 'item_needs_lead';
  message: string;
  refId?: string;
}

export interface Quote {
  lines: QuoteLine[];
  /** Sum of discount-eligible service lines, fils. */
  eligibleSubtotalFils: number;
  discountUnlocked: boolean;
  discountFils: number;
  customThemeFeeFils: number;
  deliveryFils: number;
  totalFils: number;
  /** Fils still needed to unlock the 15%; 0 once unlocked. */
  remainingToUnlockFils: number;
  startTime: string | null;
  endTime: string | null;
  problems: QuoteProblem[];
  bookable: boolean;
}

/* ------------------------------------------------------------------ */
/* Orders, payments, events                                            */
/* ------------------------------------------------------------------ */

export type OrderStatus =
  | 'awaiting_payment'
  | 'processing'
  | 'paid'
  | 'failed'
  | 'cancelled'
  | 'refunded'
  | 'partially_refunded'
  | 'needs_review';

/** Eventana's own payment status. Provider statuses map onto these. */
export type PaymentStatus =
  | 'created'
  | 'processing'
  | 'paid'
  | 'captured'
  | 'failed'
  | 'cancelled'
  | 'refunded'
  | 'partially_refunded'
  | 'needs_review';

export type ProviderName = 'tabby' | 'tamara' | 'ziina';

export type OrderKind = 'booking' | 'addon';

export interface AddonRequest {
  /** Extra hours at AED 800 each; capped by the midnight rule. */
  additionalHours: number;
  /** Pairs of kids socks at AED 12. */
  socksPairs: number;
  /** serviceId -> number of +10 serving blocks. */
  extraServings: Record<string, number>;
}

export type EventPhase =
  | 'Booking Confirmed'
  | 'Preparing'
  | 'On The Way'
  | 'Arrived'
  | 'Setting Up'
  | 'Setup Ready'
  | 'Party Started'
  | 'Event Completed'
  /**
   * Terminal. A cancelled event is not a stage of the normal timeline —
   * it replaces it. Live tracking stops, the timeline collapses to
   * Confirmed → Cancelled, and no further self-service purchase or
   * change is accepted.
   */
  | 'Cancelled';

/** The normal progression, in order. Excludes the terminal Cancelled. */
export const EVENT_PHASES: EventPhase[] = [
  'Booking Confirmed',
  'Preparing',
  'On The Way',
  'Arrived',
  'Setting Up',
  'Setup Ready',
  'Party Started',
  'Event Completed',
];

/**
 * A cancelled event is frozen for the customer: no additional hour, no
 * socks, no extra servings, and no self-service location change. Both the
 * API and the app gate on this single predicate so they can never drift.
 */
export function isCancelled(phase: string | null | undefined): boolean {
  return phase === 'Cancelled';
}

/** What the customer's timeline shows once an event is cancelled. */
export const CANCELLED_TIMELINE = [
  { label: 'Booking Confirmed', mark: '✓', done: true },
  { label: 'Cancelled', mark: '✕', done: false },
] as const;

export type TaskDepartment = 'design' | 'operations' | 'inventory' | 'logistics' | 'finance';
