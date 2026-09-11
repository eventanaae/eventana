/**
 * READ-ONLY. Lists the good_feedback staff rewards (the "5★ moments") joined to
 * the real event behind each — event date, customer, celebration, guest of
 * honour, theme, booking ref — plus the reward date and the rating's stars/date.
 * So we can see WHAT each rewarded event actually was. Gated by REWARDS_DEBUG=true.
 */
import { pool } from './pool.js';

/**
 * One-shot cleanup: delete orphaned good_feedback rewards — the "5★ moments"
 * whose backing event no longer exists or has no 4-5★ rating (left behind when
 * test/removed events were deleted). Keeps every reward that still has a real
 * event + rating behind it. Logs each deletion. Gated by REWARDS_CLEANUP=true.
 */
export async function rewardsCleanupFromEnv(): Promise<void> {
  if (String(process.env.REWARDS_CLEANUP ?? '').toLowerCase() !== 'true') return;
  const L = (s: string) => console.log(`[rewards-cleanup] ${s}`);
  try {
    const del = await pool.query<{ member_id: string; event_id: string; note: string | null }>(
      `DELETE FROM staff_rewards sr
        WHERE sr.kind = 'good_feedback'
          AND NOT EXISTS (
            SELECT 1 FROM events e
              JOIN event_ratings r ON r.event_id = e.id AND r.stars >= 4
             WHERE e.id = sr.event_id
          )
        RETURNING sr.member_id, sr.event_id, sr.note`,
    );
    for (const r of del.rows) L(`deleted orphan: member=${r.member_id} event=${r.event_id}`);
    L(`DONE — deleted ${del.rowCount ?? 0} orphaned good_feedback reward(s)`);
  } catch (e) {
    console.error('[rewards-cleanup] failed:', (e as Error).message);
  }
}

export async function rewardsDebugFromEnv(): Promise<void> {
  if (String(process.env.REWARDS_DEBUG ?? '').toLowerCase() !== 'true') return;
  const L = (s: string) => console.log(`[rewards-debug] ${s}`);
  try {
    const { rows } = await pool.query(
      `SELECT tm.name AS member,
              sr.event_id,
              to_char(sr.created_at,'YYYY-MM-DD') AS reward_date,
              to_char(e.event_date,'YYYY-MM-DD')  AS event_date,
              c.name AS customer,
              e.celebration_type,
              initcap(o.cart->>'eventFor') AS baby,
              COALESCE(th.name, initcap(o.cart->>'customTheme')) AS theme,
              (SELECT fr.number FROM finance_receipts fr
                 WHERE fr.event_id = e.id OR (e.order_id IS NOT NULL AND fr.order_id = e.order_id)
                 ORDER BY (fr.event_id = e.id) DESC, fr.id LIMIT 1) AS receipt_number,
              r.stars, to_char(r.created_at,'YYYY-MM-DD') AS rated_on
         FROM staff_rewards sr
         LEFT JOIN team_members tm ON tm.id = sr.member_id
         LEFT JOIN events e ON e.id = sr.event_id
         LEFT JOIN orders o ON o.id = e.order_id
         LEFT JOIN themes th ON th.id = e.theme_id
         LEFT JOIN customers c ON c.id = e.customer_id
         LEFT JOIN event_ratings r ON r.event_id = e.id
        WHERE sr.kind = 'good_feedback'
        ORDER BY sr.created_at DESC, sr.event_id`,
    );
    L(`good_feedback rewards: ${rows.length}`);
    for (const x of rows) {
      const ref = x.receipt_number ? `EV-${x.receipt_number}` : (x.event_id ?? '—');
      const what = [x.baby ? `${x.baby}'s` : '', x.celebration_type ?? '', x.theme ? `(${x.theme})` : ''].filter(Boolean).join(' ');
      L(`• ${x.member ?? '—'} | ${x.event_id} = ${ref} | ${what || '—'} | eventDate=${x.event_date ?? 'NULL'} | customer=${x.customer ?? '—'} | rated ${x.stars ?? '?'}★ on ${x.rated_on ?? '?'} | rewarded ${x.reward_date}`);
    }
    L('DONE');
  } catch (e) {
    console.error('[rewards-debug] failed:', (e as Error).message);
  }
}
