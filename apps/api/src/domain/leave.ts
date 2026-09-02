/**
 * Annual leave — entitlement, pro-rata accrual, requests, approval.
 *
 * Accrual is pro-rata from the member's employment start date: rate =
 * annualEntitlementDays / 12 (≈ 2.5 days per completed month for 30 days). Both
 * values live in settings ('leave_rules') so the owner can change them without a
 * deploy. The balance is computed LIVE from the requests table — accrued minus
 * approved (Used) minus pending (Pending) — so the same request can never be
 * deducted twice and nothing is deducted before approval. Approving a request
 * also drops a linked staff_days_off row, which is what makes the person show as
 * Unavailable on the calendar and skipped by the auto-staffing engine.
 */
import type { PoolClient } from 'pg';
import { pool } from '../db/pool.js';

/** Names NOT on the annual-leave scheme (owner-family / off-scheme). Lower-cased. */
export const LEAVE_EXCLUDED = ['razan', 'noon'];
export function isLeaveExcluded(name: string | null | undefined): boolean {
  const n = (name ?? '').trim().toLowerCase();
  return LEAVE_EXCLUDED.some((x) => n === x || n.startsWith(`${x} `));
}

export interface LeaveConfig { annualEntitlementDays: number; accrualPerMonth: number; }
const LEAVE_DEFAULTS: LeaveConfig = { annualEntitlementDays: 30, accrualPerMonth: 2.5 };

export async function loadLeaveConfig(): Promise<LeaveConfig> {
  const { rows } = await pool.query(`SELECT value FROM settings WHERE key = 'leave_rules'`);
  return { ...LEAVE_DEFAULTS, ...(rows[0]?.value ?? {}) };
}
export async function saveLeaveConfig(patch: Partial<LeaveConfig>, updatedBy: string): Promise<LeaveConfig> {
  const next = { ...(await loadLeaveConfig()), ...patch };
  await pool.query(
    `INSERT INTO settings (key, value, updated_by) VALUES ('leave_rules', $1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`,
    [JSON.stringify(next), updatedBy],
  );
  return next;
}

/** Parse a date-only value to a UTC midnight Date. */
function toDate(d: string | Date): Date {
  const s = typeof d === 'string' ? d : d.toISOString();
  return new Date(`${s.slice(0, 10)}T00:00:00Z`);
}

/** Whole calendar months completed from start to end (UTC, date-only). */
export function completedMonths(start: Date, end: Date): number {
  if (end < start) return 0;
  let months = (end.getUTCFullYear() - start.getUTCFullYear()) * 12 + (end.getUTCMonth() - start.getUTCMonth());
  if (end.getUTCDate() < start.getUTCDate()) months -= 1; // the current month isn't complete yet
  return Math.max(0, months);
}

/** Inclusive calendar days between two date-only strings. */
export function rangeDays(start: string, end: string): number {
  const a = toDate(start).getTime();
  const b = toDate(end).getTime();
  return Math.floor((b - a) / 86_400_000) + 1;
}

/** Days accrued to `asOf`, capping the clock at the contract end date if any. */
export function accruedDays(startDate: string, asOf: Date, endDate: string | null, cfg: LeaveConfig): number {
  if (!startDate) return 0;
  let end = asOf;
  if (endDate) { const ed = toDate(endDate); if (ed < end) end = ed; }
  const months = completedMonths(toDate(startDate), end);
  return Math.round(months * cfg.accrualPerMonth * 10) / 10;
}

export interface LeaveBalance {
  onScheme: boolean;
  startDate: string | null;
  endDate: string | null;
  entitlement: number;
  accrualPerMonth: number;
  accrued: number;
  used: number;
  pending: number;
  remaining: number;
}

export async function leaveBalance(memberId: string): Promise<LeaveBalance> {
  const cfg = await loadLeaveConfig();
  const { rows } = await pool.query(
    // to_char keeps these as 'YYYY-MM-DD' strings; a raw DATE comes back as a JS
    // Date whose String() is "Sat Apr 12 2025 …", and slicing that gives garbage
    // ("Sat Apr 12") that parses to NaN — which is what made accrued/remaining null.
    `SELECT name,
            to_char(employment_start_date, 'YYYY-MM-DD') AS employment_start_date,
            to_char(employment_end_date,   'YYYY-MM-DD') AS employment_end_date,
            COALESCE(leave_opening_used_days, 0)::numeric AS opening_used
       FROM team_members WHERE id = $1`,
    [memberId],
  );
  const m = rows[0];
  const onScheme = !!m && !isLeaveExcluded(m.name);
  const startDate = m?.employment_start_date ? String(m.employment_start_date).slice(0, 10) : null;
  const endDate = m?.employment_end_date ? String(m.employment_end_date).slice(0, 10) : null;
  const accrued = onScheme && startDate ? accruedDays(startDate, new Date(), endDate, cfg) : 0;
  // Leave used before the system existed (owner backfill). Folded into "used"
  // so the live balance reflects reality for long-serving staff.
  const openingUsed = Number(m?.opening_used ?? 0);

  const agg = await pool.query(
    `SELECT COALESCE(SUM(days) FILTER (WHERE status = 'approved'), 0)::numeric AS used,
            COALESCE(SUM(days) FILTER (WHERE status = 'pending'),  0)::numeric AS pending
       FROM leave_requests WHERE member_id = $1`,
    [memberId],
  );
  const used = Number(agg.rows[0].used) + openingUsed;
  const pending = Number(agg.rows[0].pending);
  const remaining = Math.round((accrued - used - pending) * 10) / 10;
  return { onScheme, startDate, endDate, entitlement: cfg.annualEntitlementDays, accrualPerMonth: cfg.accrualPerMonth, accrued, used, pending, remaining };
}

type SubmitResult = { ok: true; id: number; days: number } | { ok: false; reason: string };

/**
 * Submit a leave request: validate dates, sufficient balance, and no clash with
 * the member's own leave or an event they're rostered on. Creates a 'pending'
 * row — nothing is deducted until it's approved.
 */
export async function submitLeaveRequest(
  memberId: string,
  startDate: string,
  endDate: string,
  reason: string | null,
): Promise<SubmitResult> {
  if (!startDate || !endDate) return { ok: false, reason: 'Choose a start and end date.' };
  if (toDate(endDate) < toDate(startDate)) return { ok: false, reason: 'The end date is before the start date.' };

  const bal = await leaveBalance(memberId);
  if (!bal.onScheme) return { ok: false, reason: 'This account is not on the annual-leave scheme.' };
  if (!bal.startDate) return { ok: false, reason: 'Your employment start date isn’t set yet — ask the owner to add it so your balance can be calculated.' };

  const days = rangeDays(startDate, endDate);
  if (days > bal.remaining) {
    return { ok: false, reason: `Not enough leave: you have ${bal.remaining} day(s) left and this request is ${days} day(s).` };
  }

  const overlap = await pool.query(
    `SELECT 1 FROM leave_requests
      WHERE member_id = $1 AND status IN ('pending','approved')
        AND start_date <= $3 AND end_date >= $2 LIMIT 1`,
    [memberId, startDate, endDate],
  );
  if (overlap.rowCount) return { ok: false, reason: 'These dates overlap a leave you already have.' };

  const evConf = await pool.query(
    `SELECT e.id FROM event_team et JOIN events e ON e.id = et.event_id
      WHERE et.member_id = $1 AND e.event_date BETWEEN $2 AND $3
        AND lower(e.phase) NOT LIKE '%cancel%' LIMIT 3`,
    [memberId, startDate, endDate],
  );
  if (evConf.rowCount) {
    return { ok: false, reason: `You’re assigned to an event on these dates (${evConf.rows.map((r) => r.id).join(', ')}). Ask the manager to reassign it first.` };
  }

  const ins = await pool.query(
    `INSERT INTO leave_requests (member_id, start_date, end_date, days, reason)
     VALUES ($1,$2,$3,$4,$5) RETURNING id`,
    [memberId, startDate, endDate, days, (reason ?? '').trim() || null],
  );
  return { ok: true, id: Number(ins.rows[0].id), days };
}

type DecideResult = { ok: true; memberId: string } | { ok: false; reason: string };

/** Approve or reject a pending request. On approval, drop a linked day-off. */
export async function decideLeaveRequest(
  db: PoolClient,
  id: number,
  decision: 'approved' | 'rejected',
  deciderName: string,
  note: string | null,
): Promise<DecideResult> {
  const { rows } = await db.query(`SELECT * FROM leave_requests WHERE id = $1 FOR UPDATE`, [id]);
  const req = rows[0];
  if (!req) return { ok: false, reason: 'Request not found.' };
  if (req.status !== 'pending') return { ok: false, reason: `This request is already ${req.status}.` };

  await db.query(
    `UPDATE leave_requests SET status = $2, decided_by = $3, decided_at = now(), decision_note = $4 WHERE id = $1`,
    [id, decision, deciderName, (note ?? '').trim() || null],
  );

  if (decision === 'approved') {
    const exists = await db.query(`SELECT 1 FROM staff_days_off WHERE leave_request_id = $1`, [id]);
    if (!exists.rowCount) {
      await db.query(
        `INSERT INTO staff_days_off (member_id, start_date, end_date, reason, status, leave_request_id)
         VALUES ($1,$2,$3,$4,'approved',$5)`,
        [req.member_id, req.start_date, req.end_date, `Annual leave${req.reason ? ` — ${req.reason}` : ''}`, id],
      );
    }
  }
  return { ok: true, memberId: req.member_id };
}

/** An employee cancels their own request; frees the day-off if it was approved. */
export async function cancelLeaveRequest(id: number, memberId: string): Promise<{ ok: boolean; reason?: string }> {
  const { rows } = await pool.query(`SELECT status FROM leave_requests WHERE id = $1 AND member_id = $2`, [id, memberId]);
  const req = rows[0];
  if (!req) return { ok: false, reason: 'Request not found.' };
  if (req.status === 'cancelled') return { ok: true };
  if (req.status === 'rejected') return { ok: false, reason: 'A rejected request can’t be cancelled.' };
  await pool.query(`UPDATE leave_requests SET status = 'cancelled' WHERE id = $1`, [id]);
  await pool.query(`DELETE FROM staff_days_off WHERE leave_request_id = $1`, [id]);
  return { ok: true };
}

const REQ_COLS = `id,
  to_char(start_date,'YYYY-MM-DD') AS start_date,
  to_char(end_date,'YYYY-MM-DD')   AS end_date,
  days, reason, status,
  to_char(submitted_at,'YYYY-MM-DD') AS submitted_at,
  decided_by,
  to_char(decided_at,'YYYY-MM-DD')   AS decided_at,
  decision_note`;

export async function listMemberLeave(memberId: string): Promise<any[]> {
  const { rows } = await pool.query(
    `SELECT ${REQ_COLS} FROM leave_requests WHERE member_id = $1 ORDER BY submitted_at DESC, id DESC`,
    [memberId],
  );
  return rows;
}

/** All requests for the owner/manager, pending first. */
export async function listAllLeave(): Promise<any[]> {
  const { rows } = await pool.query(
    `SELECT lr.id, lr.member_id, tm.name AS member_name, tm.color,
            to_char(lr.start_date,'YYYY-MM-DD') AS start_date,
            to_char(lr.end_date,'YYYY-MM-DD')   AS end_date,
            lr.days, lr.reason, lr.status,
            to_char(lr.submitted_at,'YYYY-MM-DD HH24:MI') AS submitted_at,
            lr.decided_by,
            to_char(lr.decided_at,'YYYY-MM-DD') AS decided_at,
            lr.decision_note
       FROM leave_requests lr JOIN team_members tm ON tm.id = lr.member_id
      ORDER BY (lr.status = 'pending') DESC, lr.submitted_at DESC, lr.id DESC`,
  );
  return rows;
}
