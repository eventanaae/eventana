/**
 * Owner-set weekly days off (2026-09-08). weekly_day_off is a weekday number
 * read with getUTCDay()/Postgres dow: 0=Sun … 6=Sat. Current split:
 *   • Tuesday (2):   Dindo, Gloria, Marsha
 *   • Wednesday (3): Jane, Diana
 * (Marsha also works from home on Wednesday — a separate arrangement, not a day
 * off.) Gated by SET_TEAM_DAYOFF=true; idempotent.
 */
import { pool } from './pool.js';

const OFF: Array<[string, number]> = [
  ['Dindo', 2], ['Gloria', 2], ['Marsha', 2],
  ['Jane', 3], ['Diana', 3],
];

export async function setTeamDayOffFromEnv(): Promise<void> {
  if (String(process.env.SET_TEAM_DAYOFF ?? '').toLowerCase() !== 'true') return;
  for (const [name, dow] of OFF) {
    const r = await pool.query(
      `UPDATE team_members SET weekly_day_off = $2 WHERE lower(name) = lower($1) AND active`,
      [name, dow],
    );
    console.log(`[team-dayoff] ${name} → weekly day off = ${dow} (${r.rowCount} row)`);
  }
  console.log('[team-dayoff] DONE');
}
