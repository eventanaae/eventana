import { useEffect, useState } from 'react';
import { to12h, timeRange12h } from '@eventana/shared';
import type { View } from '../App';
import { api } from '../api';
import { ACCENTS, Badge, Button, C, fredoka, Panel, QuickAction, SectionHeader, Spinner } from '../ui';

/**
 * The operational home — a warm, lively landing that answers, at a glance:
 * how's the day, what needs me now, what's next, and where do I jump. Greeting
 * hero → quick actions → vibrant stats → next event → attention → today &
 * upcoming. Mobile-first and vertical.
 */
export function Today({ onOpenEvent, onOpenShop, onGoto, staffName, role }: { onOpenEvent: (id: string) => void; onOpenShop?: (id: string) => void; onGoto: (v: View) => void; staffName?: string; role?: string }) {
  const [data, setData] = useState<any>(null);
  const [brief, setBrief] = useState<{ birthdays: string[]; offToday: string[]; alerts: Array<{ level: string; icon: string; text: string }> } | null>(null);

  const load = () => api.today().then(setData);
  useEffect(() => {
    load();
    const timer = setInterval(load, 30_000);
    return () => clearInterval(timer);
  }, []);
  // Morning brief (owner/manager only) — birthdays, who's off, what needs attention.
  const canBrief = role === 'owner' || role === 'manager';
  useEffect(() => { if (canBrief) api.morningBrief().then(setBrief).catch(() => setBrief(null)); }, [canBrief]);

  const todayStr = new Date().toISOString().slice(0, 10);

  if (!data) return <Spinner />;

  const k = data.kpis;
  const events: any[] = [...(data.events ?? [])].sort((a, b) =>
    `${String(a.event_date).slice(0, 10)} ${a.start_time}`.localeCompare(`${String(b.event_date).slice(0, 10)} ${b.start_time}`),
  );
  const isToday = (e: any) => String(e.event_date).slice(0, 10) === todayStr;
  const todays = events.filter(isToday);
  const upcoming = events.filter((e) => !isToday(e)).slice(0, 6);
  const next = events[0];
  // Every event that falls on the same day as the next one — so a day with two
  // parties shows both in the Next-event card, not just the first.
  const nextDay = next ? String(next.event_date).slice(0, 10) : null;
  const nextDayEvents = nextDay ? events.filter((e) => String(e.event_date).slice(0, 10) === nextDay) : [];

  const lowStock = (data.criticalInventory ?? []).filter((a: any) => a.status !== 'available' || a.committed > 0);
  const attention: Array<{ label: string; n: number; onClick: () => void }> = [
    { label: 'Open tasks', n: k.openTasks, onClick: () => onGoto('tasks') },
    { label: 'Needs review', n: k.needsReview, onClick: () => onGoto('schedule') },
    { label: 'Design approvals', n: (data.pendingDesignApprovals ?? []).length, onClick: () => onGoto('schedule') },
    { label: 'Assets in demand', n: lowStock.length, onClick: () => onGoto('inventory') },
  ].filter((a) => a.n > 0);

  const when = (e: any) =>
    isToday(e)
      ? `Today · ${to12h(e.start_time)}`
      : `${new Date(e.event_date).toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short' })} · ${to12h(e.start_time)}`;

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

      {/* ☀️ Your morning brief — birthdays, who's off, and what needs attention */}
      {canBrief && brief && (brief.birthdays.length > 0 || brief.offToday.length > 0 || brief.alerts.length > 0) && (
        <div style={{ background: '#fff', border: `1px solid ${C.line}`, borderRadius: 20, boxShadow: C.shadow, overflow: 'hidden' }}>
          <div style={{ height: 5, background: `linear-gradient(90deg,${C.pinkDeep},${C.pink})` }} />
          <div style={{ padding: '14px 18px' }}>
            <div style={{ ...fredoka(15), marginBottom: 10 }}>☀️ Your morning brief</div>
            {brief.birthdays.length > 0 && (
              <div style={{ background: C.pinkSoft, color: C.pinkDeep, borderRadius: 12, padding: '10px 13px', fontSize: 12.5, fontWeight: 700, marginBottom: 8 }}>
                🎂 Birthday today: {brief.birthdays.join(', ')} — wish them a happy birthday!
              </div>
            )}
            {brief.offToday.length > 0 && (
              <div style={{ background: C.greenSoft, color: C.ink, borderRadius: 12, padding: '10px 13px', fontSize: 12.5, fontWeight: 700, marginBottom: 8 }}>
                🌴 Off today: {brief.offToday.join(', ')}
              </div>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
              {brief.alerts.map((a, i) => (
                <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'center', background: a.level === 'high' ? C.redSoft : C.greenSoft, borderRadius: 12, padding: '9px 12px' }}>
                  <span style={{ fontSize: 15, flex: 'none' }}>{a.icon}</span>
                  <span style={{ flex: 1, fontSize: 12.5, fontWeight: 600, color: C.ink, lineHeight: 1.45 }}>{a.text}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

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
              <div style={{ ...fredoka(21), marginTop: 8 }}>{eventTitle(todays[0])}</div>
              {todays[0].eventFor && <div style={{ fontSize: 12, fontWeight: 600, color: '#a07d8f' }}>by {todays[0].customer}</div>}
              <div style={{ fontSize: 12.5, fontWeight: 700, color: '#8b6c7a', marginTop: 3 }}>Today · {timeRange12h(todays[0].start_time, todays[0].base_end_time)} · {todays[0].emirate}</div>
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

      {/* Staff (employee/driver) get their own "latest updates" inline — prep at
          risk, low stock and the ratings on their events. Owner/manager Home stays
          clean (the KPI tiles were removed on request). */}
      {(role === 'employee' || role === 'driver') && (
        <StaffUpdates onOpenEvent={onOpenEvent} />
      )}

      {/* Next event — shown only when nothing is on today (today is up top).
          Every event that day gets its own pink card (a day can have two). */}
      {next && !isToday(next) && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="rise-in lift" style={{ ['--i' as any]: 2, background: '#fff', border: `1px solid ${C.line}`, borderRadius: 22, padding: 4, boxShadow: C.shadow, cursor: 'pointer' }} onClick={() => onOpenEvent(nextDayEvents[0].id)}>
            <div style={{ borderRadius: 18, background: 'linear-gradient(135deg,#FFF0F7,#FDE7F0)', padding: '16px 18px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: C.pink, animation: 'pulse 1.8s infinite', boxShadow: '0 0 0 4px rgba(240,108,168,.18)' }} />
                <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '.8px', color: C.pinkDeep }}>NEXT EVENT</div>
              </div>
              <div style={{ ...fredoka(21), marginTop: 8 }}>{eventTitle(nextDayEvents[0])}</div>
              {nextDayEvents[0].eventFor && <div style={{ fontSize: 12, fontWeight: 600, color: '#a07d8f' }}>by {nextDayEvents[0].customer}</div>}
              <div style={{ fontSize: 12.5, fontWeight: 700, color: '#8b6c7a', marginTop: 3 }}>{when(nextDayEvents[0])}–{to12h(nextDayEvents[0].base_end_time)} · {nextDayEvents[0].emirate}</div>
              {themeOf(nextDayEvents[0]) && (
                <div style={{ fontSize: 12, fontWeight: 800, color: C.pinkDeep, marginTop: 4 }}>🎨 {themeOf(nextDayEvents[0])}</div>
              )}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 13 }}>
                <Badge tone={nextDayEvents[0].phase === 'Event Completed' ? 'neutral' : 'info'}>{nextDayEvents[0].phase}</Badge>
                <div style={{ flex: 1 }} />
                <Button onClick={() => onOpenEvent(nextDayEvents[0].id)}>Open job →</Button>
              </div>
            </div>
          </div>
          {nextDayEvents.length > 1 && (
            <Panel title={`Also that day · ${nextDayEvents.length - 1} more`}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {nextDayEvents.slice(1).map((e, idx) => <EventRow key={e.id} e={e} label={when(e)} accentIdx={idx + 1} onOpen={() => onOpenEvent(e.id)} />)}
              </div>
            </Panel>
          )}
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

      {/* Manager/owner: staffing that needs action + day-off requests, right on Home. */}
      {(role === 'owner' || role === 'manager') && <ManagerHomeAlerts onOpenEvent={onOpenEvent} />}

      {/* Upcoming — events + shop orders interleaved, sorted by date. */}
      {(() => {
        const totalUpcoming = events.filter((e) => !isToday(e)).length;
        const evItems = upcoming.map((e) => ({ shop: false, id: e.id, sortDate: String(e.event_date).slice(0, 10), e }));
        const shopItems = (data.shopOrders ?? []).map((o: any) => ({ shop: true, id: o.id, sortDate: String(o.readyBy ?? ''), o }));
        const combined = [...evItems, ...shopItems].sort((a, b) => a.sortDate.localeCompare(b.sortDate)).slice(0, 5);
        if (combined.length === 0) return null;
        return (
          <Panel className="rise-in" style={{ ['--i' as any]: 5 } as any} title={`Upcoming · ${totalUpcoming} event${totalUpcoming === 1 ? '' : 's'}`}
            action={<span onClick={() => onGoto('schedule')} className="tap" style={{ fontSize: 12, fontWeight: 800, color: C.pinkDeep, cursor: 'pointer' }}>See all ›</span>}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {combined.map((it, idx) => it.shop
                ? <ShopRow key={`s-${it.id}`} o={(it as any).o} onOpen={() => onOpenShop?.(it.id)} />
                : <EventRow key={it.id} e={(it as any).e} label={when((it as any).e)} accentIdx={idx} onOpen={() => onOpenEvent(it.id)} />)}
            </div>
          </Panel>
        );
      })()}

      {/* Achievements / points competition — always the last thing on Home. */}
      <CompetitionBoard />

      {/* What customers say about our events — the latest feedback wall. */}
      <CustomerVoices onGoto={onGoto} onOpenEvent={onOpenEvent} />
    </div>
  );
}

/**
 * A warm wall of the latest things customers said about our events — the last 5,
 * with a "Show more" that opens the full feedback page. Motivating for the whole
 * team; visible to everyone, no money.
 */
function CustomerVoices({ onGoto, onOpenEvent }: { onGoto: (v: View) => void; onOpenEvent: (id: string) => void }) {
  const [rows, setRows] = useState<any[] | null>(null);
  useEffect(() => { api.customerFeedback(5).then((r) => setRows(r.rows)).catch(() => setRows([])); }, []);
  if (!rows || rows.length === 0) return null;
  return (
    <Panel title="💬 What customers say about our events">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {rows.map((r) => <FeedbackCard key={r.id} r={r} onOpen={() => onOpenEvent(r.event_id)} />)}
      </div>
      <button
        onClick={() => onGoto('feedback')}
        style={{ marginTop: 12, width: '100%', cursor: 'pointer', border: `1px solid ${C.line}`, background: '#fff', borderRadius: 12, padding: '10px', fontSize: 12.5, fontWeight: 800, color: C.pinkDeep }}
      >
        Show more feedback →
      </button>
    </Panel>
  );
}

/** One customer feedback bubble: stars, the words, and who/which event. */
export function FeedbackCard({ r, onOpen }: { r: any; onOpen?: () => void }) {
  return (
    <div onClick={onOpen} style={{ cursor: onOpen ? 'pointer' : 'default', background: 'linear-gradient(135deg,#FFF6FB,#FFF0F7)', border: `1px solid ${C.lineSoft}`, borderRadius: 14, padding: '12px 14px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5 }}>
        <span style={{ color: C.pinkDeep, fontSize: 13, letterSpacing: 1 }}>{'★'.repeat(r.stars)}<span style={{ color: C.line }}>{'★'.repeat(Math.max(0, 5 - r.stars))}</span></span>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 10.5, fontWeight: 700, color: C.muted }}>{r.date}</span>
      </div>
      <div style={{ fontSize: 13, fontWeight: 600, color: C.ink, lineHeight: 1.5 }}>“{r.feedback}”</div>
      <div style={{ fontSize: 11, fontWeight: 700, color: C.pinkDeep, marginTop: 6 }}>
        — {r.event_for ? `${r.event_for}'s party` : r.customer}{r.customer && r.event_for ? ` · ${r.customer}` : ''}
      </div>
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

/** The theme label for an event row — the real name, custom or catalogue. */
function themeOf(e: any): string | null {
  if (e.theme_name) return String(e.theme_name);
  if (e.custom_theme) return 'Custom theme';
  return null;
}

/** Prettify a celebration type id ("kids") into a label ("Birthday"). */
export function celebrationName(type?: string): string {
  const map: Record<string, string> = { kids: 'Birthday', adult: 'Birthday', baby_shower: 'Baby Shower', gender_reveal: 'Gender Reveal', graduation: 'Graduation', anniversary: 'Anniversary', corporate: 'Event', wedding: 'Wedding' };
  if (!type) return 'Celebration';
  return map[type] || String(type).replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/** The headline for an event card: "Dana's Birthday" — guest of honour + type. */
export function eventTitle(e: any): string {
  const t = celebrationName(e.celebration_type);
  return e.eventFor ? `${e.eventFor}'s ${t}` : (e.customer || t);
}

function EventRow({ e, label, onOpen, accentIdx = 0 }: { e: any; label: string; onOpen: () => void; accentIdx?: number }) {
  const ac = ACCENTS[accentIdx % ACCENTS.length];
  return (
    <div onClick={onOpen} className="tap" style={{ display: 'flex', alignItems: 'center', gap: 11, cursor: 'pointer', padding: '8px 4px', borderRadius: 12 }}>
      <span style={{ width: 34, height: 34, borderRadius: 11, background: ac.grad, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, flex: 'none' }}>🎈</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: C.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{eventTitle(e)}</div>
        {e.eventFor && <div style={{ fontSize: 11, fontWeight: 600, color: C.muted2 }}>by {e.customer}</div>}
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
  useEffect(() => {
    const load = () => api.alerts().then(setData).catch(() => setData({ prepAtRisk: [], lowStock: [], recentRatings: [] }));
    load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, []);
  if (!data) return <Spinner />;
  const prep = data.prepAtRisk ?? [];
  const low = data.lowStock ?? [];
  const ratings = data.recentRatings ?? [];
  const rowS: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 10, padding: '9px 0', borderTop: `1px solid ${C.lineSoft}` };

  const nothing = prep.length === 0 && low.length === 0 && ratings.length === 0;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <OffTodayPanel list={data.offToday ?? []} />
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
    </div>
  );
}

/**
 * Manager/owner Home panels: events that still need staffing, and pending
 * day-off requests they can approve or deny — surfaced right on Home so the
 * "Updates" screen isn't needed. Each panel hides itself when it's empty.
 */
/** Who's off today — shown on everyone's Home so the whole team knows. */
export function OffTodayPanel({ list }: { list: any[] }) {
  if (!list || list.length === 0) return null;
  return (
    <Panel title="🌴 Off today">
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {list.map((d) => (
          <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#faf6f9', border: `1px solid ${C.line}`, borderRadius: 20, padding: '6px 12px' }}>
            <div style={{ width: 24, height: 24, borderRadius: '50%', background: d.color || C.pink, color: '#fff', fontWeight: 700, fontSize: 11, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{String(d.member_name || '?')[0]}</div>
            <span style={{ fontSize: 12.5, fontWeight: 700, color: C.ink }}>{d.member_name}</span>
            {d.reason && <span style={{ fontSize: 10.5, fontWeight: 600, color: C.muted }}>· {d.reason}</span>}
          </div>
        ))}
      </div>
    </Panel>
  );
}

function ManagerHomeAlerts({ onOpenEvent }: { onOpenEvent: (id: string) => void }) {
  const [data, setData] = useState<any>(null);
  const load = () => api.alerts().then(setData).catch(() => setData(null));
  useEffect(() => { load(); const t = setInterval(load, 30_000); return () => clearInterval(t); }, []);
  if (!data || data.scoped) return null;
  const gaps = data.staffingGaps ?? [];
  const leave = data.pendingLeave ?? [];
  const rowS: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 10, padding: '9px 0', borderTop: `1px solid ${C.lineSoft}` };
  return (
    <>
      <OffTodayPanel list={data.offToday ?? []} />
      {gaps.length > 0 && (
        <Panel title="🎭 Staffing — action required">
          {gaps.map((s: any) => (
            <div key={s.event_id} style={{ ...rowS, cursor: 'pointer' }} onClick={() => onOpenEvent(s.event_id)}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: C.red, flex: 'none' }} />
              <span style={{ fontWeight: 700, fontSize: 12.5, minWidth: 96 }}>{new Date(s.event_date).toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short' })}</span>
              <span style={{ fontSize: 12, fontWeight: 600, color: C.muted, flex: 1 }}>{s.emirate} · {to12h(s.start_time)} · {(s.roles ?? []).join(', ').replace(/_/g, ' ')}</span>
              <span style={{ fontSize: 11.5, fontWeight: 800, color: C.red }}>{s.open} to confirm</span>
            </div>
          ))}
        </Panel>
      )}
      {leave.length > 0 && (
        <Panel title="🌴 Day OFF requests">
          {leave.map((d: any) => (
            <div key={d.id} style={rowS}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: d.color || C.pink, flex: 'none' }} />
              <span style={{ fontWeight: 700, fontSize: 12.5, minWidth: 96 }}>{d.member_name}</span>
              <span style={{ fontSize: 12, fontWeight: 600, color: C.muted, flex: 1 }}>
                {new Date(d.start_date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}
                {String(d.end_date).slice(0, 10) !== String(d.start_date).slice(0, 10) && ` → ${new Date(d.end_date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}`}
                {d.reason ? ` · ${d.reason}` : ''}
              </span>
              <button onClick={async () => { await api.setDayOffStatus(d.id, 'approved'); load(); }} style={{ border: `1px solid ${C.line}`, background: '#fff', borderRadius: 8, padding: '5px 9px', fontSize: 11, fontWeight: 700, cursor: 'pointer', color: C.green, flex: 'none' }}>Approve</button>
              <button onClick={async () => { await api.setDayOffStatus(d.id, 'denied'); load(); }} style={{ border: `1px solid ${C.line}`, background: '#fff', borderRadius: 8, padding: '5px 9px', fontSize: 11, fontWeight: 700, cursor: 'pointer', color: C.red, flex: 'none' }}>Deny</button>
            </div>
          ))}
        </Panel>
      )}
    </>
  );
}

/**
 * The month's points competition — every teammate ranked by points, with a
 * legend explaining how points are earned. Self-fetching so it can sit at the
 * bottom of Home for everyone (owner, manager, employee, driver).
 */
function CompetitionBoard() {
  const [board, setBoard] = useState<any[] | null>(null);
  const [showHelp, setShowHelp] = useState(false);
  useEffect(() => {
    const now = new Date();
    const mth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    api.kpis(mth).then((k: any) => setBoard(k?.board ?? [])).catch(() => setBoard([]));
  }, []);
  if (!board || board.length === 0) return null;
  const ranked = [...board].sort((a: any, b: any) => b.points - a.points);
  return (
    <Panel title="🏆 Team competition">
      {/* Rankings — always shown, no collapse. */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {ranked.map((s: any, i: number) => (
          <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '7px 2px' }}>
            <span style={{ fontSize: 15, width: 22, textAlign: 'center', flex: 'none', fontWeight: 800, color: C.muted }}>{i === 0 ? '🥇' : i + 1}</span>
            <div style={{ width: 30, height: 30, borderRadius: '50%', background: s.color, color: '#fff', fontWeight: 700, fontSize: 12.5, display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}>{s.name[0]}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 13 }}>{s.name}</div>
              <div style={{ fontSize: 10.5, fontWeight: 600, color: C.muted }}>{s.eventsDone} completed{s.fiveStars > 0 ? ` · ${s.fiveStars}×5★` : ''}{s.avgRating > 0 ? ` · ${s.avgRating}★` : ''}</div>
            </div>
            <span style={{ ...fredoka(15), color: C.pinkDeep }}>{s.points}</span>
          </div>
        ))}
      </div>

      {/* How points & rewards work — a tappable breakdown, kept at the bottom. */}
      <button
        onClick={() => setShowHelp((s) => !s)}
        style={{ width: '100%', textAlign: 'left', cursor: 'pointer', border: `1px solid ${C.line}`, background: showHelp ? '#fff' : '#faf6f9', borderRadius: 10, padding: '9px 11px', marginTop: 12, display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, fontWeight: 800, color: C.pinkDeep }}
      >
        <span>ℹ️ How points &amp; rewards work</span>
        <span style={{ flex: 1 }} />
        <span style={{ transform: showHelp ? 'rotate(180deg)' : 'none', transition: 'transform .2s', color: C.muted }}>⌄</span>
      </button>
      {showHelp && <div style={{ marginTop: 8 }}><PointsHelp /></div>}
    </Panel>
  );
}

/** A plain-language breakdown of how competition points and real rewards work. */
function PointsHelp() {
  const line: React.CSSProperties = { display: 'flex', gap: 9, alignItems: 'flex-start', fontSize: 12, fontWeight: 600, color: C.ink, lineHeight: 1.45, padding: '4px 0' };
  const emo: React.CSSProperties = { fontSize: 14, width: 18, flex: 'none', textAlign: 'center' };
  const head: React.CSSProperties = { fontSize: 11, fontWeight: 800, letterSpacing: '.4px', textTransform: 'uppercase', color: C.pinkDeep, margin: '4px 0 2px' };
  const b = (t: string) => <b style={{ color: C.pinkDeep }}>{t}</b>;
  return (
    <div style={{ background: '#faf6f9', border: `1px solid ${C.line}`, borderRadius: 12, padding: '12px 14px', marginBottom: 12 }}>
      <div style={head}>🏆 How you earn points</div>
      <div style={line}><span style={emo}>🎈</span><span>{b('10 points')} for every event you complete.</span></div>
      <div style={line}><span style={emo}>⭐</span><span>{b('+20 points')} each time a customer rates your event 5★.</span></div>
      <div style={line}><span style={emo}>💅</span><span>{b('+20 points')} for every Glam Doll you perform.</span></div>
      <div style={line}><span style={emo}>🎟️</span><span>Bring in an event with your code and earn on its value — {b('every AED 2 = 1 point')} (so an AED 4,000 event ≈ 2,000 points).</span></div>

      <div style={{ ...head, marginTop: 10 }}>🎯 Your target &amp; reward</div>
      <div style={line}><span style={emo}>🎯</span><span>Your monthly target is {b('600 points')} — reach this first.</span></div>
      <div style={line}><span style={emo}>💰</span><span>{b('After')} you hit 600, every {b('100 points')} = {b('AED 10')} — see the amount in your {b('Profile')}.</span></div>
      <div style={line}><span style={emo}>🚀</span><span>{b('Why it matters:')} the target is set from how the company needs to perform — when you reach it, Eventana is hitting its goals too.</span></div>
      <div style={line}><span style={emo}>🙌</span><span>{b('Tips are 100% yours')} — always on top.</span></div>
      <div style={line}><span style={emo}>⚠️</span><span>A {b('warning')} clears that month’s points.</span></div>
      <div style={{ fontSize: 10.5, fontWeight: 600, color: C.muted, marginTop: 8, lineHeight: 1.5 }}>
        All of this is tied to your performance, attendance and productivity.
      </div>
    </div>
  );
}
