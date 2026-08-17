import { useEffect, useState } from 'react';
import { api, hasStaffToken, setStaffToken, clearStaffToken } from './api';
import { C, fredoka } from './ui';
import { Today } from './views/Today';
import { Events } from './views/Events';
import { Inventory } from './views/Inventory';
import { Tasks } from './views/Tasks';
import { Team } from './views/Team';
import { Settings } from './views/Settings';

export type View = 'today' | 'events' | 'inventory' | 'tasks' | 'team' | 'settings';

const NAV: Array<{ id: View; label: string; icon: string; title: string; sub: string }> = [
  { id: 'today', label: 'Today', icon: '◉', title: 'Today', sub: 'Live board, tasks and inventory at a glance' },
  { id: 'events', label: 'Events', icon: '▤', title: 'Events', sub: 'Every booking, with its services, tasks and payments' },
  { id: 'inventory', label: 'Inventory', icon: '▣', title: 'Inventory', sub: 'Physical assets, reservations and buffers' },
  { id: 'tasks', label: 'Tasks', icon: '✓', title: 'Tasks', sub: 'Work by department across all events' },
  { id: 'team', label: 'Team', icon: '☺', title: 'Team', sub: 'Staff, roles and upcoming assignments' },
  { id: 'settings', label: 'Settings', icon: '⚙', title: 'Settings', sub: 'Pricing rules, delivery zones and integrations' },
];

export default function App() {
  const [authed, setAuthed] = useState(hasStaffToken());
  const [view, setView] = useState<View>('today');
  const [counts, setCounts] = useState<{ tasks: number; review: number }>({ tasks: 0, review: 0 });
  const [integrations, setIntegrations] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!authed) return;
    const load = () =>
      api
        .today()
        .then((d) => {
          setCounts({ tasks: d.kpis.openTasks, review: d.kpis.needsReview });
          setIntegrations(d.integrations);
          setError(null);
        })
        .catch((e) => setError(e.message));
    load();
    const timer = setInterval(load, 30_000);
    return () => clearInterval(timer);
  }, [authed]);

  if (!authed) {
    return <StaffLogin onDone={() => setAuthed(true)} />;
  }

  const current = NAV.find((n) => n.id === view)!;
  const sandbox = integrations.some((i) => i.mode !== 'live');

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: C.bg }}>
      {/* ---------------- sidebar ---------------- */}
      <div
        style={{
          width: 212,
          flex: 'none',
          background: C.ink,
          color: '#fff',
          display: 'flex',
          flexDirection: 'column',
          padding: '20px 0',
          position: 'sticky',
          top: 0,
          height: '100vh',
        }}
      >
        <div style={{ padding: '0 20px 22px' }}>
          <div style={{ ...fredoka(19), letterSpacing: '.3px' }}>Eventana</div>
          <div style={{ fontSize: 10.5, fontWeight: 600, color: C.sidebarMuted, letterSpacing: 1.2, marginTop: 2 }}>
            OPERATIONS
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '0 10px' }}>
          {NAV.map((n) => {
            const active = view === n.id;
            const badge =
              n.id === 'tasks' ? counts.tasks : n.id === 'events' ? counts.review : 0;
            return (
              <div
                key={n.id}
                onClick={() => setView(n.id)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '10px 12px',
                  borderRadius: 12,
                  cursor: 'pointer',
                  background: active ? 'rgba(255,255,255,.12)' : 'transparent',
                }}
              >
                <span style={{ fontSize: 14, width: 18, textAlign: 'center' }}>{n.icon}</span>
                <span
                  style={{
                    flex: 1,
                    fontSize: 13,
                    fontWeight: active ? 700 : 600,
                    color: active ? '#fff' : C.sidebarMuted,
                  }}
                >
                  {n.label}
                </span>
                {badge > 0 && (
                  <span
                    style={{
                      background: n.id === 'events' ? C.red : C.pink,
                      color: '#fff',
                      fontSize: 10,
                      fontWeight: 700,
                      padding: '2px 7px',
                      borderRadius: 9,
                    }}
                  >
                    {badge}
                  </span>
                )}
              </div>
            );
          })}
        </div>

        <div style={{ flex: 1 }} />
        <div style={{ padding: '16px 20px 0', borderTop: '1px solid rgba(255,255,255,.09)', margin: '0 10px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div
              style={{
                width: 32, height: 32, borderRadius: '50%', background: C.pink,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontWeight: 700, fontSize: 13,
              }}
            >
              M
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 700 }}>Maryam</div>
              <div style={{ fontSize: 10, fontWeight: 600, color: C.sidebarMuted }}>
                Operations Manager
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ---------------- main ---------------- */}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <div
          style={{
            flex: 'none',
            background: '#fff',
            borderBottom: `1px solid ${C.line}`,
            padding: '16px 26px',
            display: 'flex',
            alignItems: 'center',
            gap: 18,
            position: 'sticky',
            top: 0,
            zIndex: 5,
          }}
        >
          <div style={{ flex: 1 }}>
            <div style={fredoka(20)}>{current.title}</div>
            <div style={{ fontSize: 11.5, fontWeight: 600, color: C.muted, marginTop: 1 }}>
              {current.sub}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
            {sandbox && (
              <span
                style={{
                  background: C.yellowSoft, color: C.yellowInk, fontSize: 11,
                  fontWeight: 700, padding: '7px 12px', borderRadius: 12,
                }}
              >
                ⚙ Sandbox mode — no live payment keys
              </span>
            )}
            <span
              style={{
                background: error ? C.redSoft : C.greenSoft,
                color: error ? C.red : C.green,
                fontSize: 11, fontWeight: 700, padding: '7px 12px', borderRadius: 12,
              }}
            >
              {error ? '● Engine unreachable' : '● Live sync'}
            </span>
          </div>
        </div>

        <div style={{ flex: 1, padding: 24, minWidth: 0 }}>
          {error ? (
            <div style={{ padding: 40, textAlign: 'center' }}>
              <div style={{ ...fredoka(18), marginBottom: 8 }}>Can’t reach the Eventana engine</div>
              <div style={{ fontSize: 13, fontWeight: 600, color: C.muted, lineHeight: 1.6 }}>
                {error}
                <br />
                Start it with <code>npm run dev:api</code>.
              </div>
            </div>
          ) : (
            <>
              {view === 'today' && <Today onOpenEvent={() => setView('events')} />}
              {view === 'events' && <Events />}
              {view === 'inventory' && <Inventory />}
              {view === 'tasks' && <Tasks />}
              {view === 'team' && <Team />}
              {view === 'settings' && <Settings />}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/** Staff access gate — shown when no token is stored (e.g. the mobile app). */
function StaffLogin({ onDone }: { onDone: () => void }) {
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    if (!token.trim()) return;
    setBusy(true);
    setErr(null);
    setStaffToken(token.trim());
    try {
      await api.today();
      onDone();
    } catch {
      clearStaffToken();
      setErr('Invalid access token — please check it and try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: C.bg,
        padding: 20,
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 360,
          background: '#fff',
          borderRadius: 20,
          padding: '30px 26px',
          boxShadow: '0 4px 20px rgba(0,0,0,.06)',
        }}
      >
        <div style={fredoka(22)}>Eventana Operations</div>
        <div style={{ fontSize: 12.5, fontWeight: 600, color: C.muted, margin: '6px 0 20px', lineHeight: 1.5 }}>
          Enter your staff access token to continue.
        </div>
        <input
          type="password"
          placeholder="Staff access token"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void submit();
          }}
          style={{
            width: '100%',
            boxSizing: 'border-box',
            border: `1px solid ${C.line}`,
            borderRadius: 12,
            padding: '12px 14px',
            fontWeight: 600,
            fontSize: 13,
            outline: 'none',
            marginBottom: 12,
          }}
        />
        {err && (
          <div style={{ color: C.red, fontSize: 12, fontWeight: 700, marginBottom: 10 }}>{err}</div>
        )}
        <button
          onClick={submit}
          disabled={busy || !token.trim()}
          style={{
            width: '100%',
            background: busy || !token.trim() ? '#d8d2cf' : C.pink,
            color: '#fff',
            border: 'none',
            fontWeight: 700,
            fontSize: 14,
            padding: '13px 0',
            borderRadius: 12,
            cursor: busy || !token.trim() ? 'not-allowed' : 'pointer',
          }}
        >
          {busy ? 'Checking…' : 'Sign in'}
        </button>
      </div>
    </div>
  );
}
