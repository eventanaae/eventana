import { useEffect, useState } from 'react';
import { api } from '../api';
import type { Screen } from '../App';
import { C, fredoka, Spinner } from '../ui';

export function Profile({ go }: { go: (s: Screen) => void }) {
  const [events, setEvents] = useState<any[] | null>(null);

  useEffect(() => {
    api.events().then(setEvents).catch(() => setEvents([]));
  }, []);

  return (
    <div style={{ padding: '8px 22px 30px', animation: 'rise .35s ease' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 15, marginBottom: 22 }}>
        <div
          style={{
            width: 58, height: 58, borderRadius: '50%', background: C.pink, color: '#fff',
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 21,
          }}
        >
          S
        </div>
        <div>
          <div style={fredoka(20)}>Sara Al Mansoori</div>
          <div style={{ fontSize: 12, fontWeight: 600, color: C.muted }}>
            +971 50 ··· ··42 · sara@···.com
          </div>
        </div>
      </div>

      <div style={{ background: 'linear-gradient(135deg,#5BCFC5,#3aa79d)', borderRadius: 24, padding: '20px 22px', color: '#fff', marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <span style={fredoka(17)}>Eventana Rewards ✨</span>
          <span style={{ background: 'rgba(255,255,255,.25)', fontSize: 10, fontWeight: 700, padding: '4px 10px', borderRadius: 12 }}>
            GOLD
          </span>
        </div>
        <div style={{ fontSize: 32, fontWeight: 700, margin: '12px 0 2px' }}>
          1,250 <span style={{ fontSize: 13, fontWeight: 600, opacity: 0.85 }}>points</span>
        </div>
        <div style={{ fontSize: 11.5, fontWeight: 600, opacity: 0.9 }}>750 points to your next reward</div>
        <div style={{ height: 6, background: 'rgba(255,255,255,.25)', borderRadius: 3, marginTop: 10, overflow: 'hidden' }}>
          <div style={{ height: '100%', width: '62%', background: C.yellow, borderRadius: 3 }} />
        </div>
      </div>

      <div
        style={{
          background: '#fff', borderRadius: 20, padding: '15px 18px', boxShadow: C.shadow,
          display: 'flex', alignItems: 'center', gap: 13, marginBottom: 16,
        }}
      >
        <div style={{ width: 44, height: 44, borderRadius: 15, background: C.yellowSoft, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, flex: 'none' }}>
          🎁
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 700, fontSize: 13 }}>15% OFF Your Next Event</div>
          <div style={{ fontSize: 11, fontWeight: 600, color: C.muted }}>
            Valid until Oct 30 · Min spend AED 2,000
          </div>
        </div>
        <span style={{ fontSize: 10.5, fontWeight: 700, color: C.green, background: C.greenSoft, padding: '4px 9px', borderRadius: 10 }}>
          ACTIVE
        </span>
      </div>

      <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 10 }}>My Events</div>
      {events === null ? (
        <Spinner />
      ) : events.length === 0 ? (
        <div style={{ fontSize: 12, fontWeight: 600, color: C.muted, lineHeight: 1.6 }}>
          No bookings yet.{' '}
          <a onClick={() => go('explore')} style={{ cursor: 'pointer' }}>
            Explore packages
          </a>{' '}
          to get started.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {events.map((e) => (
            <div
              key={e.id}
              style={{
                background: '#fff', borderRadius: 18, padding: '13px 16px', boxShadow: C.shadow,
                display: 'flex', alignItems: 'center', gap: 13,
              }}
            >
              <div style={{ width: 44, height: 44, borderRadius: 14, background: 'linear-gradient(135deg,#F9C6DC,#F7C948)', flex: 'none' }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 12.5 }}>{e.packageName ?? 'Celebration'}</div>
                <div style={{ fontSize: 11, fontWeight: 600, color: C.muted }}>
                  {new Date(e.date).toDateString()} · {e.emirate} · AED {e.totalDisplay}
                </div>
              </div>
              <button
                onClick={() => go('explore')}
                style={{
                  background: C.pinkSoft, border: 'none', color: C.pinkDeep, fontWeight: 700,
                  fontSize: 10.5, padding: '8px 11px', borderRadius: 12, cursor: 'pointer', whiteSpace: 'nowrap',
                }}
              >
                Book Similar
              </button>
            </div>
          ))}
        </div>
      )}

      <div style={{ marginTop: 20, textAlign: 'center', fontSize: 11, fontWeight: 600, color: C.faint }}>
        @eventana.uae · +971 56 450 0777
      </div>
    </div>
  );
}
