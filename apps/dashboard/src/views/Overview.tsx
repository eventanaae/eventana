import { useEffect, useState } from 'react';
import type { View } from '../App';
import { api } from '../api';
import { ACCENTS, Badge, C, Panel, SectionHeader, Spinner, StatCard, useCountUp } from '../ui';

/**
 * Manager overview — a mini, money-free operational dashboard: how many orders
 * this month, what they are, and the busiest emirate & theme. No revenue.
 */
const PERIODS: [string, string][] = [['month', 'This month'], ['quarter', 'Last 3 months'], ['year', 'This year']];

export function Overview({ onOpenEvent, onGoto }: { onOpenEvent: (id: string) => void; onGoto: (v: View) => void }) {
  const [period, setPeriod] = useState<string>('month');
  const [d, setD] = useState<any>(null);
  useEffect(() => { setD(null); api.overview(period).then(setD).catch(() => setD({ error: true })); }, [period]);

  const orders = useCountUp(Number(d?.orders) || 0);
  const periodLabel = PERIODS.find(([p]) => p === period)?.[1] ?? 'This month';

  const fmtDate = (s: string) => new Date(s).toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short' });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* period filter */}
      <div style={{ display: 'flex', gap: 4, background: '#fff', border: `1px solid ${C.line}`, borderRadius: 12, padding: 4 }}>
        {PERIODS.map(([p, label]) => (
          <button key={p} onClick={() => setPeriod(p)} style={{
            flex: 1, border: 'none', cursor: 'pointer', borderRadius: 9, padding: '9px 0', fontWeight: 700, fontSize: 12,
            background: period === p ? C.pink : 'transparent', color: period === p ? '#fff' : C.muted2,
          }}>{label}</button>
        ))}
      </div>

      {!d ? <Spinner /> : d.error ? (
        <Panel><div style={{ fontSize: 13, fontWeight: 600, color: C.muted }}>Couldn't load the overview.</div></Panel>
      ) : (
      <>
      {/* headline stats — counts only, no money */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 12 }}>
        <StatCard i={0} label={`Total orders · ${periodLabel}`} value={Math.round(orders)} icon="🎈" accent={ACCENTS[0]} onClick={() => onGoto('schedule')} />
        <StatCard i={1} label="Top emirate" value={d.topEmirate?.label ?? '—'} icon="📍" accent={ACCENTS[4]} hint={d.topEmirate ? `${d.topEmirate.count} order(s)` : undefined} />
        <StatCard i={2} label="Top theme" value={d.topTheme?.label ?? '—'} icon="🎨" accent={ACCENTS[3]} hint={d.topTheme ? `${d.topTheme.count} order(s)` : undefined} />
      </div>

      {/* breakdowns */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(240px,1fr))', gap: 14 }}>
        <Breakdown title="By emirate" rows={d.byEmirate} accent={ACCENTS[4]} />
        <Breakdown title="By theme" rows={d.byTheme} accent={ACCENTS[3]} />
        <Breakdown title="By event type" rows={d.byType} accent={ACCENTS[1]} />
      </div>

      {/* the orders in this period */}
      <div>
        <SectionHeader action={<span onClick={() => onGoto('schedule')} className="tap" style={{ fontSize: 12, fontWeight: 800, color: C.pinkDeep, cursor: 'pointer' }}>Open events ›</span>}>Orders · {periodLabel}</SectionHeader>
        <Panel>
          {(d.list ?? []).length === 0 ? (
            <div style={{ fontSize: 13, fontWeight: 600, color: C.muted }}>No orders in this period.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {d.list.map((o: any, i: number) => {
                const ac = ACCENTS[i % ACCENTS.length];
                return (
                  <div key={o.id} onClick={() => onOpenEvent(o.id)} className="tap" style={{ display: 'flex', alignItems: 'center', gap: 11, cursor: 'pointer', padding: '9px 4px', borderRadius: 12 }}>
                    <span style={{ width: 34, height: 34, borderRadius: 11, background: ac.grad, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, flex: 'none' }}>🎈</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: C.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{o.customer}</div>
                      <div style={{ fontSize: 11.5, fontWeight: 600, color: C.muted }}>{fmtDate(o.date)} · {o.emirate}{o.theme ? ` · ${o.theme}` : ''}{o.package ? ` · ${o.package}` : ''}</div>
                    </div>
                    <Badge tone={o.phase === 'Event Completed' ? 'neutral' : 'info'}>{o.phase}</Badge>
                    <span style={{ color: C.muted, fontWeight: 800 }}>›</span>
                  </div>
                );
              })}
            </div>
          )}
        </Panel>
      </div>
      </>
      )}
    </div>
  );
}

function Breakdown({ title, rows, accent }: { title: string; rows: Array<{ label: string; count: number }>; accent: typeof ACCENTS[number] }) {
  const max = Math.max(1, ...(rows ?? []).map((r) => r.count));
  return (
    <Panel title={title}>
      {(rows ?? []).length === 0 ? (
        <div style={{ fontSize: 12.5, fontWeight: 600, color: C.muted }}>No data yet.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {rows.map((r) => (
            <div key={r.label}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, fontWeight: 700, color: C.ink, marginBottom: 4 }}>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.label}</span>
                <span style={{ color: accent.fg }}>{r.count}</span>
              </div>
              <div style={{ height: 8, borderRadius: 5, background: C.lineSoft, overflow: 'hidden' }}>
                <div style={{ width: `${Math.round((r.count / max) * 100)}%`, height: '100%', borderRadius: 5, background: accent.grad }} />
              </div>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}
