import { useEffect, useState } from 'react';
import { api, hasStaffToken, setStaffToken, clearStaffToken, setApiErrorHandler } from './api';
import { C, fredoka } from './ui';
import { BookingNotifier } from './BookingNotifier';
import { Today } from './views/Today';
import { Schedule } from './views/Schedule';
import { EventDrawer } from './views/Events';
import { Inventory } from './views/Inventory';
import { Tasks } from './views/Tasks';
import { Team } from './views/Team';
import { Kpis } from './views/Kpis';
import { Alerts } from './views/Alerts';
import { Finance } from './views/Finance';
import { Marketing } from './views/Marketing';
import { Settings } from './views/Settings';
import { ShopOrders } from './views/ShopOrders';
import { Leads } from './views/Leads';

export type View =
  | 'today' | 'schedule' | 'tasks' | 'inventory'
  | 'alerts' | 'team' | 'kpis' | 'finance' | 'marketing' | 'settings' | 'shop' | 'leads';

type Group = 'primary' | 'more';

const NAV: Array<{ id: View; label: string; icon: string; title: string; sub: string; group: Group }> = [
  { id: 'today', label: 'Today', icon: '◉', title: 'Today', sub: 'Your day at a glance', group: 'primary' },
  { id: 'schedule', label: 'Schedule', icon: '▦', title: 'Schedule', sub: 'Jobs, events and calendar', group: 'primary' },
  { id: 'tasks', label: 'Tasks', icon: '✓', title: 'Tasks', sub: 'Work by department', group: 'primary' },
  { id: 'inventory', label: 'Inventory', icon: '▣', title: 'Inventory', sub: 'Assets and reservations', group: 'primary' },
  { id: 'leads', label: 'Leads', icon: '💬', title: 'WhatsApp Leads', sub: 'Enquiries and their party dates', group: 'more' },
  { id: 'alerts', label: 'Alerts', icon: '🔔', title: 'Alerts', sub: 'Stock, leave, reviews and tips', group: 'more' },
  { id: 'team', label: 'Team', icon: '☺', title: 'Team', sub: 'Staff, roles and days off', group: 'more' },
  { id: 'kpis', label: 'KPIs', icon: '★', title: 'Team KPIs & Tips', sub: 'Monthly leaderboard', group: 'more' },
  { id: 'finance', label: 'Finance', icon: '₳', title: 'Finance — Owner view', sub: 'Revenue, expenses and profit', group: 'more' },
  { id: 'marketing', label: 'Marketing', icon: '✉', title: 'Marketing', sub: 'Email campaigns', group: 'more' },
  { id: 'shop', label: 'Shop', icon: '🛍️', title: 'Shop Orders', sub: 'Custom printed & digital goods', group: 'more' },
  { id: 'settings', label: 'Settings', icon: '⚙', title: 'Settings', sub: 'Pricing, zones and integrations', group: 'more' },
];

// Which views each access level sees. The API enforces the same rules, so
// hiding a tab is convenience, not the guard.
const ROLE_VIEWS: Record<string, View[] | 'all'> = {
  owner: 'all',
  manager: 'all',
  employee: ['today', 'schedule', 'tasks', 'inventory'],
  driver: ['today', 'schedule'],
};

export default function App() {
  const [authed, setAuthed] = useState(hasStaffToken());
  const [view, setView] = useState<View>('today');
  const [role, setRole] = useState<string>('owner');
  const [staffName, setStaffName] = useState<string>('Owner');
  const [counts, setCounts] = useState<{ tasks: number; review: number }>({ tasks: 0, review: 0 });
  const [integrations, setIntegrations] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [openEventId, setOpenEventId] = useState<string | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  // Surface any failed API request (broken load / failed action) as a toast so
  // nothing fails silently.
  useEffect(() => {
    setApiErrorHandler((msg) => setToast(msg));
    return () => setApiErrorHandler(null);
  }, []);
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(id);
  }, [toast]);

  useEffect(() => {
    if (!authed) return;
    api
      .me()
      .then((m) => { setRole(m.role); setStaffName(m.name); })
      .catch(() => setRole('employee'));
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

  const allowed = ROLE_VIEWS[role] ?? 'all';
  const isVisible = (id: View) => allowed === 'all' || allowed.includes(id);
  const visibleNav = NAV.filter((n) => isVisible(n.id));
  const primaryNav = visibleNav.filter((n) => n.group === 'primary');
  const moreNav = visibleNav.filter((n) => n.group === 'more');
  const canSeeAll = role !== 'driver';

  // If the current tab isn't allowed for this role, snap to the first that is.
  useEffect(() => {
    if (!isVisible(view)) setView(primaryNav[0]?.id ?? 'today');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role]);

  // Hooks must run on every render, before any early return — otherwise
  // logging in (authed false→true) changes the hook count and React crashes.
  const mobile = useIsMobile();

  if (!authed) {
    return <StaffLogin onDone={() => setAuthed(true)} />;
  }

  const current = NAV.find((n) => n.id === view) ?? NAV[0];
  const sandbox = integrations.some((i) => i.mode !== 'live');
  const openEvent = (id: string) => setOpenEventId(id);

  const go = (id: View) => { setView(id); setMoreOpen(false); };

  const body = error ? (
    <div style={{ padding: 40, textAlign: 'center' }}>
      <div style={{ ...fredoka(18), marginBottom: 8 }}>Can’t reach the Eventana engine</div>
      <div style={{ fontSize: 13, fontWeight: 600, color: C.muted, lineHeight: 1.6 }}>{error}</div>
    </div>
  ) : (
    <>
      {view === 'today' && <Today onOpenEvent={openEvent} onGoto={go} />}
      {view === 'schedule' && <Schedule onOpenEvent={openEvent} canSeeAll={canSeeAll} />}
      {view === 'tasks' && <Tasks />}
      {view === 'inventory' && <Inventory />}
      {view === 'alerts' && <Alerts onOpenEvent={openEvent} />}
      {view === 'team' && <Team role={role} />}
      {view === 'kpis' && <Kpis />}
      {view === 'finance' && <Finance />}
      {view === 'marketing' && <Marketing />}
      {view === 'shop' && <ShopOrders />}
      {view === 'leads' && <Leads />}
      {view === 'settings' && <Settings />}
    </>
  );

  const eventDrawer = openEventId && (
    <EventDrawer eventId={openEventId} onClose={() => setOpenEventId(null)} />
  );

  const toastEl = toast ? (
    <div
      onClick={() => setToast(null)}
      style={{
        position: 'fixed', left: 12, right: 12, bottom: 90, zIndex: 40, cursor: 'pointer',
        background: C.ink, color: '#fff', borderRadius: 14, padding: '13px 16px',
        fontSize: 12.5, fontWeight: 600, lineHeight: 1.5, boxShadow: '0 8px 24px rgba(0,0,0,.3)',
        maxWidth: 520, margin: '0 auto',
      }}
    >
      ⚠️ {toast}
    </div>
  ) : null;

  // ---------------- phone: compact bar of primary tabs + a More sheet -------
  if (mobile) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', background: C.bg }}>
        {toastEl}
        <BookingNotifier enabled={authed} />
        <div style={{ position: 'sticky', top: 0, zIndex: 5, background: '#fff', borderBottom: `1px solid ${C.line}`, padding: '13px 16px', display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={fredoka(17)}>{current.title}</div>
            <div style={{ fontSize: 10.5, fontWeight: 600, color: C.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {current.sub}
            </div>
          </div>
          <span style={{ background: error ? C.redSoft : C.greenSoft, color: error ? C.red : C.green, fontSize: 10, fontWeight: 700, padding: '5px 9px', borderRadius: 10, flex: 'none' }}>
            {error ? '● offline' : '● live'}
          </span>
        </div>

        <div style={{ flex: 1, padding: 14, paddingBottom: 84, minWidth: 0 }}>{body}</div>

        <div style={{ position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 10, background: C.ink, display: 'flex', padding: '8px 4px calc(8px + env(safe-area-inset-bottom))' }}>
          {primaryNav.map((n) => (
            <BarItem
              key={n.id}
              icon={n.icon}
              label={n.label}
              active={view === n.id}
              badge={n.id === 'tasks' ? counts.tasks : n.id === 'schedule' ? counts.review : 0}
              badgeColor={n.id === 'schedule' ? C.red : C.pink}
              onClick={() => go(n.id)}
            />
          ))}
          {moreNav.length > 0 && (
            <BarItem icon="⋯" label="More" active={moreOpen || moreNav.some((n) => n.id === view)} onClick={() => setMoreOpen(true)} />
          )}
        </div>

        {moreOpen && (
          <div onClick={() => setMoreOpen(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(59,54,65,.4)', zIndex: 15, display: 'flex', alignItems: 'flex-end' }}>
            <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', background: '#fff', borderRadius: '20px 20px 0 0', padding: '10px 14px calc(18px + env(safe-area-inset-bottom))' }}>
              <div style={{ width: 40, height: 4, borderRadius: 3, background: C.line, margin: '4px auto 12px' }} />
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                {moreNav.map((n) => (
                  <button
                    key={n.id}
                    onClick={() => go(n.id)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 11, textAlign: 'left', cursor: 'pointer',
                      border: `1px solid ${view === n.id ? C.pink : C.line}`, background: view === n.id ? C.pinkSoft : '#fff',
                      borderRadius: 14, padding: '13px 14px',
                    }}
                  >
                    <span style={{ fontSize: 17 }}>{n.icon}</span>
                    <span style={{ fontSize: 13, fontWeight: 700, color: C.ink }}>{n.label}</span>
                  </button>
                ))}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 14, paddingTop: 14, borderTop: `1px solid ${C.line}` }}>
                <div style={{ width: 34, height: 34, borderRadius: '50%', background: C.pink, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 14, flex: 'none' }}>
                  {staffName[0]?.toUpperCase() ?? 'E'}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 700 }}>{staffName}</div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: C.muted, textTransform: 'capitalize' }}>{role}</div>
                </div>
                <button
                  onClick={() => { clearStaffToken(); setAuthed(false); }}
                  style={{ border: `1px solid ${C.line}`, background: '#fff', color: C.ink, fontWeight: 700, fontSize: 12.5, padding: '9px 16px', borderRadius: 12, cursor: 'pointer' }}
                >
                  Sign out
                </button>
              </div>
            </div>
          </div>
        )}

        {eventDrawer}
      </div>
    );
  }

  // ---------------- desktop: sidebar ---------------------------------------
  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: C.bg }}>
      {toastEl}
      <BookingNotifier enabled={authed} />
      <div
        style={{
          width: 212, flex: 'none', background: C.ink, color: '#fff',
          display: 'flex', flexDirection: 'column', padding: '20px 0',
          position: 'sticky', top: 0, height: '100vh',
        }}
      >
        <div style={{ padding: '0 20px 22px' }}>
          <div style={{ ...fredoka(19), letterSpacing: '.3px' }}>Eventana</div>
          <div style={{ fontSize: 10.5, fontWeight: 600, color: C.sidebarMuted, letterSpacing: 1.2, marginTop: 2 }}>
            OPERATIONS
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '0 10px', overflowY: 'auto' }}>
          {visibleNav.map((n, i) => {
            const active = view === n.id;
            const badge = n.id === 'tasks' ? counts.tasks : n.id === 'schedule' ? counts.review : 0;
            const firstMore = n.group === 'more' && visibleNav[i - 1]?.group === 'primary';
            return (
              <div key={n.id}>
                {firstMore && <div style={{ height: 1, background: 'rgba(255,255,255,.09)', margin: '8px 12px' }} />}
                <div
                  onClick={() => setView(n.id)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px',
                    borderRadius: 12, cursor: 'pointer',
                    background: active ? 'rgba(255,255,255,.12)' : 'transparent',
                  }}
                >
                  <span style={{ fontSize: 14, width: 18, textAlign: 'center' }}>{n.icon}</span>
                  <span style={{ flex: 1, fontSize: 13, fontWeight: active ? 700 : 600, color: active ? '#fff' : C.sidebarMuted }}>
                    {n.label}
                  </span>
                  {badge > 0 && (
                    <span style={{ background: n.id === 'schedule' ? C.red : C.pink, color: '#fff', fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 9 }}>
                      {badge}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <div style={{ flex: 1 }} />
        <div style={{ padding: '16px 20px 0', borderTop: '1px solid rgba(255,255,255,.09)', margin: '0 10px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 32, height: 32, borderRadius: '50%', background: C.pink, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 13, flex: 'none' }}>
              {staffName[0]?.toUpperCase() ?? 'E'}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{staffName}</div>
              <div style={{ fontSize: 10, fontWeight: 600, color: C.sidebarMuted, textTransform: 'capitalize' }}>{role}</div>
            </div>
            <button
              onClick={() => { clearStaffToken(); setAuthed(false); }}
              title="Sign out"
              style={{ border: 'none', background: 'transparent', color: C.sidebarMuted, fontSize: 15, cursor: 'pointer', flex: 'none' }}
            >
              ⏻
            </button>
          </div>
        </div>
      </div>

      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <div
          style={{
            flex: 'none', background: '#fff', borderBottom: `1px solid ${C.line}`,
            padding: '16px 26px', display: 'flex', alignItems: 'center', gap: 18,
            position: 'sticky', top: 0, zIndex: 5,
          }}
        >
          <div style={{ flex: 1 }}>
            <div style={fredoka(20)}>{current.title}</div>
            <div style={{ fontSize: 11.5, fontWeight: 600, color: C.muted, marginTop: 1 }}>{current.sub}</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
            {sandbox && (
              <span style={{ background: C.yellowSoft, color: C.yellowInk, fontSize: 11, fontWeight: 700, padding: '7px 12px', borderRadius: 12 }}>
                ⚙ Sandbox mode — no live payment keys
              </span>
            )}
            <span style={{ background: error ? C.redSoft : C.greenSoft, color: error ? C.red : C.green, fontSize: 11, fontWeight: 700, padding: '7px 12px', borderRadius: 12 }}>
              {error ? '● Engine unreachable' : '● Live sync'}
            </span>
          </div>
        </div>

        <div style={{ flex: 1, padding: 24, minWidth: 0 }}>{body}</div>
      </div>

      {eventDrawer}
    </div>
  );
}

/** A single bottom-bar tab. */
function BarItem({
  icon, label, active, badge = 0, badgeColor = C.pink, onClick,
}: {
  icon: string; label: string; active: boolean; badge?: number; badgeColor?: string; onClick: () => void;
}) {
  return (
    <div onClick={onClick} style={{ flex: 1, textAlign: 'center', cursor: 'pointer', color: active ? '#fff' : C.sidebarMuted, position: 'relative' }}>
      <div style={{ fontSize: 17 }}>{icon}</div>
      <div style={{ fontSize: 9.5, fontWeight: 700, marginTop: 2 }}>{label}</div>
      {badge > 0 && (
        <span style={{ position: 'absolute', top: -3, left: '50%', marginLeft: 4, background: badgeColor, color: '#fff', fontSize: 8, fontWeight: 700, padding: '1px 5px', borderRadius: 8 }}>
          {badge}
        </span>
      )}
    </div>
  );
}

/** True on phone-width viewports. */
function useIsMobile(): boolean {
  const [m, setM] = useState(() => typeof window !== 'undefined' && window.innerWidth < 820);
  useEffect(() => {
    const on = () => setM(window.innerWidth < 820);
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return m;
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
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: C.bg, padding: 20 }}>
      <div style={{ width: '100%', maxWidth: 360, background: '#fff', borderRadius: 20, padding: '30px 26px', boxShadow: '0 4px 20px rgba(0,0,0,.06)' }}>
        <div style={fredoka(22)}>Eventana Operations</div>
        <div style={{ fontSize: 12.5, fontWeight: 600, color: C.muted, margin: '6px 0 20px', lineHeight: 1.5 }}>
          Enter your staff access token to continue.
        </div>
        <input
          type="password"
          placeholder="Staff access token"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void submit(); }}
          style={{ width: '100%', boxSizing: 'border-box', border: `1px solid ${C.line}`, borderRadius: 12, padding: '12px 14px', fontWeight: 600, fontSize: 13, outline: 'none', marginBottom: 12 }}
        />
        {err && <div style={{ color: C.red, fontSize: 12, fontWeight: 700, marginBottom: 10 }}>{err}</div>}
        <button
          onClick={submit}
          disabled={busy || !token.trim()}
          style={{ width: '100%', background: busy || !token.trim() ? '#d8d2cf' : C.pink, color: '#fff', border: 'none', fontWeight: 700, fontSize: 14, padding: '13px 0', borderRadius: 12, cursor: busy || !token.trim() ? 'not-allowed' : 'pointer' }}
        >
          {busy ? 'Checking…' : 'Sign in'}
        </button>
      </div>
    </div>
  );
}
