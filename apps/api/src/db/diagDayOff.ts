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
  const sdo = await pool.query<{ name: string; start_date: string; end_date: string; status: string; reason: string | null }>(
    `SELECT tm.name, to_char(d.start_date,'YYYY-MM-DD') AS start_date, to_char(d.end_date,'YYYY-MM-DD') AS end_date, d.status, d.reason
       FROM staff_days_off d JOIN team_members tm ON tm.id = d.member_id
      WHERE (now() AT TIME ZONE 'Asia/Dubai')::date BETWEEN d.start_date AND d.end_date
      ORDER BY tm.name`,
  );
  if (!sdo.rows.length) console.log('[diag-dayoff] staff_days_off covering today: (none)');
  for (const r of sdo.rows) {
    console.log(`[diag-dayoff] staff_days_off covering today: ${r.name} ${r.start_date}..${r.end_date} status=${r.status} reason=${r.reason ?? '—'}`);
  }
  const off = await offTodayNames();
  console.log(`[diag-dayoff] offTodayNames() => ${off.join(', ') || '(none)'}`);
}
