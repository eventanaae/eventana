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

/**
 * What the team should read on a prep task: the party itself — its date, who it's
 * for, the celebration type and the theme — plus the booking reference (EV-<number>),
 * NOT the internal event id or the customer's name.
 */
const partyLine = (t: any): string =>
  [t.eventDate ? fmtDue(t.eventDate) : null, t.babyName, t.celebrationType, t.theme, t.reference]
    .filter(Boolean)
    .join(' · ');

export function Tasks({ role }: { role?: string }) {
  const [openEvent, setOpenEvent] = useState<string | null>(null);
  const canSeeAll = role === 'owner' || role === 'manager';
  // Tabs by role: "By person" (whole-team board) is Manager+Owner only; an
  // employee gets their own "My tasks" instead. "By event" is for everyone.
  const tabs: [string, string][] = canSeeAll
    ? [['person', '👤 By person'], ['mine', '📋 My tasks'], ['event', '🎉 By event']]
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

// One row in the employee's own task list (checklist + Done / Proof / Issue).
function MyTaskRow({ t, onAction }: { t: any; onAction: () => void }) {
  return (
    <div style={{ background: '#fff', border: `1px solid ${t.status === 'issue' ? '#f2c9c2' : C.line}`, borderRadius: 14, padding: '12px 14px' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <span style={{ fontSize: 13, fontWeight: 800, color: C.ink, flex: 1 }}>{t.category === 'design' ? '🖌️ ' : t.category === 'manual' ? '📌 ' : ''}{t.title}</span>
        <Badge tone={st(t.status).tone}>{st(t.status).label}</Badge>
      </div>
      <div style={{ fontSize: 10.5, fontWeight: 700, color: C.muted, margin: '4px 0 8px' }}>
        {partyLine(t)} · due {fmtDue(t.due)}{t.people_needed > 1 ? ` · ${t.people_needed} people` : ''}
      </div>
      {Array.isArray(t.checklist) && t.checklist.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, margin: '4px 0 8px' }}>
          {t.checklist.map((ci: any, i: number) => (
            <label key={i} style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12, fontWeight: 600, color: ci.done ? C.muted : C.ink, cursor: 'pointer' }}>
              <input type="checkbox" checked={!!ci.done} onChange={async (e) => { await api.prepToggleChecklist(String(t.id), i, e.target.checked); onAction(); }} />
              <span style={{ textDecoration: ci.done ? 'line-through' : 'none' }}>{ci.label}</span>
            </label>
          ))}
        </div>
      )}
      {t.notes && <div style={{ fontSize: 11.5, fontWeight: 600, color: C.red, marginBottom: 6 }}>📝 {t.notes}</div>}
      {t.status === 'waiting_design' && (
        <div style={{ fontSize: 11.5, fontWeight: 700, color: '#c98a2b', marginBottom: 7 }}>⏳ Waiting for the design — you can still mark it done once it's ready</div>
      )}
      {t.status === 'completed' ? (
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <span style={{ fontSize: 11, fontWeight: 800, color: C.green }}>✓ Done</span>
          <Button tone="ghost" onClick={async () => { await api.prepSetStatus(String(t.id), 'not_started'); onAction(); }} style={{ padding: '5px 10px', fontSize: 11 }}>↺ Reopen</Button>
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <Button onClick={async () => { await api.prepComplete(String(t.id)); onAction(); }}>✓ Done</Button>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 5, border: `1px solid ${C.pink}`, background: C.pinkSoft, color: C.pinkDeep, borderRadius: 10, padding: '7px 11px', fontWeight: 700, fontSize: 11.5, cursor: 'pointer' }}>
            📷 Proof
            <input type="file" accept="image/*" style={{ display: 'none' }} onChange={async (e) => { const f = e.target.files?.[0]; if (!f) return; try { const url = await api.uploadImage(f, 'setup-photos'); await api.prepComplete(String(t.id), url); onAction(); } catch (err: any) { alert(err?.message ?? 'Upload failed'); } }} />
          </label>
          <Button tone="ghost" onClick={async () => { const note = prompt('What is the issue / missing item?') ?? ''; if (note.trim()) { await api.prepSetStatus(String(t.id), 'issue', note.trim()); onAction(); } }}>⚠ Issue</Button>
        </div>
      )}
    </div>
  );
}

// ── An employee's own tasks only ─────────────────────────────────────────────
function MyTasks() {
  const [tasks, setTasks] = useState<any[] | null>(null);
  const [items, setItems] = useState<any[]>([]);
  const [myId, setMyId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const load = () => {
    api.prepMine().then(setTasks).catch(() => setTasks([]));
    api.missingItems().then(setItems).catch(() => setItems([]));
    api.me().then((m: any) => setMyId(m?.id ?? null)).catch(() => {});
  };
  useEffect(() => { load(); }, []);
  if (!tasks) return <Spinner />;

  const manual = tasks.filter((t) => t.category === 'manual');
  const eventTasks = tasks.filter((t) => t.category !== 'manual');
  const manualDone = manual.filter((t) => t.status === 'completed').length;
  const pct = manual.length > 0 ? Math.round((manualDone / manual.length) * 100) : 0;
  const openCount = tasks.filter((t) => t.status !== 'completed').length;

  // 🛒 The missing items assigned to me, still to buy — grouped by emirate/location.
  const shopping = items.filter((m) => String(m.assigned_to ?? '') === String(myId) && m.status !== 'received' && m.status !== 'cancelled');
  const shopGroups = new Map<string, any[]>();
  for (const m of shopping) { const k = (m.location ?? '').trim() || 'No location set'; (shopGroups.get(k) ?? shopGroups.set(k, []).get(k)!).push(m); }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* 📌 Tasks assigned to me by the owner/manager */}
      {manual.length > 0 && (
        <Panel title="📌 Assigned to me" action={<Badge tone={pct === 100 ? 'ok' : 'warn'}>{manualDone}/{manual.length} · {pct}%</Badge>}>
          <div style={{ height: 7, borderRadius: 5, background: C.lineSoft, overflow: 'hidden', marginBottom: 12 }}>
            <div style={{ height: '100%', width: `${pct}%`, background: pct === 100 ? C.green : C.pink, transition: 'width .3s' }} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {manual.map((t) => <MyTaskRow key={t.id} t={t} onAction={load} />)}
          </div>
        </Panel>
      )}

      {/* 🛒 Shopping — the missing items assigned to me, grouped by emirate */}
      {shopping.length > 0 && (
        <Panel title="🛒 Shopping" action={<Badge tone="warn">{shopping.length} to buy</Badge>}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {[...shopGroups.entries()].map(([loc, list]) => (
              <div key={loc}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 7, margin: '0 2px 8px' }}>
                  <span style={{ fontSize: 14 }}>📍</span>
                  <span style={{ ...fredoka(14) }}>{loc}</span>
                  <span style={{ marginLeft: 'auto', fontSize: 11, fontWeight: 700, color: C.muted2, background: C.lineSoft, padding: '2px 9px', borderRadius: 20 }}>{list.length}</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {list.map((m) => (
                    <div key={m.id} style={{ background: '#fff', border: `1px solid ${C.line}`, borderRadius: 13, padding: '11px 13px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13.5, fontWeight: 700, color: C.ink }}>{m.item}{m.quantity > 1 ? <span style={{ color: C.pinkDeep }}> ×{m.quantity}</span> : null}</div>
                          <div style={{ fontSize: 11.5, fontWeight: 600, color: C.muted, marginTop: 2 }}>{m.supplier ? `🏬 ${m.supplier}` : 'Supplier not set'}{m.note ? ` · ${m.note}` : ''}</div>
                        </div>
                        {m.photo_url && <a href={m.photo_url} target="_blank" rel="noreferrer"><img src={m.photo_url} alt="" style={{ width: 44, height: 44, objectFit: 'cover', borderRadius: 9, border: `1px solid ${C.line}` }} /></a>}
                      </div>
                      <div style={{ display: 'flex', gap: 6, marginTop: 9 }}>
                        <Button onClick={async () => { setBusy(String(m.id)); try { await api.setMissingStatus(Number(m.id), 'received'); load(); } finally { setBusy(null); } }} disabled={busy === String(m.id)}>✓ Bought</Button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </Panel>
      )}

      {/* 🎉 Event preparation tasks */}
      <Panel title="My preparation tasks" action={<Badge tone={eventTasks.some((t) => t.status !== 'completed') ? 'warn' : 'ok'}>{eventTasks.filter((t) => t.status !== 'completed').length} open</Badge>}>
        {eventTasks.length === 0 ? (
          manual.length === 0 ? <Empty>No tasks assigned to you right now 🎉</Empty> : <Empty>No event prep right now 🎉</Empty>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {eventTasks.map((t) => <MyTaskRow key={t.id} t={t} onAction={load} />)}
          </div>
        )}
      </Panel>

      {openCount === 0 && manual.length === 0 && <div />}
    </div>
  );
}

// ── Assign a manual task to a staff member ───────────────────────────────────
function NewTaskForm({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [crew, setCrew] = useState<any[]>([]);
  const [title, setTitle] = useState('');
  const [ids, setIds] = useState<Set<string>>(new Set());
  const [due, setDue] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open && crew.length === 0) api.staffingCrew().then(setCrew).catch(() => {}); }, [open]);

  const submit = async () => {
    if (!title.trim() || ids.size === 0) { alert('Add a title and pick at least one person.'); return; }
    setBusy(true);
    try {
      await api.prepCreateManual({ title: title.trim(), memberIds: [...ids], dueDate: due || undefined, note: note.trim() || undefined });
      setTitle(''); setIds(new Set()); setDue(''); setNote(''); setOpen(false);
      onCreated();
    } catch (e: any) { alert(e?.message ?? 'Could not create the task.'); }
    finally { setBusy(false); }
  };

  if (!open) return <div><Button onClick={() => setOpen(true)}>➕ New task</Button></div>;
  return (
    <Panel title="Assign a task">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Task (e.g. Follow up: Dubai TV payment)"
          style={{ padding: '10px 12px', border: `1px solid ${C.line}`, borderRadius: 10, fontSize: 13, fontWeight: 600 }} />
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: C.muted2, marginBottom: 6 }}>Assign to</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {crew.length === 0 ? <span style={{ fontSize: 12, color: C.muted2 }}>Loading team…</span> : crew.map((m) => {
              const on = ids.has(m.id);
              return <Button key={m.id} tone={on ? 'primary' : 'ghost'} onClick={() => {
                const n = new Set(ids); on ? n.delete(m.id) : n.add(m.id); setIds(n);
              }}>{m.name}</Button>;
            })}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <label style={{ fontSize: 11.5, fontWeight: 700, color: C.muted, display: 'flex', alignItems: 'center', gap: 6 }}>
            Deadline
            <input type="date" value={due} onChange={(e) => setDue(e.target.value)}
              style={{ padding: '8px 10px', border: `1px solid ${C.line}`, borderRadius: 9, fontSize: 12.5 }} />
          </label>
        </div>
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)"
          style={{ padding: '9px 12px', border: `1px solid ${C.line}`, borderRadius: 10, fontSize: 12.5, fontWeight: 600 }} />
        <div style={{ display: 'flex', gap: 8 }}>
          <Button onClick={submit} disabled={busy}>{busy ? 'Assigning…' : '✓ Assign task'}</Button>
          <Button tone="ghost" onClick={() => setOpen(false)}>Cancel</Button>
        </div>
      </div>
    </Panel>
  );
}

// One task row with the manager actions (Done / Start / Issue / Reopen).
function TaskRow({ t, onAction }: { t: any; onAction: () => void }) {
  return (
    <div style={{ border: `1px solid ${C.lineSoft}`, borderRadius: 12, padding: '9px 11px' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <span style={{ fontSize: 12.5, fontWeight: 700, color: C.ink, flex: 1 }}>
          {t.category === 'design' ? '🖌️ ' : t.category === 'manual' ? '📌 ' : ''}{t.title}
        </span>
        <Badge tone={st(t.status).tone}>{st(t.status).label}</Badge>
      </div>
      <div style={{ fontSize: 10.5, fontWeight: 600, color: C.muted, marginTop: 3 }}>
        {partyLine(t)} · due {fmtDue(t.due)}
      </div>
      {t.status === 'waiting_design' ? (
        <div style={{ fontSize: 10.5, fontWeight: 700, color: '#c98a2b', marginTop: 7 }}>⏳ Waiting for the design</div>
      ) : t.status !== 'completed' ? (
        <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
          <Button onClick={async () => { await api.prepComplete(String(t.id)); onAction(); }} style={{ padding: '6px 12px', fontSize: 11.5 }}>✓ Done</Button>
          {t.status !== 'in_progress' && (
            <Button tone="ghost" onClick={async () => { await api.prepSetStatus(String(t.id), 'in_progress'); onAction(); }} style={{ padding: '6px 11px', fontSize: 11.5 }}>Start</Button>
          )}
          <Button tone="ghost" onClick={async () => { const note = prompt('What is the issue / missing item?') ?? ''; if (note.trim()) { await api.prepSetStatus(String(t.id), 'issue', note.trim()); onAction(); } }} style={{ padding: '6px 11px', fontSize: 11.5 }}>⚠ Issue</Button>
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 6, marginTop: 8, alignItems: 'center' }}>
          <span style={{ fontSize: 10.5, fontWeight: 700, color: C.green }}>✓ Completed</span>
          <Button tone="ghost" onClick={async () => { await api.prepSetStatus(String(t.id), 'not_started'); onAction(); }} style={{ padding: '5px 10px', fontSize: 11 }}>↺ Reopen</Button>
        </div>
      )}
    </div>
  );
}

// ── By person ────────────────────────────────────────────────────────────────
function ByPerson() {
  const [board, setBoard] = useState<any[] | null>(null);
  const load = () => api.prepBoard().then(setBoard).catch(() => setBoard([]));
  useEffect(() => { load(); }, []);
  if (!board) return <Spinner />;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <NewTaskForm onCreated={load} />
      {board.length === 0 ? (
        <Panel><Empty>No prep tasks yet — assign one above, or they’re generated when a booking is confirmed.</Empty></Panel>
      ) : (
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16, alignItems: 'start' }}>
      {board.map((p) => {
        const manual = (p.tasks ?? []).filter((t: any) => t.category === 'manual');
        const eventTasks = (p.tasks ?? []).filter((t: any) => t.category !== 'manual');
        const manualTotal = p.manual_total ?? 0;
        const manualDone = p.manual_done ?? 0;
        const pct = manualTotal > 0 ? Math.round((manualDone / manualTotal) * 100) : 0;
        return (
        <Panel key={p.id} title={p.name}
          action={<Badge tone={p.open_count > 0 ? 'warn' : 'ok'}>{p.open_count} open</Badge>}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {/* 📌 Assigned by Sheem — the owner's manual tasks + completion % */}
            {manualTotal > 0 && (
              <div style={{ background: C.pinkSoft, border: `1px solid ${C.pink}`, borderRadius: 12, padding: '10px 11px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <span style={{ fontSize: 12, fontWeight: 800, color: C.pinkDeep, flex: 1 }}>📌 Assigned by Sheem</span>
                  <span style={{ fontSize: 11, fontWeight: 800, color: pct === 100 ? C.green : C.pinkDeep }}>{manualDone}/{manualTotal} · {pct}%</span>
                </div>
                <div style={{ height: 6, borderRadius: 5, background: '#fff', overflow: 'hidden', marginBottom: manual.length ? 9 : 0 }}>
                  <div style={{ height: '100%', width: `${pct}%`, background: pct === 100 ? C.green : C.pink }} />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {manual.map((t: any) => <TaskRow key={t.id} t={t} onAction={load} />)}
                  {manual.length === 0 && <span style={{ fontSize: 11, fontWeight: 700, color: C.green }}>All assigned tasks done ✓</span>}
                </div>
              </div>
            )}
            {/* 🎉 Event preparation tasks */}
            {eventTasks.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {eventTasks.map((t: any) => <TaskRow key={t.id} t={t} onAction={load} />)}
              </div>
            )}
            {eventTasks.length === 0 && manualTotal === 0 && <Empty>All clear 🎉</Empty>}
          </div>
        </Panel>
        );
      })}
      </div>
      )}
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
              {[e.reference, new Date(e.event_date).toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short' }), e.babyName, e.celebrationType, e.theme, e.emirate].filter(Boolean).join(' · ')}
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
                <div style={fredoka(18)}>Preparation · {plan.reference ?? eventId}</div>
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

            {plan.event && (
              <div style={{ background: '#fff', border: `1px solid ${C.line}`, borderRadius: 16, padding: '14px 16px', marginBottom: 16, boxShadow: C.shadow }}>
                <div style={{ ...fredoka(15), marginBottom: 2 }}>
                  🎉 {plan.event.babyName || 'The celebration'}{plan.event.celebrationType ? ` · ${plan.event.celebrationType}` : ''}
                </div>
                <div style={{ fontSize: 12, fontWeight: 700, color: C.muted2, display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 4 }}>
                  {plan.event.eventDate && <span>📅 {new Date(plan.event.eventDate).toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' })}</span>}
                  {plan.event.theme && <span>🎨 {plan.event.theme}</span>}
                </div>
                {(plan.event.packageName || (plan.event.items && plan.event.items.length > 0)) && (
                  <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px solid ${C.lineSoft}` }}>
                    <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '.4px', textTransform: 'uppercase', color: C.muted2, marginBottom: 5 }}>What the customer ordered</div>
                    {plan.event.packageName && <div style={{ fontSize: 12.5, fontWeight: 700, color: C.ink, marginBottom: 4 }}>📦 {plan.event.packageName}</div>}
                    {plan.event.items && plan.event.items.length > 0 && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                        {plan.event.items.map((it: string, i: number) => (
                          <span key={i} style={{ fontSize: 11.5, fontWeight: 600, color: C.ink, background: C.pinkSoft, borderRadius: 8, padding: '4px 9px' }}>{it}</span>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {plan.tasks.length === 0 && <Empty>No prep tasks for this event.</Empty>}
              {plan.tasks.map((t: any) => (
                <div key={t.id} style={{ background: '#fff', border: `1px solid ${t.status === 'issue' ? '#f2c9c2' : C.line}`, borderRadius: 14, padding: '12px 14px' }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                    <span style={{ fontSize: 13, fontWeight: 800, color: C.ink, flex: 1 }}>
                      {t.category === 'design' ? '🖌️ ' : t.category === 'manual' ? '📌 ' : ''}{t.title}
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
