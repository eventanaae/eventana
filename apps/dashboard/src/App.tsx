import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { api, hasStaffToken, setStaffToken, clearStaffToken, setApiErrorHandler, isPreviewing, exitPreview } from './api';
import { C, fredoka } from './ui';
import { BookingNotifier } from './BookingNotifier';
import { NotificationBell } from './NotificationBell';
import { Today } from './views/Today';
import { Overview } from './views/Overview';
import { Schedule } from './views/Schedule';
import { EventDrawer } from './views/Events';
import { ShopOrderDrawer } from './views/ShopOrderDrawer';
import { Inventory } from './views/Inventory';
import { Tasks } from './views/Tasks';
import { Team } from './views/Team';
import { Kpis } from './views/Kpis';
import { Alerts } from './views/Alerts';
import { FinanceHub } from './views/FinanceHub';
import { Financials } from './views/Financials';
import { Ceo } from './views/Ceo';
import { NewOrder } from './views/NewOrder';
import { Marketing } from './views/Marketing';
import { Settings } from './views/Settings';
import { ShopOrders } from './views/ShopOrders';
import { Leads } from './views/Leads';
import { Customers } from './views/Customers';
import { Reports } from './views/Reports';
import { Profile } from './views/Profile';

export type View =
  | 'today' | 'schedule' | 'tasks' | 'inventory'
  | 'alerts' | 'team' | 'kpis' | 'ceo' | 'overview' | 'finance' | 'financials' | 'marketing' | 'settings' | 'shop' | 'leads' | 'neworder' | 'customers' | 'reports' | 'profile';

type Section = 'ops' | 'sales' | 'business' | 'admin';

// Sidebar sections, in priority order. Every view lives in exactly one section
// so the whole app is visible and one click away on desktop, and grouped with
// clear labels on mobile — no "lost in More".
const SECTIONS: Array<{ id: Section; label: string }> = [
  { id: 'ops', label: 'Operations' },
  { id: 'sales', label: 'Sales & Customers' },
  { id: 'business', label: 'Business' },
  { id: 'admin', label: 'Team & Setup' },
];

// `mobile: true` marks the handful of top tabs shown in the phone bottom bar.
const NAV: Array<{ id: View; label: string; icon: string; title: string; sub: string; section: Section; mobile?: boolean }> = [
  { id: 'today', label: 'Home', icon: '◉', title: 'Home', sub: 'Your day at a glance', section: 'ops', mobile: true },
  { id: 'schedule', label: 'Events', icon: '▦', title: 'Events', sub: 'Events, jobs, bookings & tasks', section: 'ops', mobile: true },
  { id: 'inventory', label: 'Inventory', icon: '▣', title: 'Inventory', sub: 'Assets, stock & issue reports', section: 'ops' },
  { id: 'alerts', label: 'Updates', icon: '📣', title: 'Latest updates', sub: "What's new — prep, stock, tips and ratings", section: 'ops', mobile: true },
  { id: 'customers', label: 'Customers', icon: '👥', title: 'Customers', sub: 'Your customer book — spend, history & contacts', section: 'sales' },
  { id: 'neworder', label: 'New Order', icon: '➕', title: 'New Order', sub: 'Create a WhatsApp order & payment link', section: 'sales' },
  { id: 'leads', label: 'Leads', icon: '💬', title: 'WhatsApp Leads', sub: 'Enquiries and their party dates', section: 'sales' },
  // Shop orders already flow into Sales (finance) and the dashboard, so there's
  // no separate Shop tab — removed from the nav on purpose.
  { id: 'overview', label: 'Overview', icon: '📊', title: 'Overview', sub: 'Orders, emirates & themes at a glance', section: 'business', mobile: true },
  { id: 'ceo', label: 'CEO Dashboard', icon: '◆', title: 'CEO Dashboard', sub: 'Revenue, growth, insights & risks', section: 'business' },
  { id: 'finance', label: 'Finance', icon: '₳', title: 'Finance', sub: 'Invoices, receipts, expenses & accounts', section: 'business' },
  { id: 'financials', label: 'Financials', icon: '📚', title: 'Financials (P&L)', sub: 'Yearly revenue, expenses & profit history', section: 'business' },
  { id: 'kpis', label: 'Achievements', icon: '★', title: 'Achievements & Tips', sub: 'Your achievements, rewards & points', section: 'business' },
  { id: 'marketing', label: 'Marketing', icon: '✉', title: 'Marketing', sub: 'Email campaigns & approvals', section: 'business' },
  { id: 'team', label: 'Team', icon: '☺', title: 'Team', sub: 'Staff, roles and days off', section: 'admin' },
  { id: 'settings', label: 'Settings', icon: '⚙', title: 'Settings', sub: 'Pricing, zones and integrations', section: 'admin' },
  { id: 'reports', label: 'Reports & Tools', icon: '🛡️', title: 'Reports & Tools', sub: 'Reconciliation, refunds, audit log & clean-up', section: 'admin' },
  { id: 'profile', label: 'Profile', icon: '👤', title: 'My Profile', sub: 'Your details, achievements & feedback', section: 'admin' },
];

// Which views each access level sees. The API enforces the same rules, so
// hiding a tab is convenience, not the guard.
const ROLE_VIEWS: Record<string, View[] | 'all'> = {
  owner: 'all',
  // Manager: everything EXCEPT the CEO dashboard and the P&L history (Owner's
  // money views). Gets the money-free Overview instead.
  manager: ['today', 'schedule', 'inventory', 'alerts', 'customers', 'neworder', 'leads', 'overview', 'finance', 'kpis', 'marketing', 'team', 'settings', 'profile'],
  // Employee/driver: exactly their four bottom-bar tabs — no "More" (achievements
  // live inside Profile now).
  employee: ['today', 'schedule', 'inventory', 'profile'],
  driver: ['today', 'schedule', 'profile'],
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
  const [openShopId, setOpenShopId] = useState<string | null>(null);
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
  // Phone bottom bar: exactly four primary tabs. The Owner keeps the CEO
  // Dashboard as their 4th; everyone else gets Latest updates. Whatever else
  // their role can see spills into "More".
  const primaryIds: View[] = role === 'owner'
    ? ['today', 'schedule', 'ceo']
    : role === 'manager'
      ? ['today', 'schedule', 'alerts']
      : ['today', 'schedule', 'inventory', 'profile']; // employee/driver — filtered by isVisible
  const primaryNav = primaryIds.filter((id) => isVisible(id)).map((id) => NAV.find((n) => n.id === id)!);
  const primarySet = new Set<View>(primaryIds);
  const moreNav = visibleNav.filter((n) => !primarySet.has(n.id));
  const canSeeAll = role !== 'driver';

  // If the current tab isn't allowed for this role, snap to the first that is.
  useEffect(() => {
    if (!isVisible(view)) setView(primaryNav[0]?.id ?? 'today');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role]);

  // Hooks must run on every render, before any early return — otherwise
  // logging in (authed false→true) changes the hook count and React crashes.
  const mobile = useIsMobile();

  // A set-password link (?setup=TOKEN) always shows the login/set-password screen,
  // even if a token would otherwise auto-authenticate this device.
  const hasSetup = (() => { try { return new URLSearchParams(window.location.search).has('setup'); } catch { return false; } })();
  if (!authed || hasSetup) {
    return <StaffLogin onDone={() => setAuthed(true)} />;
  }

  const current = NAV.find((n) => n.id === view) ?? NAV[0];
  // Only warn when a provider is genuinely in test/sandbox mode. A 'disabled'
  // provider (e.g. Tabby/Tamara/Ziina awaiting production creds) is not a
  // sandbox — Stripe being live means real payments work.
  const sandbox = integrations.some((i) => i.mode === 'sandbox' || i.mode === 'test');
  const openEvent = (id: string) => setOpenEventId(id);

  const go = (id: View) => { setView(id); setMoreOpen(false); };

  const body = error ? (
    <div style={{ padding: 40, textAlign: 'center' }}>
      <div style={{ ...fredoka(18), marginBottom: 8 }}>Can’t reach the Eventana engine</div>
      <div style={{ fontSize: 13, fontWeight: 600, color: C.muted, lineHeight: 1.6 }}>{error}</div>
    </div>
  ) : (
    <>
      {view === 'today' && <Today onOpenEvent={openEvent} onOpenShop={setOpenShopId} onGoto={go} staffName={staffName} role={role} />}
      {view === 'overview' && <Overview onOpenEvent={openEvent} onGoto={go} />}
      {view === 'schedule' && <Schedule onOpenEvent={openEvent} canSeeAll={canSeeAll} role={role} />}
      {view === 'tasks' && <Tasks role={role} />}
      {view === 'inventory' && <Inventory role={role} />}
      {view === 'alerts' && <Alerts onOpenEvent={openEvent} />}
      {view === 'team' && <Team role={role} />}
      {view === 'kpis' && <Kpis role={role} />}
      {view === 'ceo' && <Ceo />}
      {view === 'finance' && <FinanceHub role={role} />}
      {view === 'financials' && <Financials />}
      {view === 'marketing' && <Marketing />}
      {view === 'shop' && <ShopOrders />}
      {view === 'neworder' && <NewOrder />}
      {view === 'leads' && <Leads />}
      {view === 'customers' && <Customers />}
      {view === 'reports' && <Reports />}
      {view === 'profile' && <Profile onSignedOut={() => setAuthed(false)} />}
      {view === 'settings' && <Settings />}
    </>
  );

  const eventDrawer = openEventId && (
    <EventDrawer eventId={openEventId} onClose={() => setOpenEventId(null)} />
  );
  const shopDrawer = openShopId && (
    <ShopOrderDrawer orderId={openShopId} role={role} onClose={() => setOpenShopId(null)} />
  );

  const preview = isPreviewing();
  const previewBar = preview ? (
    <div style={{ position: 'sticky', top: 0, zIndex: 30, background: C.yellowInk, color: '#fff', padding: '8px 14px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, fontSize: 12.5, fontWeight: 700, flexWrap: 'wrap' }}>
      👁 Previewing as {preview.name} ({preview.role})
      <button onClick={exitPreview} style={{ background: '#fff', color: C.yellowInk, border: 'none', borderRadius: 8, padding: '5px 12px', fontWeight: 800, cursor: 'pointer', fontSize: 12 }}>Exit preview</button>
    </div>
  ) : null;

  const toastEl = toast ? (
    <div
      onClick={() => setToast(null)}
      style={{
        position: 'fixed', left: 12, right: 12, bottom: 90, zIndex: 40, cursor: 'pointer',
        background: C.pinkDeep, color: '#fff', borderRadius: 14, padding: '13px 16px',
        fontSize: 12.5, fontWeight: 600, lineHeight: 1.5, boxShadow: '0 10px 30px rgba(214,49,127,.28)',
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
        {previewBar}
        {toastEl}
        <BookingNotifier enabled={authed} />
        <div style={{ position: 'sticky', top: 0, zIndex: 5, background: '#fff', borderBottom: `1px solid ${C.line}`, padding: '8px 14px', display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ ...fredoka(16), flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{current.title}</div>
          <span style={{ background: error ? C.redSoft : C.greenSoft, color: error ? C.red : C.green, fontSize: 10, fontWeight: 700, padding: '4px 8px', borderRadius: 10, flex: 'none' }}>
            {error ? '● offline' : '● live'}
          </span>
          <NotificationBell onOpenEvent={openEvent} />
        </div>

        <div style={{ flex: 1, padding: 14, paddingBottom: 84, minWidth: 0 }}>{body}</div>

        <div style={{ position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 10, background: '#fff', borderTop: `1px solid ${C.line}`, display: 'flex', padding: '8px 4px calc(8px + env(safe-area-inset-bottom))' }}>
          {primaryNav.map((n) => (
            <BarItem
              key={n.id}
              icon={n.icon}
              label={n.label}
              active={view === n.id}
              badge={n.id === 'schedule' ? (counts.review + counts.tasks) : 0}
              badgeColor={counts.review > 0 ? C.red : C.pink}
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
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {SECTIONS.map((sec) => {
                  const items = moreNav.filter((n) => n.section === sec.id);
                  if (items.length === 0) return null;
                  return (
                    <div key={sec.id}>
                      <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: 0.8, textTransform: 'uppercase', color: C.muted, margin: '0 2px 6px' }}>
                        {sec.label}
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                        {items.map((n) => (
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
                            <span style={{ fontSize: 13, fontWeight: 700, color: view === n.id ? C.pinkDeep : C.ink }}>{n.label}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })}
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
        {shopDrawer}
      </div>
    );
  }

  // ---------------- desktop: sidebar ---------------------------------------
  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', background: C.bg }}>
      {previewBar}
      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
      {toastEl}
      <BookingNotifier enabled={authed} />
      <div
        style={{
          width: 212, flex: 'none', background: '#fff', color: C.ink,
          borderRight: `1px solid ${C.line}`,
          display: 'flex', flexDirection: 'column', padding: '20px 0',
          position: 'sticky', top: 0, height: '100vh',
        }}
      >
        <div style={{ padding: '0 20px 20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
            <span style={{ width: 30, height: 30, borderRadius: 10, background: C.gradPink, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, boxShadow: '0 6px 14px rgba(233,79,156,.3)' }}>🎈</span>
            <div style={{ ...fredoka(19), color: C.pinkDeep }}>Eventana</div>
          </div>
          <div style={{ height: 3, borderRadius: 2, background: C.rainbow, margin: '10px 0 0', opacity: .85 }} />
          <div style={{ fontSize: 9.5, fontWeight: 800, color: C.muted, letterSpacing: 1.4, marginTop: 8 }}>
            OPERATIONS
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '0 10px', overflowY: 'auto' }}>
          {SECTIONS.map((sec) => {
            const items = visibleNav.filter((n) => n.section === sec.id);
            if (items.length === 0) return null;
            return (
              <div key={sec.id} style={{ marginBottom: 6 }}>
                <div style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: 1, textTransform: 'uppercase', color: C.muted, padding: '10px 12px 4px' }}>
                  {sec.label}
                </div>
                {items.map((n) => {
                  const active = view === n.id;
                  const badge = n.id === 'schedule' ? (counts.review + counts.tasks) : 0;
                  return (
                    <div
                      key={n.id}
                      onClick={() => setView(n.id)}
                      className="navi"
                      style={{
                        display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px',
                        borderRadius: 13, cursor: 'pointer', marginBottom: 1,
                        background: active ? C.gradPink : 'transparent',
                        boxShadow: active ? '0 6px 15px rgba(233,79,156,.28)' : 'none',
                      }}
                      onMouseEnter={(ev) => { if (!active) (ev.currentTarget as HTMLElement).style.background = C.pinkSoft; }}
                      onMouseLeave={(ev) => { if (!active) (ev.currentTarget as HTMLElement).style.background = 'transparent'; }}
                    >
                      <span style={{ fontSize: 14, width: 18, textAlign: 'center' }}>{n.icon}</span>
                      <span style={{ flex: 1, fontSize: 13, fontWeight: active ? 700 : 600, color: active ? '#fff' : C.muted2 }}>
                        {n.label}
                      </span>
                      {badge > 0 && (
                        <span style={{ background: active ? 'rgba(255,255,255,.9)' : (n.id === 'schedule' ? C.red : C.pink), color: active ? C.pinkDeep : '#fff', fontSize: 10, fontWeight: 800, padding: '2px 7px', borderRadius: 9 }}>
                          {badge}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>

        <div style={{ flex: 1 }} />
        <div style={{ padding: '16px 20px 0', borderTop: `1px solid ${C.line}`, margin: '0 10px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 32, height: 32, borderRadius: '50%', background: C.pink, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 13, flex: 'none' }}>
              {staffName[0]?.toUpperCase() ?? 'E'}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{staffName}</div>
              <div style={{ fontSize: 10, fontWeight: 600, color: C.muted, textTransform: 'capitalize' }}>{role}</div>
            </div>
            <button
              onClick={() => { clearStaffToken(); setAuthed(false); }}
              title="Sign out"
              style={{ border: 'none', background: 'transparent', color: C.muted, fontSize: 15, cursor: 'pointer', flex: 'none' }}
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
            <NotificationBell onOpenEvent={openEvent} />
          </div>
        </div>

        <div style={{ flex: 1, padding: 24, minWidth: 0 }}>{body}</div>
      </div>

      {eventDrawer}
      </div>
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
    <div onClick={onClick} className="tap" style={{ flex: 1, textAlign: 'center', cursor: 'pointer', color: active ? C.pinkDeep : C.muted, position: 'relative' }}>
      <div style={{ width: 40, height: 27, margin: '0 auto', borderRadius: 13, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 17, background: active ? C.pinkSoft : 'transparent', transition: 'background .16s ease' }}>{icon}</div>
      <div style={{ fontSize: 9.5, fontWeight: active ? 800 : 700, marginTop: 2 }}>{label}</div>
      {badge > 0 && (
        <span style={{ position: 'absolute', top: -3, left: '50%', marginLeft: 6, background: badgeColor, color: '#fff', fontSize: 8, fontWeight: 700, padding: '1px 5px', borderRadius: 8 }}>
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

/**
 * Staff login — email + password, with a forgot-password flow and a set-password
 * screen reached from the emailed invite/reset link (?setup=TOKEN). The old
 * "paste your access token" method stays available under "Advanced" so nobody is
 * stranded during the switch to passwords.
 */
function StaffLogin({ onDone }: { onDone: () => void }) {
  const setupToken = (() => { try { return new URLSearchParams(window.location.search).get('setup'); } catch { return null; } })();
  const [mode, setMode] = useState<'login' | 'forgot' | 'setup' | 'token'>(setupToken ? 'setup' : 'login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const inputStyle: CSSProperties = { width: '100%', boxSizing: 'border-box', border: `1px solid ${C.line}`, borderRadius: 12, padding: '12px 14px', fontWeight: 600, fontSize: 14, outline: 'none', marginBottom: 10 };
  const clearUrl = () => { try { window.history.replaceState({}, '', window.location.pathname); } catch { /* ignore */ } };

  const doLogin = async () => {
    setBusy(true); setErr(null);
    try { const r = await api.staffLogin(email.trim(), password); setStaffToken(r.token); onDone(); }
    catch (e: any) { setErr(e?.message || 'Wrong email or password.'); }
    finally { setBusy(false); }
  };
  const doForgot = async () => {
    setBusy(true); setErr(null); setNote(null);
    try { await api.staffForgot(email.trim()); setNote('If that email is on our team, a reset link is on its way. 📩'); }
    catch { setNote('If that email is on our team, a reset link is on its way. 📩'); }
    finally { setBusy(false); }
  };
  const doSetPassword = async () => {
    if (password !== password2) { setErr('The two passwords don’t match.'); return; }
    setBusy(true); setErr(null);
    try {
      const r = await api.staffSetPassword(setupToken!, password);
      // Password saved — send them to sign in with it (confirms it works).
      clearUrl();
      setPassword(''); setPassword2('');
      if (r.email) setEmail(r.email);
      setMode('login');
      setNote('Password saved ✓ Now sign in with your email and new password.');
    }
    catch (e: any) { setErr(e?.message || 'This link is invalid or expired.'); }
    finally { setBusy(false); }
  };
  const doToken = async () => {
    if (!token.trim()) return;
    setBusy(true); setErr(null); setStaffToken(token.trim());
    try { await api.today(); onDone(); }
    catch { clearStaffToken(); setErr('Invalid access token.'); }
    finally { setBusy(false); }
  };

  const btn = (label: string, onClick: () => void, disabled = false) => (
    <button onClick={onClick} disabled={busy || disabled}
      style={{ width: '100%', background: busy || disabled ? '#d8d2cf' : C.pink, color: '#fff', border: 'none', fontWeight: 700, fontSize: 14, padding: '13px 0', borderRadius: 12, cursor: busy || disabled ? 'not-allowed' : 'pointer', marginTop: 4 }}>
      {busy ? 'Please wait…' : label}
    </button>
  );
  const link = (label: string, onClick: () => void) => (
    <button onClick={onClick} style={{ border: 'none', background: 'none', color: C.pinkDeep, fontWeight: 700, fontSize: 12.5, cursor: 'pointer', padding: 0 }}>{label}</button>
  );

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: C.bg, padding: 20 }}>
      <div style={{ width: '100%', maxWidth: 380, background: '#fff', borderRadius: 20, padding: '30px 26px', boxShadow: '0 4px 20px rgba(0,0,0,.06)' }}>
        <div style={{ ...fredoka(22), textAlign: 'center' }}>🎈 Eventana</div>
        <div style={{ fontSize: 12.5, fontWeight: 700, color: C.muted, textAlign: 'center', margin: '4px 0 22px', letterSpacing: 1 }}>OPERATIONS</div>

        {err && <div style={{ color: C.red, fontSize: 12.5, fontWeight: 700, marginBottom: 10, background: C.redSoft, borderRadius: 10, padding: '9px 11px' }}>{err}</div>}
        {note && <div style={{ color: C.green, fontSize: 12.5, fontWeight: 700, marginBottom: 10, background: C.greenSoft, borderRadius: 10, padding: '9px 11px' }}>{note}</div>}

        {mode === 'login' && (<>
          <input type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} style={inputStyle} />
          <input type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void doLogin(); }} style={inputStyle} />
          {btn('Sign in', doLogin, !email.trim() || !password)}
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 14 }}>
            {link('Forgot password?', () => { setErr(null); setNote(null); setMode('forgot'); })}
            {link('Use access token', () => { setErr(null); setMode('token'); })}
          </div>
        </>)}

        {mode === 'forgot' && (<>
          <div style={{ fontSize: 12.5, fontWeight: 600, color: C.muted, marginBottom: 12, lineHeight: 1.5 }}>Enter your email and we’ll send you a link to set a new password.</div>
          <input type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void doForgot(); }} style={inputStyle} />
          {btn('Send reset link', doForgot, !email.trim())}
          <div style={{ marginTop: 14, textAlign: 'center' }}>{link('← Back to sign in', () => { setErr(null); setNote(null); setMode('login'); })}</div>
        </>)}

        {mode === 'setup' && (<>
          <div style={{ fontSize: 13, fontWeight: 700, color: C.ink, marginBottom: 4 }}>Set your password</div>
          <div style={{ fontSize: 12, fontWeight: 600, color: C.muted, marginBottom: 12, lineHeight: 1.5 }}>At least 8 characters, with a letter and a number.</div>
          <input type="password" placeholder="New password" value={password} onChange={(e) => setPassword(e.target.value)} style={inputStyle} />
          <input type="password" placeholder="Confirm password" value={password2} onChange={(e) => setPassword2(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void doSetPassword(); }} style={inputStyle} />
          {btn('Save & sign in', doSetPassword, !password || !password2)}
          <div style={{ marginTop: 14, textAlign: 'center' }}>{link('← Back to sign in', () => { clearUrl(); setErr(null); setMode('login'); })}</div>
        </>)}

        {mode === 'token' && (<>
          <div style={{ fontSize: 12.5, fontWeight: 600, color: C.muted, marginBottom: 12, lineHeight: 1.5 }}>Advanced: paste your staff access token.</div>
          <input type="password" placeholder="Staff access token" value={token} onChange={(e) => setToken(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void doToken(); }} style={inputStyle} />
          {btn('Sign in with token', doToken, !token.trim())}
          <div style={{ marginTop: 14, textAlign: 'center' }}>{link('← Back to sign in', () => { setErr(null); setMode('login'); })}</div>
        </>)}
      </div>
    </div>
  );
}
