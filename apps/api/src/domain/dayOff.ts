/**
 * Weekly day-off CHANGE requests. A member asks to move their recurring rest
 * day; the owner or Marsha approves, and on approval the new day is written to
 * team_members.weekly_day_off. Managers can still set the day directly on the
 * Team screen — this is only the self-service request path.
 */
import type { PoolClient } from 'pg';
import { pool } from '../db/pool.js';

export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

type SubmitResult = { ok: true; id: number } | { ok: false; reason: string };

export async function submitDayOffChange(memberId: string, requestedDay: number, reason: string | null): Promise<SubmitResult> {
  if (!(Number.isInteger(requestedDay) && requestedDay >= 0 && requestedDay <= 6)) {
    return { ok: false, reason: 'Pick a valid weekday.' };
  }
  const cur = await pool.query(`SELECT weekly_day_off FROM team_members WHERE id = $1`, [memberId]);
  if (!cur.rows[0]) return { ok: false, reason: 'Member not found.' };
  if (cur.rows[0].weekly_day_off !== null && Number(cur.rows[0].weekly_day_off) === requestedDay) {
    return { ok: false, reason: 'That is already your day off.' };
  }
  const pend = await pool.query(`SELECT 1 FROM day_off_change_requests WHERE member_id = $1 AND status = 'pending' LIMIT 1`, [memberId]);
  if (pend.rowCount) return { ok: false, reason: 'You already have a day-off change waiting for approval.' };
  const ins = await pool.query(
    `INSERT INTO day_off_change_requests (member_id, requested_day, reason) VALUES ($1,$2,$3) RETURNING id`,
    [memberId, requestedDay, (reason ?? '').trim() || null],
  );
  return { ok: true, id: Number(ins.rows[0].id) };
}

type DecideResult = { ok: true; memberId: string; requestedDay: number } | { ok: false; reason: string };

export async function decideDayOffChange(
  db: PoolClient, id: number, decision: 'approved' | 'rejected', deciderName: string, note: string | null,
): Promise<DecideResult> {
  const { rows } = await db.query(`SELECT * FROM day_off_change_requests WHERE id = $1 FOR UPDATE`, [id]);
  const req = rows[0];
  if (!req) return { ok: false, reason: 'Request not found.' };
  if (req.status !== 'pending') return { ok: false, reason: `This request is already ${req.status}.` };
  await db.query(
    `UPDATE day_off_change_requests SET status = $2, decided_by = $3, decided_at = now(), decision_note = $4 WHERE id = $1`,
    [id, decision, deciderName, (note ?? '').trim() || null],
  );
  if (decision === 'approved') {
    await db.query(`UPDATE team_members SET weekly_day_off = $2 WHERE id = $1`, [req.member_id, req.requested_day]);
  }
  return { ok: true, memberId: req.member_id, requestedDay: Number(req.requested_day) };
}

export async function cancelDayOffChange(id: number, memberId: string): Promise<{ ok: boolean; reason?: string }> {
  const { rows } = await pool.query(`SELECT status FROM day_off_change_requests WHERE id = $1 AND member_id = $2`, [id, memberId]);
  if (!rows[0]) return { ok: false, reason: 'Request not found.' };
  if (rows[0].status !== 'pending') return { ok: false, reason: 'Only a pending request can be cancelled.' };
  await pool.query(`UPDATE day_off_change_requests SET status = 'cancelled' WHERE id = $1`, [id]);
  return { ok: true };
}

/** Owner/manager (+ Marsha): every change request, pending first. */
export async function listDayOffChanges(): Promise<any[]> {
  const { rows } = await pool.query(
    `SELECT dc.id, dc.member_id, tm.name AS member_name, tm.color,
            tm.weekly_day_off AS current_day, dc.requested_day, dc.reason, dc.status,
            to_char(dc.submitted_at,'YYYY-MM-DD HH24:MI') AS submitted_at,
            dc.decided_by, to_char(dc.decided_at,'YYYY-MM-DD') AS decided_at
       FROM day_off_change_requests dc JOIN team_members tm ON tm.id = dc.member_id
      ORDER BY (dc.status = 'pending') DESC, dc.submitted_at DESC, dc.id DESC LIMIT 100`,
  );
  return rows;
}

/** The member's own pending change (for their profile). Defensive: returns null
 *  if the table doesn't exist yet, so the profile never breaks. */
export async function memberPendingDayOffChange(memberId: string): Promise<any | null> {
  try {
    const { rows } = await pool.query(
      `SELECT id, requested_day, reason, to_char(submitted_at,'YYYY-MM-DD') AS submitted_at
         FROM day_off_change_requests WHERE member_id = $1 AND status = 'pending'
        ORDER BY id DESC LIMIT 1`,
      [memberId],
    );
    return rows[0] ?? null;
  } catch {
    return null;
  }
}
