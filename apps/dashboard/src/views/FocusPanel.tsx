import { useEffect, useState } from 'react';
import { api, type FocusTask } from '../api';
import { C, fredoka } from '../ui';

/** Keep the day to a focused few — anything past this is gently flagged as "too much". */
const DAILY_CAP = 4;

/**
 * My Focus — the owner's (or a manager's) own short daily to-do, shown on the
 * dashboard home. Deliberately small: add a few priorities, order them, tick
 * them off. Everything is scoped server-side to the signed-in person, so this is
 * strictly private. Separate from the auto-generated event prep tasks.
 */
export function FocusPanel() {
  const [tasks, setTasks] = useState<FocusTask[]>([]);
  const [doneCount, setDoneCount] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);

  const load = () =>
    api.focus()
      .then((r) => { setTasks(r.tasks); setDoneCount(r.done.length); })
      .catch(() => { setTasks([]); setDoneCount(0); })
      .finally(() => setLoaded(true));
  useEffect(() => { load(); }, []);

  const add = async () => {
    const t = title.trim();
    if (!t || busy) return;
    setBusy(true);
    try {
      const created = await api.addFocus(t);
      setTasks((prev) => [...prev, created]);
      setTitle('');
    } finally {
      setBusy(false);
    }
  };

  const toggle = async (task: FocusTask) => {
    // Optimistic: drop it from the open list immediately, then persist.
    setTasks((prev) => prev.filter((x) => x.id !== task.id));
    setDoneCount((n) => n + 1);
    try {
      await api.updateFocus(task.id, { done: true });
    } catch {
      load(); // put it back if the save failed
    }
  };

  const remove = async (id: number) => {
    setTasks((prev) => prev.filter((x) => x.id !== id));
    try { await api.deleteFocus(id); } catch { load(); }
  };

  const move = async (index: number, dir: -1 | 1) => {
    const next = [...tasks];
    const j = index + dir;
    if (j < 0 || j >= next.length) return;
    [next[index], next[j]] = [next[j], next[index]];
    setTasks(next);
    try { await api.reorderFocus(next.map((x) => x.id)); } catch { load(); }
  };

  if (!loaded) return null; // stay invisible until we know there's anything to show

  const openCount = tasks.length;
  const over = openCount > DAILY_CAP;

  return (
    <div style={{ background: '#fff', border: `1px solid ${C.line}`, borderRadius: 20, boxShadow: C.shadow, overflow: 'hidden' }}>
      <div style={{ height: 5, background: `linear-gradient(90deg,${C.mintDeep},${C.mint})` }} />
      <div style={{ padding: '14px 18px 16px' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, marginBottom: 10 }}>
          <div style={fredoka(15)}>🎯 My focus today</div>
          <div style={{ fontSize: 11.5, fontWeight: 700, color: doneCount > 0 ? C.mintDeep : C.muted }}>
            {doneCount > 0 ? `${doneCount} done ✓` : `keep it to ${DAILY_CAP} ✨`}
          </div>
        </div>

        {openCount === 0 ? (
          <div style={{ fontSize: 12.5, fontWeight: 600, color: C.muted, marginBottom: 12, lineHeight: 1.5 }}>
            {doneCount > 0 ? 'All done for today — lovely work 💐' : `Add your ${DAILY_CAP} priorities for today.`}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
            {tasks.map((task, i) => {
              const beyond = i >= DAILY_CAP;
              return (
                <div key={task.id} style={{ display: 'flex', alignItems: 'center', gap: 10, background: beyond ? C.lineSoft : C.mintSoft, borderRadius: 12, padding: '9px 11px', opacity: beyond ? 0.72 : 1 }}>
                  <button
                    onClick={() => toggle(task)}
                    title="Mark done"
                    style={{ width: 20, height: 20, flex: 'none', borderRadius: 6, border: `2px solid ${C.mintDeep}`, background: '#fff', cursor: 'pointer' }}
                  />
                  <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, fontWeight: 700, color: C.ink, lineHeight: 1.4 }}>
                    {!beyond && <span style={{ color: C.mintDeep, marginRight: 6 }}>{i + 1}.</span>}
                    {task.title}
                  </span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 2, flex: 'none' }}>
                    <IconBtn label="Move up" disabled={i === 0} onClick={() => move(i, -1)}>↑</IconBtn>
                    <IconBtn label="Move down" disabled={i === tasks.length - 1} onClick={() => move(i, 1)}>↓</IconBtn>
                    <IconBtn label="Remove" onClick={() => remove(task.id)}>✕</IconBtn>
                  </div>
                </div>
              );
            })}
            {over && (
              <div style={{ fontSize: 11, fontWeight: 700, color: C.yellowInk, background: C.yellowSoft, borderRadius: 10, padding: '7px 11px' }}>
                That's {openCount} for today — try to keep it to {DAILY_CAP}. The rest can wait for tomorrow 🌙
              </div>
            )}
          </div>
        )}

        <div style={{ display: 'flex', gap: 8 }}>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') add(); }}
            placeholder="Add a priority…"
            maxLength={200}
            style={{ flex: 1, minWidth: 0, boxSizing: 'border-box', border: `1px solid ${C.line}`, borderRadius: 11, padding: '9px 12px', fontSize: 12.5, fontWeight: 600, color: C.ink, outline: 'none' }}
          />
          <button
            onClick={add}
            disabled={busy || !title.trim()}
            className={busy || !title.trim() ? undefined : 'press'}
            style={{ flex: 'none', border: 'none', borderRadius: 11, padding: '0 16px', fontWeight: 800, fontSize: 13, cursor: busy || !title.trim() ? 'not-allowed' : 'pointer', background: C.gradMint, color: '#fff', opacity: busy || !title.trim() ? 0.5 : 1 }}
          >
            Add
          </button>
        </div>
      </div>
    </div>
  );
}

function IconBtn({ children, onClick, disabled, label }: { children: React.ReactNode; onClick: () => void; disabled?: boolean; label: string }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={label}
      style={{ width: 24, height: 24, borderRadius: 7, border: 'none', background: 'transparent', color: disabled ? C.line : C.muted2, cursor: disabled ? 'default' : 'pointer', fontSize: 13, fontWeight: 800, lineHeight: 1 }}
    >
      {children}
    </button>
  );
}
