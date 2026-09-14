import { useEffect, useState } from 'react';
import { api } from '../api';
import { C, Panel, Spinner } from '../ui';

/**
 * "The Eventana Week" — the team's regular weekly rhythm (pickups, office hours,
 * days off, shopping day), living permanently in the dashboard instead of an
 * emailed image. The per-day operational content is the fixed rhythm; the
 * "Days off this week" strip at the top reads LIVE from team_members so it is
 * always accurate (single source of truth), even if the rhythm text drifts.
 */

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const firstName = (n: string) => (n || '').trim().split(/\s+/)[0];

type Tone = { fg: string; soft: string; bar: string };
const TONES: Record<string, Tone> = {
  pink: { fg: C.pinkDeep, soft: C.pinkSoft, bar: 'linear-gradient(90deg,#F97CB4,#E94F9C)' },
  peach: { fg: '#E4703F', soft: '#FDEAE0', bar: 'linear-gradient(90deg,#FFC2A0,#FF9E7A)' },
  mint: { fg: '#37B3A6', soft: '#E4F7F3', bar: 'linear-gradient(90deg,#8FE6D9,#37B3A6)' },
  lavender: { fg: '#7C5BB8', soft: '#F0E9FB', bar: 'linear-gradient(90deg,#D2BEF2,#B79BE0)' },
  sky: { fg: '#2E90BE', soft: '#E3F4FB', bar: 'linear-gradient(90deg,#A9DEF4,#6FC7EA)' },
  yellow: { fg: '#B7860B', soft: '#FCF3D6', bar: 'linear-gradient(90deg,#FBE08A,#F7C948)' },
};

const DAYS: Array<{ name: string; tag?: string; tone: keyof typeof TONES; lines: string[] }> = [
  { name: 'Saturday', tag: 'Event day', tone: 'pink', lines: [
    '🚚 Pickup: Part-timers → Marsha from Mall of the Emirates → Dindo & Jane from Al Barsha',
    '🏢 Team at the office by 11:00 AM (max)',
    '🔙 Drop-off depends on when the event finishes',
  ] },
  { name: 'Sunday', tag: 'Theme & photoshoot', tone: 'peach', lines: [
    '🚚 Pickup: Marsha from Mall of the Emirates → Dindo from Al Barsha',
    '🏢 Drop at the office by 11:00 AM, then the driver returns home',
    '🧑‍🤝‍🧑 At 1:00 PM pick up the part-timers from the location they send',
    '🎥 No event? Same timing — the team creates a new theme + photoshoot',
    '🔙 Drop-off depends on when it finishes',
  ] },
  { name: 'Monday', tone: 'mint', lines: [
    '🏠 Marsha works from home — no pickup',
    '🚚 Pickup: Dindo & Jane from Al Barsha',
    '🏢 Team: office 4:00 PM → return 11:00 PM',
  ] },
  { name: 'Tuesday', tag: 'No driver', tone: 'lavender', lines: [
    '👥 Working: Diana (at the office) · Jane — own transport',
    '🏢 Team: office 4:00 PM → 11:00 PM',
  ] },
  { name: 'Wednesday', tag: 'Shopping day', tone: 'sky', lines: [
    '🏠 Marsha works from home — no pickup',
    '🚚 Working: Dindo & Gloria — pickup Dindo from Al Barsha',
    '🏢 Team: office 4:00 PM → 11:00 PM',
    '🛒 Purchase & collect all missing items',
  ] },
  { name: 'Thursday', tone: 'yellow', lines: [
    '🚚 Pickup: Marsha from Mall of the Emirates → Dindo & Jane from Al Barsha',
    '🏢 Team: office 4:00 PM → return 11:00 PM',
    '⏰ Marsha: 11:00 AM → 6:00 PM',
  ] },
  { name: 'Friday', tag: 'Special event', tone: 'pink', lines: [
    '🚚 Pickup: Marsha from Mall of the Emirates → Dindo from Al Barsha',
    '🏢 Drop at office by 11:00 AM, then return home',
    '🧑‍🤝‍🧑 At 1:00 PM pick up the part-timers from the location they send',
    '🔙 Drop-off depends on when the event finishes',
  ] },
];

export function TheWeek() {
  const [team, setTeam] = useState<any[] | null>(null);

  useEffect(() => {
    let live = true;
    api.team().then((t) => { if (live) setTeam(Array.isArray(t) ? t : []); }).catch(() => { if (live) setTeam([]); });
    return () => { live = false; };
  }, []);

  // weekday index (0=Sun..6=Sat) → first names off that day, live from the DB.
  const offByDay: Record<number, string[]> = {};
  (team ?? []).forEach((m) => {
    const d = m?.weekly_day_off;
    if (d === null || d === undefined) return;
    (offByDay[Number(d)] ??= []).push(firstName(m.name));
  });
  const offFor = (dayName: string) => (offByDay[WEEKDAYS.indexOf(dayName)] ?? []).sort();

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <Panel style={{ background: C.gradHero, border: 'none' }}>
        <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 1.1, textTransform: 'uppercase', color: C.pinkDeep }}>Eventana · Operations</div>
        <div style={{ fontSize: 26, fontWeight: 800, color: C.ink, margin: '6px 0 6px' }}>The Eventana Week 🗓️</div>
        <div style={{ fontSize: 14, color: C.inkSoft, maxWidth: 620 }}>
          Our regular weekly rhythm — pickups, office hours, days off and the shopping day. Event days follow the event schedule instead.
        </div>
        <div style={{ marginTop: 12, background: 'rgba(255,255,255,.7)', border: `1px solid ${C.line}`, borderRadius: 12, padding: '10px 13px', fontSize: 13, color: '#8a6d1a', fontWeight: 600 }}>
          ☀️ Summer hours — working hours are reduced for the heat right now. In winter they go back to normal.
        </div>
      </Panel>

      <Panel title="🌴 Days off this week">
        {team === null ? <Spinner /> : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {WEEKDAYS.map((d, i) => offByDay[i]?.length ? (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, background: C.pinkSoft, border: `1px solid ${C.line}`, borderRadius: 12, padding: '8px 12px' }}>
                <span style={{ fontSize: 12.5, fontWeight: 800, color: C.pinkDeep, minWidth: 74 }}>{d}</span>
                <span style={{ fontSize: 13, fontWeight: 600, color: C.ink }}>{offByDay[i].slice().sort().join(' · ')}</span>
              </div>
            ) : null)}
            {Object.keys(offByDay).length === 0 && <div style={{ fontSize: 13, color: C.muted2 }}>No weekly days off set yet.</div>}
          </div>
        )}
        <div style={{ marginTop: 10, fontSize: 11.5, color: C.muted2 }}>Live from the team records — change a person's day in <b>Team</b> or <b>Leave</b> and it updates here.</div>
      </Panel>

      <div style={{ display: 'grid', gap: 14, gridTemplateColumns: 'repeat(auto-fill,minmax(280px,1fr))' }}>
        {DAYS.map((day) => {
          const t = TONES[day.tone];
          const off = offFor(day.name);
          return (
            <div key={day.name} style={{ background: '#fff', border: `1px solid ${C.line}`, borderRadius: 16, overflow: 'hidden', boxShadow: C.shadow }}>
              <div style={{ height: 4, background: t.bar }} />
              <div style={{ padding: '14px 16px 16px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                  <div style={{ fontSize: 16, fontWeight: 800, color: C.ink, flex: 1 }}>{day.name}</div>
                  {day.tag && <span style={{ fontSize: 11, fontWeight: 700, color: t.fg, background: t.soft, borderRadius: 20, padding: '3px 10px' }}>{day.tag}</span>}
                </div>
                {off.length > 0 && (
                  <div style={{ fontSize: 12.5, fontWeight: 700, color: t.fg, background: t.soft, borderRadius: 10, padding: '6px 10px', marginBottom: 10 }}>
                    🌴 Off: {off.join(' · ')}
                  </div>
                )}
                <div style={{ display: 'grid', gap: 8 }}>
                  {day.lines.map((l, i) => (
                    <div key={i} style={{ fontSize: 13, color: C.ink, lineHeight: 1.5 }}>{l}</div>
                  ))}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <Panel style={{ borderInlineStart: `4px solid ${C.pink}` }}>
        <div style={{ fontSize: 14, fontWeight: 800, color: C.ink, marginBottom: 4 }}>🔄 This can change</div>
        <div style={{ fontSize: 13, color: C.inkSoft, lineHeight: 1.6 }}>
          This is the regular weekly schedule. Timings, pickups and days off may change with event schedules, operations or urgent tasks. <b>Any change is shared in advance.</b>
        </div>
      </Panel>
    </div>
  );
}
