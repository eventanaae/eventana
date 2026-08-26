import { useState } from 'react';
import { C } from '../ui';
import { MyEvents } from './MyEvents';
import { Events } from './Events';

/**
 * The Events surface — "My events" and "All events" in one segmented switch.
 * Both open the same Event Details page by id.
 */
export function Schedule({
  onOpenEvent,
  canSeeAll,
}: {
  onOpenEvent: (id: string) => void;
  canSeeAll: boolean;
}) {
  const [mode, setMode] = useState<'mine' | 'all'>(canSeeAll ? 'all' : 'mine');
  const tabs: Array<{ id: 'mine' | 'all'; label: string }> = [
    { id: 'mine', label: 'My events' },
    ...(canSeeAll ? ([{ id: 'all', label: 'All events' }] as const) : []),
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', gap: 4, background: '#fff', border: `1px solid ${C.line}`, borderRadius: 12, padding: 4 }}>
        {tabs.map((t) => {
          const active = mode === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setMode(t.id)}
              style={{
                flex: 1, border: 'none', cursor: 'pointer', borderRadius: 9, padding: '9px 0',
                fontWeight: 700, fontSize: 12.5,
                background: active ? C.pink : 'transparent',
                color: active ? '#fff' : C.muted2,
              }}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      {mode === 'mine' && <MyEvents onOpenEvent={onOpenEvent} />}
      {mode === 'all' && canSeeAll && <Events onOpenEvent={onOpenEvent} />}
    </div>
  );
}
