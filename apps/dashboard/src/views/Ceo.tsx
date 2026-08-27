import { useEffect, useMemo, useState } from 'react';
import { CELEBRATION_TYPES } from '@eventana/shared';
import { api } from '../api';
import { C, Panel, Spinner, fredoka } from '../ui';

/**
 * CEO Executive Dashboard — a premium, decision-first view. In under a minute:
 * headline KPIs with growth vs the previous period and sparklines, an
 * auto-generated "needs your attention" summary (risks / opportunities), a
 * revenue & profit chart, cash + pipeline + sales-funnel health, and the
 * best-performing emirates / event types / packages / themes. All from the live
 * /api/admin/ceo endpoint — no invented numbers.
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
    default: return { from: iso(new Date(Date.UTC(y, m - 11, 1))), to: firstNextMonth };
  }
}
const PRESETS = [
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

  const revSpark: number[] = (data?.trend ?? []).map((t: any) => t.revenueFils);
  const bookSpark: number[] = (data?.trend ?? []).map((t: any) => t.bookings);

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
                border: `1.5px solid ${preset === p.id ? C.pink : C.line}`,
                background: preset === p.id ? C.pinkSoft : '#fff',
                color: preset === p.id ? C.pinkDeep : C.muted2,
                fontWeight: 700, fontSize: 12.5, padding: '7px 13px', borderRadius: 999, cursor: 'pointer',
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
          {/* CEO Morning Brief — birthdays + prioritised alerts (Critical→Low) */}
          <MorningBrief data={data} />

          {/* Hero KPIs with growth + sparkline */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 12 }}>
            <HeroKpi label="Revenue" value={`AED ${data.revenueDisplay}`} delta={data.revenueChangePct} spark={revSpark} accent={C.pink} />
            <HeroKpi label="Bookings" value={String(data.bookings)} delta={data.bookingsChangePct} spark={bookSpark} accent={C.mint} />
            <HeroKpi label="Avg order value" value={`AED ${data.aovDisplay}`} accent={C.yellow} />
            <HeroKpi
              label={data.profitNegative ? 'Net loss' : 'Net profit'}
              value={`AED ${data.profitDisplay}`}
              caption={`${data.marginPct}% margin`}
              accent={data.profitNegative ? C.red : C.green}
            />
          </div>

          {/* Executive summary — needs your attention */}
          {data.insights?.length > 0 && (
            <div style={{ background: '#fff', border: `1px solid ${C.line}`, borderRadius: 20, boxShadow: C.shadow, overflow: 'hidden' }}>
              <div style={{ height: 5, background: `linear-gradient(90deg,${C.pink},${C.pinkDeep})` }} />
              <div style={{ padding: '16px 20px' }}>
                <div style={{ ...fredoka(15), marginBottom: 12 }}>Executive summary — what needs your attention</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(300px,1fr))', gap: 10 }}>
                  {data.insights.map((ins: any, i: number) => {
                    const tone = ins.tone === 'good' ? C.green : ins.tone === 'warn' ? C.red : C.pinkDeep;
                    const soft = ins.tone === 'good' ? C.greenSoft : ins.tone === 'warn' ? C.redSoft : C.pinkSoft;
                    const icon = ins.tone === 'good' ? '↑' : ins.tone === 'warn' ? '!' : 'i';
                    return (
                      <div key={i} style={{ display: 'flex', gap: 11, alignItems: 'flex-start', background: soft, borderRadius: 14, padding: '11px 13px' }}>
                        <span style={{ flex: 'none', width: 22, height: 22, borderRadius: '50%', background: tone, color: '#fff', fontWeight: 800, fontSize: 12, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{icon}</span>
                        <span style={{ fontSize: 12.5, fontWeight: 600, color: C.muted2, lineHeight: 1.5 }}>{ins.text}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* Revenue & profit chart */}
          <Panel title="Revenue by month">
            <RevenueChart trend={data.trend} />
          </Panel>

          {/* Cash · pipeline · funnel */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(260px,1fr))', gap: 12 }}>
            <Panel title="Cash position">
              {data.cash?.cashOnHandDisplay != null ? (
                <>
                  <div style={{ ...fredoka(24), color: C.green }}>AED {data.cash.availableDisplay}</div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, marginBottom: 8 }}>available after upcoming commitments</div>
                  <MiniRow label="Cash on hand" value={`AED ${data.cash.cashOnHandDisplay}`} tone={C.ink} />
                  <MiniRow label="Expected incoming" value={`AED ${data.cash.expectedInDisplay}`} sub="A/R + unsettled orders" tone={C.green} />
                  <MiniRow label="Upcoming refunds" value={`AED ${data.cash.upcomingRefundsDisplay}`} tone={C.muted2} last />
                </>
              ) : (
                <>
                  <MiniRow label="Collected (paid)" value={`AED ${data.collectedDisplay}`} tone={C.green} />
                  <MiniRow label="Outstanding" value={`AED ${data.outstandingDisplay}`} sub={`${data.outstandingCount} order(s)`} tone={data.outstandingCount > 0 ? C.yellowInk : C.muted} />
                  <MiniRow label="Expenses" value={`AED ${data.expensesDisplay}`} tone={C.muted2} last />
                </>
              )}
            </Panel>
            <Panel title="Pipeline (upcoming)">
              <div style={{ ...fredoka(28), color: C.pinkDeep }}>AED {data.pipeline?.revenueDisplay ?? '0'}</div>
              <div style={{ fontSize: 12.5, fontWeight: 700, color: C.muted, marginTop: 2 }}>{data.pipeline?.events ?? 0} confirmed event(s) ahead</div>
              <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
                <MiniRow label="Repeat customers" value={`${data.repeatRatePct}%`} sub={`${data.repeatCustomers} of ${data.totalCustomers}`} tone={C.pinkDeep} last />
              </div>
            </Panel>
            <Panel title="Sales funnel (WhatsApp)">
              <Funnel funnel={data.funnel} />
            </Panel>
          </div>

          {/* Year-end forecast */}
          {data.forecast && <ForecastPanel f={data.forecast} />}

          {/* Operational health */}
          {data.opsHealth && <OpsHealth ops={data.opsHealth} />}

          {/* Breakdowns */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))', gap: 12 }}>
            <Breakdown title="Top emirates" rows={data.byEmirate} />
            <Breakdown title="Top event types" rows={data.byEventType} />
            <Breakdown title="Top packages" rows={data.byPackage} />
            <Breakdown title="Top themes" rows={data.byTheme} />
          </div>

          {/* Customers + cancellations */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))', gap: 12 }}>
            <Panel title="Top customers by revenue">
              {(data.topCustomers ?? []).length === 0 ? (
                <div style={{ color: C.muted, fontSize: 12.5, fontWeight: 600 }}>Not enough data yet.</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  {data.topCustomers.map((c: any, i: number) => (
                    <MiniRow key={i} label={`${i + 1}. ${c.name}`} value={`AED ${c.revenueDisplay}`} sub={`${c.orders} order(s)`} tone={C.ink} last={i === data.topCustomers.length - 1} />
                  ))}
                </div>
              )}
            </Panel>
            <Panel title="Cancellations & refunds">
              <MiniRow label="Cancellation rate" value={`${data.cancelRatePct}%`} sub={`${data.cancelled} cancelled`} tone={data.cancelRatePct > 15 ? C.red : C.ink} />
              <MiniRow label="Total refunded" value={`AED ${data.refundDisplay}`} tone={C.muted2} last={(data.cancelReasons ?? []).length === 0} />
              {(data.cancelReasons ?? []).length > 0 && (
                <div style={{ marginTop: 8 }}>
                  <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '.4px', color: C.muted, marginBottom: 5 }}>TOP REASONS</div>
                  {data.cancelReasons.map((r: any, i: number) => (
                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, fontWeight: 600, color: C.muted2, padding: '3px 0' }}>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.reason}</span>
                      <span style={{ fontWeight: 800 }}>{r.count}</span>
                    </div>
                  ))}
                </div>
              )}
            </Panel>
          </div>

          <div style={{ fontSize: 11, fontWeight: 600, color: C.muted, textAlign: 'center', lineHeight: 1.6, padding: '4px 8px' }}>
            Per-package profit &amp; margin, ad spend / ROAS, and year-over-year comparison need cost &amp; ad-spend data that isn't captured yet — shown as “Not enough data yet” rather than estimated.
          </div>
        </>
      )}
    </div>
  );
}

/** CEO Morning Brief — birthdays + prioritised alerts, Critical → Low. */
function MorningBrief({ data }: { data: any }) {
  const alerts: any[] = data.alerts ?? [];
  const birthdays: string[] = data.birthdays ?? [];
  const LV: Record<string, { bg: string; fg: string; label: string }> = {
    critical: { bg: '#fdecea', fg: '#c0392b', label: 'CRITICAL' },
    high: { bg: '#fef2e3', fg: '#c98a2b', label: 'HIGH' },
    medium: { bg: '#fffbe6', fg: '#9a8322', label: 'MEDIUM' },
    low: { bg: C.pinkSoft, fg: C.pinkDeep, label: 'LOW' },
  };
  if (alerts.length === 0 && birthdays.length === 0) {
    return (
      <div style={{ background: C.greenSoft, color: C.green, borderRadius: 16, padding: '14px 18px', fontSize: 13, fontWeight: 700 }}>
        ☀️ Good morning! Nothing urgent right now — everything is on track. 🎉
      </div>
    );
  }
  return (
    <div style={{ background: '#fff', border: `1px solid ${C.line}`, borderRadius: 20, boxShadow: C.shadow, overflow: 'hidden' }}>
      <div style={{ height: 5, background: `linear-gradient(90deg,${C.pinkDeep},${C.pink})` }} />
      <div style={{ padding: '16px 20px' }}>
        <div style={{ ...fredoka(15), marginBottom: 12 }}>☀️ Your morning brief</div>
        {birthdays.length > 0 && (
          <div style={{ background: C.pinkSoft, color: C.pinkDeep, borderRadius: 12, padding: '10px 13px', fontSize: 13, fontWeight: 700, marginBottom: 10 }}>
            🎂 Birthday today: {birthdays.join(', ')} — send them a wish!
          </div>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {alerts.map((a, i) => {
            const lv = LV[a.level] ?? LV.low;
            return (
              <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'center', background: lv.bg, borderRadius: 12, padding: '10px 13px' }}>
                <span style={{ fontSize: 15, flex: 'none' }}>{a.icon}</span>
                <span style={{ flex: 1, fontSize: 12.5, fontWeight: 600, color: C.ink, lineHeight: 1.45 }}>{a.text}</span>
                <span style={{ flex: 'none', fontSize: 9.5, fontWeight: 800, letterSpacing: '.5px', color: lv.fg, background: '#fff', padding: '3px 7px', borderRadius: 20 }}>{lv.label}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/** Year-end forecast — 3 scenarios (estimate from run-rate + booked pipeline). */
function ForecastPanel({ f }: { f: any }) {
  const scen = [
    { key: 'conservative', label: 'Conservative', emoji: '🔴', color: C.red, s: f.conservative },
    { key: 'expected', label: 'Expected', emoji: '🟡', color: C.yellowInk, s: f.expected },
    { key: 'optimistic', label: 'Optimistic', emoji: '🟢', color: C.green, s: f.optimistic },
  ];
  return (
    <Panel title="Year-end forecast">
      <div style={{ fontSize: 11.5, fontWeight: 600, color: C.muted, marginBottom: 12 }}>
        Estimate from this year's run-rate + already-booked future revenue (AED {f.ytdRevenueDisplay} so far, AED {f.bookedFutureDisplay} booked ahead · {f.marginPct}% margin).
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 10 }}>
        {scen.map((x) => (
          <div key={x.key} style={{ border: `1px solid ${C.line}`, borderTop: `3px solid ${x.color}`, borderRadius: 14, padding: '12px 14px' }}>
            <div style={{ fontSize: 11.5, fontWeight: 800, color: x.color }}>{x.emoji} {x.label}</div>
            <div style={{ ...fredoka(19), color: C.ink, marginTop: 6 }}>AED {x.s.revenueDisplay}</div>
            <div style={{ fontSize: 11, fontWeight: 700, color: C.muted }}>revenue</div>
            <div style={{ fontSize: 13.5, fontWeight: 800, color: x.color, marginTop: 6 }}>AED {x.s.netDisplay}</div>
            <div style={{ fontSize: 11, fontWeight: 700, color: C.muted }}>est. net profit</div>
          </div>
        ))}
      </div>
    </Panel>
  );
}

/** Operational readiness for the week ahead. */
function OpsHealth({ ops }: { ops: any }) {
  const pct = ops.readinessPct;
  const cells = [
    { label: 'Events next 7 days', value: ops.upcoming7, tone: C.ink },
    { label: 'Fully ready', value: ops.fullyReady, tone: C.green },
    { label: 'Understaffed', value: ops.understaffed, tone: ops.understaffed > 0 ? C.red : C.muted },
    { label: 'Missing items', value: ops.withMissingItems, tone: ops.withMissingItems > 0 ? C.red : C.muted },
    { label: 'Late prep tasks', value: ops.latePrep, tone: ops.latePrep > 0 ? C.yellowInk : C.muted },
    { label: 'Prep at risk', value: ops.atRisk, tone: ops.atRisk > 0 ? C.red : C.muted },
  ];
  return (
    <Panel title="Operational health"
      action={pct != null ? <span style={{ ...fredoka(18), color: pct >= 80 ? C.green : pct >= 50 ? C.yellowInk : C.red }}>{pct}% ready</span> : undefined}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(110px,1fr))', gap: 10 }}>
        {cells.map((c) => (
          <div key={c.label} style={{ border: `1px solid ${C.line}`, borderRadius: 12, padding: '11px 12px' }}>
            <div style={{ ...fredoka(22), color: c.tone }}>{c.value}</div>
            <div style={{ fontSize: 10.5, fontWeight: 700, color: C.muted, marginTop: 2 }}>{c.label}</div>
          </div>
        ))}
      </div>
    </Panel>
  );
}

function DeltaChip({ v }: { v: number | null | undefined }) {
  if (v === null || v === undefined) return null;
  const up = v >= 0;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 11.5, fontWeight: 800, color: up ? C.green : C.red, background: up ? C.greenSoft : C.redSoft, padding: '2px 8px', borderRadius: 999 }}>
      {up ? '▲' : '▼'} {Math.abs(v)}%
    </span>
  );
}

function Sparkline({ data, color }: { data: number[]; color: string }) {
  const W = 104, H = 34;
  if (!data || data.length < 2) return <div style={{ width: W, height: H }} />;
  const max = Math.max(...data), min = Math.min(...data);
  const range = max - min || 1;
  let lastY = H / 2;
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * W;
    const y = H - ((v - min) / range) * (H - 6) - 3;
    lastY = y;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ flex: 'none' }}>
      <polygon points={`0,${H} ${pts} ${W},${H}`} fill={color} opacity={0.1} />
      <polyline points={pts} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={W} cy={lastY} r={2.6} fill={color} />
    </svg>
  );
}

function HeroKpi({ label, value, delta, caption, spark, accent }: { label: string; value: string; delta?: number | null; caption?: string; spark?: number[]; accent: string }) {
  return (
    <div style={{ background: '#fff', border: `1px solid ${C.line}`, borderRadius: 20, padding: '16px 18px', boxShadow: C.shadow, borderTop: `3px solid ${accent}` }}>
      <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 0.5, textTransform: 'uppercase', color: C.muted }}>{label}</div>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 10, marginTop: 6 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ ...fredoka(25), color: C.ink, whiteSpace: 'nowrap' }}>{value}</div>
          <div style={{ marginTop: 5, minHeight: 18 }}>
            {delta !== undefined ? <DeltaChip v={delta} /> : caption ? <span style={{ fontSize: 12, fontWeight: 700, color: C.muted }}>{caption}</span> : null}
          </div>
        </div>
        {spark && <Sparkline data={spark} color={accent} />}
      </div>
    </div>
  );
}

function MiniRow({ label, value, sub, tone, last }: { label: string; value: string; sub?: string; tone?: string; last?: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '9px 0', borderBottom: last ? 'none' : `1px solid ${C.lineSoft}` }}>
      <span style={{ fontSize: 12.5, fontWeight: 600, color: C.muted2 }}>{label}</span>
      <span style={{ textAlign: 'right' }}>
        <span style={{ fontSize: 13.5, fontWeight: 800, color: tone ?? C.ink, whiteSpace: 'nowrap' }}>{value}</span>
        {sub && <div style={{ fontSize: 10.5, fontWeight: 600, color: C.muted }}>{sub}</div>}
      </span>
    </div>
  );
}

function RevenueChart({ trend }: { trend: Array<{ month: string; revenueFils: number; revenueDisplay: string; bookings: number }> }) {
  if (!trend || trend.length === 0) return <div style={{ color: C.muted, fontSize: 13, fontWeight: 600 }}>No data in this range.</div>;
  const max = Math.max(1, ...trend.map((t) => t.revenueFils));
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, height: 210, overflowX: 'auto', paddingTop: 8 }}>
      {trend.map((t) => (
        <div key={t.month} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, minWidth: 44, flex: 1 }}>
          <div style={{ fontSize: 10, fontWeight: 800, color: C.pinkDeep }}>{t.revenueFils > 0 ? t.revenueDisplay : ''}</div>
          <div style={{ width: '100%', maxWidth: 40, height: `${Math.round((t.revenueFils / max) * 150)}px`, minHeight: 3, background: `linear-gradient(180deg,${C.pink},${C.pinkDeep})`, borderRadius: '8px 8px 4px 4px' }} title={`AED ${t.revenueDisplay} · ${t.bookings} bookings`} />
          <div style={{ fontSize: 10, fontWeight: 700, color: C.muted }}>{t.month.slice(2)}</div>
          <div style={{ fontSize: 9.5, fontWeight: 700, color: C.muted2 }}>{t.bookings}</div>
        </div>
      ))}
    </div>
  );
}

function Funnel({ funnel }: { funnel?: { leads: number; quoted: number; booked: number; conversionPct: number } }) {
  if (!funnel || funnel.leads === 0) return <div style={{ color: C.muted, fontSize: 13, fontWeight: 600 }}>No WhatsApp leads yet.</div>;
  const stages = [
    { label: 'Leads', value: funnel.leads, color: C.pink },
    { label: 'Quoted', value: funnel.quoted, color: C.yellow },
    { label: 'Booked', value: funnel.booked, color: C.green },
  ];
  const max = Math.max(1, funnel.leads);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {stages.map((s) => (
        <div key={s.label}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
            <span style={{ fontSize: 12.5, fontWeight: 700, color: C.ink }}>{s.label}</span>
            <span style={{ fontSize: 12.5, fontWeight: 800, color: C.muted2 }}>{s.value}</span>
          </div>
          <div style={{ height: 10, background: C.lineSoft, borderRadius: 999 }}>
            <div style={{ width: `${Math.round((s.value / max) * 100)}%`, height: '100%', background: s.color, borderRadius: 999 }} />
          </div>
        </div>
      ))}
      <div style={{ fontSize: 12, fontWeight: 700, color: C.pinkDeep, marginTop: 2 }}>{funnel.conversionPct}% lead → booking conversion</div>
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
  border: `1.5px solid ${C.line}`, borderRadius: 999, padding: '7px 13px', fontWeight: 700, fontSize: 12.5,
  color: C.muted2, background: '#fff', cursor: 'pointer', outline: 'none',
};
