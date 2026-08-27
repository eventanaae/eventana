/**
 * Staff incentives & achievements.
 *
 * The reward amounts live in settings (key 'incentive_rules'), never hard-coded,
 * so the owner can change them without a deploy. Rewards are RECORDED into
 * staff_rewards the moment they're earned (e.g. a 4★+ customer feedback), with a
 * UNIQUE guard so a re-submitted or refreshed feedback is never paid twice.
 */
import { pool } from '../db/pool.js';
import { formatAed } from '@eventana/shared';
import { pushToStaff, pushToOwner } from '../integrations/push.js';

export interface IncentiveRules {
  goodStars: number;            // minimum stars that count as positive feedback
  goodFeedbackRewardFils: number;
  glamRewardFils: number;
  eventIncentiveFils: number;   // per event beyond target
  minEventValueFils: number;    // an event must be worth at least this (excl delivery)
  targetEvents: number;
  minEvents: number;
  commissionRate: number;
  commissionMinFils: number;
}

export const INCENTIVE_DEFAULTS: IncentiveRules = {
  goodStars: 5,
  goodFeedbackRewardFils: 1000,   // AED 10
  glamRewardFils: 2000,           // AED 20
  eventIncentiveFils: 5000,       // AED 50
  minEventValueFils: 200000,      // AED 2000
  targetEvents: 20,
  minEvents: 15,
  commissionRate: 0.02,
  commissionMinFils: 2_000_000,   // AED 20,000
};

/** Names never in the incentive scheme (owner + driver). Lower-cased. */
export const INCENTIVE_EXCLUDED = ['shan', 'sheem'];

export async function loadIncentiveRules(): Promise<IncentiveRules> {
  const { rows } = await pool.query(`SELECT value FROM settings WHERE key = 'incentive_rules'`);
  return { ...INCENTIVE_DEFAULTS, ...(rows[0]?.value ?? {}) };
}

export async function saveIncentiveRules(patch: Partial<IncentiveRules>, updatedBy: string): Promise<IncentiveRules> {
  const next = { ...(await loadIncentiveRules()), ...patch };
  await pool.query(
    `INSERT INTO settings (key, value, updated_by) VALUES ('incentive_rules', $1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`,
    [JSON.stringify(next), updatedBy],
  );
  return next;
}

/**
 * A positive customer feedback (>= goodStars) earns the crew that ran the event
 * the "good feedback" reward. One reward per (rating, member) thanks to the
 * UNIQUE key, so a re-submit never double-pays. Notifies each rewarded member
 * individually AND broadcasts the good news (names + feedback) to the whole team.
 * Safe to call on every rating submit; a no-op below the star threshold.
 */
export async function recordGoodFeedbackRewards(params: {
  eventId: string; ratingId: number | string; stars: number; feedback?: string | null;
}): Promise<{ rewarded: Array<{ memberId: string; name: string }>; amountFils: number }> {
  const rules = await loadIncentiveRules();
  if (params.stars < rules.goodStars) return { rewarded: [], amountFils: 0 };

  // The crew that actually ran it — real team members only (part-timers are just
  // names on a slot, never here), minus the excluded owner/driver names.
  const { rows: crew } = await pool.query<{ id: string; name: string }>(
    `SELECT tm.id, tm.name FROM event_team et JOIN team_members tm ON tm.id = et.member_id
      WHERE et.event_id = $1 AND tm.active AND lower(tm.name) <> ALL($2::text[])`,
    [params.eventId, INCENTIVE_EXCLUDED],
  );
  if (crew.length === 0) return { rewarded: [], amountFils: 0 };

  const amount = rules.goodFeedbackRewardFils;
  const note = (params.feedback ?? '').trim().slice(0, 500) || `${params.stars}★ customer feedback`;
  const rewarded: Array<{ memberId: string; name: string }> = [];
  for (const m of crew) {
    const res = await pool.query(
      `INSERT INTO staff_rewards (member_id, event_id, kind, amount_fils, note, source_ref)
       VALUES ($1,$2,'good_feedback',$3,$4,$5)
       ON CONFLICT (kind, source_ref, member_id) DO NOTHING
       RETURNING id`,
      [m.id, params.eventId, amount, note, String(params.ratingId)],
    );
    if (res.rowCount) {
      rewarded.push({ memberId: m.id, name: m.name });
      // The individual "you earned it" message.
      void pushToOwner('staff', m.id, 'Great job! 🎉',
        `This positive customer feedback earned you ${formatAed(amount)}. View it in your Achievements.`,
        { eventId: params.eventId });
    }
  }

  if (rewarded.length > 0) {
    // Broadcast to the whole team who got the love, and what the customer said.
    const names = rewarded.map((r) => r.name).join(', ');
    const fb = (params.feedback ?? '').trim();
    await pool.query(
      `INSERT INTO notifications (event_id, channel, template, scheduled_for, payload)
       VALUES ($1,'push','good_feedback_broadcast', now(), $2)`,
      [params.eventId, JSON.stringify({ eventId: params.eventId, names, stars: params.stars, feedback: fb.slice(0, 300), amountFils: amount })],
    );
    void pushToStaff('Great customer feedback! 🌟',
      `${names} earned a reward for ${params.stars}★ feedback${fb ? `: "${fb.slice(0, 80)}"` : ''}.`,
      { eventId: params.eventId });
  }
  return { rewarded, amountFils: amount };
}

/**
 * Achievements list. An employee sees only their own rewards; owner/manager see
 * everyone's. Each row carries the event, date, amount and the feedback note.
 */
export async function listAchievements(opts: { memberId?: string; all: boolean }): Promise<any> {
  const params: any[] = [];
  let where = '';
  if (!opts.all) {
    if (!opts.memberId) return { rows: [], totalFils: 0, totalDisplay: formatAed(0) };
    where = 'WHERE r.member_id = $1';
    params.push(opts.memberId);
  }
  const { rows } = await pool.query(
    `SELECT r.id, r.member_id, tm.name AS member, r.event_id, r.kind, r.amount_fils, r.note,
            to_char(r.created_at,'YYYY-MM-DD') AS date
       FROM staff_rewards r LEFT JOIN team_members tm ON tm.id = r.member_id
       ${where}
      ORDER BY r.created_at DESC LIMIT 200`,
    params,
  );
  const total = rows.reduce((s, r) => s + Number(r.amount_fils), 0);
  return {
    rows: rows.map((r) => ({
      id: r.id, memberId: r.member_id, member: r.member, eventId: r.event_id, kind: r.kind,
      amountFils: Number(r.amount_fils), amountDisplay: formatAed(Number(r.amount_fils)), note: r.note, date: r.date,
    })),
    totalFils: total, totalDisplay: formatAed(total),
  };
}
