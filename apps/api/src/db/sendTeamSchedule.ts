/**
 * One-shot: email "The Eventana Week" weekly schedule to the team. Gated by
 * SEND_TEAM_SCHEDULE=true. Recipients resolved from team_members by name (Sheem
 * falls back to the business inbox). Logs who got it and who has no email.
 * English — the crew reads English. Turn the flag off after it sends.
 */
import { pool } from './pool.js';
import { emailEnabled, sendEmail } from '../integrations/email.js';

const NAMES = ['Shan', 'Marsha', 'Jane', 'Diana', 'Gloria', 'Dindo', 'Sheem'];
const FALLBACK: Record<string, string> = { sheem: 'sheem@eventanauae.com' };

const PINK = '#E94F9C', DEEP = '#C93A83', INK = '#3B3641', OFF = '#C24E7D';

function day(bar: string, name: string, tag: string, tagBg: string, tagColor: string, rowsHtml: string): string {
  return `<tr><td style="padding:0 0 12px">
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;border:1px solid #F0DCE7;border-radius:16px;overflow:hidden">
      <tr><td style="height:6px;background:${bar};line-height:6px;font-size:6px">&nbsp;</td></tr>
      <tr><td style="padding:12px 16px 14px">
        <table width="100%" cellpadding="0" cellspacing="0"><tr>
          <td style="font-family:Segoe UI,Arial,sans-serif;font-weight:800;font-size:17px;color:${INK}">${name}</td>
          ${tag ? `<td align="right"><span style="font-size:11px;font-weight:700;padding:3px 10px;border-radius:20px;background:${tagBg};color:${tagColor}">${tag}</span></td>` : ''}
        </tr></table>
        <div style="font-family:Segoe UI,Arial,sans-serif;font-size:13.5px;line-height:1.7;color:${INK};margin-top:8px">${rowsHtml}</div>
      </td></tr>
    </table>
  </td></tr>`;
}

function scheduleHtml(): string {
  const t = (s: string) => `<b style="color:${DEEP}">${s}</b>`;
  const off = (s: string) => `<span style="background:#FCE6EF;color:${OFF};font-weight:700;font-size:12px;padding:2px 8px;border-radius:7px">${s}</span>`;
  const days = [
    day('#F06CA8', 'Saturday', 'Event day', '#FDEFF6', DEEP,
      `🚐 <b>Pickup:</b> Part-timers → <b>Marsha</b> (Mall of the Emirates) → <b>Dindo</b> &amp; <b>Jane</b> (Al Barsha)<br>🏢 Team at the office by ${t('11:00 AM')} (max)<br>🔙 Drop-off depends on when the event finishes`),
    day('#FF9E7A', 'Sunday', 'Theme &amp; photoshoot', '#FDEFF6', DEEP,
      `🚐 <b>Pickup:</b> <b>Marsha</b> (Mall of the Emirates) → <b>Dindo</b> (Al Barsha)<br>🏢 Drop at the office by ${t('11:00 AM')}, then the driver returns home<br>🧑‍🤝‍🧑 At ${t('1:00 PM')} pick up the part-timers from the location they send<br>📸 <b>No event?</b> Same timing — the team creates a <b>new theme + photoshoot</b><br>🔙 Drop-off depends on when it finishes`),
    day('#5BCFC5', 'Monday', '', '', '',
      `🏠 <b>Marsha</b> works from home — no pickup<br>🚐 <b>Pickup:</b> <b>Dindo</b> &amp; <b>Jane</b> (Al Barsha)<br>🏢 <b>Team:</b> office ${t('4:00 PM')} → return ${t('11:00 PM')}`),
    day('#B79BE0', 'Tuesday', 'No driver', '#FCE6EF', OFF,
      `🌴 ${off('Shan · Dindo · Gloria · Marsha — off')}<br>👥 <b>Working:</b> <b>Diana</b> (at the office) · <b>Jane</b> — own transport, Shan is off<br>🏢 <b>Team:</b> office ${t('4:00 PM')} → ${t('11:00 PM')}`),
    day('#6FC7EA', 'Wednesday', 'Shopping day', '#E3F6EF', '#2e9e7e',
      `🌴 ${off('Jane · Diana — off')}<br>🏠 <b>Marsha</b> works from home — no pickup<br>🚐 <b>Working:</b> <b>Dindo</b> &amp; <b>Gloria</b> — pickup <b>Dindo</b> (Al Barsha)<br>🏢 <b>Team:</b> office ${t('4:00 PM')} → ${t('11:00 PM')}<br>🛒 <b>Purchase &amp; collect all missing items</b>`),
    day('#F7C948', 'Thursday', '', '', '',
      `🚐 <b>Pickup:</b> <b>Marsha</b> (Mall of the Emirates) → <b>Dindo</b> &amp; <b>Jane</b> (Al Barsha)<br>🏢 <b>Team:</b> office ${t('4:00 PM')} → return ${t('11:00 PM')}<br>👩 <b>Marsha:</b> ${t('11:00 AM')} → ${t('6:00 PM')}`),
    day('#E94F9C', 'Friday', 'Special event', '#FDEFF6', DEEP,
      `🚐 <b>Pickup:</b> <b>Marsha</b> (Mall of the Emirates) → <b>Dindo</b> (Al Barsha)<br>🏢 Drop at office by ${t('11:00 AM')}, then return home<br>🧑‍🤝‍🧑 At ${t('1:00 PM')} pick up the part-timers from the location they send<br>🔙 Drop-off depends on when the event finishes`),
  ].join('');
  return `<!doctype html><html><body style="margin:0;padding:0;background:#FBF3F7">
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#FBF3F7"><tr><td align="center" style="padding:24px 12px 40px">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px">
        <tr><td style="background:#FDEFF6;border:1px solid #F0DCE7;border-radius:20px;padding:20px 20px 16px">
          <div style="font-family:Segoe UI,Arial,sans-serif;font-weight:700;color:${PINK};font-size:13px">● EVENTANA · OPERATIONS</div>
          <div style="font-family:Segoe UI,Arial,sans-serif;font-weight:800;font-size:26px;color:${INK};margin:6px 0 4px">The Eventana Week 🗓️</div>
          <div style="font-family:Segoe UI,Arial,sans-serif;color:#8B7E86;font-size:13.5px">Our regular weekly rhythm — pickups, office hours, days off and the shopping day. Event days follow the event schedule instead.</div>
          <div style="margin-top:13px;background:#FFF3D6;border-radius:12px;padding:10px 13px;font-family:Segoe UI,Arial,sans-serif;font-size:12.5px;font-weight:600;color:#9A6A12;line-height:1.5">☀️ <b>Summer hours</b> — working hours are reduced for the heat right now. In winter they go back to normal.</div>
        </td></tr>
        <tr><td style="height:16px;line-height:16px;font-size:16px">&nbsp;</td></tr>
        <tr><td><table width="100%" cellpadding="0" cellspacing="0">${days}</table></td></tr>
        <tr><td style="background:#ffffff;border:1px solid #F0DCE7;border-left:4px solid ${PINK};border-radius:16px;padding:13px 15px;font-family:Segoe UI,Arial,sans-serif;font-size:12.5px;color:${INK};line-height:1.6">
          <b style="font-size:13.5px">🔄 This can change</b><br>This is the regular weekly schedule. Timings, pickups and days off may change with event schedules, operations or urgent tasks. <b>Any change is shared in advance.</b>
        </td></tr>
      </table>
    </td></tr></table>
  </body></html>`;
}

export async function sendTeamScheduleFromEnv(): Promise<void> {
  if (String(process.env.SEND_TEAM_SCHEDULE ?? '').toLowerCase() !== 'true') return;
  if (!emailEnabled()) { console.log('[team-schedule] email disabled'); return; }
  const { rows } = await pool.query<{ name: string; email: string | null }>(
    `SELECT name, email FROM team_members WHERE lower(name) = ANY($1)`,
    [NAMES.map((n) => n.toLowerCase())],
  );
  const found = new Map(rows.map((r) => [r.name.toLowerCase(), (r.email ?? '').trim()]));
  const html = scheduleHtml();
  const subject = '📅 The Eventana Week — our weekly schedule';
  for (const n of NAMES) {
    const email = found.get(n.toLowerCase()) || FALLBACK[n.toLowerCase()] || '';
    if (!email) { console.log(`[team-schedule] ${n}: NO EMAIL on file — skipped`); continue; }
    const res = await sendEmail({ to: email, subject, html });
    console.log(`[team-schedule] ${n} <${email}>: ${res.ok ? 'SENT' : 'FAILED ' + (res as any).error}`);
  }
  console.log('[team-schedule] DONE');
}
