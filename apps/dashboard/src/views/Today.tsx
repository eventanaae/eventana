import { useEffect, useState } from 'react';
import type { View } from '../App';
import { api } from '../api';
import { ACCENTS, Badge, Button, C, fredoka, Panel, QuickAction, SectionHeader, Spinner, StatCard, useCountUp } from '../ui';

/**
 * The operational home — a warm, lively landing that answers, at a glance:
 * how's the day, what needs me now, what's next, and where do I jump. Greeting
 * hero → quick actions → vibrant stats → next event → attention → today &
 * upcoming. Mobile-first and vertical.
 */
export function Today({ onOpenEvent, onOpenShop, onGoto, staffName, role }: { onOpenEvent: (id: string) => void; onOpenShop?: (id: string) => void; onGoto: (v: View) => void; staffName?: string; role?: string }) {
  const [data, setData] = useState<any>(null);

  const load = () => api.today().then(setData);
  useEffect(() => {
    load();
    const timer = setInterval(load, 30_000);
    return () => clearInterval(timer);
  }, []);

  // Count-up targets — computed defensively so the hooks run every render
  // (before the early return), keeping the hook order stable.
  const todayStr = new Date().toISOString().slice(0, 10);
  const evToday = useCountUp(Number(data?.kpis?.eventsToday) || 0);
  const upCount = useCountUp((data?.events ?? []).filter((e: any) => String(e.event_date).slice(0, 10) !== todayStr).length);
  const tasks = useCountUp(Number(data?.kpis?.openTasks) || 0);

  if (!data) return <Spinner />;

  const k = data.kpis;
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

  const hour = new Date().getHours();
  const partOfDay = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const first = (staffName || '').trim().split(/\s+/)[0] || 'there';
  const dateLine = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
  const line = todays.length > 0
    ? `${todays.length} ${todays.length === 1 ? 'celebration' : 'celebrations'} on today — let's make them magical ✨`
    : next
      ? "No parties today — a good day to get ahead 💐"
      : "Let's fill the calendar with celebrations 🎈";

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Greeting hero */}
      <div className="pop-in" style={{ position: 'relative', overflow: 'hidden', borderRadius: 24, background: C.gradHero, boxShadow: C.shadowLg }}>
        <div style={{ height: 6, background: C.rainbow }} />
        <div style={{ position: 'absolute', right: 14, top: 20, fontSize: 62, animation: 'floaty 4s ease-in-out infinite', filter: 'drop-shadow(0 8px 14px rgba(233,79,156,.2))' }}>🎉</div>
        <div style={{ padding: '18px 20px 20px' }}>
          <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 1, textTransform: 'uppercase', color: C.pinkDeep }}>{dateLine}</div>
          <div style={{ ...fredoka(26), marginTop: 6, maxWidth: '78%' }}>{partOfDay}, {first} <span style={{ display: 'inline-block', animation: 'floaty 3s ease-in-out infinite' }}>👋</span></div>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#96637c', marginTop: 6, maxWidth: '86%', lineHeight: 1.5 }}>{line}</div>
        </div>
      </div>

      {/* Quick actions — only the ones this role can actually open */}
      {(() => {
        const isMgr = role === 'owner' || role === 'manager';
        const acts = [
          isMgr && { icon: '🎀', label: 'New order', accent: ACCENTS[0], to: 'neworder' as View },
          { icon: '🗓️', label: 'Schedule', accent: ACCENTS[1], to: 'schedule' as View },
          role !== 'driver' && { icon: '✅', label: 'Tasks', accent: ACCENTS[3], to: 'tasks' as View },
          isMgr && { icon: '💰', label: 'Finance', accent: ACCENTS[5], to: 'finance' as View },
        ].filter(Boolean) as Array<{ icon: string; label: string; accent: any; to: View }>;
        if (acts.length === 0) return null;
        return (
          <div>
            <SectionHeader>Quick actions</SectionHeader>
            <div style={{ display: 'grid', gridTemplateColumns: `repeat(${acts.length}, 1fr)`, gap: 10 }}>
              {acts.map((a) => (
                <QuickAction key={a.label} icon={a.icon} label={a.label} accent={a.accent} onClick={() => onGoto(a.to)} />
              ))}
            </div>
          </div>
        );
      })()}

      {/* Today's celebrations — surfaced right under quick actions so the crew
          sees today's job first thing, before stats or the competition board. */}
      {todays.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="rise-in lift" style={{ ['--i' as any]: 1, background: '#fff', border: `1px solid ${C.line}`, borderRadius: 22, padding: 4, boxShadow: C.shadow, cursor: 'pointer' }} onClick={() => onOpenEvent(todays[0].id)}>
            <div style={{ borderRadius: 18, background: 'linear-gradient(135deg,#FFF0F7,#FDE7F0)', padding: '16px 18px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: C.pink, animation: 'pulse 1.8s infinite', boxShadow: '0 0 0 4px rgba(240,108,168,.18)' }} />
                <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '.8px', color: C.pinkDeep }}>{todays.length === 1 ? 'YOUR EVENT · TODAY' : 'FIRST TODAY'}</div>
              </div>
              <div style={{ ...fredoka(21), marginTop: 8 }}>{todays[0].customer}</div>
              <div style={{ fontSize: 12.5, fontWeight: 700, color: '#8b6c7a', marginTop: 3 }}>Today · {todays[0].start_time}–{todays[0].base_end_time} · {todays[0].emirate}</div>
              {themeOf(todays[0]) && (
                <div style={{ fontSize: 12, fontWeight: 800, color: C.pinkDeep, marginTop: 4 }}>🎨 {themeOf(todays[0])}</div>
              )}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 13 }}>
                <Badge tone={todays[0].phase === 'Event Completed' ? 'neutral' : 'info'}>{todays[0].phase}</Badge>
                <div style={{ flex: 1 }} />
                <Button onClick={() => onOpenEvent(todays[0].id)}>Open job →</Button>
              </div>
            </div>
          </div>
          {todays.length > 1 && (
            <Panel title={`Also today · ${todays.length - 1} more`}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {todays.slice(1).map((e, idx) => <EventRow key={e.id} e={e} label={when(e)} accentIdx={idx + 1} onOpen={() => onOpenEvent(e.id)} />)}
              </div>
            </Panel>
          )}
        </div>
      )}

      {/* Owner/manager get the vibrant KPI tiles. Staff (employee/driver) instead
          get their own "latest updates" inline — their prep at risk, low stock and
          the ratings on their events — so Home is their one useful screen. */}
      {(role === 'employee' || role === 'driver') ? (
        <StaffUpdates onOpenEvent={onOpenEvent} />
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12 }}>
          <StatCard i={0} label="Events today" value={Math.round(evToday)} icon="🎈" accent={ACCENTS[0]} onClick={() => onGoto('schedule')} />
          {role === 'owner' && k.revenueThisMonthDisplay
            ? <StatCard i={1} label="Revenue this month" value={<span>AED {k.revenueThisMonthDisplay}</span>} icon="💸" accent={ACCENTS[1]} onClick={() => onGoto('ceo')} />
            : <StatCard i={1} label="Bookings this month" value={Number(k.bookingsThisMonth) || 0} icon="🎉" accent={ACCENTS[1]} onClick={() => onGoto('overview')} />}
          <StatCard i={2} label="Upcoming" value={Math.round(upCount)} icon="✨" accent={ACCENTS[4]} hint={next ? when(next).replace('Today · ', 'next today ') : undefined} onClick={() => onGoto('schedule')} />
          <StatCard i={3} label="Open tasks" value={Math.round(tasks)} icon="📋" accent={ACCENTS[3]} onClick={() => onGoto('tasks')} />
        </div>
      )}

      {/* Next event — shown only when nothing is on today (today is up top). */}
      {next && !isToday(next) && (
        <div className="rise-in lift" style={{ ['--i' as any]: 2, background: '#fff', border: `1px solid ${C.line}`, borderRadius: 22, padding: 4, boxShadow: C.shadow, cursor: 'pointer' }} onClick={() => onOpenEvent(next.id)}>
          <div style={{ borderRadius: 18, background: 'linear-gradient(135deg,#FFF0F7,#FDE7F0)', padding: '16px 18px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: C.pink, animation: 'pulse 1.8s infinite', boxShadow: '0 0 0 4px rgba(240,108,168,.18)' }} />
              <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '.8px', color: C.pinkDeep }}>{isToday(next) ? 'NEXT EVENT · TODAY' : 'NEXT EVENT'}</div>
            </div>
            <div style={{ ...fredoka(21), marginTop: 8 }}>{next.customer}</div>
            <div style={{ fontSize: 12.5, fontWeight: 700, color: '#8b6c7a', marginTop: 3 }}>{when(next)}–{next.base_end_time} · {next.emirate}</div>
            {themeOf(next) && (
              <div style={{ fontSize: 12, fontWeight: 800, color: C.pinkDeep, marginTop: 4 }}>🎨 {themeOf(next)}</div>
            )}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 13 }}>
              <Badge tone={next.phase === 'Event Completed' ? 'neutral' : 'info'}>{next.phase}</Badge>
              <div style={{ flex: 1 }} />
              <Button onClick={() => onOpenEvent(next.id)}>Open job →</Button>
            </div>
          </div>
        </div>
      )}

      {/* Needs attention — a manager/owner overview (staff have it on their own screens) */}
      {(role === 'owner' || role === 'manager') && attention.length > 0 && (
        <Panel className="rise-in" style={{ ['--i' as any]: 3 } as any} title="Needs attention">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {attention.map((a, idx) => {
              const ac = ACCENTS[idx % ACCENTS.length];
              return (
                <div key={a.label} onClick={a.onClick} className="tap" style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '11px 4px', borderBottom: idx < attention.length - 1 ? `1px solid ${C.lineSoft}` : 'none', cursor: 'pointer', borderRadius: 10 }}>
                  <span style={{ width: 9, height: 9, borderRadius: '50%', background: ac.grad, flex: 'none' }} />
                  <span style={{ flex: 1, fontSize: 13, fontWeight: 700, color: C.ink }}>{a.label}</span>
                  <span style={{ background: ac.soft, color: ac.fg, fontWeight: 800, fontSize: 12.5, minWidth: 26, textAlign: 'center', borderRadius: 9, padding: '3px 9px' }}>{a.n}</span>
                  <span style={{ color: C.muted, fontWeight: 800 }}>›</span>
                </div>
              );
            })}
          </div>
        </Panel>
      )}

      {/* Upcoming — events + shop orders interleaved, sorted by date. */}
      {(() => {
        const evItems = upcoming.map((e) => ({ shop: false, id: e.id, sortDate: String(e.event_date).slice(0, 10), e }));
        const shopItems = (data.shopOrders ?? []).map((o: any) => ({ shop: true, id: o.id, sortDate: String(o.readyBy ?? ''), o }));
        const combined = [...evItems, ...shopItems].sort((a, b) => a.sortDate.localeCompare(b.sortDate)).slice(0, 10);
        if (combined.length === 0) return null;
        return (
          <Panel className="rise-in" style={{ ['--i' as any]: 5 } as any} title="Upcoming"
            action={<span onClick={() => onGoto('schedule')} className="tap" style={{ fontSize: 12, fontWeight: 800, color: C.pinkDeep, cursor: 'pointer' }}>See all ›</span>}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {combined.map((it, idx) => it.shop
                ? <ShopRow key={`s-${it.id}`} o={(it as any).o} onOpen={() => onOpenShop?.(it.id)} />
                : <EventRow key={it.id} e={(it as any).e} label={when((it as any).e)} accentIdx={idx} onOpen={() => onOpenEvent(it.id)} />)}
            </div>
          </Panel>
        );
      })()}
    </div>
  );
}

/** A shop order row in the Upcoming list — light purple, clickable. */
function ShopRow({ o, onOpen }: { o: any; onOpen: () => void }) {
  return (
    <div onClick={onOpen} className="tap" style={{ display: 'flex', alignItems: 'center', gap: 11, cursor: 'pointer', padding: '8px 4px', borderRadius: 12 }}>
      <span style={{ width: 34, height: 34, borderRadius: 11, background: 'linear-gradient(135deg,#E7D6F7,#D6C2F0)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, flex: 'none' }}>🛍️</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#6B4E9E', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{o.customer}</div>
        <div style={{ fontSize: 11.5, fontWeight: 600, color: '#9578bd' }}>
          {o.itemsLabel}{o.readyBy ? ` · 📦 ${new Date(o.readyBy).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}` : ''}
        </div>
      </div>
      <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: '.4px', color: '#8a6cc0', background: '#F1E8FB', padding: '3px 8px', borderRadius: 20 }}>SHOP</span>
      <span style={{ color: C.muted, fontWeight: 800 }}>›</span>
    </div>
  );
}

/** The theme label for an event row: the booked theme name, or "Custom theme". */
function themeOf(e: any): string | null {
  if (e.custom_theme) return 'Custom theme';
  return e.theme_name || null;
}

function EventRow({ e, label, onOpen, accentIdx = 0 }: { e: any; label: string; onOpen: () => void; accentIdx?: number }) {
  const ac = ACCENTS[accentIdx % ACCENTS.length];
  return (
    <div onClick={onOpen} className="tap" style={{ display: 'flex', alignItems: 'center', gap: 11, cursor: 'pointer', padding: '8px 4px', borderRadius: 12 }}>
      <span style={{ width: 34, height: 34, borderRadius: 11, background: ac.grad, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, flex: 'none' }}>🎈</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: C.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.customer}</div>
        <div style={{ fontSize: 11.5, fontWeight: 600, color: C.muted }}>{label} · {e.emirate}</div>
        {themeOf(e) && (
          <div style={{ fontSize: 11, fontWeight: 700, color: C.pinkDeep, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>🎨 {themeOf(e)}</div>
        )}
      </div>
      <Badge tone={e.phase === 'Event Completed' ? 'neutral' : 'info'}>{e.phase}</Badge>
      <span style={{ color: C.muted, fontWeight: 800 }}>›</span>
    </div>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 12.5, fontWeight: 600, color: C.muted, padding: '10px 0' }}>{children}</div>
  );
}

const ago2 = (ts: string) => {
  const s = Math.max(1, Math.floor((Date.now() - new Date(ts).getTime()) / 1000));
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
};

/**
 * A staff member's own "latest updates", inline on Home: their preparation at
 * risk, low stock to flag, and the ratings customers left on their events.
 * Replaces the KPI tiles for employees/drivers so Home is their one screen.
 */
function StaffUpdates({ onOpenEvent }: { onOpenEvent: (id: string) => void }) {
  const [data, setData] = useState<any>(null);
  const [board, setBoard] = useState<any[] | null>(null);
  useEffect(() => {
    const load = () => api.alerts().then(setData).catch(() => setData({ prepAtRisk: [], lowStock: [], recentRatings: [] }));
    load();
    const now = new Date();
    const mth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    api.kpis(mth).then((k: any) => setBoard(k?.board ?? [])).catch(() => setBoard([]));
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, []);
  if (!data) return <Spinner />;
  const prep = data.prepAtRisk ?? [];
  const low = data.lowStock ?? [];
  const ratings = data.recentRatings ?? [];
  const RANK = ['🥇', '🥈', '🥉'];
  const rowS: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 10, padding: '9px 0', borderTop: `1px solid ${C.lineSoft}` };

  const nothing = prep.length === 0 && low.length === 0 && ratings.length === 0;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {prep.length > 0 && (
      <Panel title="🧰 Your preparation at risk">
        {prep.map((e: any) => (
          <div key={e.event_id} style={{ ...rowS, cursor: 'pointer' }} onClick={() => onOpenEvent(e.event_id)}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: C.red, flex: 'none' }} />
            <span style={{ fontWeight: 700, fontSize: 12.5, minWidth: 96 }}>{new Date(e.event_date).toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short' })}</span>
            <span style={{ fontSize: 12, fontWeight: 600, color: C.muted, flex: 1 }}>{e.customer} · {e.completed}/{e.total} done</span>
            <span style={{ fontSize: 11.5, fontWeight: 800, color: C.red }}>{e.progressPct}%</span>
          </div>
        ))}
      </Panel>
      )}

      {low.length > 0 && (
      <Panel title="🧴 Low stock — reorder soon">
        {low.map((c: any) => (
          <div key={c.id} style={rowS}>
            <span style={{ fontWeight: 700, fontSize: 12.5, flex: 1 }}>{c.name}</span>
            <span style={{ fontSize: 12, fontWeight: 700, color: c.on_hand === 0 ? C.red : '#c98a2b' }}>{c.on_hand} {c.unit} left</span>
          </div>
        ))}
      </Panel>
      )}

      {ratings.length > 0 && (
      <Panel title="⭐ Ratings on your events">
        {ratings.map((r: any) => (
          <div key={r.id} style={{ ...rowS, alignItems: 'flex-start', cursor: 'pointer' }} onClick={() => onOpenEvent(r.event_id)}>
            <span style={{ color: C.pinkDeep, fontSize: 13, letterSpacing: 1, minWidth: 72 }}>{'★'.repeat(r.stars)}<span style={{ color: C.line }}>{'★'.repeat(5 - r.stars)}</span></span>
            <span style={{ fontSize: 12, fontWeight: 600, color: C.ink, flex: 1, lineHeight: 1.4 }}>{r.feedback ? `“${r.feedback}”` : <span style={{ color: C.muted }}>{r.event_id}</span>}</span>
            <span style={{ fontSize: 10.5, fontWeight: 600, color: C.muted }}>{ago2(r.created_at)}</span>
          </div>
        ))}
      </Panel>
      )}

      {nothing && (
        <div style={{ background: C.greenSoft, color: C.green, borderRadius: 16, padding: '14px 18px', fontSize: 13, fontWeight: 700 }}>
          ☀️ Nothing needs your attention right now — you're all set! 🎉
        </div>
      )}

      {board && board.length > 0 && (
        <Panel title="🏆 Team competition">
          <div style={{ fontSize: 10.5, fontWeight: 700, color: C.muted, marginBottom: 8, lineHeight: 1.5, background: '#faf6f9', borderRadius: 8, padding: '7px 9px' }}>
            Points this month · <b style={{ color: C.pinkDeep }}>10</b> per completed event · <b style={{ color: C.pinkDeep }}>+20</b> per 5★ rating · <b style={{ color: C.pinkDeep }}>+1</b> per AED 10 in tips
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {[...board].sort((a: any, b: any) => b.points - a.points).map((s: any, i: number) => (
              <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '7px 2px' }}>
                <span style={{ fontSize: 15, width: 22, textAlign: 'center', flex: 'none' }}>{RANK[i] ?? i + 1}</span>
                <div style={{ width: 30, height: 30, borderRadius: '50%', background: s.color, color: '#fff', fontWeight: 700, fontSize: 12.5, display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}>{s.name[0]}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 13 }}>{s.name}</div>
                  <div style={{ fontSize: 10.5, fontWeight: 600, color: C.muted }}>{s.eventsDone} completed{s.fiveStars > 0 ? ` · ${s.fiveStars}×5★` : ''}{s.avgRating > 0 ? ` · ${s.avgRating}★` : ''}</div>
                </div>
                <span style={{ ...fredoka(15), color: C.pinkDeep }}>{s.points}</span>
              </div>
            ))}
          </div>
        </Panel>
      )}
    </div>
  );
}
