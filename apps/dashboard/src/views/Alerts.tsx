import { useEffect, useState } from 'react';
import { api } from '../api';
import { C, fredoka, Panel, Spinner } from '../ui';
import { Empty } from './Today';

const ago = (ts: string) => {
  const s = Math.max(1, Math.floor((Date.now() - new Date(ts).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
};

export function Alerts({ onOpenEvent }: { onOpenEvent: (id: string) => void }) {
  const [data, setData] = useState<any>(null);
  const load = () => api.alerts().then(setData).catch(() => setData(null));
  useEffect(() => {
    load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, []);

  if (!data) return <Spinner />;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 12 }}>
        <Stat label="Low stock items" value={data.counts.lowStock} tone={data.counts.lowStock > 0 ? 'warn' : 'ok'} />
        <Stat label="Leave to approve" value={data.counts.pendingLeave} tone={data.counts.pendingLeave > 0 ? 'warn' : 'ok'} />
        <Stat label="Orders in review" value={data.counts.needsReview} tone={data.counts.needsReview > 0 ? 'error' : 'ok'} />
      </div>

      <Panel title="🧴 Low stock — reorder soon">
        {data.lowStock.length === 0 ? (
          <Empty>All consumables above their reorder level.</Empty>
        ) : (
          data.lowStock.map((c: any) => (
            <div key={c.id} style={row}>
              <span style={{ fontWeight: 700, fontSize: 12.5, flex: 1 }}>{c.name}</span>
              <span style={{ fontSize: 12, fontWeight: 700, color: c.on_hand === 0 ? C.red : '#c98a2b' }}>
                {c.on_hand} {c.unit} left
              </span>
              <span style={{ fontSize: 11, fontWeight: 600, color: C.muted, minWidth: 90, textAlign: 'right' }}>
                reorder at {c.reorder_level}
              </span>
            </div>
          ))
        )}
      </Panel>

      <Panel title="🌴 Leave requests">
        {data.pendingLeave.length === 0 ? (
          <Empty>No pending leave requests.</Empty>
        ) : (
          data.pendingLeave.map((d: any) => (
            <div key={d.id} style={row}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: d.color, flex: 'none' }} />
              <span style={{ fontWeight: 700, fontSize: 12.5, minWidth: 110 }}>{d.member_name}</span>
              <span style={{ fontSize: 12, fontWeight: 600, color: C.muted, flex: 1 }}>
                {new Date(d.start_date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}
                {String(d.end_date).slice(0, 10) !== String(d.start_date).slice(0, 10) &&
                  ` → ${new Date(d.end_date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}`}
                {d.reason ? ` · ${d.reason}` : ''}
              </span>
              <button onClick={async () => { await api.setDayOffStatus(d.id, 'approved'); load(); }} style={miniBtn}>Approve</button>
              <button onClick={async () => { await api.setDayOffStatus(d.id, 'denied'); load(); }} style={{ ...miniBtn, color: C.red }}>Deny</button>
            </div>
          ))
        )}
      </Panel>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(260px,1fr))', gap: 16 }}>
        <Panel title="💐 Recent tips">
          {data.recentTips.length === 0 ? (
            <Empty>No tips yet.</Empty>
          ) : (
            data.recentTips.map((t: any) => (
              <div key={t.id} style={row} onClick={() => onOpenEvent?.(t.event_id)}>
                <span style={{ fontWeight: 700, fontSize: 12.5, color: C.pinkDeep }}>AED {t.amountDisplay}</span>
                <span style={{ fontSize: 12, fontWeight: 600, color: C.muted, flex: 1 }}>
                  {t.member_name ? `for ${t.member_name}` : 'for the team'} · {t.event_id}
                </span>
                <span style={{ fontSize: 10.5, fontWeight: 600, color: C.muted }}>{ago(t.created_at)}</span>
              </div>
            ))
          )}
        </Panel>

        <Panel title="⭐ Recent ratings">
          {data.recentRatings.length === 0 ? (
            <Empty>No ratings yet.</Empty>
          ) : (
            data.recentRatings.map((r: any) => (
              <div key={r.id} style={{ ...row, alignItems: 'flex-start' }} onClick={() => onOpenEvent?.(r.event_id)}>
                <span style={{ color: C.pinkDeep, fontSize: 13, letterSpacing: 1, minWidth: 74 }}>
                  {'★'.repeat(r.stars)}<span style={{ color: C.line }}>{'★'.repeat(5 - r.stars)}</span>
                </span>
                <span style={{ fontSize: 12, fontWeight: 600, color: C.ink, flex: 1, lineHeight: 1.4 }}>
                  {r.feedback ? `“${r.feedback}”` : <span style={{ color: C.muted }}>{r.event_id}</span>}
                </span>
                <span style={{ fontSize: 10.5, fontWeight: 600, color: C.muted }}>{ago(r.created_at)}</span>
              </div>
            ))
          )}
        </Panel>
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone: 'ok' | 'warn' | 'error' }) {
  const color = tone === 'error' ? C.red : tone === 'warn' ? '#c98a2b' : C.green;
  return (
    <div style={{ background: '#fff', border: `1px solid ${C.line}`, borderRadius: 14, padding: '13px 15px' }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, marginBottom: 5 }}>{label}</div>
      <div style={{ ...fredoka(24), color }}>{value}</div>
    </div>
  );
}

const row = {
  display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0',
  borderTop: `1px solid ${C.lineSoft}`, cursor: 'default' as const,
};
const miniBtn = {
  border: `1px solid ${C.line}`, background: '#fff', borderRadius: 8, padding: '5px 9px',
  fontSize: 11, fontWeight: 700, cursor: 'pointer', color: C.ink, flex: 'none' as const,
};
