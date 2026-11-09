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

/**
 * Turns this order's LIVE temporary holds into firm reservations. A hold that
 * already lapsed is never promoted blindly (the asset may have been sold to
 * someone else since): if any asset is left without a live hold, the late-
 * success path re-acquires it under lock — throwing ConflictError if it is
 * taken — and the fresh hold is then promoted. Call inside a transaction.
 */
export async function confirmHolds(db: Db, orderId: string, eventId: string): Promise<number> {
  const promote = async () =>
    (
      await db.query(
        `UPDATE inventory_holds
            SET status = 'reserved', expires_at = NULL, event_id = $2
          WHERE order_id = $1 AND status = 'held'
            AND (expires_at IS NULL OR expires_at > now())`,
        [orderId, eventId],
      )
    ).rowCount ?? 0;
  let promoted = await promote();
  if (!(await holdsStillValid(db, orderId))) {
    await reacquireLapsedHolds(db, orderId);
    promoted += await promote();
  }
  return promoted;
}

/**
 * Late success: the order's holds lapsed before its payment landed. Re-take
 * every asset that has no live hold for this order, over the SAME window the
 * original hold covered, with the same lock-then-count guarantee as
 * acquireHolds. Throws ConflictError (writing nothing the caller's rollback
 * won't discard) when any asset is now taken. MUST run inside a transaction.
 */
export async function reacquireLapsedHolds(db: Db, orderId: string, holdMinutes = 10): Promise<number> {
  // Lapsed-but-unswept rows are closed first so they never linger as 'held'.
  await db.query(
    `UPDATE inventory_holds SET status = 'released'
      WHERE order_id = $1 AND status = 'held' AND expires_at IS NOT NULL AND expires_at <= now()`,
    [orderId],
  );
  const { rows: lapsed } = await db.query<{ asset_code: string; starts_at: Date; ends_at: Date }>(
    `SELECT DISTINCT ON (asset_code) asset_code, starts_at, ends_at
       FROM inventory_holds h
      WHERE order_id = $1
        AND NOT EXISTS (
          SELECT 1 FROM inventory_holds l
           WHERE l.order_id = h.order_id AND l.asset_code = h.asset_code
             AND (l.status = 'reserved'
                  OR (l.status = 'held' AND (l.expires_at IS NULL OR l.expires_at > now()))))
      ORDER BY asset_code, id DESC`,
    [orderId],
  );
  if (lapsed.length === 0) return 0;

  const codes = lapsed.map((r) => r.asset_code).sort();
  const { rows: assets } = await db.query<AssetRow>(
    `SELECT * FROM inventory_assets WHERE code = ANY($1) ORDER BY code FOR UPDATE`,
    [codes],
  );
  const expiresAt = new Date(Date.now() + holdMinutes * 60_000);
  const conflicts: string[] = [];
  let created = 0;
  for (const code of codes) {
    const asset = assets.find((a) => a.code === code);
    const win = lapsed.find((r) => r.asset_code === code)!;
    if (!asset || asset.status !== 'available') {
      conflicts.push(code);
      continue;
    }
    const { rows } = await db.query<{ used: number }>(
      `SELECT count(*)::int AS used
         FROM inventory_holds
        WHERE asset_code = $1
          AND order_id IS DISTINCT FROM $4
          AND status IN ('held', 'reserved')
          AND (expires_at IS NULL OR expires_at > now())
          AND starts_at < $3
          AND ends_at   > $2`,
      [code, win.starts_at, win.ends_at, orderId],
    );
    if ((rows[0]?.used ?? 0) >= asset.units) {
      conflicts.push(code);
      continue;
    }
    await db.query(
      `INSERT INTO inventory_holds (asset_code, order_id, starts_at, ends_at, expires_at, status)
       VALUES ($1,$2,$3,$4,$5,'held')`,
      [code, orderId, win.starts_at, win.ends_at, expiresAt],
    );
    created++;
  }
  if (conflicts.length > 0) {
    throw new ConflictError(`Lapsed hold could not be re-acquired: ${conflicts.join(', ')}`, conflicts);
  }
  return created;
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
  // Valid when EVERY asset the order holds still has at least one LIVE hold.
  // Grouping by asset_code is essential: re-opening a pay-link runs
  // releaseHolds()+acquireHolds(), leaving an old 'released' row AND a fresh live
  // 'held' row for the SAME asset — the order is still protected. The old
  // live===count(*) check counted those released rows and wrongly failed, sending
  // a real PAID booking to needs_review (charged, no event created). A genuinely
  // lapsed asset (all its rows released/expired, none re-held) still reads invalid.
  const { rows } = await db.query<{ ok: boolean | null }>(
    `SELECT bool_and(has_live) AS ok FROM (
       SELECT asset_code,
              bool_or(status = 'reserved' OR (status = 'held' AND (expires_at IS NULL OR expires_at > now()))) AS has_live
         FROM inventory_holds WHERE order_id = $1 GROUP BY asset_code
     ) t`,
    [orderId],
  );
  const ok = rows[0]?.ok;
  return ok == null || ok === true; // no physical holds (null) → nothing to protect
}

/** Housekeeping: mark lapsed holds released so the dashboard reads true. */
export async function expireStaleHolds(db: Db = pool): Promise<number> {
  const { rowCount } = await db.query(
    `UPDATE inventory_holds SET status = 'released'
      WHERE status = 'held' AND expires_at IS NOT NULL AND expires_at <= now()`,
  );
  return rowCount ?? 0;
}
