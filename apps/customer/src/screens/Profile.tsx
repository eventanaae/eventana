import { useEffect, useState } from 'react';
import { api } from '../api';
import type { Screen } from '../App';
import { C, fredoka, Spinner } from '../ui';
import { loadProfile } from '../profile';

export function Profile({ go, onRebook }: { go: (s: Screen) => void; onRebook: (eventId: string) => Promise<void> }) {
  const [events, setEvents] = useState<any[] | null>(null);
  const [rebooking, setRebooking] = useState<string | null>(null);
  const [rewards, setRewards] = useState<Awaited<ReturnType<typeof api.rewards>> | null>(null);
  const profile = loadProfile();
  const name = profile?.name?.trim() || 'Guest';
  const initial = (name[0] || '☺').toUpperCase();
  const subline = profile?.birthday
    ? `🎂 Birthday ${new Date(profile.birthday).toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })}`
    : 'Complete your profile';

  useEffect(() => {
    api.events().then(setEvents).catch(() => setEvents([]));
    api.rewards().then(setRewards).catch(() => setRewards(null));
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
          {initial}
        </div>
        <div>
          <div style={fredoka(20)}>{name}</div>
          <div style={{ fontSize: 12, fontWeight: 600, color: C.muted }}>{subline}</div>
        </div>
      </div>

      <div style={{ background: 'linear-gradient(135deg,#5BCFC5,#3aa79d)', borderRadius: 24, padding: '20px 22px', color: '#fff', marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <span style={fredoka(17)}>Eventana Rewards ✨</span>
          <span style={{ background: 'rgba(255,255,255,.25)', fontSize: 10, fontWeight: 700, padding: '4px 10px', borderRadius: 12, letterSpacing: '.4px' }}>
            {rewards?.tier ?? '—'}
          </span>
        </div>
        <div style={{ fontSize: 32, fontWeight: 700, margin: '12px 0 2px' }}>
          {rewards ? rewards.points.toLocaleString('en-US') : '—'}{' '}
          <span style={{ fontSize: 13, fontWeight: 600, opacity: 0.85 }}>points</span>
        </div>
        <div style={{ fontSize: 11.5, fontWeight: 600, opacity: 0.9 }}>
          {!rewards
            ? 'Loading your rewards…'
            : rewards.nextTier
              ? `${rewards.pointsToNextTier.toLocaleString('en-US')} points to ${rewards.nextTier}`
              : 'You’ve reached our top tier 🎉'}
        </div>
        {rewards && rewards.nextTier && (
          <div style={{ height: 6, background: 'rgba(255,255,255,.25)', borderRadius: 3, marginTop: 10, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${rewards.progressPct}%`, background: C.yellow, borderRadius: 3, transition: 'width .5s' }} />
          </div>
        )}
        <div style={{ fontSize: 10.5, fontWeight: 600, opacity: 0.85, marginTop: 10 }}>
          You earn {`1 point per AED`} on every booking. Redeem on an upcoming celebration — coming soon.
        </div>
      </div>

      {rewards && rewards.history.length > 0 && (
        <div style={{ background: '#fff', borderRadius: 20, padding: '15px 18px', boxShadow: C.shadow, marginBottom: 16 }}>
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 10 }}>Points activity</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {rewards.history.slice(0, 5).map((h, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 11.5, fontWeight: 600, color: C.muted }}>{h.reason}</span>
                <span style={{ fontWeight: 700, fontSize: 12.5, color: h.points < 0 ? C.red : C.green, whiteSpace: 'nowrap' }}>
                  {h.points < 0 ? '' : '+'}{h.points.toLocaleString('en-US')}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

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
                disabled={rebooking === e.id}
                onClick={async () => {
                  setRebooking(e.id);
                  try { await onRebook(e.id); } catch { setRebooking(null); }
                }}
                style={{
                  background: C.pinkSoft, border: 'none', color: C.pinkDeep, fontWeight: 700,
                  fontSize: 10.5, padding: '8px 11px', borderRadius: 12, cursor: 'pointer', whiteSpace: 'nowrap',
                  opacity: rebooking === e.id ? 0.6 : 1,
                }}
              >
                {rebooking === e.id ? 'Opening…' : 'Book Again'}
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
