/**
 * Booking confirmation — the only place an Event ID is ever minted.
 *
 * Called exclusively from a provider-confirmed payment transition. Runs
 * inside ONE transaction: the reservation, the event, its services, the
 * department tasks, the team assignment, the scheduled notifications and
 * the loyalty award all commit together or not at all (spec §4.8).
 *
 * Idempotent by construction: if the order already has an event, it
 * returns that event and writes nothing. A webhook delivered five times
 * produces one Event ID, one confirmation email and one task set
 * (test plan case 4).
 */
import type { PoolClient } from 'pg';
import {
  eventEndHour,
  formatHour,
  formatHour24,
  parseHour,
  type CartInput,
  type PricingRules,
  type Quote,
} from '@eventana/shared';
import { confirmHolds } from './inventory.js';
import { nextEventId } from './orders.js';

export interface ConfirmResult {
  eventId: string;
  created: boolean;
}

/** Department tasks generated for every confirmed booking. */
function baseTasks(opts: {
  hasCustomTheme: boolean;
  hasInflatable: boolean;
  hasFoodStation: boolean;
  hasBackdrop: boolean;
}) {
  const tasks: Array<{ department: string; title: string }> = [
    { department: 'design', title: 'Prepare theme artwork and setup proposal' },
    { department: 'operations', title: 'Confirm crew roster and call time' },
    { department: 'inventory', title: 'Pick, check and load reserved assets' },
    { department: 'logistics', title: 'Plan route and set team departure time' },
    { department: 'finance', title: 'Verify payment settlement against the order' },
  ];
  if (opts.hasCustomTheme) {
    tasks.push({ department: 'design', title: 'Custom theme design — v1 for customer approval' });
  }
  if (opts.hasBackdrop) {
    tasks.push({ department: 'design', title: 'Confirm backdrop panel dimensions with the customer' });
  }
  if (opts.hasInflatable) {
    tasks.push({ department: 'operations', title: 'Brief crew: socks required, no food or drinks inside inflatables' });
    tasks.push({ department: 'inventory', title: 'Inspect and clean inflatable before dispatch' });
  }
  if (opts.hasFoodStation) {
    tasks.push({ department: 'operations', title: 'Assign station attendant — team operates and serves' });
    tasks.push({ department: 'inventory', title: 'Load consumables for booked food stations' });
  }
  return tasks;
}

export async function confirmBooking(
  db: PoolClient,
  args: {
    orderId: string;
    rules: PricingRules;
    serviceIsInflatable: (id: string) => boolean;
    serviceIsFoodStation: (id: string) => boolean;
  },
): Promise<ConfirmResult> {
  const { rows: orderRows } = await db.query(
    `SELECT * FROM orders WHERE id = $1 FOR UPDATE`,
    [args.orderId],
  );
  const order = orderRows[0];
  if (!order) throw new Error(`Unknown order ${args.orderId}`);

  // Already confirmed? Return the existing event untouched.
  const { rows: existing } = await db.query(`SELECT id FROM events WHERE order_id = $1`, [
    order.id,
  ]);
  if (existing[0]) return { eventId: existing[0].id, created: false };

  if (order.kind === 'addon') {
    // Add-ons attach to an event that already exists.
    await applyAddonOrder(db, order, args.rules);
    return { eventId: order.event_id, created: false };
  }

  const cart = order.cart as CartInput & {
    address?: Record<string, unknown>;
    mapPin?: { lat: number; lng: number };
    customerId?: string;
  };
  const quote = order.quote as Quote;

  const eventId = await nextEventId(db);
  const startTime = cart.startTime!;
  const endHour = eventEndHour(startTime, args.rules);

  await db.query(
    `INSERT INTO events
       (id, order_id, customer_id, celebration_type, package_id, theme_id, custom_theme,
        event_date, start_time, base_end_time, extra_hours, children_count, emirate,
        address, map_lat, map_lng, castle_variant, phase)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,0,$11,$12,$13,$14,$15,$16,'Booking Confirmed')`,
    [
      eventId,
      order.id,
      order.customer_id,
      cart.celebrationType,
      cart.packageId,
      cart.themeId,
      cart.customTheme,
      cart.eventDate,
      startTime,
      // Stored in 24h so arithmetic and comparison stay trivial; the API
      // formats for display at the edge.
      formatHour24(endHour),
      cart.childrenCount ?? 0,
      cart.emirate,
      JSON.stringify(cart.address ?? {}),
      cart.mapPin?.lat ?? 0,
      cart.mapPin?.lng ?? 0,
      cart.castleVariant ?? null,
    ],
  );

  // Every priced line becomes a row operations can act on.
  for (const line of quote.lines) {
    if (line.kind === 'discount') continue;
    await db.query(
      `INSERT INTO event_services (event_id, service_id, label, quantity, amount_fils, source, order_id)
       VALUES ($1,$2,$3,$4,$5,'booking',$6)`,
      [
        eventId,
        line.kind === 'service' || line.kind === 'addon' ? line.refId : null,
        line.label,
        line.quantity,
        line.amountFils,
        order.id,
      ],
    );
  }

  // A fixed package is one priced line but a dozen things to prepare and
  // load. Expand its items so the dashboard's pick list, the socks rule
  // and the extra-servings offer all see what is actually going out.
  if (cart.packageId) {
    const { rows: pkgItems } = await db.query<{ name: string }>(
      `SELECT name FROM package_items WHERE package_id = $1 ORDER BY sort_order`,
      [cart.packageId],
    );
    for (const it of pkgItems) {
      await db.query(
        `INSERT INTO event_services (event_id, service_id, label, quantity, amount_fils, source, order_id)
         VALUES ($1,NULL,$2,1,0,'package_item',$3)`,
        [eventId, it.name, order.id],
      );
    }
  }

  // Auto-draw single-use consumable stock for this booking. Deliberately
  // constraint-free (INSERT..SELECT straight from consumables, GREATEST-clamped
  // UPDATE) so it can never abort a confirmation: per-guest items draw the head
  // count, flat items draw their per-event quantity.
  const guests = cart.childrenCount ?? 0;
  await db.query(
    `INSERT INTO consumable_usage (consumable_id, event_id, order_id, quantity, reason)
     SELECT id, $1, $2, (CASE WHEN per_guest THEN $3::int ELSE 0 END) + per_event_qty, 'event'
       FROM consumables
      WHERE active AND ((CASE WHEN per_guest THEN $3::int ELSE 0 END) + per_event_qty) > 0`,
    [eventId, order.id, guests],
  );
  await db.query(
    `UPDATE consumables
        SET on_hand = GREATEST(0, on_hand - ((CASE WHEN per_guest THEN $1::int ELSE 0 END) + per_event_qty))
      WHERE active AND ((CASE WHEN per_guest THEN $1::int ELSE 0 END) + per_event_qty) > 0`,
    [guests],
  );

  const serviceIds = cart.services.map((s) => s.serviceId);
  const hasInflatable = serviceIds.some(args.serviceIsInflatable);
  const hasFoodStation = serviceIds.some(args.serviceIsFoodStation);
  const hasBackdrop = serviceIds.some((id) => id.startsWith('backdrop'));

  // A package can carry an inflatable or a station even with an empty
  // service list — check the package's own reserved assets too.
  const { rows: heldAssets } = await db.query<{ asset_code: string }>(
    `SELECT asset_code FROM inventory_holds WHERE order_id = $1`,
    [order.id],
  );
  const assetCodes = heldAssets.map((r) => r.asset_code);
  const packageInflatable = assetCodes.some((c) =>
    /castle|bubble-house|ball-pool-slide|amwaj|blue-water|slippery/.test(c),
  );
  const packageStation = assetCodes.some((c) => /-cart|choc-fountain|hotchoc-urn/.test(c));

  for (const t of baseTasks({
    hasCustomTheme: !!cart.customTheme,
    hasInflatable: hasInflatable || packageInflatable,
    hasFoodStation: hasFoodStation || packageStation,
    hasBackdrop,
  })) {
    await db.query(
      `INSERT INTO event_tasks (event_id, department, title) VALUES ($1,$2,$3)`,
      [eventId, t.department, t.title],
    );
  }

  // Assign whoever is free. Real rostering belongs to the dashboard; this
  // gives operations a starting crew rather than an empty event.
  await db.query(
    `INSERT INTO event_team (event_id, member_id)
     SELECT $1, id FROM team_members WHERE active ORDER BY id LIMIT 3
     ON CONFLICT DO NOTHING`,
    [eventId],
  );

  await confirmHolds(db, order.id, eventId);

  if (cart.customTheme) {
    await db.query(
      `INSERT INTO designs (event_id, version, status) VALUES ($1, 1, 'pending')
       ON CONFLICT (event_id, version) DO NOTHING`,
      [eventId],
    );
  }

  // Scheduled communications. A cancellation cancels these rather than
  // letting them fire for an event that is no longer happening.
  const eventStart = `${cart.eventDate}T${startTime}:00+04:00`;
  await db.query(
    `INSERT INTO notifications (event_id, channel, template, scheduled_for, payload) VALUES
       ($1,'email','booking_confirmation', now(), $2),
       ($1,'email','three_day_reminder', ($3::timestamptz - interval '3 days'), $2),
       ($1,'email','event_day', ($3::timestamptz - interval '4 hours'), $2)`,
    [eventId, JSON.stringify({ orderId: order.id, eventId }), eventStart],
  );

  // Loyalty is awarded on the amount actually paid.
  const points = Math.floor((order.total_fils / 100) * args.rules.loyaltyPointsPerAed);
  if (points > 0) {
    await db.query(
      `INSERT INTO loyalty_transactions (customer_id, event_id, order_id, points, reason)
       VALUES ($1,$2,$3,$4,'Booking confirmed')`,
      [order.customer_id, eventId, order.id, points],
    );
    await db.query(`UPDATE customers SET loyalty_points = loyalty_points + $2 WHERE id = $1`, [
      order.customer_id,
      points,
    ]);
  }

  await db.query(`UPDATE orders SET event_id = $2, updated_at = now() WHERE id = $1`, [
    order.id,
    eventId,
  ]);

  return { eventId, created: true };
}

/**
 * Applies a paid add-on order to its existing event: extends the end time
 * (still capped at midnight), records the extra services, and regenerates
 * the preparation tasks the change affects. The original order and its
 * payment are never modified (spec §8).
 */
async function applyAddonOrder(db: PoolClient, order: any, rules: PricingRules): Promise<void> {
  const quote = order.quote as { lines: Array<{ refId: string | null; label: string; quantity: number; amountFils: number }> };
  const eventId: string = order.event_id;

  const { rows: eventRows } = await db.query(`SELECT * FROM events WHERE id = $1 FOR UPDATE`, [
    eventId,
  ]);
  const event = eventRows[0];
  if (!event) throw new Error(`Add-on order ${order.id} references unknown event ${eventId}`);

  // Guard against double application if this somehow runs twice.
  const { rows: already } = await db.query(
    `SELECT 1 FROM event_services WHERE order_id = $1 LIMIT 1`,
    [order.id],
  );
  if (already[0]) return;

  let extraHours = 0;
  for (const line of quote.lines) {
    if (line.refId === 'additional_hour') extraHours += line.quantity;
    await db.query(
      `INSERT INTO event_services (event_id, service_id, label, quantity, amount_fils, source, order_id)
       VALUES ($1,$2,$3,$4,$5,'addon',$6)`,
      [
        eventId,
        line.refId && line.refId !== 'additional_hour' && line.refId !== 'kids_socks'
          ? line.refId
          : null,
        line.label,
        line.quantity,
        line.amountFils,
        order.id,
      ],
    );
  }

  if (extraHours > 0) {
    const totalExtra = event.extra_hours + extraHours;
    const newEnd = eventEndHour(event.start_time, rules, totalExtra);
    if (newEnd > rules.latestEndHour) {
      throw new Error(
        `Add-on ${order.id} would extend event ${eventId} past ${formatHour(rules.latestEndHour)}`,
      );
    }
    await db.query(
      `UPDATE events SET extra_hours = $2, base_end_time = $3 WHERE id = $1`,
      [eventId, totalExtra, formatHour24(newEnd)],
    );
    // The crew's window moved; their reservations must move with it.
    await db.query(
      `UPDATE inventory_holds
          SET ends_at = ends_at + ($2 || ' hours')::interval
        WHERE event_id = $1 AND status = 'reserved'`,
      [eventId, String(extraHours)],
    );
    await db.query(
      `INSERT INTO event_tasks (event_id, department, title)
       VALUES ($1,'operations',$2), ($1,'logistics',$3)`,
      [
        eventId,
        `Extended booking — crew now until ${formatHour(newEnd)}`,
        'Re-check return window after the extra hour',
      ],
    );
  }

  const hasServings = quote.lines.some(
    (l) => l.refId && l.refId !== 'additional_hour' && l.refId !== 'kids_socks',
  );
  if (hasServings) {
    await db.query(
      `INSERT INTO event_tasks (event_id, department, title)
       VALUES ($1,'inventory','Update station quantities — extra servings purchased')`,
      [eventId],
    );
  }
  if (quote.lines.some((l) => l.refId === 'kids_socks')) {
    await db.query(
      `INSERT INTO event_tasks (event_id, department, title)
       VALUES ($1,'inventory','Pack kids socks for the event')`,
      [eventId],
    );
  }

  void parseHour;
}
