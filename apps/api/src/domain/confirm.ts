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
  effectiveEventHours,
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
import { makeVoucherCode, NEXT_BOOKING_VOUCHER_PERCENT } from './discounts.js';
import { recordSaleFromOrder } from './finance.js';
import { markOfferUsed } from './offers.js';
import { INCENTIVE_EXCLUDED } from './incentives.js';

export interface ConfirmResult {
  /** Null for orders that create no event (e.g. standalone shop orders). */
  eventId: string | null;
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

  // Every paid order becomes a sale on the finance Sales page — website, app,
  // shop or manual pay-link alike. Tips are crew money, not a sale, so skip
  // them. Idempotent and failure-isolated (see recordSaleFromOrder).
  if (order.kind !== 'tip') await recordSaleFromOrder(db, order);

  // A booking made through a manual-order link consumes its offer now that it is
  // paid, so the same link can never produce a second booking.
  const offerToken = (order.cart as { offerToken?: string } | null)?.offerToken;
  if (offerToken) await markOfferUsed(db, offerToken, order.id);

  if (order.kind === 'addon') {
    // Add-ons attach to an event that already exists.
    await applyAddonOrder(db, order, args.rules);
    return { eventId: order.event_id, created: false };
  }

  if (order.kind === 'tip') {
    // A tip is money for the crew, not a booking: mark it paid and alert the
    // team. Idempotent — a replayed webhook flips an already-paid tip to the
    // same state and the notification insert is guarded by NOT EXISTS.
    await db.query(
      `UPDATE tips SET status = 'paid', paid_at = now()
        WHERE order_id = $1 AND status <> 'paid'`,
      [order.id],
    );
    const { rows: tipRows } = await db.query(
      `SELECT event_id, member_id, amount_fils FROM tips WHERE order_id = $1`,
      [order.id],
    );
    const tip = tipRows[0];
    // A whole-team tip (member_id NULL) is split EQUALLY among the crew that
    // worked the event, so each person's share lands in their own earnings.
    // A tip aimed at one person stays with them. Idempotent: once split, the
    // NULL pool row is gone so a re-run does nothing.
    if (tip && tip.member_id === null) {
      const { rows: crew } = await db.query(
        `SELECT tm.id FROM event_team et JOIN team_members tm ON tm.id = et.member_id
          WHERE et.event_id = $1 AND tm.active AND lower(tm.name) <> ALL($2::text[])
          ORDER BY tm.id`,
        [tip.event_id, INCENTIVE_EXCLUDED],
      );
      if (crew.length > 0) {
        const total = Number(tip.amount_fils);
        const base = Math.floor(total / crew.length);
        const rem = total - base * crew.length; // spread the odd fils to the first few
        await db.query(`DELETE FROM tips WHERE order_id = $1 AND member_id IS NULL`, [order.id]);
        for (let i = 0; i < crew.length; i++) {
          const share = base + (i < rem ? 1 : 0);
          if (share <= 0) continue;
          await db.query(
            `INSERT INTO tips (event_id, order_id, member_id, amount_fils, status, paid_at)
             VALUES ($1,$2,$3,$4,'paid', now())`,
            [tip.event_id, i === 0 ? order.id : null, crew[i].id, share],
          );
        }
      }
    }
    if (tip) {
      await db.query(
        `INSERT INTO notifications (event_id, channel, template, scheduled_for, payload)
         SELECT $1, 'push', 'tip_received', now(), $2
          WHERE NOT EXISTS (
            SELECT 1 FROM notifications
             WHERE template = 'tip_received' AND payload->>'orderId' = $3)`,
        [
          tip.event_id,
          JSON.stringify({
            orderId: order.id,
            eventId: tip.event_id,
            memberId: tip.member_id,
            amountFils: Number(tip.amount_fils),
          }),
          order.id,
        ],
      );
    }
    return { eventId: order.event_id, created: false };
  }

  if (order.kind === 'shop') {
    // A standalone shop order (printed/digital goods, no party): mark it paid
    // and raise an ops alert with everything the team needs to fulfil it — no
    // event, no crew, no calendar. Idempotent (guarded by NOT EXISTS).
    await db.query(
      `UPDATE orders SET status = 'paid', updated_at = now() WHERE id = $1 AND status <> 'paid'`,
      [order.id],
    );
    const shopCart = order.cart as Record<string, unknown>;
    await db.query(
      `INSERT INTO notifications (event_id, channel, template, scheduled_for, payload)
       SELECT NULL, 'ops_alert', 'shop_order', now(), $1
        WHERE NOT EXISTS (
          SELECT 1 FROM notifications WHERE template = 'shop_order' AND payload->>'orderId' = $2)`,
      [
        JSON.stringify({
          orderId: order.id,
          totalFils: Number(order.total_fils),
          customerId: order.customer_id,
          items: shopCart.items ?? [],
          emirate: shopCart.emirate ?? null,
          address: shopCart.address ?? null,
          customization: shopCart.customization ?? null,
          readyBy: shopCart.readyBy ?? null,
        }),
        order.id,
      ],
    );
    // Customer confirmation email for the shop order (no event, so it carries the
    // order id in its payload and is delivered by a dedicated sweep). Idempotent.
    await db.query(
      `INSERT INTO notifications (event_id, channel, template, scheduled_for, payload)
       SELECT NULL, 'email', 'shop_confirmation', now(), $1
        WHERE NOT EXISTS (
          SELECT 1 FROM notifications WHERE template = 'shop_confirmation' AND payload->>'orderId' = $2)`,
      [JSON.stringify({ orderId: order.id }), order.id],
    );
    return { eventId: null, created: false };
  }

  const cart = order.cart as CartInput & {
    address?: Record<string, unknown>;
    mapPin?: { lat: number; lng: number };
    customerId?: string;
    movie?: string | null;
    stationColors?: Record<string, string>;
    mascotChoice?: string;
    customization?: { refImages?: string[]; wantDraw?: boolean } | null;
    themeBrief?: (Record<string, string> & { refImages?: string[] }) | null;
    appliedDiscounts?: {
      promo: { code: string; amountFils: number } | null;
      creditFils: number;
      points: { used: number; amountFils: number } | null;
    };
  };
  const quote = order.quote as Quote;

  const eventId = await nextEventId(db);
  const startTime = cart.startTime!;
  const endHour = eventEndHour(startTime, args.rules, 0, effectiveEventHours(cart, args.rules));

  await db.query(
    `INSERT INTO events
       (id, order_id, customer_id, celebration_type, package_id, theme_id, custom_theme,
        custom_theme_brief, movie_id,
        event_date, start_time, base_end_time, extra_hours, children_count, emirate,
        address, map_lat, map_lng, castle_variant, phase)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,0,$13,$14,$15,$16,$17,$18,'Booking Confirmed')`,
    [
      eventId,
      order.id,
      order.customer_id,
      cart.celebrationType,
      cart.packageId,
      cart.themeId,
      cart.customTheme,
      // Custom-theme brief + film choice reach the team instead of being lost.
      cart.customTheme && cart.themeBrief ? JSON.stringify(cart.themeBrief) : null,
      cart.movie ?? null,
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

  // Every priced line becomes a row operations can act on. A chosen kiosk
  // colour (food/games stations) is appended to the label so the crew sees it.
  for (const line of quote.lines) {
    if (line.kind === 'discount') continue;
    const color = line.refId ? cart.stationColors?.[line.refId] : undefined;
    const mascot = line.refId === 'mascot' ? cart.mascotChoice : undefined;
    const extra = color ? `${color.charAt(0).toUpperCase()}${color.slice(1)}` : mascot;
    const label = extra ? `${line.label} · ${extra}` : line.label;
    await db.query(
      `INSERT INTO event_services (event_id, service_id, label, quantity, amount_fils, source, order_id)
       VALUES ($1,$2,$3,$4,$5,'booking',$6)`,
      [
        eventId,
        line.kind === 'service' || line.kind === 'addon' ? line.refId : null,
        label,
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

  // Printed custom items (t-shirt/hat/banner/drawing): surface the guest's
  // uploaded drawing(s), or the request that we create one, as a design task so
  // the team can prep the artwork.
  const cust = cart.customization;
  if (cust && ((cust.refImages?.length ?? 0) > 0 || cust.wantDraw)) {
    const title = cust.refImages?.length
      ? `Custom print artwork — customer uploaded ${cust.refImages.length} image(s): ${cust.refImages.join(' , ')}`
      : 'Custom print artwork — create a professional digital drawing for the customer';
    await db.query(
      `INSERT INTO event_tasks (event_id, department, title) VALUES ($1,'design',$2)`,
      [eventId, title.slice(0, 1000)],
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
    // Surface the customer's brief in the ops task list so the design team
    // acts on the actual request rather than a generic "custom theme" task.
    const b = cart.themeBrief;
    const refCount = Array.isArray(b?.refImages) ? b!.refImages.length : 0;
    if (b && (b.theme || b.concept || b.colors || b.notes || refCount > 0)) {
      const summary = [
        b.theme && `Theme: ${b.theme}`,
        b.concept && `Concept: ${b.concept}`,
        b.colors && `Colours: ${b.colors}`,
        b.child && `For: ${b.child}${b.age ? ` (${b.age})` : ''}`,
        b.notes && `Notes: ${b.notes}`,
        refCount > 0 && `${refCount} reference image${refCount === 1 ? '' : 's'} attached`,
      ].filter(Boolean).join(' · ');
      await db.query(
        `INSERT INTO event_tasks (event_id, department, title) VALUES ($1,'design',$2)`,
        [eventId, `Custom theme brief — ${summary}`.slice(0, 500)],
      );
    }
  }

  // Scheduled communications. A cancellation cancels these rather than
  // letting them fire for an event that is no longer happening.
  const eventStart = `${cart.eventDate}T${startTime}:00+04:00`;
  await db.query(
    `INSERT INTO notifications (event_id, channel, template, scheduled_for, payload) VALUES
       ($1,'email','booking_confirmation', now(), $2),
       ($1,'email','three_day_reminder', ($3::timestamptz - interval '3 days'), $2),
       ($1,'email','event_day', ($3::timestamptz - interval '4 hours'), $2),
       ($1,'email','feedback_request', ($3::timestamptz + interval '1 day'), $2)`,
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

  // Reward: a personal 20%-off code for the customer's NEXT booking, valid a
  // year, with a 6-month "don't forget" reminder. Issued once per confirmed
  // booking (this block only runs when the event is first created).
  await db.query(
    `INSERT INTO promo_codes
       (code, kind, value, min_spend_fils, max_uses, active, expires_at, customer_id, auto_reminder)
     VALUES ($1, 'percent', $2, 0, 1, TRUE, now() + interval '1 year', $3, TRUE)
     ON CONFLICT (code) DO NOTHING`,
    [makeVoucherCode(), NEXT_BOOKING_VOUCHER_PERCENT, order.customer_id],
  );

  // Consume any checkout discounts now that the payment is real. Each is
  // clamped so a replay or a race can never overspend, and the referral
  // reward is guarded by referral_rewarded so it pays out at most once.
  const disc = cart.appliedDiscounts;
  if (disc) {
    if (disc.points && disc.points.used > 0) {
      await db.query(
        `INSERT INTO loyalty_transactions (customer_id, event_id, order_id, points, reason)
         VALUES ($1,$2,$3,$4,'Points redeemed at checkout')`,
        [order.customer_id, eventId, order.id, -disc.points.used],
      );
      await db.query(
        `UPDATE customers SET loyalty_points = GREATEST(0, loyalty_points - $2) WHERE id = $1`,
        [order.customer_id, disc.points.used],
      );
    }
    if (disc.creditFils > 0) {
      await db.query(
        `UPDATE customers SET referral_credit_fils = GREATEST(0, referral_credit_fils - $2) WHERE id = $1`,
        [order.customer_id, disc.creditFils],
      );
    }
    if (disc.promo) {
      await db.query(
        `INSERT INTO promo_redemptions (code, customer_id, order_id, amount_fils)
         VALUES ($1,$2,$3,$4) ON CONFLICT (code, customer_id) DO NOTHING`,
        [disc.promo.code, order.customer_id, order.id, disc.promo.amountFils],
      );
      await db.query(`UPDATE promo_codes SET uses = uses + 1 WHERE code = $1`, [disc.promo.code]);
    }
  }

  // Referral reward: the first confirmed booking of a referred customer pays
  // their referrer AED 250 in store credit, once.
  const { rows: refRows } = await db.query(
    `SELECT referred_by, referral_rewarded FROM customers WHERE id = $1`,
    [order.customer_id],
  );
  const ref = refRows[0];
  if (ref?.referred_by && !ref.referral_rewarded) {
    const { rows: selfRows } = await db.query(
      `SELECT referral_code FROM customers WHERE id = $1`,
      [order.customer_id],
    );
    const isSelfReferral = selfRows[0]?.referral_code === ref.referred_by;
    if (!isSelfReferral) {
      // Both sides earn AED 250 store credit — but only now, on the referee's
      // FIRST real booking (not at signup), so throwaway accounts earn nothing.
      await db.query(
        `UPDATE customers SET referral_credit_fils = referral_credit_fils + 25000 WHERE referral_code = $1`,
        [ref.referred_by],
      );
      await db.query(
        `UPDATE customers SET referral_credit_fils = referral_credit_fils + 25000 WHERE id = $1`,
        [order.customer_id],
      );
    }
    // Mark rewarded regardless, so a missing/self referrer isn't retried forever.
    await db.query(`UPDATE customers SET referral_rewarded = TRUE WHERE id = $1`, [order.customer_id]);
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

  // Email the customer an UPDATED invoice: what they just added + the new event
  // total. Keyed by this add-on order so a replayed webhook never double-sends.
  await db.query(
    `INSERT INTO notifications (event_id, channel, template, scheduled_for, payload)
     SELECT $1, 'email', 'addon_invoice', now(), $2
      WHERE NOT EXISTS (
        SELECT 1 FROM notifications WHERE template = 'addon_invoice' AND payload->>'orderId' = $3)`,
    [eventId, JSON.stringify({ orderId: order.id }), order.id],
  );

  void parseHour;
}
