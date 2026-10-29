import { useEffect, useState } from 'react';
import { syncOutbox } from './api';
import { getOfflineState, subscribeOffline, type OfflineState } from './offline';
import { C } from './ui';

export function useOfflineState(): OfflineState {
  const [s, setS] = useState(getOfflineState());
  useEffect(() => subscribeOffline(setS), []);
  return s;
}

const timeLabel = (ms: number) => {
  const d = new Date(ms);
  const sameDay = d.toDateString() === new Date().toDateString();
  const t = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return sameDay ? t : `${d.toLocaleDateString([], { day: 'numeric', month: 'short' })}, ${t}`;
};

/**
 * Thin strip under the header: "No internet — showing data from 3:45 PM" while
 * offline, and the count of changes saved on this phone waiting to be sent.
 * Also drives the outbox: sends it when the phone reconnects, on open, and
 * every 20s while anything is waiting. `onSynced` fires after changes went
 * through so the screen can reload fresh data.
 */
export function OfflineBar({ onSynced, onMessage }: { onSynced: () => void; onMessage: (msg: string) => void }) {
  const s = useOfflineState();

  useEffect(() => {
    const run = async () => {
      const r = await syncOutbox();
      if (r.failed.length) onMessage(`Some offline changes couldn't be saved — ${r.failed.join(' · ')}`);
      if (r.sent > 0) { onMessage(`✓ ${r.sent} change${r.sent > 1 ? 's' : ''} made offline ${r.sent > 1 ? 'were' : 'was'} sent.`); onSynced(); }
    };
    run();
    const onOnline = () => { run(); onSynced(); };
    window.addEventListener('online', onOnline);
    const id = setInterval(run, 20_000);
    return () => { window.removeEventListener('online', onOnline); clearInterval(id); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!s.offline && !s.pending) return null;
  const waiting = s.pending > 0
    ? s.syncing ? ` · Sending ${s.pending} change${s.pending > 1 ? 's' : ''}…` : ` · ⏳ ${s.pending} change${s.pending > 1 ? 's' : ''} waiting to send`
    : '';
  const text = s.offline
    ? `📴 No internet${s.dataAsOf ? ` — showing data from ${timeLabel(s.dataAsOf)}` : ''}${waiting}`
    : `Back online${waiting}`;
  return (
    <div
      role="status"
      style={{
        background: s.offline ? C.yellowSoft : C.skySoft, color: s.offline ? C.yellowInk : C.ink,
        fontSize: 12, fontWeight: 700, padding: '7px 14px', lineHeight: 1.45,
        borderBottom: `1px solid ${C.line}`,
      }}
    >
      {text}
    </div>
  );
}
