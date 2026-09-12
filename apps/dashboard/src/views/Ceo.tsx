import { useEffect, useMemo, useState } from 'react';
import { CELEBRATION_TYPES } from '@eventana/shared';
import { api } from '../api';
import { C, Panel, Spinner, fredoka, money } from '../ui';

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
  const [data, setData] = useState<any>(null);
  const [funnel, setFunnel] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const range = useMemo(() => presetRange(preset), [preset]);
  const periodLabel = PRESETS.find((p) => p.id === preset)?.label ?? 'this period';

  useEffect(() => {
    setLoading(true);
    setError(null);
    api
      .ceo({ from: range.from, to: range.to })
      .then(setData)
      .catch((e) => setError(e?.message || 'Could not load analytics.'))
      .finally(() => setLoading(false));
  }, [range.from, range.to]);

  // Website funnel is global (not range-filtered) — load it once.
  useEffect(() => { api.webFunnel().then(setFunnel).catch(() => setFunnel(null)); }, []);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Filters — a tidy two-row block: the period pills, then the two dropdowns. */}
      <div style={{ background: '#fff', border: `1px solid ${C.line}`, borderRadius: 16, boxShadow: C.shadow, padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 2 }}>
          {PRESETS.map((p) => (
            <button
              key={p.id}
              onClick={() => setPreset(p.id)}
              style={{
                border: `1.5px solid ${preset === p.id ? C.pink : C.line}`,
                background: preset === p.id ? C.pinkSoft : '#fff',
                color: preset === p.id ? C.pinkDeep : C.muted2,
                fontWeight: 700, fontSize: 12.5, padding: '7px 13px', borderRadius: 999, cursor: 'pointer', whiteSpace: 'nowrap', flex: 'none',
              }}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {loading && <Spinner />}
      {error && !loading && <Panel title="Analytics"><div style={{ color: C.red, fontWeight: 600, fontSize: 13 }}>{error}</div></Panel>}

      {data && !loading && (
        <>
          {/* CEO Morning Brief — birthdays + prioritised alerts (Critical→Low) */}
          <MorningBrief data={data} />

          {/* Website funnel: visitors → registered → booked */}
          {funnel && <WebFunnel f={funnel} />}

          {/* 1) Money in your account NOW — a fixed "right now" figure, not filtered */}
          {data.cash?.cashOnHandDisplay != null && (
            <div style={{ background: '#fff', border: `1px solid ${C.line}`, borderRadius: 20, boxShadow: C.shadow, overflow: 'hidden' }}>
              <div style={{ height: 5, background: `linear-gradient(90deg,${C.mint},${C.green})` }} />
              <div style={{ padding: '16px 20px' }}>
                <div style={{ ...fredoka(15), marginBottom: 6 }}>💰 Your money now</div>
                <div style={{ ...fredoka(30), color: C.green }}>AED {data.cash.cashOnHandDisplay}</div>
                <div style={{ fontSize: 12, fontWeight: 700, color: C.muted, marginBottom: 12 }}>total in your account right now</div>
                <MiniRow label="Money still owed to you" value={`AED ${data.cash.expectedInDisplay}`} sub="unpaid invoices + orders not yet paid" tone={C.green} last />
              </div>
            </div>
          )}

          {/* 2) FOR THE SELECTED PERIOD — these change when you change the filter above */}
          <div style={{ background: '#fff', border: `1px solid ${C.line}`, borderRadius: 20, boxShadow: C.shadow, overflow: 'hidden' }}>
            <div style={{ height: 5, background: `linear-gradient(90deg,${C.pink},${C.mint})` }} />
            <div style={{ padding: '16px 20px' }}>
              <div style={{ ...fredoka(15), marginBottom: 4 }}>📊 For {periodLabel.toLowerCase()}</div>
              <div style={{ fontSize: 11.5, fontWeight: 600, color: C.muted, marginBottom: 12 }}>Real income &amp; expenses for the period — from your full sales &amp; expense history.</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 12 }}>
                <HeroKpi label="Income" value={`AED ${data.periodIncomeDisplay}`} accent={C.pink} />
                <HeroKpi label="Expenses" value={`AED ${data.periodExpenseDisplay}`} accent={C.yellow} />
                <HeroKpi label={data.periodNetNegative ? 'Net loss' : 'Net profit'} value={`AED ${data.periodNetDisplay}`} caption={`${data.periodMarginPct}% margin`} accent={data.periodNetNegative ? C.red : C.green} />
                <HeroKpi label="Sales" value={String(data.periodSalesCount ?? 0)} caption="receipts in period" accent={C.mint} />
              </div>
            </div>
          </div>

          {/* 3) Refunds for the period — customer request vs OUR quality (a real loss) */}
          <Panel title={`💸 Refunds · ${periodLabel.toLowerCase()}`}>
            <MiniRow label="Total refunded" value={`AED ${data.refundDisplay}`} sub={`${data.cancelled} cancelled · ${data.cancelRatePct}% cancel rate`} tone={C.ink} />
            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
              <div style={{ flex: 1, background: C.redSoft, borderRadius: 12, padding: '10px 13px' }}>
                <div style={{ fontSize: 10, fontWeight: 800, color: C.red, letterSpacing: '.3px' }}>OUR QUALITY — LOSS</div>
                <div style={{ ...fredoka(17), color: C.red }}>AED {data.refundQualityDisplay ?? '0'}</div>
              </div>
              <div style={{ flex: 1, background: C.lineSoft, borderRadius: 12, padding: '10px 13px' }}>
                <div style={{ fontSize: 10, fontWeight: 800, color: C.muted2, letterSpacing: '.3px' }}>CUSTOMER ASKED</div>
                <div style={{ ...fredoka(17), color: C.ink }}>AED {data.refundCustomerDisplay ?? '0'}</div>
              </div>
            </div>
            {(data.cancelReasons ?? []).length > 0 && (
              <div style={{ marginTop: 12 }}>
                <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '.4px', color: C.muted, marginBottom: 5 }}>TOP CANCEL REASONS</div>
                {data.cancelReasons.map((r: any, i: number) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, fontWeight: 600, color: C.muted2, padding: '3px 0' }}>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.reason}</span>
                    <span style={{ fontWeight: 800 }}>{r.count}</span>
                  </div>
                ))}
              </div>
            )}
          </Panel>

          {/* 4) Top 3 for the period — most-requested emirates & themes, biggest expenses */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 12 }}>
            <Top3Orders title="🏆 Top emirates" rows={data.byEmirateFull ?? data.byEmirate} />
            <Top3Orders title="🎨 Top themes" rows={data.byTheme} note="Themes are tracked from 1 Sep — they weren't recorded before." />
            <Top3Expenses rows={data.periodExpenseByCat} />
          </div>

          {/* Customers · sales funnel */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(260px,1fr))', gap: 12 }}>
            <Panel title="Customers">
              <div style={{ ...fredoka(28), color: C.pinkDeep }}>{data.totalCustomers ?? 0}</div>
              <div style={{ fontSize: 12.5, fontWeight: 700, color: C.muted, marginTop: 2 }}>total customers</div>
              <div style={{ marginTop: 14 }}>
                <MiniRow label="Booked more than once" value={`${data.repeatRatePct}%`} sub={`${data.repeatCustomers} of ${data.totalCustomers}`} tone={C.pinkDeep} last />
              </div>
            </Panel>
            <Panel title="Sales funnel (WhatsApp)">
              <Funnel funnel={data.funnel} />
            </Panel>
          </div>

          {/* Revenue vs expenses vs net profit, per year (QuickBooks history) */}
          <YearPnl years={data.yearsPnl} />
        </>
      )}
    </div>
  );
}

/** Top-3 dimensions by number of orders (what's most requested), with revenue as context. */
function Top3Orders({ title, rows, note }: { title: string; rows: any[]; note?: string }) {
  const top = [...(rows ?? [])].sort((a, b) => (Number(b.bookings) || 0) - (Number(a.bookings) || 0)).slice(0, 3);
  return (
    <Panel title={title}>
      {top.length === 0 ? (
        <div style={{ color: C.muted, fontWeight: 600, fontSize: 12.5 }}>No orders in this period.</div>
      ) : top.map((r, i) => (
        <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, padding: '9px 0', borderBottom: i < top.length - 1 ? `1px solid ${C.lineSoft}` : 'none' }}>
          <span style={{ fontSize: 12.5, fontWeight: 700, color: C.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{i + 1}. {r.label}</span>
          <span style={{ fontSize: 12, fontWeight: 800, color: C.pinkDeep, flex: 'none' }}>{r.bookings} order{Number(r.bookings) === 1 ? '' : 's'}<span style={{ color: C.muted, fontWeight: 600 }}> · AED {r.revenueDisplay}</span></span>
        </div>
      ))}
      {note && <div style={{ fontSize: 10, fontWeight: 600, color: C.muted, marginTop: 8, lineHeight: 1.4 }}>{note}</div>}
    </Panel>
  );
}

/** Revenue vs Expenses vs Net profit, per year (from the QuickBooks history). */
function YearPnl({ years }: { years: any[] }) {
  if (!years || years.length === 0) return null;
  const max = Math.max(1, ...years.map((y) => Math.max(Number(y.revenueFils) || 0, Number(y.expensesFils) || 0)));
  return (
    <Panel title="📅 By year — revenue vs expenses vs profit">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {years.map((y) => {
          const rev = Number(y.revenueFils) || 0, exp = Number(y.expensesFils) || 0;
          const bar = (v: number, color: string) => (
            <div style={{ height: 9, borderRadius: 6, background: C.lineSoft, overflow: 'hidden' }}>
              <div style={{ width: `${Math.round((v / max) * 100)}%`, height: '100%', background: color }} />
            </div>
          );
          return (
            <div key={y.year}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 5 }}>
                <span style={{ ...fredoka(14), color: C.ink }}>{y.year}</span>
                <span style={{ fontSize: 11.5, fontWeight: 800, color: Number(y.netFils) < 0 ? C.red : C.green }}>Net AED {y.netDisplay} · {y.marginPct}%</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 10, fontWeight: 700, color: C.muted2, width: 62, flex: 'none' }}>Revenue</span>
                  <div style={{ flex: 1 }}>{bar(rev, C.pink)}</div>
                  <span style={{ fontSize: 10.5, fontWeight: 700, color: C.ink, width: 78, textAlign: 'right', flex: 'none' }}>{y.revenueDisplay}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 10, fontWeight: 700, color: C.muted2, width: 62, flex: 'none' }}>Expenses</span>
                  <div style={{ flex: 1 }}>{bar(exp, C.yellow)}</div>
                  <span style={{ fontSize: 10.5, fontWeight: 700, color: C.ink, width: 78, textAlign: 'right', flex: 'none' }}>{y.expensesDisplay}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <div style={{ fontSize: 10, fontWeight: 600, color: C.muted, marginTop: 10, lineHeight: 1.4 }}>
        Revenue from your full sales history; expenses from your yearly totals (0 where a year's expenses haven't been entered yet).
      </div>
    </Panel>
  );
}

/** Top-3 expense accounts by amount spent this period. */
function Top3Expenses({ rows }: { rows: any[] }) {
  const top = [...(rows ?? [])].slice(0, 3); // the API returns these amount-descending
  return (
    <Panel title="🧾 Top expenses">
      {top.length === 0 ? (
        <div style={{ color: C.muted, fontWeight: 600, fontSize: 12.5 }}>No expenses in this period.</div>
      ) : top.map((r, i) => (
        <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, padding: '9px 0', borderBottom: i < top.length - 1 ? `1px solid ${C.lineSoft}` : 'none' }}>
          <span style={{ fontSize: 12.5, fontWeight: 700, color: C.ink, textTransform: 'capitalize', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{i + 1}. {r.category}</span>
          <span style={{ fontSize: 12, fontWeight: 800, color: C.yellowInk, flex: 'none' }}>AED {r.amountDisplay}</span>
        </div>
      ))}
    </Panel>
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

/** Website funnel: visitors → registered → booked, with conversion at each step. */
function WebFunnel({ f }: { f: any }) {
  const steps = [
    { label: 'Visited the site', value: f.visitors, icon: '👀', accent: C.mint, sub: f.tracking ? `${f.visitorsLast30} in the last 30 days` : 'Collecting from now on' },
    { label: 'Registered an account', value: f.registered, icon: '📝', accent: C.pink, sub: `${f.registeredPct}% of visitors` },
    { label: 'Registered & booked', value: f.booked, icon: '🎉', accent: C.green, sub: `${f.bookedPct}% of registered` },
  ];
  const max = Math.max(1, f.visitors, f.registered, f.booked);
  return (
    <div style={{ background: '#fff', border: `1px solid ${C.line}`, borderRadius: 20, boxShadow: C.shadow, overflow: 'hidden' }}>
      <div style={{ height: 5, background: `linear-gradient(90deg,${C.mint},${C.pink},${C.green})` }} />
      <div style={{ padding: '16px 20px' }}>
        <div style={{ ...fredoka(15), marginBottom: 4 }}>🔎 Website funnel</div>
        <div style={{ fontSize: 11.5, fontWeight: 600, color: C.muted, marginBottom: 14 }}>
          {f.tracking
            ? `From ${f.visitors.toLocaleString()} visitors to ${f.booked.toLocaleString()} booked · ${f.overallPct}% overall`
            : 'Visitor tracking just went live — numbers will grow as people open the site.'}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {steps.map((s, i) => (
            <div key={i}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 4 }}>
                <span style={{ fontSize: 14 }}>{s.icon}</span>
                <span style={{ fontSize: 12.5, fontWeight: 700, color: C.ink, flex: 1 }}>{s.label}</span>
                <span style={{ ...fredoka(17), color: s.accent }}>{Number(s.value).toLocaleString()}</span>
              </div>
              <div style={{ height: 10, borderRadius: 6, background: C.lineSoft, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${Math.round((Number(s.value) / max) * 100)}%`, background: s.accent, transition: 'width .4s' }} />
              </div>
              <div style={{ fontSize: 10.5, fontWeight: 600, color: C.muted, marginTop: 3 }}>{s.sub}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Net profit by year — the real turnaround at a glance (from QuickBooks P&L). */
function YearBars({ years }: { years: Array<{ year: string; netFils: number }> }) {
  const max = Math.max(...years.map((y) => Math.abs(Number(y.netFils))), 1);
  return (
    <div style={{ marginTop: 18 }}>
      <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '.4px', color: C.muted, marginBottom: 10 }}>NET PROFIT BY YEAR</div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12, height: 118 }}>
        {years.map((y) => {
          const v = Number(y.netFils);
          const h = Math.round((Math.abs(v) / max) * 78) + 4;
          const neg = v < 0;
          return (
            <div key={y.year} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5 }}>
              <div style={{ fontSize: 11, fontWeight: 800, color: neg ? C.red : C.green }}>{neg ? '−' : '+'}{(Math.abs(v) / 100000).toFixed(0)}K</div>
              <div style={{ width: '100%', maxWidth: 46, height: h, borderRadius: '8px 8px 4px 4px', background: neg ? C.red : `linear-gradient(180deg,${C.mint},${C.mintDeep})` }} title={`AED ${(v / 100).toLocaleString()}`} />
              <div style={{ fontSize: 11, fontWeight: 700, color: C.muted2 }}>{y.year}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Year-end forecast — 3 scenarios (estimate from run-rate + booked pipeline). */
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
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ ...fredoka(22), fontSize: 'clamp(16px,4.6vw,23px)', color: C.ink, lineHeight: 1.12, wordBreak: 'break-word' }}>{value}</div>
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
