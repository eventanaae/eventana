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

function jobOf(role: string): { job: string; fils: number } {
  if (role === 'face_painting') return { job: 'Face painting', fils: FACEPAINT_FILS };
  if (role === 'clown' || role === 'acrobat_clown') return { job: 'Clown', fils: CLOWN_FILS };
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

export type StaffPayReport = {
  monthLabel: string;
  partTimers: Array<{ name: string; entries: Array<{ date: string; emirate: string; job: string; amountDisplay: string }>; totalFils: number; totalDisplay: string }>;
  partTimerTotalDisplay: string;
  drivers: Array<{ id: string; eventId: string | null; name: string; date: string; emirate: string; type: string; truck: string | null; priceFils: number | null; priceDisplay: string; priceManual: boolean }>;
  deliveryTotalDisplay: string;
};

export async function buildStaffPayReport(monthISO?: string): Promise<StaffPayReport> {
  const month = monthISO ?? new Date().toISOString().slice(0, 10);
  const monthLabel = new Date(month).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });

  // Part-timer engagements this month (event_staff rows carrying a part-timer name).
  const pt = await pool.query<{ name: string; role: string; emirate: string | null; date: string }>(
    `SELECT btrim(es.part_time_name) AS name, es.role, e.emirate,
            to_char(e.event_date,'YYYY-MM-DD') AS date
       FROM event_staff es JOIN events e ON e.id = es.event_id
      WHERE es.part_time_name IS NOT NULL AND btrim(es.part_time_name) <> ''
        -- Only the paid entertainer roles belong in this tracker (clown / face
        -- paint); part-time drivers show under Deliveries, not here.
        AND es.role IN ('clown', 'acrobat_clown', 'face_painting')
        AND e.phase IS DISTINCT FROM 'Cancelled'
        AND e.event_date >= date_trunc('month', $1::date)
        AND e.event_date <  date_trunc('month', $1::date) + interval '1 month'
        -- Count only events that have already happened (up to today) — the total
        -- grows as each event finishes, never counts work not done yet.
        AND e.event_date <= CURRENT_DATE
      ORDER BY btrim(es.part_time_name), e.event_date`,
    [month],
  );
  const byName = new Map<string, StaffPayReport['partTimers'][number]>();
  let grand = 0;
  for (const r of pt.rows) {
    const { job, fils } = jobOf(r.role);
    const g = byName.get(r.name) ?? { name: r.name, entries: [], totalFils: 0, totalDisplay: '' };
    g.entries.push({ date: r.date, emirate: r.emirate || '—', job, amountDisplay: fils ? formatAed(fils) : '—' });
    g.totalFils += fils; grand += fils;
    byName.set(r.name, g);
  }
  const partTimers = [...byName.values()].map((g) => ({ ...g, totalDisplay: formatAed(g.totalFils) }));

  // Event deliveries this month (a driver assigned, excluding salaried own-van
  // Shan), plus any truck/price the owner set for them (deliveries table by
  // event_id) — and MANUAL deliveries (deliveries rows with event_id NULL).
  const [evd, man] = await Promise.all([
    pool.query<{ event_id: string; name: string; emirate: string | null; date: string; truck: string | null; price_fils: string | null; price_manual: boolean | null }>(
      `SELECT e.id AS event_id, COALESCE(tm.name, btrim(es.part_time_name), 'Driver') AS name,
              e.emirate, to_char(e.event_date,'YYYY-MM-DD') AS date,
              d.truck, d.price_fils, d.price_manual
         FROM event_staff es JOIN events e ON e.id = es.event_id
         LEFT JOIN team_members tm ON tm.id = es.assignee_id
         LEFT JOIN deliveries d ON d.event_id = e.id
        WHERE es.role IN ('driver','pt_driver')
          AND (es.role = 'pt_driver' OR es.assignee_id IS NULL OR lower(tm.name) <> 'shan')
          AND e.phase IS DISTINCT FROM 'Cancelled'
          AND e.event_date >= date_trunc('month', $1::date)
          AND e.event_date <  date_trunc('month', $1::date) + interval '1 month'
          AND e.event_date <= CURRENT_DATE
        ORDER BY e.event_date`,
      [month],
    ),
    pool.query<{ id: string; date: string; driver_name: string | null; driver_type: string | null; emirate: string | null; truck: string | null; price_fils: string | null; price_manual: boolean | null }>(
      `SELECT id, to_char(del_date,'YYYY-MM-DD') AS date, driver_name, driver_type, emirate, truck, price_fils, price_manual
         FROM deliveries
        WHERE event_id IS NULL
          AND del_date >= date_trunc('month', $1::date)
          AND del_date <  date_trunc('month', $1::date) + interval '1 month'
          AND del_date <= CURRENT_DATE
        ORDER BY del_date`,
      [month],
    ),
  ]);

  const priceOf = (truck: string | null, emirate: string | null, override: string | null, manual: boolean | null): number | null =>
    (manual && override != null) ? Number(override) : deliveryPriceFils(truck, emirate);

  let deliveryTotal = 0;
  const drivers = [
    ...evd.rows.map((r) => {
      const price = priceOf(r.truck, r.emirate, r.price_fils, r.price_manual);
      if (price) deliveryTotal += price;
      return { id: `event:${r.event_id}`, eventId: r.event_id, name: r.name, date: r.date, emirate: r.emirate || '—',
        type: 'Delivery', truck: r.truck, priceFils: price, priceDisplay: price != null ? formatAed(price) : '—', priceManual: !!r.price_manual };
    }),
    ...man.rows.map((r) => {
      const price = priceOf(r.truck, r.emirate, r.price_fils, r.price_manual);
      if (price) deliveryTotal += price;
      return { id: `manual:${r.id}`, eventId: null, name: r.driver_name || 'External driver', date: r.date, emirate: r.emirate || '—',
        type: r.driver_type === 'own_van' ? 'Own van' : r.driver_type === 'part_time' ? 'Part-time' : 'External', truck: r.truck,
        priceFils: price, priceDisplay: price != null ? formatAed(price) : '—', priceManual: !!r.price_manual };
    }),
  ].sort((a, b) => a.date.localeCompare(b.date));

  return { monthLabel, partTimers, partTimerTotalDisplay: formatAed(grand), drivers, deliveryTotalDisplay: formatAed(deliveryTotal) };
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
    if ((res as any)?.id || res) sent++;
  }
  return { sent };
}

/**
 * On the 1st of each month, email the PREVIOUS month's part-timer/driver report
 * to the owner + Marsha, exactly once (deduped by staff_pay_reports).
 */
export async function sweepStaffPayReport(): Promise<void> {
  if (!emailEnabled()) return;
  try {
    const now = new Date();
    if (now.getUTCDate() !== 1) return;
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
