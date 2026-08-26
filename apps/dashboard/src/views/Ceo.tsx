import { useEffect, useMemo, useState } from 'react';
import { CELEBRATION_TYPES } from '@eventana/shared';
import { api } from '../api';
import { Badge, Button, C, Panel, Spinner, fredoka } from '../ui';

/**
 * CEO Executive Dashboard — decision-support, not operations. Revenue, growth vs
 * the previous period, AOV, confirmed vs cancelled, outstanding, profitability,
 * top emirate/type/package/theme, repeat-customer rate, and actionable insights.
 * Filterable by period, emirate and event type. All figures come from the live
 * /api/admin/ceo endpoint (no invented numbers).
 */

const EMIRATES = ['Dubai', 'Abu Dhabi', 'Al Ain', 'Ajman', 'Sharjah', 'Umm Al Quwain', 'Ras Al Khaimah', 'Fujairah', 'Al Gharbia'];

const iso = (d: Date) => d.toISOString().slice(0, 10);
function presetRange(preset: string): { from: string; to: string } {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const firstNextMonth = iso(new Date(Date.UTC(y, m + 1, 1)));
  switch (preset) {
    case 'month': return { from: iso(new Date(Date.UTC(y, m, 1))), to: firstNextMonth };
    case 'q': return { from: iso(new Date(Date.UTC(y, m - 2, 1))), to: firstNextMonth };
    case 'year': return { from: iso(new Date(Date.UTC(y, 0, 1))), to: iso(new Date(Date.UTC(y + 1, 0, 1))) };
    case 'all': return { from: '2020-01-01', to: iso(new Date(Date.UTC(y + 1, 0, 1))) };
    default: return { from: iso(new Date(Date.UTC(y, m - 11, 1))), to: firstNextMonth }; // 12m
  }
}
const PRESETS: Array<{ id: string; label: string }> = [
  { id: 'month', label: 'This month' },
  { id: 'q', label: 'Last 3 months' },
  { id: '12m', label: 'Last 12 months' },
  { id: 'year', label: 'This year' },
  { id: 'all', label: 'All time' },
];

export function Ceo() {
  const [preset, setPreset] = useState('12m');
  const [emirate, setEmirate] = useState('');
  const [eventType, setEventType] = useState('');
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const range = useMemo(() => presetRange(preset), [preset]);

  useEffect(() => {
    setLoading(true);
    setError(null);
    api
      .ceo({ from: range.from, to: range.to, emirate: emirate || undefined, eventType: eventType || undefined })
      .then(setData)
      .catch((e) => setError(e?.message || 'Could not load analytics.'))
      .finally(() => setLoading(false));
  }, [range.from, range.to, emirate, eventType]);

  const chg = (v: number | null) =>
    v === null ? null : (
      <span style={{ fontSize: 12, fontWeight: 700, color: v >= 0 ? C.green : C.red }}>
        {v >= 0 ? '▲' : '▼'} {Math.abs(v)}%
      </span>
    );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Filters */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {PRESETS.map((p) => (
            <button
              key={p.id}
              onClick={() => setPreset(p.id)}
              style={{
                border: `1px solid ${preset === p.id ? C.pink : C.line}`,
                background: preset === p.id ? C.pinkSoft : '#fff',
                color: preset === p.id ? C.pinkDeep : C.muted2,
                fontWeight: 700, fontSize: 12.5, padding: '7px 12px', borderRadius: 999, cursor: 'pointer',
              }}
            >
              {p.label}
            </button>
          ))}
        </div>
        <div style={{ flex: 1 }} />
        <select value={emirate} onChange={(e) => setEmirate(e.target.value)} style={selectStyle}>
          <option value="">All emirates</option>
          {EMIRATES.map((e) => <option key={e} value={e}>{e}</option>)}
        </select>
        <select value={eventType} onChange={(e) => setEventType(e.target.value)} style={selectStyle}>
          <option value="">All event types</option>
          {CELEBRATION_TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
        </select>
      </div>

      {loading && <Spinner />}
      {error && !loading && <Panel title="Analytics"><div style={{ color: C.red, fontWeight: 600, fontSize: 13 }}>{error}</div></Panel>}

      {data && !loading && (
        <>
          {/* KPI cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 12 }}>
            <Kpi label="Revenue" value={`AED ${data.revenueDisplay}`} sub={chg(data.revenueChangePct)} accent={C.pink} />
            <Kpi label="Bookings" value={String(data.bookings)} sub={chg(data.bookingsChangePct)} />
            <Kpi label="Avg order value" value={`AED ${data.aovDisplay}`} />
            <Kpi
              label={data.profitNegative ? 'Net loss' : 'Net profit'}
              value={`AED ${data.profitDisplay}`}
              sub={<span style={{ fontSize: 12, fontWeight: 700, color: C.muted }}>{data.marginPct}% margin</span>}
              accent={data.profitNegative ? C.red : C.green}
            />
            <Kpi label="Outstanding" value={`AED ${data.outstandingDisplay}`} sub={<span style={{ fontSize: 12, color: C.muted, fontWeight: 700 }}>{data.outstandingCount} order(s)</span>} accent={data.outstandingCount > 0 ? C.yellow : undefined} />
            <Kpi label="Cancelled" value={`${data.cancelled}`} sub={<span style={{ fontSize: 12, color: C.muted, fontWeight: 700 }}>{data.cancelRatePct}% · AED {data.refundDisplay} refunded</span>} />
            <Kpi label="Repeat customers" value={`${data.repeatRatePct}%`} sub={<span style={{ fontSize: 12, color: C.muted, fontWeight: 700 }}>{data.repeatCustomers} of {data.totalCustomers}</span>} />
            <Kpi label="Expenses" value={`AED ${data.expensesDisplay}`} />
          </div>

          {/* Insights */}
          {data.insights?.length > 0 && (
            <Panel title="What needs your attention">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {data.insights.map((ins: any, i: number) => (
                  <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                    <span style={{ marginTop: 2 }}>
                      <Badge tone={ins.tone === 'good' ? 'ok' : ins.tone === 'warn' ? 'warn' : 'info'}>
                        {ins.tone === 'good' ? '✓' : ins.tone === 'warn' ? '!' : 'i'}
                      </Badge>
                    </span>
                    <span style={{ fontSize: 13.5, fontWeight: 600, color: C.muted2, lineHeight: 1.5 }}>{ins.text}</span>
                  </div>
                ))}
              </div>
            </Panel>
          )}

          {/* Trend */}
          <Panel title="Revenue & bookings by month">
            <TrendChart trend={data.trend} />
          </Panel>

          {/* Breakdowns */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))', gap: 12 }}>
            <Breakdown title="By emirate" rows={data.byEmirate} />
            <Breakdown title="By event type" rows={data.byEventType} />
            <Breakdown title="By package" rows={data.byPackage} />
            <Breakdown title="By theme" rows={data.byTheme} />
          </div>
        </>
      )}
    </div>
  );
}

function Kpi({ label, value, sub, accent }: { label: string; value: string; sub?: React.ReactNode; accent?: string }) {
  return (
    <div style={{ background: '#fff', border: `1px solid ${C.line}`, borderRadius: 16, padding: '16px 18px', boxShadow: C.shadow, borderTop: accent ? `3px solid ${accent}` : undefined }}>
      <div style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase', color: C.muted }}>{label}</div>
      <div style={{ ...fredoka(23), marginTop: 6, color: C.ink }}>{value}</div>
      {sub && <div style={{ marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

function TrendChart({ trend }: { trend: Array<{ month: string; revenueFils: number; revenueDisplay: string; bookings: number }> }) {
  if (!trend || trend.length === 0) return <div style={{ color: C.muted, fontSize: 13, fontWeight: 600 }}>No data in this range.</div>;
  const max = Math.max(1, ...trend.map((t) => t.revenueFils));
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, height: 200, overflowX: 'auto', paddingTop: 8 }}>
      {trend.map((t) => (
        <div key={t.month} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, minWidth: 46, flex: 1 }}>
          <div style={{ fontSize: 10.5, fontWeight: 700, color: C.muted2 }}>{t.bookings}</div>
          <div style={{ width: '100%', maxWidth: 40, height: `${Math.round((t.revenueFils / max) * 140)}px`, minHeight: 3, background: `linear-gradient(180deg,${C.pink},${C.pinkDeep})`, borderRadius: 6 }} title={`AED ${t.revenueDisplay}`} />
          <div style={{ fontSize: 10, fontWeight: 700, color: C.muted }}>{t.month.slice(2)}</div>
        </div>
      ))}
    </div>
  );
}

function Breakdown({ title, rows }: { title: string; rows: Array<{ key: string; label: string; bookings: number; revenueFils: number; revenueDisplay: string }> }) {
  const top = (rows ?? []).slice(0, 6);
  const max = Math.max(1, ...top.map((r) => r.revenueFils));
  return (
    <Panel title={title}>
      {top.length === 0 ? (
        <div style={{ color: C.muted, fontSize: 13, fontWeight: 600 }}>No data.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {top.map((r) => (
            <div key={r.key}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 4 }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: C.ink, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.label}</span>
                <span style={{ fontSize: 12.5, fontWeight: 700, color: C.muted2, whiteSpace: 'nowrap' }}>AED {r.revenueDisplay} · {r.bookings}</span>
              </div>
              <div style={{ height: 8, background: C.lineSoft, borderRadius: 999 }}>
                <div style={{ width: `${Math.round((r.revenueFils / max) * 100)}%`, height: '100%', background: C.pink, borderRadius: 999 }} />
              </div>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

const selectStyle: React.CSSProperties = {
  border: `1px solid ${C.line}`, borderRadius: 999, padding: '7px 12px', fontWeight: 700, fontSize: 12.5,
  color: C.muted2, background: '#fff', cursor: 'pointer', outline: 'none',
};
