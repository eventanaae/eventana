import { useEffect, useState } from 'react';
import type { View } from '../App';
import { api } from '../api';
import { Badge, Button, C, fredoka, Panel, Spinner } from '../ui';

/**
 * The operational home. Answers, in order: what's next, when to move, where,
 * who, and is anything waiting on me. Mobile-first and vertical — no wide
 * tables, no side-by-side columns.
 */
export function Today({ onOpenEvent, onGoto }: { onOpenEvent: (id: string) => void; onGoto: (v: View) => void }) {
  const [data, setData] = useState<any>(null);

  const load = () => api.today().then(setData);
  useEffect(() => {
    load();
    const timer = setInterval(load, 30_000);
    return () => clearInterval(timer);
  }, []);

  if (!data) return <Spinner />;

  const k = data.kpis;
  const todayStr = new Date().toISOString().slice(0, 10);
  const events: any[] = [...(data.events ?? [])].sort((a, b) =>
    `${String(a.event_date).slice(0, 10)} ${a.start_time}`.localeCompare(`${String(b.event_date).slice(0, 10)} ${b.start_time}`),
  );
  const isToday = (e: any) => String(e.event_date).slice(0, 10) === todayStr;
  const todays = events.filter(isToday);
  const upcoming = events.filter((e) => !isToday(e)).slice(0, 6);
  const next = events[0];

  const lowStock = (data.criticalInventory ?? []).filter((a: any) => a.status !== 'available' || a.committed > 0);
  const attention: Array<{ label: string; n: number; onClick: () => void }> = [
    { label: 'Open tasks', n: k.openTasks, onClick: () => onGoto('tasks') },
    { label: 'Needs review', n: k.needsReview, onClick: () => onGoto('schedule') },
    { label: 'Design approvals', n: (data.pendingDesignApprovals ?? []).length, onClick: () => onGoto('schedule') },
    { label: 'Assets in demand', n: lowStock.length, onClick: () => onGoto('inventory') },
  ].filter((a) => a.n > 0);

  const when = (e: any) =>
    isToday(e)
      ? `Today · ${e.start_time}`
      : `${new Date(e.event_date).toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short' })} · ${e.start_time}`;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* quick stats — two up, the numbers a manager glances at */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <MiniStat label="Events today" value={k.eventsToday} />
        <MiniStat label="Revenue this month" value={`AED ${k.revenueThisMonthDisplay}`} />
      </div>

      {/* next event — the hero */}
      {next ? (
        <div style={{ background: 'linear-gradient(135deg,#FDE0EE,#F9C6DC)', borderRadius: 18, padding: '16px 18px' }}>
          <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '.8px', color: C.pinkDeep }}>
            {isToday(next) ? 'NEXT EVENT · TODAY' : 'NEXT EVENT'}
          </div>
          <div style={{ ...fredoka(20), marginTop: 5 }}>{next.customer}</div>
          <div style={{ fontSize: 12.5, fontWeight: 600, color: '#8b6c7a', marginTop: 3 }}>
            {when(next)}–{next.base_end_time} · {next.emirate}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12 }}>
            <Badge tone={next.phase === 'Event Completed' ? 'neutral' : 'info'}>{next.phase}</Badge>
            <div style={{ flex: 1 }} />
            <Button onClick={() => onOpenEvent(next.id)} style={{ background: C.ink }}>Open job →</Button>
          </div>
        </div>
      ) : (
        <Panel><div style={{ fontSize: 13, fontWeight: 600, color: C.muted }}>No upcoming events yet.</div></Panel>
      )}

      {/* needs attention — one tap to the right place */}
      {attention.length > 0 && (
        <Panel title="Needs attention">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {attention.map((a) => (
              <div
                key={a.label}
                onClick={a.onClick}
                style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', borderBottom: `1px solid ${C.lineSoft}`, cursor: 'pointer' }}
              >
                <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: C.ink }}>{a.label}</span>
                <span style={{ background: C.pinkSoft, color: C.pinkDeep, fontWeight: 800, fontSize: 12.5, minWidth: 26, textAlign: 'center', borderRadius: 9, padding: '3px 8px' }}>{a.n}</span>
                <span style={{ color: C.muted, fontWeight: 700 }}>›</span>
              </div>
            ))}
          </div>
        </Panel>
      )}

      {/* today's jobs */}
      {todays.length > 0 && (
        <Panel title={`Today · ${todays.length} ${todays.length === 1 ? 'event' : 'events'}`}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {todays.map((e) => <EventRow key={e.id} e={e} label={when(e)} onOpen={() => onOpenEvent(e.id)} />)}
          </div>
        </Panel>
      )}

      {/* upcoming */}
      {upcoming.length > 0 && (
        <Panel
          title="Upcoming"
          action={<span onClick={() => onGoto('schedule')} style={{ fontSize: 12, fontWeight: 700, color: C.pinkDeep, cursor: 'pointer' }}>See all</span>}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {upcoming.map((e) => <EventRow key={e.id} e={e} label={when(e)} onOpen={() => onOpenEvent(e.id)} />)}
          </div>
        </Panel>
      )}
    </div>
  );
}

function EventRow({ e, label, onOpen }: { e: any; label: string; onOpen: () => void }) {
  return (
    <div onClick={onOpen} style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: C.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.customer}</div>
        <div style={{ fontSize: 11.5, fontWeight: 600, color: C.muted }}>{label} · {e.emirate}</div>
      </div>
      <Badge tone={e.phase === 'Event Completed' ? 'neutral' : 'info'}>{e.phase}</Badge>
      <span style={{ color: C.muted, fontWeight: 700 }}>›</span>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={{ background: '#fff', border: `1px solid ${C.line}`, borderRadius: 14, padding: '13px 15px' }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: C.muted, letterSpacing: '.5px' }}>{label.toUpperCase()}</div>
      <div style={{ ...fredoka(19), marginTop: 4 }}>{value}</div>
    </div>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 12.5, fontWeight: 600, color: C.muted, padding: '10px 0' }}>{children}</div>
  );
}
