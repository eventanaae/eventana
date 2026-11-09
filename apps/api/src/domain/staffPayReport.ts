/**
 * Part-timer & driver tracker (the owner's spec, 2026-09-08):
 *  - Part-timers: each clown / face-paint engagement this month — name, date,
 *    emirate, job, amount (clown AED 200, face-paint AED 350) + per-person and
 *    grand totals.
 *  - Drivers: each delivery this month — name, date, emirate, own-van vs part-time.
 * Emailed to the owner + Marsha on the 1st of each month; also a live dashboard view.
 *
 * Data gaps (flagged, not guessed): part-timer PHONE isn't stored on the roster
 * (part-timers are slot names), and the driver's distance-from-base needs the
 * Google Maps key — both surface as "—" until those are added.
 */
import { pool } from '../db/pool.js';
import { formatAed } from '@eventana/shared';
import { emailEnabled, sendEmail } from '../integrations/email.js';

const OWNER_EMAIL = 'sheem@eventanauae.com';
const MARSHA_EMAIL = 'marsha@eventanauae.com';

const CLOWN_FILS = 20000;      // AED 200
const FACEPAINT_FILS = 35000;  // AED 350
const BALLOON_FILS = 35000;    // AED 350 (part-time balloon artist, owner rate)

function jobOf(role: string): { job: string; fils: number } {
  if (role === 'face_painting') return { job: 'Face painting', fils: FACEPAINT_FILS };
  if (role === 'clown' || role === 'acrobat_clown') return { job: 'Clown', fils: CLOWN_FILS };
  if (role === 'balloon_artist' || role === 'balloon_twisting') return { job: 'Balloon artist', fils: BALLOON_FILS };
  return { job: role.replace(/_/g, ' '), fils: 0 };
}

// Customer delivery price schedule (AED, ×100 = fils), by truck size × emirate.
// Owner-set 2026-09-08; kept here so the report and any override use one source.
const DELIVERY_PRICE: Record<'small' | 'big', Record<string, number>> = {
  small: { dubai: 25000, sharjah: 30000, ajman: 30000, 'abu dhabi': 40000, 'ras al khaimah': 40000, rak: 40000, fujairah: 50000, khorfakkan: 50000, 'al ain': 40000 },
  big: { dubai: 45000, sharjah: 50000, ajman: 50000, 'abu dhabi': 60000, 'ras al khaimah': 60000, rak: 60000, fujairah: 70000, khorfakkan: 70000, 'al ain': 60000 },
};
export function deliveryPriceFils(truck: string | null, emirate: string | null): number | null {
  if (truck !== 'small' && truck !== 'big') return null;
  const key = (emirate ?? '').trim().toLowerCase();
  const p = DELIVERY_PRICE[truck][key];
  return p ?? null; // unknown emirate (e.g. Umm Al Quwain) → owner sets the price manually
}

/**
 * One match key per person: trim, collapse inner whitespace, lowercase — so
 * "Ali", " ali " and "Ali  " are the same payee in the report, the phone /
 * driver-type lookups, the paid lookup and the stored staff_payments row.
 */
export function personKey(name: string | null | undefined): string {
  return String(name ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
}
/** Display form of a typed name (trimmed, inner whitespace collapsed). */
function cleanName(name: string | null | undefined): string {
  return String(name ?? '').trim().replace(/\s+/g, ' ');
}
/** SQL twin of personKey(). */
const SQL_KEY = (expr: string) => `lower(regexp_replace(btrim(${expr}), '\\s+', ' ', 'g'))`;

/** Today in Dubai (UTC+4, no DST) as YYYY-MM-DD. */
function dubaiToday(): string {
  return new Date(Date.now() + 4 * 3600 * 1000).toISOString().slice(0, 10);
}
/** Today's date in Dubai, in SQL — "the event has happened" cut-off. */
const SQL_DUBAI_TODAY = `(now() AT TIME ZONE 'Asia/Dubai')::date`;

/** Part-timer engagements (paid entertainer roles only) on events that happened. */
const PT_WHERE = `
      es.part_time_name IS NOT NULL AND btrim(es.part_time_name) <> ''
      -- Only the paid entertainer roles belong in this tracker (clown / face
      -- paint / balloon artist); part-time drivers show under Deliveries.
      AND es.role IN ('clown', 'acrobat_clown', 'face_painting', 'balloon_artist', 'balloon_twisting')
      AND e.phase IS DISTINCT FROM 'Cancelled' AND NOT COALESCE(e.date_tbd, false)
      -- Count only events that have already happened (up to today, Dubai).
      AND e.event_date <= ${SQL_DUBAI_TODAY}`;

/**
 * Event driver slots that name a real person — an assigned team member or a
 * typed part-timer name (empty auto slots are NOT a payee) — excluding the
 * salaried main driver Shan, on events that happened.
 */
const DRIVER_WHERE = `
      es.role IN ('driver','pt_driver')
      AND (tm.id IS NOT NULL OR (es.part_time_name IS NOT NULL AND btrim(es.part_time_name) <> ''))
      AND (es.role = 'pt_driver' OR tm.id IS NULL OR ${SQL_KEY('tm.name')} <> 'shan')
      AND e.phase IS DISTINCT FROM 'Cancelled' AND NOT COALESCE(e.date_tbd, false)
      AND e.event_date <= ${SQL_DUBAI_TODAY}`;

type PayState = {
  owedFils: number; owedDisplay: string;
  paidFils: number; balanceFils: number; balanceDisplay: string;
  /** Fully paid: paid ≥ owed (and no delivery is missing its price). */
  paid: boolean;
  /** Something was paid but less than owed. */
  partlyPaid: boolean;
  paidDisplay: string | null;
  statusDisplay: string | null;
};

function payState(owedFils: number, paidFils: number, priceMissing = 0): PayState {
  const balanceFils = Math.max(0, owedFils - paidFils);
  const paid = paidFils > 0 && paidFils >= owedFils && priceMissing === 0;
  const partlyPaid = paidFils > 0 && !paid;
  const missingNote = priceMissing > 0 ? ` (+ ${priceMissing} deliver${priceMissing > 1 ? 'ies' : 'y'} with price not set)` : '';
  const statusDisplay = paid ? `Paid ${formatAed(paidFils)}`
    : partlyPaid ? `Partly paid ${formatAed(paidFils)} — ${formatAed(balanceFils)} still owed${missingNote}`
    : priceMissing > 0 ? `Not paid — ${formatAed(balanceFils)} owed${missingNote}`
    : null;
  return { owedFils, owedDisplay: formatAed(owedFils), paidFils, balanceFils, balanceDisplay: formatAed(balanceFils),
    paid, partlyPaid, paidDisplay: paidFils > 0 ? formatAed(paidFils) : null, statusDisplay };
}

export type StaffPayReport = {
  monthLabel: string;
  month: string;
  partTimers: Array<{ key: string; name: string; phone: string | null; entries: Array<{ date: string; emirate: string; job: string; amountDisplay: string }>; totalFils: number; totalDisplay: string } & PayState>;
  partTimerTotalDisplay: string;
  drivers: Array<{ id: string; eventId: string | null; key: string; name: string; date: string; emirate: string; type: string; payKind: 'van' | 'own_car'; truck: string | null; priceFils: number | null; priceDisplay: string; priceManual: boolean }>;
  deliveryTotalDisplay: string;
  driverPayouts: Array<{ key: string; name: string; phone: string | null; type: string; count: number; priceMissing: number; entries: Array<{ date: string; emirate: string; truck: string | null; priceDisplay: string }>; suggestedFils: number; suggestedDisplay: string } & PayState>;
  driverPayoutTotalDisplay: string;
};

export async function buildStaffPayReport(monthISO?: string): Promise<StaffPayReport> {
  const month = monthISO ?? dubaiToday();
  const monthLabel = new Date(month).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
  const monthStr = month.slice(0, 7); // YYYY-MM

  // Phones + driver types + what's been paid this month. Driver type is read
  // from ALL roster rows (not just active ones) so a driver deactivated after
  // the month still pays at the right rate.
  const [ptPhones, drRows, payments] = await Promise.all([
    pool.query<{ name_norm: string; phone: string | null }>(`SELECT name_norm, phone FROM part_timers WHERE active`),
    pool.query<{ name: string; phone: string | null; kind: string; active: boolean }>(`SELECT name, phone, kind, active FROM drivers ORDER BY active`),
    pool.query<{ person_kind: string; person_name: string; amount_fils: string }>(`SELECT person_kind, person_name, amount_fils FROM staff_payments WHERE month = $1`, [monthStr]),
  ]);
  const ptPhone = new Map(ptPhones.rows.map((r) => [personKey(r.name_norm), r.phone]));
  // ORDER BY active → active rows come last and win on a key clash.
  const drPhone = new Map<string, string | null>();
  const drKind = new Map<string, string>();
  for (const r of drRows.rows) {
    const k = personKey(r.name);
    if (r.phone || !drPhone.get(k)) drPhone.set(k, r.phone);
    drKind.set(k, r.kind);
  }
  const PART_TIME_DAY_FILS = 25000; // AED 250 / day for van (part-time) drivers
  // Sum by normalised key, so legacy rows stored under a differently-spaced or
  // -cased name still count towards the same person.
  const paidMap = new Map<string, number>();
  for (const r of payments.rows) {
    const k = `${r.person_kind}:${personKey(r.person_name)}`;
    paidMap.set(k, (paidMap.get(k) ?? 0) + Number(r.amount_fils));
  }
  const paidOf = (kind: string, key: string): number => paidMap.get(`${kind}:${key}`) ?? 0;

  // Part-timer engagements this month (event_staff rows carrying a part-timer name).
  const pt = await pool.query<{ name: string; role: string; emirate: string | null; date: string }>(
    `SELECT btrim(es.part_time_name) AS name, es.role, e.emirate,
            to_char(e.event_date,'YYYY-MM-DD') AS date
       FROM event_staff es JOIN events e ON e.id = es.event_id
      WHERE ${PT_WHERE}
        AND e.event_date >= date_trunc('month', $1::date)
        AND e.event_date <  date_trunc('month', $1::date) + interval '1 month'
      ORDER BY ${SQL_KEY('es.part_time_name')}, e.event_date`,
    [month],
  );
  const byName = new Map<string, { key: string; name: string; entries: Array<{ date: string; emirate: string; job: string; amountDisplay: string }>; totalFils: number }>();
  let grand = 0;
  for (const r of pt.rows) {
    const { job, fils } = jobOf(r.role);
    const key = personKey(r.name);
    const g = byName.get(key) ?? { key, name: cleanName(r.name), entries: [], totalFils: 0 };
    g.entries.push({ date: r.date, emirate: r.emirate || '—', job, amountDisplay: fils ? formatAed(fils) : '—' });
    g.totalFils += fils; grand += fils;
    byName.set(key, g);
  }
  const partTimers = [...byName.values()].map((g) => ({
    ...g, totalDisplay: formatAed(g.totalFils), phone: ptPhone.get(g.key) ?? null,
    ...payState(g.totalFils, paidOf('part_timer', g.key)),
  }));

  // Event deliveries this month (a real driver assigned — each driver counted
  // once per event — excluding salaried Shan), plus any truck/price/driver type
  // the owner set for them (deliveries table by event_id) — and MANUAL
  // deliveries (deliveries rows with event_id NULL).
  const [evd, man] = await Promise.all([
    pool.query<{ event_id: string; name: string; emirate: string | null; date: string; truck: string | null; price_fils: string | null; price_manual: boolean | null; driver_type: string | null }>(
      `SELECT DISTINCT ON (e.id, ${SQL_KEY(`COALESCE(tm.name, es.part_time_name)`)})
              e.id AS event_id, btrim(COALESCE(tm.name, es.part_time_name)) AS name,
              e.emirate, to_char(e.event_date,'YYYY-MM-DD') AS date,
              d.truck, d.price_fils, d.price_manual, d.driver_type
         FROM event_staff es JOIN events e ON e.id = es.event_id
         LEFT JOIN team_members tm ON tm.id = es.assignee_id
         LEFT JOIN deliveries d ON d.event_id = e.id
        WHERE ${DRIVER_WHERE}
          AND e.event_date >= date_trunc('month', $1::date)
          AND e.event_date <  date_trunc('month', $1::date) + interval '1 month'
        ORDER BY e.id, ${SQL_KEY(`COALESCE(tm.name, es.part_time_name)`)}, es.id`,
      [month],
    ),
    pool.query<{ id: string; date: string; driver_name: string | null; driver_type: string | null; emirate: string | null; truck: string | null; price_fils: string | null; price_manual: boolean | null }>(
      `SELECT id, to_char(del_date,'YYYY-MM-DD') AS date, driver_name, driver_type, emirate, truck, price_fils, price_manual
         FROM deliveries
        WHERE event_id IS NULL
          AND del_date >= date_trunc('month', $1::date)
          AND del_date <  date_trunc('month', $1::date) + interval '1 month'
          AND del_date <= ${SQL_DUBAI_TODAY}
        ORDER BY del_date`,
      [month],
    ),
  ]);

  const priceOf = (truck: string | null, emirate: string | null, override: string | null, manual: boolean | null): number | null =>
    (manual && override != null) ? Number(override) : deliveryPriceFils(truck, emirate);
  // How this delivery is paid: the delivery's own driver_type wins when it is
  // decisive ('part_time' = company van → AED 250/day; 'own_van' = their own
  // vehicle → delivery price); otherwise ('external' / unset) the roster kind.
  const payKindOf = (deliveryType: string | null, key: string): 'van' | 'own_car' =>
    deliveryType === 'part_time' ? 'van' : deliveryType === 'own_van' ? 'own_car' : (drKind.get(key) === 'van' ? 'van' : 'own_car');
  const priceText = (price: number | null) => price != null ? formatAed(price) : 'price not set';

  let deliveryTotal = 0;
  const drivers: StaffPayReport['drivers'] = [
    ...evd.rows.map((r) => {
      const price = priceOf(r.truck, r.emirate, r.price_fils, r.price_manual);
      if (price) deliveryTotal += price;
      const key = personKey(r.name);
      return { id: `event:${r.event_id}`, eventId: r.event_id, key, name: cleanName(r.name), date: r.date, emirate: r.emirate || '—',
        type: 'Delivery', payKind: payKindOf(r.driver_type, key), truck: r.truck, priceFils: price, priceDisplay: priceText(price), priceManual: !!r.price_manual };
    }),
    ...man.rows.map((r) => {
      const price = priceOf(r.truck, r.emirate, r.price_fils, r.price_manual);
      if (price) deliveryTotal += price;
      const name = cleanName(r.driver_name) || 'External driver';
      const key = personKey(name);
      return { id: `manual:${r.id}`, eventId: null, key, name, date: r.date, emirate: r.emirate || '—',
        type: r.driver_type === 'own_van' ? 'Own van' : r.driver_type === 'part_time' ? 'Part-time' : 'External',
        payKind: payKindOf(r.driver_type, key), truck: r.truck,
        priceFils: price, priceDisplay: priceText(price), priceManual: !!r.price_manual };
    }),
  ].sort((a, b) => a.date.localeCompare(b.date));

  // Group deliveries by driver for the monthly payout (owner enters the amount
  // she pays; the computed amount is a suggestion).
  const payoutMap = new Map<string, { key: string; name: string; count: number; ownCarFils: number; ownCarCount: number; priceMissing: number; vanDays: Set<string>; entries: Array<{ date: string; emirate: string; truck: string | null; priceDisplay: string }> }>();
  for (const d of drivers) {
    const g = payoutMap.get(d.key) ?? { key: d.key, name: d.name, count: 0, ownCarFils: 0, ownCarCount: 0, priceMissing: 0, vanDays: new Set<string>(), entries: [] };
    g.count += 1;
    // Own-car drivers (Ubaid/Majeed) earn the delivery price; van/part-time
    // drivers (Ali/Rashid/Rana) earn AED 250 per delivery DAY.
    if (d.payKind === 'van') g.vanDays.add(d.date);
    else { g.ownCarCount += 1; if (d.priceFils == null) g.priceMissing += 1; else g.ownCarFils += d.priceFils; }
    // Per-trip line (date + emirate), so the payout card itemises like the
    // part-timer cards do. `drivers` is already sorted by date.
    g.entries.push({ date: d.date, emirate: d.emirate, truck: d.truck, priceDisplay: d.priceDisplay });
    payoutMap.set(d.key, g);
  }
  const driverPayouts = [...payoutMap.values()].map((g) => {
    const vanFils = g.vanDays.size * PART_TIME_DAY_FILS;
    const suggestedFils = vanFils + g.ownCarFils;
    const parts: string[] = [];
    if (g.ownCarCount > 0) parts.push(`Own car · delivery price${g.priceMissing ? ` · ${g.priceMissing} price not set` : ''}`);
    if (g.vanDays.size > 0) parts.push(`Van · AED 250/day × ${g.vanDays.size}`);
    return { key: g.key, name: g.name, phone: drPhone.get(g.key) ?? null,
      type: parts.join(' + '), count: g.count, priceMissing: g.priceMissing, entries: g.entries,
      suggestedFils, suggestedDisplay: formatAed(suggestedFils),
      ...payState(suggestedFils, paidOf('driver', g.key), g.priceMissing) };
  });

  const driverPayoutTotal = driverPayouts.reduce((s, d) => s + (d.suggestedFils ?? 0), 0);
  return { month: monthStr, monthLabel, partTimers, partTimerTotalDisplay: formatAed(grand), drivers, deliveryTotalDisplay: formatAed(deliveryTotal), driverPayouts, driverPayoutTotalDisplay: formatAed(driverPayoutTotal) };
}

export type OutstandingStaffPay = Array<{
  month: string;
  monthLabel: string;
  partTimers: StaffPayReport['partTimers'];
  driverPayouts: StaffPayReport['driverPayouts'];
}>;

/**
 * Unpaid part-timer/driver dues carried over from BEFORE the given month, so the
 * tracker never lets money owed disappear just because the month rolled over —
 * it stays visible until it's paid IN FULL (owner's rule, queue #14): a partly
 * paid person stays with the remaining balance, and so does a delivery whose
 * price isn't set yet. Only months that actually had activity are rebuilt.
 */
export async function buildOutstandingStaffPay(beforeMonthISO?: string): Promise<OutstandingStaffPay> {
  const before = (beforeMonthISO ?? dubaiToday()).slice(0, 7); // YYYY-MM
  const FLOOR = '2026-09-01'; // the tracker's start — nothing meaningful before this
  // Same filters as the report itself, so every month the report would show
  // money for (incl. team-member drivers) is discovered here.
  const { rows } = await pool.query<{ m: string }>(
    `SELECT DISTINCT to_char(date_trunc('month', d),'YYYY-MM') AS m
       FROM (
         SELECT e.event_date AS d
           FROM event_staff es JOIN events e ON e.id = es.event_id
          WHERE ${PT_WHERE}
         UNION ALL
         SELECT e.event_date AS d
           FROM event_staff es JOIN events e ON e.id = es.event_id
           LEFT JOIN team_members tm ON tm.id = es.assignee_id
          WHERE ${DRIVER_WHERE}
         UNION ALL
         SELECT del_date AS d FROM deliveries
          WHERE event_id IS NULL AND del_date <= ${SQL_DUBAI_TODAY}
       ) x
      WHERE d >= $1::date AND d < date_trunc('month', ($2 || '-01')::date)
      ORDER BY m`,
    [FLOOR, before],
  );
  const out: OutstandingStaffPay = [];
  for (const { m } of rows) {
    const rep = await buildStaffPayReport(`${m}-01`);
    const partTimers = rep.partTimers.filter((p) => !p.paid && p.balanceFils > 0);
    const driverPayouts = rep.driverPayouts.filter((d) => !d.paid && (d.balanceFils > 0 || d.priceMissing > 0));
    if (partTimers.length || driverPayouts.length) {
      out.push({ month: m, monthLabel: rep.monthLabel, partTimers, driverPayouts });
    }
  }
  return out;
}

export type UpcomingStaff = {
  partTimers: Array<{ name: string; role: string; job: string; priceFils: number; phone: string | null; eventDate: string; eventRef: string; eventName: string | null }>;
  drivers: Array<{ driverName: string; phone: string | null; emirate: string; truck: string | null; priceFils: number | null; eventDate: string; eventRef: string | null; eventName: string | null }>;
};

/**
 * Who's booked in the FUTURE (so the owner can reach them before the event):
 * upcoming clown / face-paint part-timers, and upcoming driver deliveries — each
 * with the person's phone. Mirrors the monthly report's joins/filters but inverts
 * the date window to tomorrow-onwards, with no month bounds.
 */
export async function buildUpcomingStaff(): Promise<UpcomingStaff> {
  // Phone maps — same sources as the monthly report.
  const [ptPhones, drPhones] = await Promise.all([
    pool.query<{ name_norm: string; phone: string | null }>(`SELECT name_norm, phone FROM part_timers WHERE active`),
    pool.query<{ name: string; phone: string | null }>(`SELECT name, phone FROM drivers WHERE active`),
  ]);
  const ptPhone = new Map(ptPhones.rows.map((r) => [personKey(r.name_norm), r.phone]));
  const drPhone = new Map(drPhones.rows.map((r) => [personKey(r.name), r.phone]));

  // A friendly event name (guest-of-honour or customer) + booking reference —
  // same derivation as the staff event brief (EV-<receipt number>, else event id).
  const EV_REF = `(SELECT fr.number FROM finance_receipts fr
                    WHERE fr.event_id = e.id OR (e.order_id IS NOT NULL AND fr.order_id = e.order_id)
                    ORDER BY (fr.event_id = e.id) DESC, fr.id LIMIT 1)`;
  const EV_NAME = `COALESCE(NULLIF(btrim(initcap(o.cart->>'eventFor')), ''), c.name)`;

  // Upcoming part-timer engagements (clown / face paint), tomorrow onwards.
  const pt = await pool.query<{ name: string; role: string; emirate: string | null; date: string; event_id: string; event_name: string | null; receipt_number: string | null }>(
    `SELECT btrim(es.part_time_name) AS name, es.role, e.emirate,
            to_char(e.event_date,'YYYY-MM-DD') AS date,
            e.id AS event_id, ${EV_NAME} AS event_name, ${EV_REF} AS receipt_number
       FROM event_staff es JOIN events e ON e.id = es.event_id
       LEFT JOIN orders o ON o.id = e.order_id
       LEFT JOIN customers c ON c.id = e.customer_id
      WHERE es.part_time_name IS NOT NULL AND btrim(es.part_time_name) <> ''
        AND es.role IN ('clown', 'acrobat_clown', 'face_painting', 'balloon_artist', 'balloon_twisting')
        AND e.phase IS DISTINCT FROM 'Cancelled' AND NOT COALESCE(e.date_tbd, false)
        AND e.event_date > ${SQL_DUBAI_TODAY}
      ORDER BY e.event_date, btrim(es.part_time_name)`,
  );
  const partTimers = pt.rows.map((r) => {
    const { job, fils } = jobOf(r.role);
    return { name: cleanName(r.name), role: r.role, job, priceFils: fils, phone: ptPhone.get(personKey(r.name)) ?? null,
      eventDate: r.date, eventRef: r.receipt_number ? `EV-${r.receipt_number}` : r.event_id, eventName: (r.event_name ?? '').trim() || null };
  });

  // Upcoming deliveries — event-assigned drivers (excluding salaried own-van Shan)
  // plus any owner-set truck/price, and future manual deliveries.
  const [evd, man] = await Promise.all([
    pool.query<{ event_id: string; name: string; emirate: string | null; date: string; truck: string | null; price_fils: string | null; price_manual: boolean | null; event_name: string | null; receipt_number: string | null }>(
      `SELECT DISTINCT ON (e.event_date, e.id, ${SQL_KEY(`COALESCE(tm.name, es.part_time_name)`)})
              e.id AS event_id, btrim(COALESCE(tm.name, es.part_time_name)) AS name,
              e.emirate, to_char(e.event_date,'YYYY-MM-DD') AS date,
              d.truck, d.price_fils, d.price_manual,
              ${EV_NAME} AS event_name, ${EV_REF} AS receipt_number
         FROM event_staff es JOIN events e ON e.id = es.event_id
         LEFT JOIN team_members tm ON tm.id = es.assignee_id
         LEFT JOIN deliveries d ON d.event_id = e.id
         LEFT JOIN orders o ON o.id = e.order_id
         LEFT JOIN customers c ON c.id = e.customer_id
        WHERE es.role IN ('driver','pt_driver')
          AND (tm.id IS NOT NULL OR (es.part_time_name IS NOT NULL AND btrim(es.part_time_name) <> ''))
          AND (es.role = 'pt_driver' OR tm.id IS NULL OR ${SQL_KEY('tm.name')} <> 'shan')
          AND e.phase IS DISTINCT FROM 'Cancelled' AND NOT COALESCE(e.date_tbd, false)
          AND e.event_date > ${SQL_DUBAI_TODAY}
        ORDER BY e.event_date, e.id, ${SQL_KEY(`COALESCE(tm.name, es.part_time_name)`)}, es.id`,
    ),
    pool.query<{ id: string; date: string; driver_name: string | null; emirate: string | null; truck: string | null; price_fils: string | null; price_manual: boolean | null }>(
      `SELECT id, to_char(del_date,'YYYY-MM-DD') AS date, driver_name, emirate, truck, price_fils, price_manual
         FROM deliveries
        WHERE event_id IS NULL
          AND del_date > ${SQL_DUBAI_TODAY}
        ORDER BY del_date`,
    ),
  ]);

  const priceOf = (truck: string | null, emirate: string | null, override: string | null, manual: boolean | null): number | null =>
    (manual && override != null) ? Number(override) : deliveryPriceFils(truck, emirate);

  const drivers = [
    ...evd.rows.map((r) => ({
      driverName: cleanName(r.name), phone: drPhone.get(personKey(r.name)) ?? null, emirate: r.emirate || '—', truck: r.truck,
      priceFils: priceOf(r.truck, r.emirate, r.price_fils, r.price_manual), eventDate: r.date,
      eventRef: r.receipt_number ? `EV-${r.receipt_number}` : r.event_id, eventName: (r.event_name ?? '').trim() || null,
    })),
    ...man.rows.map((r) => ({
      driverName: cleanName(r.driver_name) || 'External driver', phone: drPhone.get(personKey(r.driver_name)) ?? null, emirate: r.emirate || '—', truck: r.truck,
      priceFils: priceOf(r.truck, r.emirate, r.price_fils, r.price_manual), eventDate: r.date, eventRef: null, eventName: null,
    })),
  ].sort((a, b) => a.eventDate.localeCompare(b.eventDate));

  return { partTimers, drivers };
}

/**
 * Record a monthly payment to a part-timer or driver, and (if WhatsApp is on and
 * the template approved) message them their orders + total for the month. Returns
 * the summary text so the owner can send it manually meanwhile. The transfer PDF
 * needs a document-header template (flagged) — not sent here yet.
 */
export async function markStaffPaid(opts: {
  kind: 'part_timer' | 'driver'; name: string; amountFils: number; receiptUrl?: string | null; month?: string; actor?: string;
}): Promise<{ ok: boolean; summary: string; whatsappSent: boolean }> {
  const monthStr = (opts.month && /^\d{4}-\d{2}$/.test(opts.month)) ? opts.month : dubaiToday().slice(0, 7);
  const name = cleanName(opts.name);
  const key = personKey(name);
  const amountFils = Math.max(0, Math.round(opts.amountFils || 0));
  // person_name holds the normalised match key (display name kept alongside);
  // a second payment in the same month ADDS to the first, never replaces it.
  await pool.query(
    `INSERT INTO staff_payments (person_name, display_name, person_kind, month, amount_fils, receipt_url, paid_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (person_kind, person_name, month) DO UPDATE
       SET amount_fils = staff_payments.amount_fils + EXCLUDED.amount_fils,
           display_name = COALESCE(EXCLUDED.display_name, staff_payments.display_name),
           receipt_url = COALESCE(EXCLUDED.receipt_url, staff_payments.receipt_url),
           paid_at = now(), paid_by = EXCLUDED.paid_by`,
    [key, name, opts.kind, monthStr, amountFils, opts.receiptUrl || null, opts.actor ?? 'owner'],
  );

  // Build the person's summary for this month.
  const rep = await buildStaffPayReport(`${monthStr}-01`);
  const label = rep.monthLabel;
  let lines: string[] = []; let phone: string | null = null;
  // This payment, plus the month's running total when it isn't the first.
  let cumulative = amountFils;
  if (opts.kind === 'part_timer') {
    const p = rep.partTimers.find((x) => x.key === key);
    if (p) { phone = p.phone; cumulative = p.paidFils; lines = p.entries.map((e) => `• ${e.date} — ${e.job} (${e.emirate}) ${e.amountDisplay}`); }
  } else {
    const p = rep.driverPayouts.find((x) => x.key === key);
    if (p) { phone = p.phone; cumulative = p.paidFils; }
    lines = rep.drivers.filter((d) => d.key === key)
      .map((d) => `• ${d.date} — ${d.emirate}${d.truck ? ` (${d.truck} truck)` : ''} ${d.priceDisplay}`);
  }
  const total = cumulative > amountFils
    ? `${formatAed(amountFils)} (total paid for ${label}: ${formatAed(cumulative)})`
    : formatAed(amountFils);
  const summary = `Hi ${name.split(' ')[0]} 💛\n\nHere is your Eventana summary for ${label}:\n\n${lines.join('\n') || '—'}\n\nTotal paid: ${total}\n\nThank you! 🩷`;

  // Try WhatsApp via the staff template (English). No-op/logged if the flag is off,
  // the template isn't approved, or we have no phone for this person.
  let whatsappSent = false;
  try {
    const { config } = await import('../config.js');
    const { whatsappEnabled, sendWhatsAppTemplate } = await import('../integrations/whatsapp.js');
    const to = String(phone ?? '').replace(/\D+/g, '');
    if (config.whatsapp.staffNotify && whatsappEnabled() && to) {
      // WhatsApp template variables can't contain newlines — keep the breakdown on one line.
      const res = await sendWhatsAppTemplate({ to, name: 'staff_notify', language: 'en', params: [name.split(' ')[0], `Your Eventana payment — ${label}`, `${lines.join(' • ') || '—'} — Total paid: ${total}`], fromStaff: true });
      whatsappSent = !!(res as any)?.ok;
      if (!whatsappSent) console.error(`[staff-pay] WhatsApp to ${name} failed: ${(res as any)?.error ?? 'unknown'}`);
    }
  } catch (e) { console.error('[staff-pay] whatsapp attempt failed:', (e as Error).message); }

  return { ok: true, summary, whatsappSent };
}

// ── Monthly email to the owner + Marsha ──────────────────────────────────────
const BRAND = '#EF5D95', INK = '#4A3540', MUTED = '#9B8A94', HAIR = '#F4DDEC', PANEL = '#FCEEF6';
const fmtDate = (d: string) => new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });

function buildEmailHtml(r: StaffPayReport): string {
  const ptRows = r.partTimers.length === 0
    ? `<tr><td style="padding:10px;color:${MUTED}">No part-timer engagements this month.</td></tr>`
    : r.partTimers.map((p) => `
      <tr><td style="padding:9px 12px;border-top:1px solid ${HAIR}">
        <b style="color:${INK}">${p.name}</b> — <b style="color:${BRAND}">${p.totalDisplay}</b>
        <div style="color:${MUTED};font-size:13px;margin-top:3px">${p.entries.map((e) => `${fmtDate(e.date)} · ${e.job} · ${e.emirate} · ${e.amountDisplay}`).join('<br>')}</div>
      </td></tr>`).join('');
  const drRows = r.drivers.length === 0
    ? `<tr><td style="padding:10px;color:${MUTED}">No deliveries this month.</td></tr>`
    : r.drivers.map((d) => `<tr><td style="padding:8px 12px;border-top:1px solid ${HAIR};color:${INK}">${fmtDate(d.date)} · <b>${d.name}</b> · ${d.emirate}${d.truck ? ` · ${d.truck} truck` : ''} · <b style="color:${BRAND}">${d.priceDisplay}</b> <span style="color:${MUTED}">(${d.type})</span></td></tr>`).join('');
  return `<div style="font-family:'Segoe UI',Arial,sans-serif;background:#FBEAF2;padding:22px">
    <div style="max-width:600px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;border:1px solid ${HAIR}">
      <div style="height:6px;background:linear-gradient(90deg,#7FD8C4,#BFE29A,#F7D06B,#F7A98C,#F080A8,#B79BE0)"></div>
      <div style="padding:22px">
        <h1 style="margin:0 0 4px;color:${INK};font-size:22px">🤡🚐 Part-timers & Drivers</h1>
        <div style="color:${MUTED};font-size:14px;margin-bottom:18px">${r.monthLabel}</div>
        <div style="background:${PANEL};border-radius:12px;padding:12px 14px;margin-bottom:14px">
          <div style="color:${INK};font-weight:700;font-size:15px">Part-timers — total ${r.partTimerTotalDisplay}</div>
        </div>
        <table style="width:100%;border-collapse:collapse">${ptRows}</table>
        <div style="color:${INK};font-weight:700;font-size:15px;margin:20px 0 6px">🚐 Deliveries — total ${r.deliveryTotalDisplay}</div>
        <table style="width:100%;border-collapse:collapse">${drRows}</table>
        <div style="color:${MUTED};font-size:12px;margin-top:18px;border-top:1px solid ${HAIR};padding-top:12px">
          Clown = AED 200 · Face painting = AED 350. Part-timer phone numbers and driver distance-from-base aren't tracked yet.
        </div>
      </div>
    </div></div>`;
}

/** Send the report for a given month (YYYY-MM) to the owner + Marsha. */
export async function sendStaffPayReport(monthStr: string): Promise<{ sent: number }> {
  if (!emailEnabled()) return { sent: 0 };
  const r = await buildStaffPayReport(`${monthStr}-01`);
  const html = buildEmailHtml(r);
  let sent = 0;
  for (const to of [OWNER_EMAIL, MARSHA_EMAIL]) {
    const res = await sendEmail({ to, subject: `Eventana — Part-timers & Drivers · ${r.monthLabel}`, html });
    // sendEmail returns a truthy object even on failure, so `|| res` counted a
    // FAILED send as sent — check res.ok like the other report senders do.
    if ((res as any)?.ok) sent++;
  }
  return { sent };
}

/**
 * On the 1st of each month (from 10:00 Dubai), email the PREVIOUS month's part-timer/driver report
 * to the owner + Marsha, exactly once (deduped by staff_pay_reports).
 */
export async function sweepStaffPayReport(): Promise<void> {
  if (!emailEnabled()) return;
  try {
    // The 1st of the month from 10:00 Dubai time (owner, Nov 2026) — same slot as
    // the monthly report, after the whole previous month (incl. the 30th/31st) is in.
    const now = new Date(Date.now() + 4 * 3600 * 1000); // Dubai wall clock (UTC+4)
    if (now.getUTCDate() !== 1 || now.getUTCHours() < 10) return;
    const prev = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
    const monthStr = `${prev.getUTCFullYear()}-${String(prev.getUTCMonth() + 1).padStart(2, '0')}`;
    const { rowCount } = await pool.query(
      `INSERT INTO staff_pay_reports (month) VALUES ($1) ON CONFLICT (month) DO NOTHING`,
      [monthStr],
    );
    if (rowCount) await sendStaffPayReport(monthStr);
  } catch (err) {
    console.error('[staff-pay-report] sweep failed:', (err as Error).message);
  }
}
