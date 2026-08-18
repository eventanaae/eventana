import { useEffect, useState } from 'react';
import { api } from '../api';
import { Badge, C, fredoka, Panel, Spinner } from '../ui';
import { Empty } from './Today';

/** The signed-in member's own assigned jobs, with one-tap directions. */
export function MyEvents({ onOpenEvent }: { onOpenEvent: (id: string) => void }) {
  const [events, setEvents] = useState<any[] | null>(null);

  useEffect(() => { void api.myEvents().then(setEvents).catch(() => setEvents([])); }, []);

  if (!events) return <Spinner />;

  const today = new Date().toISOString().slice(0, 10);

  return (
    <Panel title={`My jobs (${events.length})`}>
      {events.length === 0 ? (
        <Empty>You have no assigned jobs right now.</Empty>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {events.map((e) => {
            const date = String(e.event_date).slice(0, 10);
            const isToday = date === today;
            const hasPin = Number(e.map_lat) !== 0 || Number(e.map_lng) !== 0;
            const dir = `https://www.google.com/maps/dir/?api=1&destination=${e.map_lat},${e.map_lng}&travelmode=driving`;
            return (
              <div
                key={e.id}
                style={{
                  border: `1px solid ${isToday ? C.pink : C.line}`,
                  background: isToday ? C.pinkSoft : '#fff',
                  borderRadius: 14, padding: '12px 14px',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ ...fredoka(15) }}>
                      {new Date(e.event_date).toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short' })}
                      {isToday && <span style={{ color: C.pinkDeep, fontSize: 12 }}> · Today</span>}
                    </div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: C.muted, marginTop: 2 }}>
                      {e.customer} · {e.emirate} · {String(e.start_time).slice(0, 5)}–{String(e.base_end_time).slice(0, 5)}
                    </div>
                    {e.eta && <div style={{ fontSize: 11, fontWeight: 700, color: C.pinkDeep, marginTop: 2 }}>ETA set: {e.eta}</div>}
                  </div>
                  <Badge tone={e.phase === 'Cancelled' ? 'error' : e.phase === 'Event Completed' ? 'ok' : 'neutral'}>{e.phase}</Badge>
                </div>
                <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                  {hasPin && (
                    <a href={dir} target="_blank" rel="noreferrer" style={linkBtn}>🧭 Directions</a>
                  )}
                  <button onClick={() => onOpenEvent?.(e.id)} style={{ ...linkBtn, cursor: 'pointer', border: `1px solid ${C.line}`, background: '#fff' }}>
                    Open job
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Panel>
  );
}

const linkBtn = {
  display: 'inline-flex', alignItems: 'center', gap: 6, textDecoration: 'none',
  border: `1px solid ${C.pink}`, background: C.pinkSoft, color: C.pinkDeep,
  borderRadius: 10, padding: '8px 13px', fontSize: 12.5, fontWeight: 700,
} as const;
