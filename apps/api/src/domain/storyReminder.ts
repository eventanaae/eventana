/**
 * Daily "today's story is ready to post" reminder.
 *
 * Once a day from 10:00 Dubai, if there's a prepared-but-unposted story due
 * today (scheduled for today, else the next in the queue), nudge the owner and
 * Marsha — a bell item + a phone push — so the daily Instagram/WhatsApp story
 * actually goes out. Deduped to one reminder per Dubai day (story_reminders).
 * Silent when the library has nothing to post.
 */
import { pool } from '../db/pool.js';
import { pushToOwner } from '../integrations/push.js';

export async function sweepDailyStoryReminder(): Promise<void> {
  try {
    // Dubai wall-clock: only from 10:00, and dedupe on the Dubai calendar day.
    const { rows: t } = await pool.query<{ ymd: string; hour: number }>(
      `SELECT (now() AT TIME ZONE 'Asia/Dubai')::date::text AS ymd,
              extract(hour FROM (now() AT TIME ZONE 'Asia/Dubai'))::int AS hour`,
    );
    const { ymd, hour } = t[0];
    if (hour < 10) return;

    // Is there a story to post today? (scheduled for today, else oldest queued.)
    const { rows: story } = await pool.query<{ id: string }>(
      `SELECT id FROM marketing_stories
        WHERE posted_at IS NULL
          AND (scheduled_date = $1::date OR scheduled_date IS NULL)
        ORDER BY (scheduled_date IS NULL), scheduled_date, id
        LIMIT 1`,
      [ymd],
    );
    if (!story[0]) return; // nothing prepared — don't nag

    // One reminder per day. INSERT wins the race; a second worker gets 0 rows.
    const claim = await pool.query(`INSERT INTO story_reminders (ymd) VALUES ($1::date) ON CONFLICT DO NOTHING`, [ymd]);
    if (claim.rowCount === 0) return;

    const { rows: people } = await pool.query<{ id: string }>(
      `SELECT id FROM team_members WHERE active AND (access_level = 'owner' OR lower(name) = 'marsha')`,
    );
    for (const p of people) {
      void pushToOwner('staff', p.id, "📸 Today's story is ready", 'Post it to Instagram & WhatsApp — open Story Studio.', { url: '/', kind: 'story' });
    }
    console.log(`[story-reminder] nudged ${people.length} person(s) for ${ymd}`);
  } catch (err) {
    console.error('[story-reminder] failed:', (err as Error).message);
  }
}
