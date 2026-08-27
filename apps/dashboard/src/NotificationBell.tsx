import { useEffect, useRef, useState } from 'react';
import { api } from './api';
import { C, fredoka } from './ui';

const SEEN_KEY = 'eventana.notifSeen';
const getSeen = () => { try { return Number(localStorage.getItem(SEEN_KEY) || 0); } catch { return 0; } };
const setSeen = (t: number) => { try { localStorage.setItem(SEEN_KEY, String(t)); } catch { /* ignore */ } };

function timeAgo(at: string): string {
  const s = Math.max(0, (Date.now() - new Date(at).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

const LEVEL_COLOR: Record<string, string> = { critical: C.red, high: C.yellowInk, info: C.pinkDeep };

/**
 * The notification bell: a role-scoped feed of things worth attention, with an
 * unread count (items newer than the last time this device opened the bell) and
 * one-tap open of the related event. Read-state is per-device via localStorage.
 */
export function NotificationBell({ onOpenEvent }: { onOpenEvent?: (id: string) => void }) {
  const [items, setItems] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const [seen, setSeenState] = useState(getSeen());
  const ref = useRef<HTMLDivElement>(null);

  const load = () => api.notificationFeed().then((r) => setItems(r.items || [])).catch(() => { /* keep last */ });
  useEffect(() => {
    load();
    const t = setInterval(load, 60000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const unread = items.filter((i) => new Date(i.at).getTime() > seen).length;
  const markAllRead = () => { const now = Date.now(); setSeen(now); setSeenState(now); };
  const openBell = () => { setOpen((o) => !o); if (!open) load(); };

  return (
    <div ref={ref} style={{ position: 'relative', flex: 'none' }}>
      <button
        onClick={openBell}
        aria-label="Notifications"
        style={{ position: 'relative', border: `1px solid ${C.line}`, background: '#fff', borderRadius: 12, width: 40, height: 40, cursor: 'pointer', fontSize: 18, lineHeight: 1 }}
      >
        🔔
        {unread > 0 && (
          <span style={{ position: 'absolute', top: -6, right: -6, background: C.red, color: '#fff', fontSize: 10, fontWeight: 800, minWidth: 18, height: 18, borderRadius: 9, padding: '0 4px', display: 'grid', placeItems: 'center', border: '2px solid #fff' }}>
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div style={{ position: 'absolute', top: 48, right: 0, width: 'min(380px, calc(100vw - 24px))', maxHeight: 'min(560px, 80vh)', background: '#fff', border: `1px solid ${C.line}`, borderRadius: 16, boxShadow: '0 16px 44px rgba(40,20,35,.22)', zIndex: 80, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 14px', borderBottom: `1px solid ${C.lineSoft}` }}>
            <div style={{ ...fredoka(15), color: C.ink }}>Notifications</div>
            {unread > 0 && (
              <button onClick={markAllRead} style={{ border: 'none', background: 'none', color: C.pinkDeep, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>Mark all read</button>
            )}
          </div>
          <div style={{ overflowY: 'auto' }}>
            {items.length === 0 ? (
              <div style={{ padding: 24, textAlign: 'center', color: C.muted, fontWeight: 600, fontSize: 13 }}>You're all caught up 🌸</div>
            ) : items.map((i) => {
              const isUnread = new Date(i.at).getTime() > seen;
              const clickable = !!i.eventId && !!onOpenEvent;
              return (
                <button
                  key={i.id}
                  disabled={!clickable}
                  onClick={() => { if (clickable) { onOpenEvent!(i.eventId); markAllRead(); setOpen(false); } }}
                  style={{
                    display: 'flex', gap: 11, alignItems: 'flex-start', width: '100%', textAlign: 'left',
                    padding: '11px 14px', border: 'none', borderBottom: `1px solid ${C.lineSoft}`,
                    background: isUnread ? C.pinkSoft : '#fff', cursor: clickable ? 'pointer' : 'default',
                  }}
                >
                  <span style={{ fontSize: 17, flex: 'none', marginTop: 1 }}>{i.icon}</span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <b style={{ fontSize: 13, color: LEVEL_COLOR[i.level] || C.ink }}>{i.title}</b>
                      {isUnread && <span style={{ width: 7, height: 7, borderRadius: 4, background: C.pink, flex: 'none' }} />}
                    </span>
                    {i.text && <span style={{ display: 'block', fontSize: 12, fontWeight: 600, color: C.muted2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{i.text}</span>}
                    <span style={{ display: 'block', fontSize: 10.5, fontWeight: 600, color: C.muted, marginTop: 2 }}>{timeAgo(i.at)}{clickable ? ' · tap to open' : ''}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
