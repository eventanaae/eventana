import { useEffect, useState } from 'react';
import { api } from '../api';
import { C, fredoka, Panel, Spinner, Badge } from '../ui';
import { Empty } from './Today';

/**
 * Part-timer & driver tracker (owner/manager). This month's clown/face-paint
 * engagements with amounts + per-person totals, and the driver deliveries.
 * Also emailed to the owner + Marsha on the 1st of each month.
 */
export function StaffPay() {
  const [data, setData] = useState<any>(null);
  useEffect(() => { api.staffPayReport().then(setData).catch(() => setData({ partTimers: [], drivers: [] })); }, []);
  if (!data) return <Spinner />;
  const fmtDate = (d: string) => new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div>
        <div style={{ ...fredoka(20) }}>🤡🚐 Part-timers & Drivers</div>
        <div style={{ fontSize: 12.5, fontWeight: 700, color: C.muted, marginTop: 2 }}>{data.monthLabel} · emailed to you & Marsha on the 1st</div>
      </div>

      <Panel title="🤡 Part-timers" action={<Badge tone="info">total {data.partTimerTotalDisplay ?? '—'}</Badge>}>
        {(!data.partTimers || data.partTimers.length === 0) ? (
          <Empty>No part-timer engagements this month.</Empty>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {data.partTimers.map((p: any) => (
              <div key={p.name} style={{ border: `1px solid ${C.line}`, borderRadius: 12, padding: '11px 13px' }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                  <span style={{ fontSize: 14, fontWeight: 800, color: C.ink, flex: 1 }}>{p.name}</span>
                  <span style={{ fontSize: 13, fontWeight: 800, color: C.pinkDeep }}>{p.totalDisplay}</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginTop: 6 }}>
                  {p.entries.map((e: any, i: number) => (
                    <div key={i} style={{ fontSize: 12, fontWeight: 600, color: C.muted }}>
                      {fmtDate(e.date)} · {e.job} · 📍 {e.emirate} · <span style={{ color: C.ink, fontWeight: 700 }}>{e.amountDisplay}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </Panel>

      <Panel title="🚐 Deliveries">
        {(!data.drivers || data.drivers.length === 0) ? (
          <Empty>No deliveries this month.</Empty>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            {data.drivers.map((d: any, i: number) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, border: `1px solid ${C.line}`, borderRadius: 11, padding: '9px 12px' }}>
                <span style={{ fontSize: 12.5, fontWeight: 700, color: C.muted2, minWidth: 52 }}>{fmtDate(d.date)}</span>
                <span style={{ fontSize: 13, fontWeight: 700, color: C.ink, flex: 1 }}>{d.name}</span>
                <span style={{ fontSize: 12, fontWeight: 600, color: C.muted }}>📍 {d.emirate}</span>
                <Badge tone={d.type === 'Own van' ? 'ok' : 'warn'}>{d.type}</Badge>
              </div>
            ))}
          </div>
        )}
      </Panel>

      <div style={{ fontSize: 11.5, fontWeight: 600, color: C.muted2, padding: '0 4px' }}>
        Clown = AED 200 · Face painting = AED 350. Part-timer phone numbers & driver distance-from-base aren't tracked yet.
      </div>
    </div>
  );
}
