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

export type StaffPayReport = {
  monthLabel: string;
  partTimers: Array<{ name: string; entries: Array<{ date: string; emirate: string; job: string; amountDisplay: string }>; totalFils: number; totalDisplay: string }>;
  partTimerTotalDisplay: string;
  drivers: Array<{ name: string; date: string; emirate: string; type: string }>;
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

  // Driver deliveries this month.
  const dr = await pool.query<{ name: string; emirate: string | null; date: string; role: string; has_account: boolean }>(
    `SELECT COALESCE(tm.name, btrim(es.part_time_name), 'Driver') AS name, e.emirate,
            to_char(e.event_date,'YYYY-MM-DD') AS date, es.role,
            (es.assignee_id IS NOT NULL) AS has_account
       FROM event_staff es JOIN events e ON e.id = es.event_id
       LEFT JOIN team_members tm ON tm.id = es.assignee_id
      WHERE es.role IN ('driver','pt_driver')
        -- Only part-time drivers we pay/track — NOT the salaried own-van driver
        -- (Shan): a part-timer or a driver slot with no team account.
        AND (es.role = 'pt_driver' OR es.assignee_id IS NULL)
        AND e.phase IS DISTINCT FROM 'Cancelled'
        AND e.event_date >= date_trunc('month', $1::date)
        AND e.event_date <  date_trunc('month', $1::date) + interval '1 month'
      ORDER BY e.event_date`,
    [month],
  );
  const drivers = dr.rows.map((r) => ({
    name: r.name, date: r.date, emirate: r.emirate || '—', type: 'Part-time',
  }));

  return { monthLabel, partTimers, partTimerTotalDisplay: formatAed(grand), drivers };
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
    : r.drivers.map((d) => `<tr><td style="padding:8px 12px;border-top:1px solid ${HAIR};color:${INK}">${fmtDate(d.date)} · <b>${d.name}</b> · ${d.emirate} · <span style="color:${MUTED}">${d.type}</span></td></tr>`).join('');
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
        <div style="color:${INK};font-weight:700;font-size:15px;margin:20px 0 6px">🚐 Deliveries</div>
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
