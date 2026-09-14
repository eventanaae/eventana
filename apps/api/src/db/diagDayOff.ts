/**
 * Diagnostic: dump every active member's stored weekly_day_off (with weekday
 * name), today's Dubai weekday, and who offToday currently returns — so we can
 * see the real DB state vs what the screens show. Gated DIAG_DAYOFF=true.
 * Read-only. Turn the flag off after.
 */
import { pool } from './pool.js';
import { offTodayNames } from '../domain/dayOff.js';

const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export async function diagDayOffFromEnv(): Promise<void> {
  if (String(process.env.DIAG_DAYOFF ?? '').toLowerCase() !== 'true') return;
  const dow = await pool.query<{ d: number }>(`SELECT EXTRACT(DOW FROM (now() AT TIME ZONE 'Asia/Dubai')::date)::int AS d`);
  console.log(`[diag-dayoff] today Dubai DOW=${dow.rows[0]?.d} (${WD[dow.rows[0]?.d ?? 0]})`);
  const { rows } = await pool.query<{ name: string; wdo: number | null; active: boolean }>(
    `SELECT name, weekly_day_off AS wdo, active FROM team_members ORDER BY name`,
  );
  for (const r of rows) {
    console.log(`[diag-dayoff] ${r.name}: weekly_day_off=${r.wdo} (${r.wdo == null ? '—' : WD[Number(r.wdo)]})${r.active ? '' : ' [inactive]'}`);
  }
  const off = await offTodayNames();
  console.log(`[diag-dayoff] offTodayNames() => ${off.join(', ') || '(none)'}`);
}
