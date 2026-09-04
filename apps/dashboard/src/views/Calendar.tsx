import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import { api } from '../api';
import { C, Panel, Spinner } from '../ui';

const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const pad = (n: number) => String(n).padStart(2, '0');

// Colour each event block by its stage so several events on the same day are
// distinguishable at a glance (they were all the same pink before).
const PHASE_COLORS: Record<string, string> = {
  'Booking Confirmed': '#6C8CFF', // blue
  'Preparing': '#E8912B',         // amber
  'Setting Up': '#B06CE0',        // purple
  'On The Way': '#1FA7A0',        // teal
  'On Site': '#2E9E6B',           // green
  'Arrived': '#2E9E6B',
  'In Progress': '#2E9E6B',
  'Event Completed': '#9A8FA0',   // grey
};
const phaseColor = (phase: string): string =>
  phase === 'Cancelled' ? C.red : (PHASE_COLORS[phase] ?? C.pink);

const navBtn: CSSProperties = {
  border: `1px solid ${C.line}`,
  background: '#fff',
  borderRadius: 8,
  padding: '5px 10px',
  fontWeight: 700,
  fontSize: 12,
  cursor: 'pointer',
  color: C.ink,
};

export function Calendar({ onOpenEvent }: { onOpenEvent: (id: string) => void }) {
  const [events, setEvents] = useState<any[] | null>(null);
  const [schedule, setSchedule] = useState<any>(null);
  const now = new Date();
  const [ym, setYm] = useState({ y: now.getFullYear(), m: now.getMonth() });

  useEffect(() => {
    void api.events().then(setEvents);
  }, []);

  const monthStr = `${ym.y}-${pad(ym.m + 1)}`;
  useEffect(() => {
    // Roster overlay is manager/employee-only; ignore a 403 for drivers.
    void api.teamSchedule(monthStr).then(setSchedule).catch(() => setSchedule(null));
  }, [monthStr]);

  const byDate = useMemo(() => {
    const map: Record<string, any[]> = {};
    (events ?? []).forEach((e) => {
      const key = String(e.event_date).slice(0, 10);
      (map[key] ||= []).push(e);
    });
    return map;
  }, [events]);

  // Which members are off on a given day, and whose birthday it is.
  const offByDate = useMemo(() => {
    const map: Record<string, any[]> = {};
    (schedule?.daysOff ?? []).forEach((d: any) => {
      if (d.status === 'denied') return;
      const s = new Date(String(d.start_date).slice(0, 10) + 'T00:00:00');
      const e = new Date(String(d.end_date).slice(0, 10) + 'T00:00:00');
      for (let dt = new Date(s); dt <= e; dt.setDate(dt.getDate() + 1)) {
        const key = `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
        (map[key] ||= []).push(d);
      }
    });
    return map;
  }, [schedule]);

  const bdayByDate = useMemo(() => {
    const map: Record<string, any[]> = {};
    (schedule?.birthdays ?? []).forEach((b: any) => {
      (map[b.date] ||= []).push(b);
    });
    return map;
  }, [schedule]);

  if (!events) return <Spinner />;

  const first = new Date(ym.y, ym.m, 1);
  const startWd = first.getDay();
  const daysIn = new Date(ym.y, ym.m + 1, 0).getDate();
  const cells: (number | null)[] = [];
  for (let i = 0; i < startWd; i++) cells.push(null);
  for (let d = 1; d <= daysIn; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);

  const monthLabel = first.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
  const todayKey = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;

  const shift = (delta: number) =>
    setYm((s) => {
      const d = new Date(s.y, s.m + delta, 1);
      return { y: d.getFullYear(), m: d.getMonth() };
    });

  return (
    <Panel
      title={`Calendar — ${monthLabel}`}
      action={
        <div style={{ display: 'flex', gap: 6 }}>
          <button onClick={() => shift(-1)} style={navBtn}>‹</button>
          <button onClick={() => setYm({ y: now.getFullYear(), m: now.getMonth() })} style={navBtn}>Today</button>
          <button onClick={() => shift(1)} style={navBtn}>›</button>
        </div>
      }
    >
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 4, minWidth: 0 }}>
        {WD.map((w) => (
          <div key={w} style={{ fontSize: 11, fontWeight: 700, color: C.muted, textAlign: 'center', padding: '2px 0' }}>
            {w}
          </div>
        ))}
        {cells.map((d, i) => {
          if (d === null) return <div key={i} />;
          const key = `${ym.y}-${pad(ym.m + 1)}-${pad(d)}`;
          const evs = byDate[key] ?? [];
          const off = offByDate[key] ?? [];
          const bdays = bdayByDate[key] ?? [];
          const isToday = key === todayKey;
          return (
            <div
              key={i}
              style={{
                minHeight: 60,
                border: `1px solid ${isToday ? C.pink : C.line}`,
                borderRadius: 8,
                padding: '4px 4px',
                background: '#fff',
                overflow: 'hidden',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3 }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: isToday ? C.pink : C.ink }}>{d}</span>
                {bdays.map((b: any) => (
                  <span key={b.id} title={`${b.name}'s birthday 🎂`} style={{ fontSize: 11 }}>🎂</span>
                ))}
              </div>
              {off.map((o: any) => (
                <div
                  key={`off-${o.id}`}
                  title={`${o.member_name} off${o.reason ? ` · ${o.reason}` : ''}${o.status === 'requested' ? ' (requested)' : ''}`}
                  style={{
                    fontSize: 9, fontWeight: 700, color: '#8a7f86',
                    background: o.status === 'requested' ? '#f5efe9' : '#efe7f2',
                    border: `1px dashed ${o.status === 'requested' ? C.line : '#d9c7e6'}`,
                    borderRadius: 5, padding: '1px 4px', marginBottom: 2,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}
                >
                  🌴 {o.member_name}{o.status === 'requested' ? '?' : ''}
                </div>
              ))}
              {evs.slice(0, 3).map((e) => (
                <div
                  key={e.id}
                  onClick={() => onOpenEvent?.(e.id)}
                  title={`${e.customer} · ${e.start_time} · ${e.phase}`}
                  style={{
                    fontSize: 9.5,
                    fontWeight: 700,
                    color: '#fff',
                    background: phaseColor(e.phase),
                    borderRadius: 6,
                    padding: '2px 5px',
                    marginBottom: 2,
                    cursor: 'pointer',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {e.customer}
                </div>
              ))}
              {evs.length > 3 && (
                <div style={{ fontSize: 9, fontWeight: 700, color: C.muted }}>+{evs.length - 3} more</div>
              )}
            </div>
          );
        })}
      </div>
      <div style={{ marginTop: 12, fontSize: 11.5, fontWeight: 600, color: C.muted }}>
        {events.length} events · tap one to open it. 🌴 = staff day off (dashed = requested) · 🎂 = birthday.
        Manage days off &amp; birthdays from the Team tab.
      </div>
    </Panel>
  );
}
