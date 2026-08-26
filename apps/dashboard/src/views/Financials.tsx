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

      <RevenueByYear />
      <AddYear onSaved={load} />
      <MigrationPanel />
      <PackageMerge />
    </div>
  );
}

/** Revenue per year, computed live from the imported invoice lines. */
function RevenueByYear() {
  const [data, setData] = useState<any[] | null>(null);
  useEffect(() => { api.revenueByYear().then(setData).catch(() => setData([])); }, []);
  if (!data || data.length === 0) return null;
  const max = Math.max(1, ...data.map((d) => d.revenueFils));
  return (
    <Panel title="Revenue by year — from your QuickBooks invoices">
      <div style={{ fontSize: 12, fontWeight: 600, color: C.muted2, marginBottom: 14 }}>
        Calculated straight from the {data.reduce((s, d) => s + d.lines, 0).toLocaleString()} imported invoice lines — your real sales history.
      </div>
      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-end', height: 160, paddingTop: 8 }}>
        {data.map((d) => {
          const h = Math.round((d.revenueFils / max) * 120) + 4;
          return (
            <div key={d.year} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, minWidth: 0 }}>
              <div style={{ fontSize: 11.5, fontWeight: 800, color: C.ink }}>AED {money(d.revenueFils)}</div>
              <div style={{ width: '100%', maxWidth: 70, height: h, borderRadius: 10, background: `linear-gradient(180deg, ${C.pink}, ${C.pinkDeep})` }} />
              <div style={{ fontSize: 12.5, fontWeight: 800, color: C.ink }}>{d.year}</div>
              <div style={{ fontSize: 10.5, fontWeight: 600, color: C.muted }}>{d.invoices} invoices</div>
            </div>
          );
        })}
      </div>
    </Panel>
  );
}

/** Lists the package/product names from invoices and merges renamed duplicates. */
function PackageMerge() {
  const [products, setProducts] = useState<any[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [target, setTarget] = useState<string>('');

  const load = () => api.importProducts().then(setProducts).catch(() => setProducts([]));
  useEffect(() => { load(); }, []);

  const toggleSel = (name: string) => setSel((s) => { const n = new Set(s); if (n.has(name)) n.delete(name); else n.add(name); return n; });
  const mergeSelected = async () => {
    const names = [...sel];
    const into = target || names[0];
    const map: Record<string, string> = {};
    for (const n of names) if (n !== into) map[n] = into;
    if (Object.keys(map).length === 0) return;
    setBusy(true); setMsg(null);
    try {
      const r = await api.mergeProducts(map);
      setMsg(`Merged ${Object.keys(map).length} name(s) into “${into}” — ${r.updated} invoice lines updated.`);
      setSel(new Set()); setTarget(''); load();
    } finally { setBusy(false); }
  };

  const groups = useMemo(() => {
    const list = products ?? [];
    // Safe typo fix, always applied.
    const fix = (name: string) => name.trim().replace(/\s+/g, ' ').replace(/pakage/gi, 'Package');
    const fixedSet = new Set(list.map((p) => fix(p.product).toLowerCase()));
    // Drop a leading "New " ONLY when a real counterpart package exists — so a
    // renamed "New Bronze Package" merges into "Bronze Package", but a genuine
    // "New Born Set Up" (a newborn setup) is left untouched.
    const canon = (name: string) => {
      const f = fix(name);
      const stripped = f.replace(/^new\s+/i, '').trim();
      if (/^new\s+/i.test(f) && stripped && fixedSet.has(stripped.toLowerCase())) return stripped;
      return f;
    };
    const m = new Map<string, { target: string; names: any[] }>();
    for (const p of list) {
      const key = canon(p.product).toLowerCase();
      if (!m.has(key)) m.set(key, { target: canon(p.product), names: [] });
      m.get(key)!.names.push(p);
    }
    return [...m.values()];
  }, [products]);

  const dupes = groups.filter((g) => g.names.length > 1 || g.names[0].product !== g.target);

  const mergeAll = async () => {
    setBusy(true); setMsg(null);
    const map: Record<string, string> = {};
    for (const g of dupes) for (const n of g.names) if (n.product !== g.target) map[n.product] = g.target;
    try {
      const r = await api.mergeProducts(map);
      setMsg(`Merged — ${r.updated} invoice lines updated across ${Object.keys(map).length} renamed packages.`);
      load();
    } finally { setBusy(false); }
  };

  if (!products) return null;

  return (
    <Panel title={`Package names (${products.length})`}>
      <div style={{ fontSize: 12, fontWeight: 600, color: C.muted2, marginBottom: 12 }}>
        Package names from your invoices. Renamed duplicates (e.g. “New Silver Pakage” → “Silver Package”) can be merged into one.
      </div>
      {dupes.length > 0 && (
        <div style={{ background: C.yellowSoft, border: '1px solid #f0dca8', borderRadius: 12, padding: '12px 14px', marginBottom: 12 }}>
          <div style={{ fontSize: 12.5, fontWeight: 800, color: C.yellowInk, marginBottom: 8 }}>
            {dupes.length} package{dupes.length > 1 ? 's have' : ' has'} duplicate names to merge:
          </div>
          {dupes.slice(0, 12).map((g) => (
            <div key={g.target} style={{ fontSize: 12, fontWeight: 600, color: C.yellowInk, padding: '2px 0' }}>
              {g.names.map((n: any) => `“${n.product}”`).join(' + ')} → <b>{g.target}</b>
            </div>
          ))}
          <div style={{ marginTop: 10 }}>
            <Button onClick={mergeAll} disabled={busy}>{busy ? 'Merging…' : 'Merge duplicates'}</Button>
          </div>
        </div>
      )}
      {dupes.length === 0 && <div style={{ fontSize: 12.5, fontWeight: 700, color: C.green, marginBottom: 8 }}>No auto-detected duplicates. Tick names below to merge them by hand.</div>}

      {/* Manual merge — tick two or more names (e.g. “New Silver Package” + “Silver Kids Package”) and merge them into one. */}
      {sel.size >= 2 && (
        <div style={{ background: C.pinkSoft, border: `1px solid ${C.pink}`, borderRadius: 12, padding: '12px 14px', marginBottom: 12 }}>
          <div style={{ fontSize: 12.5, fontWeight: 800, color: C.pinkDeep, marginBottom: 8 }}>Merge {sel.size} names into one:</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <select value={target || [...sel][0]} onChange={(e) => setTarget(e.target.value)}
              style={{ border: `1px solid ${C.line}`, borderRadius: 10, padding: '9px 11px', fontSize: 12.5, fontWeight: 700, background: '#fff', color: C.ink }}>
              {[...sel].map((n) => <option key={n} value={n}>Keep “{n}”</option>)}
            </select>
            <Button onClick={mergeSelected} disabled={busy}>{busy ? 'Merging…' : 'Merge selected'}</Button>
            <Button tone="ghost" onClick={() => { setSel(new Set()); setTarget(''); }}>Clear</Button>
          </div>
        </div>
      )}

      <div style={{ maxHeight: 300, overflowY: 'auto', border: `1px solid ${C.line}`, borderRadius: 12 }}>
        {[...(products ?? [])].sort((a, b) => b.total_fils - a.total_fils).map((p) => (
          <label key={p.product} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '8px 12px', borderBottom: `1px solid ${C.lineSoft}`, fontSize: 12.5, fontWeight: 600, cursor: 'pointer', background: sel.has(p.product) ? C.pinkSoft : 'transparent' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 8, color: C.ink }}>
              <input type="checkbox" checked={sel.has(p.product)} onChange={() => toggleSel(p.product)} />
              {p.product}
            </span>
            <span style={{ color: C.muted2, whiteSpace: 'nowrap' }}>{p.lines}× · AED {p.totalDisplay}</span>
          </label>
        ))}
      </div>
      {msg && <div style={{ marginTop: 10, color: C.green, fontWeight: 700, fontSize: 12.5 }}>{msg}</div>}
    </Panel>
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
  const [status, setStatus] = useState<any>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = () => api.importStatus().then(setStatus).catch(() => {});
  useEffect(() => { refresh(); }, []);

  const onFile = async (kind: 'customers' | 'orders' | 'expenses', file: File | undefined) => {
    if (!file) return;
    setBusy(true); setErr(null); setMsg(null);
    try {
      const { parseSheetFile } = await import('../sheet');
      const grid = await parseSheetFile(file);
      // QuickBooks reports carry a few title rows before the header; find the row
      // that looks like the column header and parse from there.
      const headerIdx = grid.findIndex((row) =>
        row.some((c) => /customer full name|phone|email|^name$|date|product|amount|total/i.test(String(c))),
      );
      if (headerIdx < 0) { setErr('Could not find a header row in that file. Make sure it is the exported report.'); return; }
      const header = grid[headerIdx].map((c) => String(c).trim());
      const rows = grid.slice(headerIdx + 1)
        .filter((r) => r.some((c) => String(c).trim() !== ''))
        .map((r) => {
          const o: Record<string, any> = {};
          header.forEach((h, i) => { if (h) o[h] = r[i]; });
          return o;
        });
      if (rows.length === 0) { setErr('No data rows found in that file.'); return; }
      // Expenses: sum each line's amount by year (every expense report is a list
      // of dated line items). Skip group/subtotal rows (no date). Store per-year
      // totals — that's all the profit calculation needs.
      if (kind === 'expenses') {
        const isDate = (s: string) => /^\d{1,2}\/\d{1,2}\/\d{4}$|^\d{4}-\d{2}-\d{2}$/.test(s);
        const toFils = (v: any) => Math.round((Number(String(v ?? '').replace(/[^\d.-]/g, '')) || 0) * 100);
        const byYear: Record<string, number> = {};
        let lines = 0;
        for (const o of rows) {
          const d = String(o['Transaction date'] ?? o['Date'] ?? '').trim();
          if (!isDate(d)) continue;
          const year = d.includes('/') ? d.split('/')[2] : d.slice(0, 4);
          byYear[year] = (byYear[year] ?? 0) + toFils(o['Amount'] ?? o['Total'] ?? '');
          lines += 1;
        }
        // Expenses are costs — store the magnitude per year.
        for (const y of Object.keys(byYear)) byYear[y] = Math.abs(byYear[y]);
        if (lines === 0) { setErr('No dated expense lines found in that file.'); return; }
        const res = await api.saveExpensesByYear(byYear);
        setMsg(`Saved expenses for ${res.saved} year(s) (${lines} lines) from “${file.name}”.`);
        refresh();
        return;
      }
      // "Sales by Customer Detail" is grouped: a bare customer-name row, then its
      // line items, then a "Total for …" row. Stamp each line with its customer
      // here (before batching) so a batch boundary can never split a group.
      let payload = rows;
      if (kind === 'orders') {
        // The report groups by customer: a row with the customer NAME in the
        // first (label) column — which has an empty header — then that customer's
        // line items, then a "Total for …" row. Read the raw grid so the name in
        // column 0 isn't lost, and stamp each line with its customer.
        const isDate = (s: string) => /^\d{1,2}\/\d{1,2}\/\d{4}$|^\d{4}-\d{2}-\d{2}$/.test(String(s).trim());
        const dateCol = header.findIndex((h) => /transaction date|^date$/i.test(h));
        const amountCol = header.findIndex((h) => /^amount$|^total$/i.test(h));
        let current = '';
        const out: any[] = [];
        for (const row of grid.slice(headerIdx + 1)) {
          const label = String(row[0] ?? '').trim();
          const dateVal = dateCol >= 0 ? String(row[dateCol] ?? '').trim() : (row.find((c) => isDate(c)) ?? '');
          const amount = amountCol >= 0 ? String(row[amountCol] ?? '').trim() : '';
          if (!isDate(dateVal) && !amount && label && !/^total\b/i.test(label)) {
            current = label.replace(/\s*\(\d+\)\s*$/, '').trim();
            continue;
          }
          if (!isDate(dateVal)) continue; // subtotal / grand-total / blank
          const o: Record<string, any> = {};
          header.forEach((h, i) => { if (h) o[h] = row[i]; });
          out.push({ ...o, customerName: current });
        }
        payload = out;
        if (payload.length === 0) { setErr('No invoice lines found in that file.'); return; }
      }
      // Upload in batches to stay well under the request size limit.
      let inserted = 0;
      for (let i = 0; i < payload.length; i += 400) {
        const res = await api.importRows(kind, payload.slice(i, i + 400));
        inserted += res.inserted;
      }
      setMsg(`Imported ${inserted} ${kind} from “${file.name}”.`);
      refresh();
    } catch (e: any) {
      setErr(e?.message || 'Could not read that file.');
    } finally { setBusy(false); }
  };

  return (
    <Panel title="Data migration — QuickBooks">
      <div style={{ fontSize: 12, fontWeight: 600, color: C.muted2, marginBottom: 12 }}>
        Brings your full customer book and invoice history from QuickBooks into Eventana. In QuickBooks open the
        report (Customer Contact List, or an invoice/sales list), click <b>Export&nbsp;▾ → Export to Excel</b>, then
        upload the file below. Safe to re-run — it updates, never duplicates.
      </div>
      {status && (
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
          <Stat label="Customers imported" value={status.customers?.n ?? 0} />
          <Stat label="With email" value={status.customers?.with_email ?? 0} />
          <Stat label="Invoices imported" value={status.orders?.n ?? 0} />
          <Stat label="Invoiced total" value={<>AED {money(Number(status.orders?.total_fils ?? 0))}</>} />
        </div>
      )}
      <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
        <UploadTile label="Customers" hint="Customer Contact List → Export to Excel" disabled={busy}
          onPick={(f) => onFile('customers', f)} />
        <UploadTile label="Invoices" hint="Sales by Customer Detail → Export as CSV" disabled={busy}
          onPick={(f) => onFile('orders', f)} />
        <UploadTile label="Expenses" hint="An expense report (by year) → Export as CSV" disabled={busy}
          onPick={(f) => onFile('expenses', f)} />
      </div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 12 }}>
        <Button tone="ghost" onClick={refresh} disabled={busy}>Refresh counts</Button>
        {busy && <span style={{ fontSize: 12, fontWeight: 700, color: C.pinkDeep }}>Working…</span>}
      </div>
      {msg && <div style={{ marginTop: 10, color: C.green, fontWeight: 700, fontSize: 12.5 }}>{msg}</div>}
      {err && <div style={{ marginTop: 10, color: C.red, fontWeight: 700, fontSize: 12.5 }}>{err}</div>}
      <div data-api-origin={apiOrigin()} style={{ display: 'none' }} />
    </Panel>
  );
}

function UploadTile({ label, hint, onPick, disabled }: { label: string; hint: string; onPick: (f: File | undefined) => void; disabled?: boolean }) {
  return (
    <label style={{
      flex: 1, minWidth: 220, border: `1.5px dashed ${C.line}`, borderRadius: 14, padding: '16px 18px',
      cursor: disabled ? 'not-allowed' : 'pointer', background: C.pinkSoft, opacity: disabled ? 0.6 : 1, display: 'block',
    }}>
      <div style={{ ...fredoka(15), color: C.ink }}>⬆ Upload {label}</div>
      <div style={{ fontSize: 11.5, fontWeight: 600, color: C.muted2, marginTop: 4 }}>{hint}</div>
      <input type="file" accept=".xlsx,.xls,.csv" disabled={disabled} style={{ display: 'none' }}
        onChange={(e) => onPick(e.target.files?.[0])} />
    </label>
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
