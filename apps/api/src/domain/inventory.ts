/**
 * Inventory availability and holds.
 *
 * The rule this file exists to guarantee: a single physical asset can
 * never be sold twice, even when two customers check out in the same
 * millisecond (Tabby spec §1.5, §7 "Two customers, one Bubble House").
 *
 * How the guarantee is made:
 *   1. The reservation window is the FULL operational window — prep,
 *      transport, setup, the event, breakdown, return and cleaning — not
 *      just the customer's four hours (spec §4.2).
 *   2. Acquiring holds locks the `inventory_assets` rows with SELECT ...
 *      FOR UPDATE, in a deterministic order, so concurrent checkouts
 *      queue behind each other instead of both reading "1 free".
 *   3. Only then does it count overlapping live holds. Losing the count
 *      raises a ConflictError and the whole checkout transaction rolls
 *      back — no order, no hold, nothing half-written.
 */
import type { PoolClient } from 'pg';
import { pool, type Db } from '../db/pool.js';

/** UAE is UTC+4 year round — no daylight saving to track. */
const UAE_OFFSET = '+04:00';

export class ConflictError extends Error {
  readonly code = 'unavailable';
  constructor(
    message: string,
    readonly assets: string[],
  ) {
    super(message);
    this.name = 'ConflictError';
  }
}

export interface ReservationWindow {
  startsAt: Date;
  endsAt: Date;
}

/**
 * The operational window for an event, widened by each asset's own prep
 * and breakdown buffers. Computed per asset because a 12×6 m slippery
 * football pitch needs longer than a snow machine.
 */
export function eventWindow(
  eventDate: string,
  startTime: string,
  endHour: number,
  bufferBeforeMinutes: number,
  bufferAfterMinutes: number,
): ReservationWindow {
  const start = new Date(`${eventDate}T${normaliseTime(startTime)}:00${UAE_OFFSET}`);
  // endHour can be 24 (midnight) or beyond only if a rule allowed it; the
  // Date maths rolls into the next day correctly either way.
  const startOfDay = new Date(`${eventDate}T00:00:00${UAE_OFFSET}`);
  const end = new Date(startOfDay.getTime() + endHour * 3_600_000);

  return {
    startsAt: new Date(start.getTime() - bufferBeforeMinutes * 60_000),
    endsAt: new Date(end.getTime() + bufferAfterMinutes * 60_000),
  };
}

function normaliseTime(time: string): string {
  const [h = '0', m = '0'] = time.split(':');
  return `${h.padStart(2, '0')}:${m.padStart(2, '0')}`;
}

export interface AssetRow {
  code: string;
  name: string;
  variant: string | null;
  units: number;
  buffer_before_minutes: number;
  buffer_after_minutes: number;
  status: string;
}

export async function getAssets(db: Db, codes: string[]): Promise<AssetRow[]> {
  if (codes.length === 0) return [];
  const { rows } = await db.query<AssetRow>(
    `SELECT * FROM inventory_assets WHERE code = ANY($1)`,
    [codes],
  );
  return rows;
}

/**
 * Which of `codes` cannot be booked for this date/time. Read-only — used
 * to grey out items in the catalogue and to warn before checkout. It is
 * NOT the safety net: only `acquireHolds` is, because only that locks.
 */
export async function unavailableAssets(
  db: Db,
  codes: string[],
  eventDate: string,
  startTime: string,
  endHour: number,
): Promise<Set<string>> {
  const assets = await getAssets(db, codes);
  const taken = new Set<string>();

  for (const asset of assets) {
    if (asset.status !== 'available') {
      taken.add(asset.code);
      continue;
    }
    const win = eventWindow(
      eventDate,
      startTime,
      endHour,
      asset.buffer_before_minutes,
      asset.buffer_after_minutes,
    );
    const { rows } = await db.query<{ used: number }>(
      `SELECT count(*)::int AS used
         FROM inventory_holds
        WHERE asset_code = $1
          AND status IN ('held', 'reserved')
          AND (expires_at IS NULL OR expires_at > now())
          AND starts_at < $3
          AND ends_at   > $2`,
      [asset.code, win.startsAt, win.endsAt],
    );
    if ((rows[0]?.used ?? 0) >= asset.units) taken.add(asset.code);
  }

  return taken;
}

export interface AcquireHoldsInput {
  orderId: string;
  assetCodes: string[];
  eventDate: string;
  startTime: string;
  endHour: number;
  holdMinutes: number;
}

/**
 * Takes a temporary hold on every asset the cart needs, or takes none.
 * MUST be called inside a transaction — the row locks it relies on are
 * released at commit or rollback.
 */
export async function acquireHolds(
  db: PoolClient,
  input: AcquireHoldsInput,
): Promise<number[]> {
  const codes = [...new Set(input.assetCodes)].sort();
  if (codes.length === 0) return [];

  // Deterministic lock order across all callers: two concurrent checkouts
  // that need the same two assets can never take them in opposite orders
  // and deadlock.
  const { rows: assets } = await db.query<AssetRow>(
    `SELECT * FROM inventory_assets WHERE code = ANY($1) ORDER BY code FOR UPDATE`,
    [codes],
  );

  const missing = codes.filter((c) => !assets.some((a) => a.code === c));
  if (missing.length > 0) {
    throw new ConflictError(`Unknown inventory asset: ${missing.join(', ')}`, missing);
  }

  const conflicts: string[] = [];
  const created: number[] = [];
  const expiresAt = new Date(Date.now() + input.holdMinutes * 60_000);

  for (const asset of assets) {
    if (asset.status !== 'available') {
      conflicts.push(asset.code);
      continue;
    }

    const win = eventWindow(
      input.eventDate,
      input.startTime,
      input.endHour,
      asset.buffer_before_minutes,
      asset.buffer_after_minutes,
    );

    const { rows } = await db.query<{ used: number }>(
      `SELECT count(*)::int AS used
         FROM inventory_holds
        WHERE asset_code = $1
          AND status IN ('held', 'reserved')
          AND (expires_at IS NULL OR expires_at > now())
          AND starts_at < $3
          AND ends_at   > $2`,
      [asset.code, win.startsAt, win.endsAt],
    );

    if ((rows[0]?.used ?? 0) >= asset.units) {
      conflicts.push(asset.code);
      continue;
    }

    const inserted = await db.query<{ id: number }>(
      `INSERT INTO inventory_holds (asset_code, order_id, starts_at, ends_at, expires_at, status)
       VALUES ($1,$2,$3,$4,$5,'held') RETURNING id`,
      [asset.code, input.orderId, win.startsAt, win.endsAt, expiresAt],
    );
    created.push(inserted.rows[0].id);
  }

  if (conflicts.length > 0) {
    // Rolling back the transaction discards the rows inserted above; the
    // caller must not swallow this.
    const names = assets
      .filter((a) => conflicts.includes(a.code))
      .map((a) => (a.variant ? `${a.name} (${a.variant})` : a.name));
    throw new ConflictError(
      `No longer available for your date and time: ${names.join(', ')}`,
      conflicts,
    );
  }

  return created;
}

/** Turns this order's temporary holds into firm reservations. */
export async function confirmHolds(db: Db, orderId: string, eventId: string): Promise<number> {
  const { rowCount } = await db.query(
    `UPDATE inventory_holds
        SET status = 'reserved', expires_at = NULL, event_id = $2
      WHERE order_id = $1 AND status = 'held'`,
    [orderId, eventId],
  );
  return rowCount ?? 0;
}

export async function releaseHolds(db: Db, orderId: string, reason = 'released'): Promise<number> {
  const { rowCount } = await db.query(
    `UPDATE inventory_holds SET status = 'released'
      WHERE order_id = $1 AND status = 'held'`,
    [orderId],
  );
  void reason;
  return rowCount ?? 0;
}

/**
 * True when this order's holds are gone — expired or explicitly released.
 * Checked before confirming a late webhook: a success that arrives after
 * the hold lapsed and the asset went to someone else must NOT confirm
 * (spec §6.5).
 */
export async function holdsStillValid(db: Db, orderId: string): Promise<boolean> {
  const { rows } = await db.query<{ live: number; total: number }>(
    `SELECT
       count(*) FILTER (
         WHERE status = 'reserved'
            OR (status = 'held' AND (expires_at IS NULL OR expires_at > now()))
       )::int AS live,
       count(*)::int AS total
     FROM inventory_holds WHERE order_id = $1`,
    [orderId],
  );
  const row = rows[0];
  if (!row || row.total === 0) return true; // nothing physical to protect
  return row.live === row.total;
}

/** Housekeeping: mark lapsed holds released so the dashboard reads true. */
export async function expireStaleHolds(db: Db = pool): Promise<number> {
  const { rowCount } = await db.query(
    `UPDATE inventory_holds SET status = 'released'
      WHERE status = 'held' AND expires_at IS NOT NULL AND expires_at <= now()`,
  );
  return rowCount ?? 0;
}
