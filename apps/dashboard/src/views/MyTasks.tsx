import { useEffect, useState } from 'react';
import { api, type FocusTask } from '../api';
import { C, Panel, Spinner } from '../ui';

/**
 * "My Tasks" — the owner's own working backlog (focus_tasks), on its own page.
 * Same private, server-scoped list as the old home widget, but full-height and
 * without the daily-4 cap nag: this is where the whole to-do list lives, add /
 * tick off / reorder. The little tag at the start of each title groups them
 * (🔒 waiting · 🛠️ ready to build · ⚙️ finance · ❓ decision).
 */
export function MyTasks() {
  const [tasks, setTasks] = useState<FocusTask[] | null>(null);
  const [doneToday, setDoneToday] = useState(0);
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);

  const load = () =>
    api.focus()
      .then((r) => { setTasks(r.tasks); setDoneToday(r.doneToday); })
      .catch(() => setTasks([]));
  useEffect(() => { load(); }, []);

  const add = async () => {
    const t = title.trim();
    if (!t || busy) return;
    setBusy(true);
    try {
      const created = await api.addFocus(t);
      setTasks((prev) => [...(prev ?? []), created]);
      setTitle('');
    } finally { setBusy(false); }
  };

  const toggle = async (task: FocusTask) => {
    setTasks((prev) => (prev ?? []).filter((x) => x.id !== task.id));
    setDoneToday((n) => n + 1);
    try { await api.updateFocus(task.id, { done: true }); } catch { load(); }
  };

  const remove = async (id: number) => {
    setTasks((prev) => (prev ?? []).filter((x) => x.id !== id));
    try { await api.deleteFocus(id); } catch { load(); }
  };

  const move = async (index: number, dir: -1 | 1) => {
    const next = [...(tasks ?? [])];
    const j = index + dir;
    if (j < 0 || j >= next.length) return;
    [next[index], next[j]] = [next[j], next[index]];
    setTasks(next);
    try { await api.reorderFocus(next.map((x) => x.id)); } catch { load(); }
  };

  return (
    <div style={{ display: 'grid', gap: 16, maxWidth: 760 }}>
      <Panel style={{ background: C.gradHero, border: 'none' }}>
        <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 1.1, textTransform: 'uppercase', color: C.pinkDeep }}>Eventana · Owner</div>
        <div style={{ fontSize: 26, fontWeight: 800, color: C.ink, margin: '6px 0 6px' }}>My Tasks 📋</div>
        <div style={{ fontSize: 14, color: C.inkSoft, maxWidth: 620 }}>
          Your private working list. Add anything, drag the priorities to the top, tick them off.
          {doneToday > 0 && <b> {doneToday} done today ✓</b>}
        </div>
      </Panel>

      <Panel>
        <div style={{ display: 'flex', gap: 8, marginBottom: tasks && tasks.length ? 14 : 0 }}>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') add(); }}
            placeholder="Add a task…"
            maxLength={200}
            style={{ flex: 1, minWidth: 0, boxSizing: 'border-box', border: `1px solid ${C.line}`, borderRadius: 11, padding: '10px 13px', fontSize: 13.5, fontWeight: 600, color: C.ink, outline: 'none' }}
          />
          <button
            onClick={add}
            disabled={busy || !title.trim()}
            className={busy || !title.trim() ? undefined : 'press'}
            style={{ flex: 'none', border: 'none', borderRadius: 11, padding: '0 18px', fontWeight: 800, fontSize: 13.5, cursor: busy || !title.trim() ? 'not-allowed' : 'pointer', background: C.gradPink, color: '#fff', opacity: busy || !title.trim() ? 0.5 : 1 }}
          >
            Add
          </button>
        </div>

        {tasks === null ? <Spinner /> : tasks.length === 0 ? (
          <div style={{ fontSize: 13, fontWeight: 600, color: C.muted, padding: '8px 2px' }}>Nothing on your list — add your first task above.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {tasks.map((task, i) => (
              <div key={task.id} style={{ display: 'flex', alignItems: 'center', gap: 11, background: C.pinkSoft, borderRadius: 12, padding: '11px 13px' }}>
                <button
                  onClick={() => toggle(task)}
                  title="Mark done"
                  style={{ width: 21, height: 21, flex: 'none', borderRadius: 6, border: `2px solid ${C.pinkDeep}`, background: '#fff', cursor: 'pointer' }}
                />
                <span style={{ flex: 1, minWidth: 0, fontSize: 13.5, fontWeight: 700, color: C.ink, lineHeight: 1.45 }}>
                  <span style={{ color: C.pinkDeep, marginRight: 7 }}>{i + 1}.</span>{task.title}
                </span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 2, flex: 'none' }}>
                  <IconBtn label="Move up" disabled={i === 0} onClick={() => move(i, -1)}>↑</IconBtn>
                  <IconBtn label="Move down" disabled={i === tasks.length - 1} onClick={() => move(i, 1)}>↓</IconBtn>
                  <IconBtn label="Remove" onClick={() => remove(task.id)}>✕</IconBtn>
                </div>
              </div>
            ))}
          </div>
        )}
        <div style={{ marginTop: 12, fontSize: 11.5, color: C.muted2 }}>Private to you. Tags: 🔒 waiting on someone · 🛠️ ready to build · ⚙️ finance clean-up · ❓ a decision.</div>
      </Panel>
    </div>
  );
}

function IconBtn({ children, onClick, disabled, label }: { children: React.ReactNode; onClick: () => void; disabled?: boolean; label: string }) {
  return (
    <button onClick={onClick} disabled={disabled} title={label}
      style={{ width: 26, height: 26, borderRadius: 7, border: 'none', background: 'transparent', color: disabled ? C.line : C.muted2, cursor: disabled ? 'default' : 'pointer', fontSize: 14, fontWeight: 800, lineHeight: 1 }}>
      {children}
    </button>
  );
}
