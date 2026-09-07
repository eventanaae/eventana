import { C, fredoka } from '../ui';

/**
 * Shan's weekly delivery schedule — a read-only reference in the app. Focus is
 * on Saturday, Sunday and Friday (the event / photoshoot days). On any day an
 * event lands mid-week, the times shift to the Saturday event pattern — the
 * owner updates it and it's shared in advance.
 */

type Day = { name: string; tone: string; tag?: string; off?: boolean; rows: Array<{ ic: string; tx: string }> };

const DAYS: Day[] = [
  { name: 'Saturday', tone: C.pink, tag: 'Event day', rows: [
    { ic: '🚐', tx: 'Pick up part-timers → Marsha (Mall of the Emirates) → Dindo & Jane (Al Barsha)' },
    { ic: '🏢', tx: 'Team at the office by 11:00 AM' },
    { ic: '🔙', tx: 'Drop-off depends on when the event finishes' },
  ] },
  { name: 'Sunday', tone: C.peach, tag: 'Theme & photoshoot', rows: [
    { ic: '🚐', tx: 'Pickup: Marsha (Mall of the Emirates) → Dindo (Al Barsha)' },
    { ic: '🏢', tx: 'Drop at the office by 11:00 AM, then return home' },
    { ic: '🧑‍🤝‍🧑', tx: 'Event? At 1:00 PM pick up the part-timers from the location they send' },
    { ic: '📸', tx: 'No event? Same timing — theme + photoshoot (no part-timers)' },
    { ic: '🔙', tx: 'Drop-off depends on when it finishes' },
  ] },
  { name: 'Monday', tone: C.mint, rows: [
    { ic: '🚐', tx: 'Pickup: Dindo & Jane (Al Barsha) — Marsha works from home' },
    { ic: '🕓', tx: 'Team: office 4:00 PM → return 11:00 PM' },
  ] },
  { name: 'Tuesday', tone: C.lavender, tag: 'Your day off', off: true, rows: [
    { ic: '🌴', tx: 'Your day off — no pickups' },
  ] },
  { name: 'Wednesday', tone: C.sky, tag: 'Shopping day', rows: [
    { ic: '🚐', tx: 'Pickup: Dindo (Al Barsha) — Gloria at the office, Marsha from home' },
    { ic: '🛒', tx: 'Shopping run — buy & collect all missing items (your list is in Shopping)' },
    { ic: '🕓', tx: 'Team: office 4:00 PM → return 11:00 PM' },
  ] },
  { name: 'Thursday', tone: C.yellow, rows: [
    { ic: '🚐', tx: 'Pickup: Marsha (Mall of the Emirates) → Dindo & Jane (Al Barsha)' },
    { ic: '👩', tx: 'Marsha: 11:00 AM → 6:00 PM · Team: 4:00 PM → 11:00 PM' },
  ] },
  { name: 'Friday', tone: C.pink, tag: 'Special event', rows: [
    { ic: '🚐', tx: 'Pickup: Marsha (Mall of the Emirates) → Dindo (Al Barsha)' },
    { ic: '🏢', tx: 'Drop at the office by 11:00 AM, then return home' },
    { ic: '🧑‍🤝‍🧑', tx: 'At 1:00 PM pick up the part-timers from the location they send' },
    { ic: '🔙', tx: 'Drop-off depends on when the event finishes' },
  ] },
];

export function DriverSchedule() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ background: C.gradHero, border: `1px solid ${C.line}`, borderRadius: 20, padding: '16px 18px' }}>
        <div style={{ ...fredoka(19) }}>🚐 My Weekly Schedule</div>
        <div style={{ fontSize: 12.5, fontWeight: 600, color: C.ink, marginTop: 4, lineHeight: 1.5 }}>
          Your pickups, office times and day off. Event days follow the event schedule.
        </div>
      </div>

      {DAYS.map((d) => (
        <div key={d.name} style={{ background: '#fff', border: `1px solid ${d.off ? '#e7c9dc' : C.line}`, borderRadius: 16, overflow: 'hidden', boxShadow: C.shadow }}>
          <div style={{ height: 5, background: d.tone }} />
          <div style={{ padding: '11px 14px 13px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 8 }}>
              <span style={{ ...fredoka(16) }}>{d.name}</span>
              {d.tag && <span style={{ marginLeft: 'auto', fontSize: 10.5, fontWeight: 800, padding: '3px 9px', borderRadius: 20, background: d.off ? C.redSoft : C.pinkSoft, color: d.off ? C.red : C.pinkDeep }}>{d.tag}</span>}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
              {d.rows.map((r, i) => (
                <div key={i} style={{ display: 'flex', gap: 9, fontSize: 12.5, fontWeight: 600, color: C.ink, lineHeight: 1.5 }}>
                  <span style={{ flex: 'none', width: 18, textAlign: 'center' }}>{r.ic}</span>
                  <span>{r.tx}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      ))}

      <div style={{ background: C.pinkSoft, border: `1px solid ${C.line}`, borderRadius: 14, padding: '13px 15px', fontSize: 12.5, fontWeight: 600, color: C.ink, lineHeight: 1.6 }}>
        📌 If an event lands mid-week, the timings shift to the <b>Saturday event pattern</b> (office by 11:00 AM, drop-off after the event). Any change is shared with you in advance.
      </div>
    </div>
  );
}
