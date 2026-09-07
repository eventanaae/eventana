/**
 * One-time: store the team's WhatsApp numbers (owner-provided) so the staff
 * WhatsApp mirror can reach them. Gated by SET_STAFF_PHONES=true. Idempotent —
 * re-running just re-writes the same numbers. Internal data only; nothing is
 * sent anywhere.
 */
import { pool } from './pool.js';

// name → E.164 digits (no '+'), as WhatsApp expects.
const PHONES: Array<[string, string]> = [
  ['Diana', '971561500948'],
  ['Jane', '971551616479'],
  ['Dindo', '971555796137'],
  ['Gloria', '971547135827'],
  ['Marsha', '971564500777'],
  ['Shan', '971552802845'],
];

export async function setStaffPhonesFromEnv(): Promise<void> {
  if (String(process.env.SET_STAFF_PHONES ?? '').toLowerCase() !== 'true') return;
  for (const [name, phone] of PHONES) {
    const r = await pool.query(
      `UPDATE team_members SET phone = $2 WHERE lower(name) = lower($1) AND active`,
      [name, phone],
    );
    console.log(`[staff-phones] team_members "${name}" → ${r.rowCount} row(s) set`);
  }
  // Shan is a driver — also set the drivers table so his order WhatsApps work.
  const d = await pool.query(`UPDATE drivers SET phone = $1 WHERE lower(name) LIKE 'shan%'`, ['971552802845']);
  console.log(`[staff-phones] drivers "Shan" → ${d.rowCount} row(s) set`);
  console.log('[staff-phones] DONE');
}
