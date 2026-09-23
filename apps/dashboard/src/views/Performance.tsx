import { useState } from 'react';
import type { CSSProperties } from 'react';
import { C } from '../ui';
import { Kpis } from './Kpis';
import { Feedback } from './Feedback';

/**
 * Achievements and the customer Review Report used to be two near-identical
 * pages — both are "how are we doing". Merged here into one page with two tabs:
 * the team's points/rewards, and what customers actually said.
 */
export function Performance({ role, onOpenEvent }: { role?: string; onOpenEvent: (id: string) => void }) {
  const [tab, setTab] = useState<'achievements' | 'reviews'>('achievements');
  const btn = (active: boolean): CSSProperties => ({
    border: `1.5px solid ${active ? C.pinkDeep : C.line}`,
    background: active ? C.pinkDeep : '#fff',
    color: active ? '#fff' : C.ink,
    borderRadius: 12,
    padding: '8px 16px',
    fontSize: 13,
    fontWeight: 800,
    cursor: 'pointer',
  });
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', gap: 8 }}>
        <button style={btn(tab === 'achievements')} onClick={() => setTab('achievements')}>★ Achievements</button>
        <button style={btn(tab === 'reviews')} onClick={() => setTab('reviews')}>⭐ Customer reviews</button>
      </div>
      {tab === 'achievements'
        ? <Kpis role={role} />
        : <Feedback onBack={() => setTab('achievements')} onOpenEvent={onOpenEvent} />}
    </div>
  );
}
