import { useEffect, useState } from 'react';
import { api } from '../api';
import { Badge, Button, C, fredoka, Panel, Spinner } from '../ui';
import { Empty } from './Today';

const DEPARTMENTS = ['design', 'operations', 'inventory', 'logistics', 'finance'] as const;

export function Tasks() {
  const [tasks, setTasks] = useState<any[] | null>(null);

  const load = () => {
    void api.tasks().then(setTasks);
  };
  useEffect(load, []);

  if (!tasks) return <Spinner />;

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 16, alignItems: 'start' }}>
      {DEPARTMENTS.map((dept) => {
        const items = tasks.filter((t) => t.department === dept);
        const open = items.filter((t) => t.status !== 'done');
        return (
          <Panel
            key={dept}
            title={dept.charAt(0).toUpperCase() + dept.slice(1)}
            action={<Badge tone={open.length > 0 ? 'warn' : 'ok'}>{open.length} open</Badge>}
          >
            {items.length === 0 ? (
              <Empty>Nothing here.</Empty>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {items.slice(0, 30).map((t) => (
                  <div
                    key={t.id}
                    style={{
                      border: `1px solid ${t.status === 'blocked' ? '#f2c9c2' : C.lineSoft}`,
                      borderRadius: 12,
                      padding: '10px 12px',
                      background: t.status === 'done' ? '#fbf9f7' : '#fff',
                    }}
                  >
                    <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div
                          style={{
                            fontSize: 12.5,
                            fontWeight: 600,
                            lineHeight: 1.45,
                            color: t.status === 'done' ? C.muted : C.ink,
                            textDecoration: t.status === 'done' ? 'line-through' : 'none',
                          }}
                        >
                          {t.title}
                        </div>
                        <div style={{ fontSize: 10.5, fontWeight: 600, color: C.muted, marginTop: 3 }}>
                          {t.event_id} ·{' '}
                          {new Date(t.event_date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}
                        </div>
                        {t.blocked_reason && (
                          <div style={{ fontSize: 10.5, fontWeight: 700, color: C.red, marginTop: 4 }}>
                            Blocked: {t.blocked_reason}
                          </div>
                        )}
                      </div>
                      <Button
                        tone="ghost"
                        style={{ padding: '5px 9px', fontSize: 11 }}
                        onClick={async () => {
                          await api.setTask(t.id, t.status === 'done' ? 'open' : 'done');
                          load();
                        }}
                      >
                        {t.status === 'done' ? '↺' : '✓'}
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Panel>
        );
      })}
      {tasks.length === 0 && (
        <div style={{ ...fredoka(16), color: C.muted }}>
          No tasks yet — they’re generated automatically when a booking is confirmed.
        </div>
      )}
    </div>
  );
}
