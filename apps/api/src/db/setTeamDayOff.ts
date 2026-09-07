/**
 * Owner decision 2026-09-08: the whole team's weekly day off is now TUESDAY
 * (was scattered per person). Sets team_members.weekly_day_off = 2 for every
 * active member (not the owner). The staffing engine reads weekly_day_off with
 * getUTCDay()/Postgres dow (0=Sun … 6=Sat), so Tuesday = 2. Gated by
 * SET_TEAM_DAYOFF=true; idempotent.
 */
import { pool } from './pool.js';

export async function setTeamDayOffFromEnv(): Promise<void> {
  if (String(process.env.SET_TEAM_DAYOFF ?? '').toLowerCase() !== 'true') return;
  const r = await pool.query(
    `UPDATE team_members SET weekly_day_off = 2 WHERE active AND COALESCE(access_level,'') <> 'owner'`,
  );
  console.log(`[team-dayoff] Tuesday (2) set as the weekly day off for ${r.rowCount} member(s)`);
}
