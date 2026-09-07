import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { api } from '../api';
import { C, fredoka, Spinner, Button, Badge } from '../ui';

/**
 * Shan's Events screen: two tabs — "My Jobs" (his delivery events) and
 * "Shopping" (the missing items assigned to him, grouped by emirate so his run
 * is organised, with supplier, location and quantity).
 */
export function DriverEvents({ onOpenEvent }: { onOpenEvent: (id: string) => void }) {
  const [tab, setTab] = useState<'jobs' | 'shopping'>('jobs');
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', gap: 4, background: '#fff', border: `1px solid ${C.line}`, borderRadius: 12, padding: 4 }}>
        {([['jobs', '🚚 My Jobs'], ['shopping', '🛒 Shopping']] as const).map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)} style={{
            flex: 1, border: 'none', cursor: 'pointer', borderRadius: 9, padding: '9px 0', fontWeight: 700, fontSize: 12.5,
            background: tab === id ? C.pink : 'transparent', color: tab === id ? '#fff' : C.muted2,
          }}>{label}</button>
        ))}
      </div>
      {tab === 'jobs' ? <MyJobs onOpenEvent={onOpenEvent} /> : <Shopping />}
    </div>
  );
}

function MyJobs({ onOpenEvent }: { onOpenEvent: (id: string) => void }) {
  const [events, setEvents] = useState<any[] | null>(null);
  useEffect(() => { api.myEvents().then(setEvents).catch(() => setEvents([])); }, []);
  if (!events) return <Spinner />;
  if (events.length === 0) return <Empty>No delivery jobs assigned to you right now 🚚</Empty>;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {events.map((e) => (
        <div key={e.id} onClick={() => onOpenEvent(e.id)} style={{ background: '#fff', border: `1px solid ${C.line}`, borderRadius: 14, padding: '13px 15px', cursor: 'pointer', boxShadow: C.shadow }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <span style={{ ...fredoka(14), flex: 1 }}>{e.customer ?? e.reference ?? e.id}</span>
            {e.phase && <Badge tone="info">{e.phase}</Badge>}
          </div>
          <div style={{ fontSize: 11.5, fontWeight: 600, color: C.muted, marginTop: 4 }}>
            {[e.reference ?? e.id, e.event_date ? new Date(e.event_date).toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short' }) : null, e.start_time, e.emirate].filter(Boolean).join(' · ')}
          </div>
          {e.location_note && <div style={{ fontSize: 11.5, fontWeight: 600, color: C.ink, marginTop: 4 }}>📍 {e.location_note}</div>}
        </div>
      ))}
    </div>
  );
}

function Shopping() {
  const [items, setItems] = useState<any[] | null>(null);
  const [myId, setMyId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = () => {
    api.me().then((m: any) => setMyId(m?.id ?? null)).catch(() => {});
    api.missingItems().then(setItems).catch(() => setItems([]));
  };
  useEffect(load, []);
  if (!items) return <Spinner />;

  // Only the items assigned to me, still to buy.
  const mine = items.filter((m) => String(m.assigned_to ?? '') === String(myId) && m.status !== 'received' && m.status !== 'cancelled');
  if (mine.length === 0) return <Empty>Nothing to buy right now — you're all caught up 🛒</Empty>;

  // Group by emirate / location, then keep supplier visible on each item.
  const groups = new Map<string, any[]>();
  for (const m of mine) {
    const key = (m.location ?? '').trim() || 'No location set';
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(m);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {[...groups.entries()].map(([loc, list]) => (
        <div key={loc}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, margin: '0 2px 8px' }}>
            <span style={{ fontSize: 15 }}>📍</span>
            <span style={{ ...fredoka(15) }}>{loc}</span>
            <span style={{ marginLeft: 'auto', fontSize: 11, fontWeight: 700, color: C.muted2, background: '#F1EAEE', padding: '2px 9px', borderRadius: 20 }}>{list.length}</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {list.map((m) => (
              <div key={m.id} style={{ background: '#fff', border: `1px solid ${C.line}`, borderRadius: 13, padding: '11px 13px', boxShadow: C.shadow }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 700, color: C.ink }}>{m.item}{m.quantity > 1 ? <span style={{ color: C.pinkDeep }}> ×{m.quantity}</span> : null}</div>
                    <div style={{ fontSize: 11.5, fontWeight: 600, color: C.muted, marginTop: 2 }}>{m.supplier ? `🏬 ${m.supplier}` : 'Supplier not set'}{m.note ? ` · ${m.note}` : ''}</div>
                  </div>
                  {m.photo_url && <a href={m.photo_url} target="_blank" rel="noreferrer"><img src={m.photo_url} alt="" style={{ width: 44, height: 44, objectFit: 'cover', borderRadius: 9, border: `1px solid ${C.line}` }} /></a>}
                </div>
                <div style={{ display: 'flex', gap: 6, marginTop: 9 }}>
                  <Button onClick={async () => { setBusy(m.id); try { await api.setMissingStatus(m.id, 'received'); load(); } finally { setBusy(null); } }} disabled={busy === m.id}>✓ Bought</Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <div style={{ padding: 32, textAlign: 'center', fontSize: 13.5, fontWeight: 600, color: C.muted2 }}>{children}</div>;
}
