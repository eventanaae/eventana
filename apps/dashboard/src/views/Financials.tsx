import { Fragment, useEffect, useMemo, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { api, apiOrigin } from '../api';
import { Button, C, Panel, Spinner, Stat, fredoka, money } from '../ui';

/**
 * Financials (from QuickBooks). Every sale the business has ever made was taken
 * on WhatsApp and booked in QuickBooks — the live app only knows bookings placed
 * through it (2026+). This view shows the REAL money history imported from the
 * QuickBooks Profit & Loss: revenue, cost of sales, expenses, gross and net
 * profit, margin, and year-over-year growth once more than one year is present.
 *
 * FY2026 (year-to-date) is seeded from QuickBooks. Prior years (2023–2025) are
 * added here with the "Add / update a year" form — enter the three totals from
 * each year's QuickBooks P&L and the rest is derived.
 */

type Line = { label: string; fils: number };
type Period = {
  period: string;
  period_kind: 'year' | 'month';
  income_fils: number;
  cogs_fils: number;
  expenses_fils: number;
  gross_profit_fils: number;
  net_income_fils: number;
  income_breakdown: Line[] | null;
  expense_breakdown: Line[] | null;
  note: string | null;
  incomeDisplay: string;
  cogsDisplay: string;
  expensesDisplay: string;
  grossProfitDisplay: string;
  netIncomeDisplay: string;
  marginPct: number;
};
type Yoy = { period: string; netIncomeFils: number; growthPct: number | null };

export function Financials() {
  const [data, setData] = useState<{ periods: Period[]; yoy: Yoy[] } | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = () => api.financials().then(setData).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, []);

  if (err) return <div style={{ color: C.red, fontWeight: 700 }}>{err}</div>;
  if (!data) return <Spinner />;

  const years = data.periods.filter((p) => p.period_kind === 'year');
  const latest = years[0]; // periods come newest-first
  const missingPriorYears = ['2023', '2024', '2025'].filter(
    (y) => !years.some((p) => p.period === y),
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 980 }}>
      {latest && (
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, letterSpacing: '.6px', marginBottom: 8 }}>
            FY{latest.period}{latest.note?.includes('year-to-date') ? ' · YEAR TO DATE' : ''} — FROM QUICKBOOKS
          </div>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <Stat label="Revenue" value={<>AED {latest.incomeDisplay}</>} />
            <Stat label="Expenses" value={<>AED {money(latest.cogs_fils + latest.expenses_fils)}</>} />
            <Stat label="Net profit" value={<>AED {latest.netIncomeDisplay}</>} tone={latest.net_income_fils < 0 ? 'alert' : undefined} />
            <Stat label="Margin" value={<>{latest.marginPct}%</>} />
          </div>
        </div>
      )}

      {missingPriorYears.length > 0 && (
        <div style={{ background: C.yellowSoft, border: `1px solid #f0dca8`, borderRadius: 16, padding: '14px 16px' }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: C.yellowInk, marginBottom: 3 }}>
            Add {missingPriorYears.join(', ')} to see full history &amp; year-over-year growth
          </div>
          <div style={{ fontSize: 12, fontWeight: 600, color: C.yellowInk, opacity: 0.85 }}>
            Open each year's Profit &amp; Loss in QuickBooks and enter the three totals below — revenue (total income),
            cost of sales, and total expenses. Net profit and margin are calculated for you.
          </div>
        </div>
      )}

      {data.yoy.length > 1 && <YoyChart yoy={data.yoy} />}

      <Panel title="Year-by-year (QuickBooks Profit &amp; Loss)">
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 620 }}>
            <thead>
              <tr>
                <ColH>Period</ColH>
                <ColH right>Revenue</ColH>
                <ColH right>Cost of sales</ColH>
                <ColH right>Expenses</ColH>
                <ColH right>Net profit</ColH>
                <ColH right>Margin</ColH>
                <ColH />
              </tr>
            </thead>
            <tbody>
              {data.periods.map((p) => {
                const open = expanded === p.period;
                const hasDetail = (p.income_breakdown?.length ?? 0) + (p.expense_breakdown?.length ?? 0) > 0;
                return (
                  <Fragment key={p.period}>
                    <tr style={{ background: open ? C.pinkSoft : 'transparent' }}>
                      <Cell><span style={{ ...fredoka(14), color: C.ink }}>{p.period}</span>{p.period_kind === 'month' && <span style={{ fontSize: 10, color: C.muted, marginLeft: 6 }}>month</span>}</Cell>
                      <Cell right>AED {p.incomeDisplay}</Cell>
                      <Cell right>AED {p.cogsDisplay}</Cell>
                      <Cell right>AED {p.expensesDisplay}</Cell>
                      <Cell right><span style={{ fontWeight: 800, color: p.net_income_fils < 0 ? C.red : C.green }}>AED {p.netIncomeDisplay}</span></Cell>
                      <Cell right>{p.marginPct}%</Cell>
                      <Cell right>
                        {hasDetail && (
                          <button
                            onClick={() => setExpanded(open ? null : p.period)}
                            style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.pinkDeep, fontWeight: 800, fontSize: 12 }}
                          >
                            {open ? 'Hide' : 'Detail'}
                          </button>
                        )}
                      </Cell>
                    </tr>
                    {open && (
                      <tr>
                        <td colSpan={7} style={{ padding: '4px 12px 16px', borderBottom: `1px solid ${C.lineSoft}` }}>
                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(240px,1fr))', gap: 20 }}>
                            <Breakdown title="Income" lines={p.income_breakdown} />
                            <Breakdown title="Expenses" lines={p.expense_breakdown} />
                          </div>
                          {p.note && <div style={{ fontSize: 11.5, color: C.muted, marginTop: 10, fontStyle: 'italic' }}>{p.note}</div>}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </Panel>

      <AddYear onSaved={load} />
      <MigrationPanel />
    </div>
  );
}

/**
 * One-time data migration from QuickBooks. "Generate ticket" mints a short-lived
 * key; a collector running in the QuickBooks browser tab then sends the customer
 * and invoice lists straight into this database (only counts are shown here — no
 * contact details pass through anything in between). Idempotent, so it is safe
 * to re-run.
 */
function MigrationPanel() {
  const [ticket, setTicket] = useState<string | null>(null);
  const [status, setStatus] = useState<any>(null);
  const [busy, setBusy] = useState(false);

  const refresh = () => api.importStatus().then(setStatus).catch(() => {});
  useEffect(() => { refresh(); }, []);

  const gen = async () => {
    setBusy(true);
    try { const t = await api.importTicket(); setTicket(t.ticket); }
    finally { setBusy(false); }
  };

  return (
    <Panel title="Data migration — QuickBooks">
      <div style={{ fontSize: 12, fontWeight: 600, color: C.muted2, marginBottom: 12 }}>
        Imports your full customer book and invoice history from QuickBooks straight into Eventana.
        Only totals are shown here — no names, emails or numbers pass through anything in between.
      </div>
      {status && (
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
          <Stat label="Customers imported" value={status.customers?.n ?? 0} />
          <Stat label="With email" value={status.customers?.with_email ?? 0} />
          <Stat label="Invoices imported" value={status.orders?.n ?? 0} />
          <Stat label="Invoiced total" value={<>AED {money(Number(status.orders?.total_fils ?? 0))}</>} />
        </div>
      )}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <Button onClick={gen} disabled={busy}>{busy ? 'Generating…' : 'Generate import ticket'}</Button>
        <Button tone="ghost" onClick={refresh}>Refresh counts</Button>
        <span data-api-origin={apiOrigin()} style={{ fontSize: 11, color: C.muted }}>API: {apiOrigin()}</span>
      </div>
      {ticket && (
        <div data-import-ticket={ticket} style={{ marginTop: 12, padding: '10px 12px', background: C.pinkSoft, borderRadius: 12, fontSize: 12, fontWeight: 700, color: C.pinkDeep, wordBreak: 'break-all' }}>
          Ticket ready (valid ~30 min): {ticket}
        </div>
      )}
    </Panel>
  );
}

function ColH({ children, right }: { children?: ReactNode; right?: boolean }) {
  return (
    <th style={{ textAlign: right ? 'right' : 'left', padding: '9px 12px', borderBottom: `1.5px solid ${C.line}`, fontWeight: 700, fontSize: 11, color: C.muted, letterSpacing: '.3px', whiteSpace: 'nowrap' }}>
      {children}
    </th>
  );
}
function Cell({ children, right }: { children?: ReactNode; right?: boolean }) {
  return (
    <td style={{ textAlign: right ? 'right' : 'left', padding: '11px 12px', borderBottom: `1px solid ${C.lineSoft}`, fontSize: 12.5, fontWeight: 600, color: C.muted2, whiteSpace: 'nowrap' }}>
      {children}
    </td>
  );
}

function Breakdown({ title, lines }: { title: string; lines: Line[] | null }) {
  if (!lines || lines.length === 0) return null;
  const sorted = [...lines].sort((a, b) => Math.abs(b.fils) - Math.abs(a.fils));
  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 800, color: C.muted, letterSpacing: '.5px', marginBottom: 6 }}>{title.toUpperCase()}</div>
      {sorted.map((l) => (
        <div key={l.label} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '4px 0', fontSize: 12, fontWeight: 600, color: l.fils < 0 ? C.red : C.ink }}>
          <span style={{ color: C.muted2 }}>{l.label}</span>
          <span style={{ whiteSpace: 'nowrap' }}>AED {money(l.fils)}</span>
        </div>
      ))}
    </div>
  );
}

/** Small SVG bar chart of net profit per year, with growth chips. */
function YoyChart({ yoy }: { yoy: Yoy[] }) {
  const max = Math.max(1, ...yoy.map((y) => Math.abs(y.netIncomeFils)));
  return (
    <Panel title="Net profit by year">
      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-end', height: 150, paddingTop: 8 }}>
        {yoy.map((y) => {
          const h = Math.round((Math.abs(y.netIncomeFils) / max) * 110) + 4;
          const neg = y.netIncomeFils < 0;
          return (
            <div key={y.period} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, minWidth: 0 }}>
              <div style={{ fontSize: 11, fontWeight: 800, color: neg ? C.red : C.green }}>AED {money(y.netIncomeFils)}</div>
              <div style={{ width: '100%', maxWidth: 64, height: h, borderRadius: 10, background: neg ? C.redSoft : `linear-gradient(180deg, ${C.pink}, ${C.pinkDeep})`, border: neg ? `1px solid ${C.red}` : 'none' }} />
              <div style={{ fontSize: 12, fontWeight: 700, color: C.ink }}>{y.period}</div>
              {y.growthPct != null && (
                <div style={{ fontSize: 10.5, fontWeight: 800, color: y.growthPct >= 0 ? C.green : C.red }}>
                  {y.growthPct >= 0 ? '▲' : '▼'} {Math.abs(y.growthPct)}%
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Panel>
  );
}

function AddYear({ onSaved }: { onSaved: () => void }) {
  const [period, setPeriod] = useState('');
  const [income, setIncome] = useState('');
  const [cogs, setCogs] = useState('');
  const [expenses, setExpenses] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const toFils = (s: string) => Math.round((Number(s.replace(/,/g, '')) || 0) * 100);
  const preview = useMemo(() => {
    const inc = toFils(income), cg = toFils(cogs), ex = toFils(expenses);
    return { gross: inc - cg, net: inc - cg - ex };
  }, [income, cogs, expenses]);

  const save = async () => {
    setErr(null); setMsg(null);
    if (!/^\d{4}(-\d{2})?$/.test(period.trim())) { setErr('Enter a year like 2024 (or a month like 2024-03).'); return; }
    if (!income.trim() || !expenses.trim()) { setErr('Enter at least revenue and total expenses.'); return; }
    setBusy(true);
    try {
      await api.saveFinancials({
        period: period.trim(),
        incomeFils: toFils(income),
        cogsFils: toFils(cogs),
        expensesFils: toFils(expenses),
        note: note.trim() || undefined,
      });
      setMsg(`Saved ${period.trim()}.`);
      setPeriod(''); setIncome(''); setCogs(''); setExpenses(''); setNote('');
      onSaved();
    } catch (e: any) {
      setErr(e?.message || 'Could not save.');
    } finally { setBusy(false); }
  };

  return (
    <Panel title="Add / update a year (from QuickBooks)">
      <div style={{ fontSize: 12, fontWeight: 600, color: C.muted2, marginBottom: 12 }}>
        In QuickBooks, run <b>Reports → Profit and Loss</b> for the year, then copy the three totals here. Amounts in AED.
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 10 }}>
        <Field label="Year *" value={period} onChange={setPeriod} placeholder="2024" />
        <Field label="Revenue (total income) *" value={income} onChange={setIncome} placeholder="e.g. 380000" />
        <Field label="Cost of sales" value={cogs} onChange={setCogs} placeholder="e.g. 20000" />
        <Field label="Total expenses *" value={expenses} onChange={setExpenses} placeholder="e.g. 180000" />
      </div>
      <div style={{ marginTop: 10 }}>
        <Field label="Note (optional)" value={note} onChange={setNote} placeholder="e.g. FY2024 full year" />
      </div>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 14, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12.5, fontWeight: 700, color: C.muted2 }}>
          Gross profit: <b style={{ color: C.ink }}>AED {money(preview.gross)}</b>
          <span style={{ margin: '0 10px', color: C.line }}>|</span>
          Net profit: <b style={{ color: preview.net < 0 ? C.red : C.green }}>AED {money(preview.net)}</b>
        </span>
        <div style={{ flex: 1 }} />
        <Button onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save year'}</Button>
      </div>
      {msg && <div style={{ marginTop: 10, color: C.green, fontWeight: 700, fontSize: 12.5 }}>{msg}</div>}
      {err && <div style={{ marginTop: 10, color: C.red, fontWeight: 700, fontSize: 12.5 }}>{err}</div>}
    </Panel>
  );
}

function Field({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <label style={{ display: 'block' }}>
      <span style={{ display: 'block', fontSize: 11, fontWeight: 700, color: C.muted, marginBottom: 4 }}>{label}</span>
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} style={input} />
    </label>
  );
}

const input: CSSProperties = {
  width: '100%', border: `1px solid ${C.line}`, borderRadius: 10, padding: '9px 11px',
  fontSize: 12.5, fontWeight: 600, outline: 'none', background: '#fff', color: C.ink,
};
