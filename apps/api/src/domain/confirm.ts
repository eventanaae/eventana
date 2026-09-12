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
  parseEndHour,
  parseHour,
  type CartInput,
  type PricingRules,
  type Quote,
} from '@eventana/shared';
import { confirmHolds } from './inventory.js';
import { nextEventId } from './orders.js';
import { issueWinbackCode } from './winback.js';
import { recordSaleFromOrder } from './finance.js';
import { markOfferUsed } from './offers.js';
import { INCENTIVE_EXCLUDED } from './incentives.js';
import { recordReferralEvent } from './staffReferral.js';

export interface ConfirmResult {
  /** Null for orders that create no event (e.g. standalone shop orders). */
  eventId: string | null;
  created: boolean;
  /** True when this was an add-on to an existing event (re-run staffing/prep). */
  addon?: boolean;
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

  // An invoice-balance payment isn't a new sale or booking — it settles part (or
  // all) of an existing invoice. Idempotent via invoice_payments (a replayed
  // webhook can never double-apply). Never posts a receipt / creates an event.
  if (order.kind === 'invoice_pay') {
    const invoiceId = Number((order.cart as { invoiceId?: number } | null)?.invoiceId);
    const amt = Number(order.total_fils);
    if (invoiceId) {
      const { rows: applied } = await db.query(
        `INSERT INTO invoice_payments (order_id, invoice_id, amount_fils)
         VALUES ($1,$2,$3) ON CONFLICT (order_id) DO NOTHING RETURNING order_id`,
        [order.id, invoiceId, amt],
      );
      if (applied[0]) {
        await db.query(
          `UPDATE finance_invoices
              SET amount_paid_fils = LEAST(total_fils, amount_paid_fils + $2),
                  status = CASE WHEN amount_paid_fils + $2 >= total_fils THEN 'paid' ELSE 'partial' END,
                  paid_at = CASE WHEN amount_paid_fils + $2 >= total_fils THEN now() ELSE paid_at END,
                  remind_daily = CASE WHEN amount_paid_fils + $2 >= total_fils THEN FALSE ELSE remind_daily END
            WHERE id = $1`,
          [invoiceId, amt],
        );
      }
    }
    return { eventId: '', created: false };
  }

  // Every paid order becomes a sale on the finance Sales page — website, app,
  // shop or manual pay-link alike. Tips are crew money, not a sale, so skip
  // them. Add-ons are NOT a new sale either: they belong to a party that already
  // has a receipt, and the owner's rule is "same event = same receipt" — so
  // applyAddonOrder merges the add-on into that existing receipt instead.
  // Idempotent and failure-isolated (see recordSaleFromOrder).
  if (order.kind !== 'tip' && order.kind !== 'addon') await recordSaleFromOrder(db, order);

  // A booking made through a manual-order link consumes its offer now that it is
  // paid, so the same link can never produce a second booking.
  const offerToken = (order.cart as { offerToken?: string } | null)?.offerToken;
  if (offerToken) await markOfferUsed(db, offerToken, order.id);

  if (order.kind === 'addon') {
    // Add-ons attach to an event that already exists.
    await applyAddonOrder(db, order, args.rules);
    // Flag it so the caller re-runs staffing + prep after commit: an add-on can
    // add services that need crew (face painter, host, inflatable) or prep, and
    // those engines only ran at first booking.
    return { eventId: order.event_id, created: false, addon: true };
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
    glamDolls?: Array<{ skin: string; dress: string }>;
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

  // A crew member's referral code on this booking records the event's value so
  // they earn value-based points on it (see the KPIs endpoint). Events only —
  // this is the booking branch. Idempotent and failure-isolated so it can never
  // abort a confirmation.
  const staffReferral = (cart as unknown as {
    staffReferral?: { code: string; memberId: string; percent: number };
  }).staffReferral;
  if (staffReferral) {
    try {
      const eventValueExclDelivery = Number(quote.totalFils) - Number(quote.deliveryFils ?? 0);
      await recordReferralEvent(db, {
        orderId: order.id,
        eventId,
        referral: staffReferral,
        eventValueExclDeliveryFils: eventValueExclDelivery,
      });
    } catch (e) {
      console.error('[referral] record failed:', (e as Error).message);
    }
  }

  // Every priced line becomes a row operations can act on. A chosen kiosk
  // colour (food/games stations) is appended to the label so the crew sees it.
  for (const line of quote.lines) {
    if (line.kind === 'discount') continue;
    const cap = (s: string) => (s ? `${s.charAt(0).toUpperCase()}${s.slice(1)}` : s);
    const color = line.refId ? cart.stationColors?.[line.refId] : undefined;
    const mascot = line.refId === 'mascot' ? cart.mascotChoice : undefined;
    // Glam Dolls: append each doll's skin tone + dress colour so the crew and
    // the assigned performers know exactly what to bring/wear.
    const glam =
      line.refId === 'glamdolls' && cart.glamDolls?.length
        ? cart.glamDolls.map((d, i) => `Doll ${i + 1}: ${cap(d.skin)} · ${cap(d.dress)}`).join('  ·  ')
        : undefined;
    const extra = color ? cap(color) : (mascot ?? glam);
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
    // Never schedule a reminder whose moment has already passed (a same-day /
    // near booking must not get a late "3 days to go"). booking_confirmation and
    // the driver order always go out now.
    `INSERT INTO notifications (event_id, channel, template, scheduled_for, payload)
     SELECT $1, channel, template, sched, $2::jsonb FROM (VALUES
       ('email','booking_confirmation', now()),
       ('email','three_day_reminder', ($3::timestamptz - interval '3 days')),
       ('email','event_day', ($3::timestamptz - interval '4 hours')),
       ('email','feedback_request', ($3::timestamptz + interval '1 day')),
       ('driver','driver_new_order', now())
     ) v(channel,template,sched)
     WHERE v.sched > now() OR v.template IN ('booking_confirmation','driver_new_order')`,
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

  // Reward: a personal "come back" code for the customer's NEXT booking — AED 600
  // off any order over AED 3,000, single-use, valid three months, named after the
  // customer. Issued once per confirmed booking (this block only runs when the
  // event is first created); issueWinbackCode is idempotent, so the same code is
  // later delivered by the post-event message and shown on the profile.
  await issueWinbackCode(db, order.customer_id);

  // Record the checkout discounts now that the payment is real. Points & store
  // credit were already RESERVED (decremented) at checkout so two concurrent
  // unpaid orders can't overspend the same balance — so here we only LOG the
  // points redemption in the ledger (no second decrement). Abandoned orders never
  // reach confirm; the reconcile sweep refunds their reserved balance.
  const disc = cart.appliedDiscounts;
  if (disc) {
    if (disc.points && disc.points.used > 0) {
      await db.query(
        `INSERT INTO loyalty_transactions (customer_id, event_id, order_id, points, reason)
         VALUES ($1,$2,$3,$4,'Points redeemed at checkout')`,
        [order.customer_id, eventId, order.id, -disc.points.used],
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
  // their referrer AED 250 in store credit, once. CLAIM the one-time reward with
  // an atomic conditional UPDATE (…WHERE referral_rewarded = FALSE RETURNING), so
  // two first-booking confirms racing (each locks its own order row, not the
  // customer) can't both read "not yet rewarded" and pay the AED 250 twice.
  const claim = await db.query(
    `UPDATE customers SET referral_rewarded = TRUE
       WHERE id = $1 AND referral_rewarded = FALSE AND referred_by IS NOT NULL
     RETURNING referred_by`,
    [order.customer_id],
  );
  if (claim.rowCount) {
    const referredBy = claim.rows[0].referred_by;
    const { rows: selfRows } = await db.query(
      `SELECT referral_code FROM customers WHERE id = $1`,
      [order.customer_id],
    );
    const isSelfReferral = selfRows[0]?.referral_code === referredBy;
    if (!isSelfReferral) {
      // Both sides earn AED 250 store credit — but only now, on the referee's
      // FIRST real booking (not at signup), so throwaway accounts earn nothing.
      await db.query(
        `UPDATE customers SET referral_credit_fils = referral_credit_fils + 25000 WHERE referral_code = $1`,
        [referredBy],
      );
      await db.query(
        `UPDATE customers SET referral_credit_fils = referral_credit_fils + 25000 WHERE id = $1`,
        [order.customer_id],
      );
    }
    // (the flag is already set TRUE by the claim above, so a missing/self
    // referrer isn't retried forever)
  }

  await db.query(`UPDATE orders SET event_id = $2, updated_at = now() WHERE id = $1`, [
    order.id,
    eventId,
  ]);

  // Link the sales receipt to the event at write time (SSOT). recordSaleFromOrder
  // inserts the receipt with event_id NULL; stamp it now so every downstream
  // consumer (add-on merge, upcoming-conversion dedup, customer EV-<number>
  // reference) resolves by event_id instead of relying on a boot-time repair.
  await db.query(
    `UPDATE finance_receipts SET event_id = $2 WHERE order_id = $1 AND event_id IS NULL`,
    [order.id, eventId],
  );

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

  // Owner rule: an add-on to the SAME event updates the SAME receipt (a new
  // receipt is only for a brand-new party on a new date). Merge the add-on lines
  // into the event's existing sales receipt and grow its total. The event_services
  // guard above makes this run at most once per add-on order.
  const addonTotal = quote.lines.reduce((s, l) => s + (Number(l.amountFils) || 0), 0);
  const addonLines = quote.lines.map((l) => {
    const qty = Number(l.quantity) || 1;
    const amt = Number(l.amountFils) || 0;
    return { name: l.label, qty, priceFils: qty > 0 ? Math.round(amt / qty) : amt, amountFils: amt };
  });
  // Find the event's existing receipt by event_id, OR by the event's order_id
  // (legacy app/website receipts created before event_id was stamped at
  // confirmation still carry only order_id). This makes the "same event = same
  // receipt" rule hold for organic app bookings too, not just converted ones.
  const { rows: rcpt } = await db.query(
    `SELECT id, line_items FROM finance_receipts
      WHERE event_id = $1
         OR order_id = (SELECT order_id FROM events WHERE id = $1)
      ORDER BY (event_id = $1) DESC, id LIMIT 1`,
    [eventId],
  );
  if (rcpt[0]) {
    const existing = Array.isArray(rcpt[0].line_items) ? rcpt[0].line_items : [];
    await db.query(
      `UPDATE finance_receipts
          SET line_items = $2::jsonb,
              subtotal_fils = subtotal_fils + $3,
              total_fils = total_fils + $3
        WHERE id = $1`,
      [rcpt[0].id, JSON.stringify([...existing, ...addonLines]), addonTotal],
    );
  } else {
    // No receipt on this event yet (e.g. a converted/manual booking) — fall back
    // to a standalone sale so the add-on still shows on the Sales page.
    await recordSaleFromOrder(db, order);
  }

  if (extraHours > 0) {
    const totalExtra = event.extra_hours + extraHours;
    // Preserve the event's ORIGINAL base length (4h, or 6h for a decor/inflatable
    // BYO) — don't let eventEndHour fall back to the 4h default, which would
    // silently shrink a 6h party the customer just PAID to extend. parseEndHour
    // so a midnight "24:00" base reads as 24, not NaN.
    const origBase = parseEndHour(event.base_end_time) - parseHour(event.start_time) - (event.extra_hours ?? 0);
    const baseHours = Number.isFinite(origBase) && origBase > 0 ? origBase : rules.standardEventHours;
    const newEnd = eventEndHour(event.start_time, rules, totalExtra, baseHours);
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
