import { useEffect, useState } from 'react';
import { api } from '../api';
import { Badge, Button, C, fredoka, Panel, Spinner } from '../ui';
import { Empty } from './Today';

/**
 * Pre-Event Preparation & Task Management — INTERNAL ONLY.
 * Two lenses on the same auto-generated prep tasks: "By person" (each employee's
 * own work) and "By event" (preparation progress per event). The customer never
 * sees any of this.
 */

const STATUS_META: Record<string, { label: string; tone: 'ok' | 'warn' | 'error' | 'info' | 'neutral' }> = {
  not_started: { label: 'Not started', tone: 'neutral' },
  in_progress: { label: 'In progress', tone: 'info' },
  waiting_design: { label: 'Waiting for design', tone: 'warn' },
  ready: { label: 'Ready to prep', tone: 'info' },
  completed: { label: 'Completed', tone: 'ok' },
  issue: { label: 'Issue / missing', tone: 'error' },
};
const st = (s: string) => STATUS_META[s] ?? { label: s, tone: 'neutral' as const };
const fmtDue = (d: string) => (d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) : '—');

export function Tasks({ role }: { role?: string }) {
  const [openEvent, setOpenEvent] = useState<string | null>(null);
  const canSeeAll = role === 'owner' || role === 'manager';
  // Tabs by role: "By person" (whole-team board) is Manager+Owner only; an
  // employee gets their own "My tasks" instead. "By event" is for everyone.
  const tabs: [string, string][] = canSeeAll
    ? [['person', '👤 By person'], ['event', '🎉 By event']]
    : [['mine', '👤 My tasks'], ['event', '🎉 By event']];
  const [tab, setTab] = useState<string>(tabs[0][0]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', gap: 4, background: '#fff', border: `1px solid ${C.line}`, borderRadius: 12, padding: 4 }}>
        {tabs.map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)} style={{
            flex: 1, border: 'none', cursor: 'pointer', borderRadius: 9, padding: '9px 0', fontWeight: 700, fontSize: 12.5,
            background: tab === id ? C.pink : 'transparent', color: tab === id ? '#fff' : C.muted2,
          }}>{label}</button>
        ))}
      </div>

      {tab === 'mine' && <MyTasks />}
      {tab === 'person' && <ByPerson />}
      {tab === 'event' && <ByEvent onOpen={setOpenEvent} canManage={canSeeAll} />}

      {openEvent && <PrepEventDrawer eventId={openEvent} role={role} onClose={() => setOpenEvent(null)} />}
    </div>
  );
}

// ── An employee's own tasks only ─────────────────────────────────────────────
function MyTasks() {
  const [tasks, setTasks] = useState<any[] | null>(null);
  const load = () => api.prepMine().then(setTasks).catch(() => setTasks([]));
  useEffect(() => { load(); }, []);
  if (!tasks) return <Spinner />;
  const open = tasks.filter((t) => t.status !== 'completed');

  return (
    <Panel title="My preparation tasks" action={<Badge tone={open.length > 0 ? 'warn' : 'ok'}>{open.length} open</Badge>}>
      {tasks.length === 0 ? (
        <Empty>No tasks assigned to you right now 🎉</Empty>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {tasks.map((t) => (
            <div key={t.id} style={{ background: '#fff', border: `1px solid ${t.status === 'issue' ? '#f2c9c2' : C.line}`, borderRadius: 14, padding: '12px 14px' }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                <span style={{ fontSize: 13, fontWeight: 800, color: C.ink, flex: 1 }}>{t.category === 'design' ? '🖌️ ' : ''}{t.title}</span>
                <Badge tone={st(t.status).tone}>{st(t.status).label}</Badge>
              </div>
              <div style={{ fontSize: 10.5, fontWeight: 700, color: C.muted, margin: '4px 0 8px' }}>
                {t.customer} · {t.event_id} · due {fmtDue(t.due)}{t.people_needed > 1 ? ` · ${t.people_needed} people` : ''}
              </div>
              {Array.isArray(t.checklist) && t.checklist.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, margin: '4px 0 8px' }}>
                  {t.checklist.map((ci: any, i: number) => (
                    <label key={i} style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12, fontWeight: 600, color: ci.done ? C.muted : C.ink, cursor: 'pointer' }}>
                      <input type="checkbox" checked={!!ci.done} onChange={async (e) => { await api.prepToggleChecklist(String(t.id), i, e.target.checked); load(); }} />
                      <span style={{ textDecoration: ci.done ? 'line-through' : 'none' }}>{ci.label}</span>
                    </label>
                  ))}
                </div>
              )}
              {t.notes && <div style={{ fontSize: 11.5, fontWeight: 600, color: C.red, marginBottom: 6 }}>📝 {t.notes}</div>}
              {t.status === 'waiting_design' ? (
                <div style={{ fontSize: 11.5, fontWeight: 700, color: '#c98a2b' }}>⏳ Waiting for the design to be ready</div>
              ) : (
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <Button onClick={async () => { await api.prepComplete(String(t.id)); load(); }}>✓ Done</Button>
                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: 5, border: `1px solid ${C.pink}`, background: C.pinkSoft, color: C.pinkDeep, borderRadius: 10, padding: '7px 11px', fontWeight: 700, fontSize: 11.5, cursor: 'pointer' }}>
                    📷 Proof
                    <input type="file" accept="image/*" style={{ display: 'none' }} onChange={async (e) => { const f = e.target.files?.[0]; if (!f) return; try { const url = await api.uploadImage(f, 'setup-photos'); await api.prepComplete(String(t.id), url); load(); } catch (err: any) { alert(err?.message ?? 'Upload failed'); } }} />
                  </label>
                  <Button tone="ghost" onClick={async () => { const note = prompt('What is the issue / missing item?') ?? ''; if (note.trim()) { await api.prepSetStatus(String(t.id), 'issue', note.trim()); load(); } }}>⚠ Issue</Button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

// ── By person ────────────────────────────────────────────────────────────────
function ByPerson() {
  const [board, setBoard] = useState<any[] | null>(null);
  const load = () => api.prepBoard().then(setBoard).catch(() => setBoard([]));
  useEffect(() => { load(); }, []);
  if (!board) return <Spinner />;
  if (board.length === 0) return <Panel><Empty>No prep tasks yet — they’re generated when a booking is confirmed.</Empty></Panel>;

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16, alignItems: 'start' }}>
      {board.map((p) => (
        <Panel key={p.id} title={p.name}
          action={<Badge tone={p.open_count > 0 ? 'warn' : 'ok'}>{p.open_count} open</Badge>}>
          {p.tasks.length === 0 ? (
            <Empty>All clear 🎉</Empty>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {p.tasks.map((t: any) => (
                <div key={t.id} style={{ border: `1px solid ${C.lineSoft}`, borderRadius: 12, padding: '9px 11px' }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                    <span style={{ fontSize: 12.5, fontWeight: 700, color: C.ink, flex: 1 }}>
                      {t.category === 'design' ? '🖌️ ' : ''}{t.title}
                    </span>
                    <Badge tone={st(t.status).tone}>{st(t.status).label}</Badge>
                  </div>
                  <div style={{ fontSize: 10.5, fontWeight: 600, color: C.muted, marginTop: 3 }}>
                    {t.customer} · {t.eventId} · due {fmtDue(t.due)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Panel>
      ))}
    </div>
  );
}

// ── By event ─────────────────────────────────────────────────────────────────
function ByEvent({ onOpen, canManage }: { onOpen: (id: string) => void; canManage?: boolean }) {
  const [events, setEvents] = useState<any[] | null>(null);
  const [busy, setBusy] = useState(false);
  const load = () => api.prepEvents().then(setEvents).catch(() => setEvents([]));
  useEffect(() => { load(); }, []);
  if (!events) return <Spinner />;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {canManage && (
        <div>
          <Button tone="ghost" onClick={async () => { setBusy(true); try { const r = await api.prepGenerateAll(); alert(`Generated prep for ${r.events} event(s) — ${r.created} task(s).`); load(); } finally { setBusy(false); } }}>
            {busy ? 'Generating…' : '⚙ Generate prep for all upcoming events'}
          </Button>
        </div>
      )}
      {events.length === 0 ? (
        <Panel><Empty>No prep tasks yet. Tap “Generate” above, or confirm a booking.</Empty></Panel>
      ) : (
        events.map((e) => (
          <div key={e.event_id} onClick={() => onOpen(e.event_id)}
            style={{ background: '#fff', border: `1px solid ${e.atRisk ? '#f2c9c2' : C.line}`, borderRadius: 14, padding: '13px 15px', cursor: 'pointer' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
              <span style={{ ...fredoka(14), flex: 1 }}>{e.customer}</span>
              {e.atRisk && <Badge tone="error">At risk</Badge>}
              {e.issues > 0 && <Badge tone="error">{e.issues} issue{e.issues > 1 ? 's' : ''}</Badge>}
              <span style={{ fontWeight: 800, fontSize: 13, color: e.progressPct === 100 ? C.green : C.ink }}>{e.progressPct}%</span>
            </div>
            <div style={{ fontSize: 11, fontWeight: 600, color: C.muted, margin: '3px 0 8px' }}>
              {e.event_id} · {new Date(e.event_date).toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short' })} · {e.emirate}
              {e.waiting > 0 ? ` · ${e.waiting} waiting on design` : ''}
            </div>
            <div style={{ height: 8, borderRadius: 6, background: C.lineSoft, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${e.progressPct}%`, background: e.progressPct === 100 ? C.green : C.pink, transition: 'width .3s' }} />
            </div>
            <div style={{ fontSize: 10.5, fontWeight: 700, color: C.muted, marginTop: 5 }}>
              {e.completed} of {e.total} tasks completed{e.progressPct === 100 ? ' — ready! ✨' : ` — ${e.progressPct}% ready`}
            </div>
          </div>
        ))
      )}
    </div>
  );
}

// ── Per-event prep detail drawer ─────────────────────────────────────────────
function PrepEventDrawer({ eventId, role, onClose }: { eventId: string; role?: string; onClose: () => void }) {
  const [plan, setPlan] = useState<any>(null);
  const [crew, setCrew] = useState<any[]>([]);
  const [openAssign, setOpenAssign] = useState<string | null>(null);
  const [myId, setMyId] = useState<string | null>(null);
  const canManage = role === 'owner' || role === 'manager';
  // An employee can only act on tasks assigned to them; everything else is
  // view-only. Managers and the owner can act on anything.
  const canAct = (t: any) => canManage || (!!myId && (t.assignees ?? []).some((a: any) => String(a.id) === String(myId)));

  const load = () => api.prepPlan(eventId).then(setPlan).catch(() => setPlan({ tasks: [] }));
  useEffect(() => {
    load();
    api.me().then((m: any) => setMyId(m?.id ?? null)).catch(() => {});
    if (canManage) api.staffingCrew().then((c) => setCrew(c.filter((m: any) => ['Marsha', 'Dindo', 'Diana', 'Gloria', 'Jane'].includes(m.name)))).catch(() => {});
  }, [eventId]);

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(59,54,65,.4)', zIndex: 20, display: 'flex', justifyContent: 'flex-end' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: 'min(640px, 100vw)', background: C.bg, height: '100vh', overflowY: 'auto', padding: 18 }}>
        {!plan ? <Spinner /> : (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
              <div style={{ flex: 1 }}>
                <div style={fredoka(18)}>Preparation · {eventId}</div>
                <div style={{ fontSize: 12, fontWeight: 700, color: C.muted, marginTop: 2 }}>
                  {plan.completed} of {plan.total} done · {plan.progressPct}% ready{plan.issues > 0 ? ` · ${plan.issues} issue(s)` : ''}
                </div>
              </div>
              <Button tone="ghost" onClick={async () => { await api.prepGenerate(eventId); load(); }}>Re-generate</Button>
              <Button tone="ghost" onClick={onClose}>Close</Button>
            </div>

            <div style={{ height: 8, borderRadius: 6, background: C.lineSoft, overflow: 'hidden', marginBottom: 16 }}>
              <div style={{ height: '100%', width: `${plan.progressPct}%`, background: plan.progressPct === 100 ? C.green : C.pink }} />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {plan.tasks.length === 0 && <Empty>No prep tasks for this event.</Empty>}
              {plan.tasks.map((t: any) => (
                <div key={t.id} style={{ background: '#fff', border: `1px solid ${t.status === 'issue' ? '#f2c9c2' : C.line}`, borderRadius: 14, padding: '12px 14px' }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                    <span style={{ fontSize: 13, fontWeight: 800, color: C.ink, flex: 1 }}>
                      {t.category === 'design' ? '🖌️ ' : ''}{t.title}
                    </span>
                    <Badge tone={st(t.status).tone}>{st(t.status).label}</Badge>
                  </div>
                  <div style={{ fontSize: 10.5, fontWeight: 700, color: C.muted, margin: '4px 0 8px' }}>
                    {(t.assignees ?? []).length ? (t.assignees.map((a: any) => a.name).join(' + ')) : '⚠ Unassigned'}
                    {t.people_needed > 1 ? ` · needs ${t.people_needed}` : ''} · due {fmtDue(t.due)}
                  </div>

                  {Array.isArray(t.checklist) && t.checklist.length > 0 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, margin: '4px 0 8px' }}>
                      {t.checklist.map((ci: any, i: number) => (
                        <label key={i} style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12, fontWeight: 600, color: ci.done ? C.muted : C.ink, cursor: canAct(t) ? 'pointer' : 'default' }}>
                          <input type="checkbox" checked={!!ci.done} disabled={!canAct(t)} onChange={async (e) => { await api.prepToggleChecklist(t.id, i, e.target.checked); load(); }} />
                          <span style={{ textDecoration: ci.done ? 'line-through' : 'none' }}>{ci.label}</span>
                        </label>
                      ))}
                    </div>
                  )}

                  {t.notes && <div style={{ fontSize: 11.5, fontWeight: 600, color: C.red, marginBottom: 6 }}>📝 {t.notes}</div>}
                  {t.completed_by && (
                    <div style={{ fontSize: 10.5, fontWeight: 700, color: C.green, marginBottom: 6 }}>
                      ✓ by {t.completed_by}{t.completed_at ? ` · ${new Date(t.completed_at).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}` : ''}
                    </div>
                  )}
                  {t.photo_url && (
                    <a href={t.photo_url} target="_blank" rel="noreferrer"><img src={t.photo_url} alt="proof" style={{ maxWidth: 120, borderRadius: 10, border: `1px solid ${C.line}`, marginBottom: 6 }} /></a>
                  )}

                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                    {!canAct(t) ? (
                      <span style={{ fontSize: 11, fontWeight: 700, color: C.muted }}>👁 View only — not assigned to you</span>
                    ) : t.status !== 'completed' ? (
                      <>
                        <Button onClick={async () => { await api.prepComplete(t.id); load(); }}>✓ Done</Button>
                        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 5, border: `1px solid ${C.pink}`, background: C.pinkSoft, color: C.pinkDeep, borderRadius: 10, padding: '7px 11px', fontWeight: 700, fontSize: 11.5, cursor: 'pointer' }}>
                          📷 Proof
                          <input type="file" accept="image/*" style={{ display: 'none' }} onChange={async (e) => {
                            const f = e.target.files?.[0]; if (!f) return;
                            try { const url = await api.uploadImage(f, 'setup-photos'); await api.prepComplete(t.id, url); load(); } catch (err: any) { alert(err?.message ?? 'Upload failed'); }
                          }} />
                        </label>
                        {t.status !== 'in_progress' && t.status !== 'waiting_design' && (
                          <Button tone="ghost" onClick={async () => { await api.prepSetStatus(t.id, 'in_progress'); load(); }}>Start</Button>
                        )}
                        <Button tone="ghost" onClick={async () => { const note = prompt('What is the issue / missing item?') ?? ''; if (note.trim()) { await api.prepSetStatus(t.id, 'issue', note.trim()); load(); } }}>⚠ Issue</Button>
                      </>
                    ) : (
                      <Button tone="ghost" onClick={async () => { await api.prepSetStatus(t.id, 'not_started'); load(); }}>↺ Reopen</Button>
                    )}
                    {canManage && (
                      <button onClick={() => setOpenAssign(openAssign === t.id ? null : t.id)}
                        style={{ background: 'none', border: 'none', color: C.muted, fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
                        ✎ Reassign
                      </button>
                    )}
                  </div>

                  {canManage && openAssign === t.id && (
                    <div style={{ marginTop: 8, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {crew.map((m) => {
                        const on = (t.assignees ?? []).some((a: any) => a.id === m.id);
                        return (
                          <Button key={m.id} tone={on ? 'primary' : 'ghost'}
                            onClick={async () => {
                              const ids = new Set<string>((t.assignees ?? []).map((a: any) => String(a.id)));
                              if (on) ids.delete(m.id); else ids.add(m.id);
                              await api.prepSetAssignees(t.id, [...ids]); load();
                            }}>{m.name}</Button>
                        );
                      })}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
