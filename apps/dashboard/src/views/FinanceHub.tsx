import { useEffect, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { api } from '../api';
import { Button, C, Panel, Spinner, fredoka, money } from '../ui';
import { NewOrder } from './NewOrder';

/**
 * The dashboard's finance hub — a lean, QuickBooks-style set of tools:
 *   Accounting · Sales & Get Paid (Invoices + Sales receipts) · Expenses.
 * Deliberately simple: a list per document with a single "+" that opens one
 * short form. Cash on hand is the only account. Uses the migrated customer book
 * and the catalogue for line items.
 */

type Tab = 'sales' | 'expenses' | 'accounting';

export function FinanceHub({ role }: { role?: string }) {
  const [tab, setTab] = useState<Tab>('sales');
  // Accounting (cash-on-hand balance) is an income total — Owner only.
  const canSeeAccounting = role === 'owner';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 900 }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <TabBtn on={tab === 'sales'} onClick={() => setTab('sales')}>💸 Sales &amp; Get Paid</TabBtn>
        <TabBtn on={tab === 'expenses'} onClick={() => setTab('expenses')}>🧾 Expenses</TabBtn>
        {canSeeAccounting && <TabBtn on={tab === 'accounting'} onClick={() => setTab('accounting')}>🏦 Accounting</TabBtn>}
      </div>
      {tab === 'sales' && <SalesTab isOwner={role === 'owner'} />}
      {tab === 'expenses' && <ExpensesTab />}
      {tab === 'accounting' && canSeeAccounting && <AccountingTab />}
    </div>
  );
}

function TabBtn({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button onClick={onClick} style={{
      border: `1.5px solid ${on ? C.pink : C.line}`, background: on ? C.pinkSoft : '#fff', color: on ? C.pinkDeep : C.muted2,
      fontWeight: 800, fontSize: 13, padding: '9px 16px', borderRadius: 14, cursor: 'pointer',
    }}>{children}</button>
  );
}

// ── Accounting ───────────────────────────────────────────────────────────────
function AccountingTab() {
  const [data, setData] = useState<any>(null);
  useEffect(() => { api.finAccounting().then(setData).catch(() => setData({ accounts: [] })); }, []);
  if (!data) return <Spinner />;
  return (
    <Panel title="Accounts">
      <div style={{ fontSize: 12, fontWeight: 600, color: C.muted2, marginBottom: 14 }}>
        The accounts you use and how much is in each. Cash on hand grows with sales receipts &amp; collected invoices, and shrinks with expenses.
      </div>
      {data.accounts.map((a: any) => (
        <div key={a.name} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 4px', borderBottom: `1px solid ${C.lineSoft}` }}>
          <div>
            <div style={{ fontSize: 10.5, fontWeight: 800, color: C.muted, letterSpacing: '.5px' }}>{a.group.toUpperCase()}</div>
            <div style={{ ...fredoka(15), color: C.ink }}>{a.name}</div>
            {a.note && <div style={{ fontSize: 11, color: C.muted, fontWeight: 600 }}>{a.note}</div>}
          </div>
          <div style={{ ...fredoka(18), color: a.balanceFils < 0 ? C.red : C.ink }}>AED {money(a.balanceFils)}</div>
        </div>
      ))}
    </Panel>
  );
}

// ── Sales & Get Paid (Invoices + Receipts) ───────────────────────────────────
function SalesTab({ isOwner }: { isOwner?: boolean }) {
  const [sub, setSub] = useState<'invoices' | 'receipts'>('receipts');
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', gap: 8 }}>
        <SubBtn on={sub === 'receipts'} onClick={() => setSub('receipts')}>Sales receipts</SubBtn>
        <SubBtn on={sub === 'invoices'} onClick={() => setSub('invoices')}>Invoices</SubBtn>
      </div>
      {sub === 'invoices' ? <InvoicesList isOwner={isOwner} /> : <ReceiptsList isOwner={isOwner} />}
    </div>
  );
}
function SubBtn({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button onClick={onClick} style={{
      border: 'none', borderBottom: `2.5px solid ${on ? C.pink : 'transparent'}`, background: 'none',
      color: on ? C.ink : C.muted, fontWeight: 800, fontSize: 13.5, padding: '6px 4px', cursor: 'pointer',
    }}>{children}</button>
  );
}

function InvoicesList({ isOwner }: { isOwner?: boolean }) {
  const [data, setData] = useState<any>(null);
  const [creating, setCreating] = useState(false);
  const [sel, setSel] = useState<any>(null);
  const load = () => api.finInvoices().then(setData).catch(() => setData({ invoices: [] }));
  useEffect(() => { load(); }, []);
  if (!data) return <Spinner />;
  return (
    <Panel
      title="Invoices"
      action={<Button onClick={() => setCreating(true)}>+ New invoice</Button>}
    >
      <div style={{ fontSize: 12.5, fontWeight: 700, color: C.muted2, marginBottom: 12 }}>
        Paid <b style={{ color: C.green }}>AED {data.paidDisplay ?? '0'}</b> · Unpaid <b style={{ color: C.red }}>AED {data.unpaidDisplay ?? '0'}</b>
      </div>
      {(data.invoices ?? []).length === 0 && <Empty>No invoices yet. Create one to bill a customer.</Empty>}
      {(data.invoices ?? []).map((inv: any) => (
        <DocRow key={inv.id} onClick={() => setSel(inv)}
          title={inv.customer_name} sub={`Invoice ${inv.number} · ${fmtDate(inv.issue_date)}`}
          amount={inv.totalDisplay}
          badge={<StatusBadge status={inv.status} overdueDays={inv.overdueDays} />}
          action={inv.status !== 'paid' ? <button style={linkBtn} onClick={async () => { await api.finSetInvoiceStatus(inv.id, 'paid'); load(); }}>Mark paid</button> : null}
        />
      ))}
      {creating && <DocForm kind="invoice" isOwner={isOwner} onClose={() => setCreating(false)} onSaved={() => { setCreating(false); load(); }} />}
      {sel && <DocDetail doc={sel} kind="invoice" isOwner={isOwner} onClose={() => setSel(null)} onChanged={load} />}
    </Panel>
  );
}

/**
 * Add-on flow: pick an upcoming paid booking (or one passed in), then build the
 * extra products for it. Reused from the Sales page and a receipt's detail view.
 */
export function AddonFlow({ onClose, initialEventId }: { onClose: () => void; initialEventId?: string }) {
  const [eventId, setEventId] = useState(initialEventId ?? '');
  const [events, setEvents] = useState<any[] | null>(initialEventId ? [] : null);
  useEffect(() => {
    if (initialEventId) return;
    const today = new Date().toISOString().slice(0, 10);
    api.events()
      .then((list: any[]) => setEvents(
        (list || [])
          .filter((e) => String(e.event_date).slice(0, 10) >= today && e.order_status === 'paid' && e.phase !== 'Cancelled')
          .sort((a, b) => String(a.event_date).localeCompare(String(b.event_date))),
      ))
      .catch(() => setEvents([]));
  }, [initialEventId]);

  if (eventId) {
    return (
      <Modal title="Add-on — build the extras" onClose={onClose}>
        <NewOrder addonEventId={eventId} />
      </Modal>
    );
  }
  return (
    <Modal title="Add-on — pick the booking" onClose={onClose}>
      <div style={{ fontSize: 12, fontWeight: 600, color: C.muted, marginBottom: 10 }}>Choose the upcoming booking to add to.</div>
      {!events ? <Spinner /> : events.length === 0 ? (
        <div style={{ fontSize: 12.5, color: C.muted, fontWeight: 600, padding: 8 }}>No upcoming paid bookings to add to.</div>
      ) : (
        <div style={{ maxHeight: 380, overflowY: 'auto' }}>
          {events.map((e) => (
            <button key={e.id} onClick={() => setEventId(e.id)} style={{ ...rowBtn }}>
              <span style={{ fontWeight: 700, color: C.ink }}>{e.customer} · {fmtDate(e.event_date)}</span>
              <span style={{ fontSize: 11, color: C.muted }}>{e.id} · {e.emirate}</span>
            </button>
          ))}
        </div>
      )}
    </Modal>
  );
}

function ReceiptsList({ isOwner }: { isOwner?: boolean }) {
  const [data, setData] = useState<any>(null);
  const [creating, setCreating] = useState(false);
  const [newOrder, setNewOrder] = useState(false);
  const [addon, setAddon] = useState(false);
  const [fixing, setFixing] = useState(false);
  const [sel, setSel] = useState<any>(null);
  const [q, setQ] = useState('');
  const load = () => api.finReceipts().then(setData).catch(() => setData({ receipts: [] }));
  useEffect(() => { load(); }, []);

  const fixNames = async (file: File | undefined) => {
    if (!file) return;
    setFixing(true);
    try {
      const { parseSheetFile } = await import('../sheet');
      const grid = await parseSheetFile(file);
      const headerIdx = grid.findIndex((r) => r.some((c) => /transaction date|number|amount/i.test(String(c))));
      if (headerIdx < 0) { alert('Could not read that report.'); return; }
      const header = grid[headerIdx].map((c) => String(c).trim());
      const isDate = (s: any) => /^\d{1,2}\/\d{1,2}\/\d{4}$|^\d{4}-\d{2}-\d{2}$/.test(String(s).trim());
      const dateCol = header.findIndex((h) => /transaction date|^date$/i.test(h));
      const numCol = header.findIndex((h) => /number|^num$|^no\.?$/i.test(h));
      let current = '';
      const map: Record<string, string> = {};
      for (const row of grid.slice(headerIdx + 1)) {
        const label = String(row[0] ?? '').trim();
        const dateVal = dateCol >= 0 ? String(row[dateCol] ?? '').trim() : '';
        if (!isDate(dateVal) && label && !/^total\b/i.test(label)) { current = label.replace(/\s*\(\d+\)\s*$/, '').trim(); continue; }
        if (!isDate(dateVal)) continue;
        const doc = numCol >= 0 ? String(row[numCol] ?? '').trim() : '';
        if (doc && current) map[doc] = current;
      }
      const entries = Object.entries(map);
      let updated = 0;
      for (let i = 0; i < entries.length; i += 400) { const r = await api.finAttribute(Object.fromEntries(entries.slice(i, i + 400))); updated += r.updated; }
      alert(`Fixed customer names on ${updated} receipts.`);
      load();
    } catch (e: any) { alert('Could not fix names: ' + (e?.message || '')); } finally { setFixing(false); }
  };

  if (!data) return <Spinner />;
  return (
    <Panel title="Sales receipts">
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 12 }}>
        <Button onClick={() => setNewOrder(true)}>+ New order</Button>
        <Button tone="ghost" onClick={() => setAddon(true)}>+ Add-on</Button>
        <Button tone="ghost" onClick={() => setCreating(true)}>+ New manual receipt</Button>
      </div>
      {data.totalDisplay != null && (
        <div style={{ fontSize: 12.5, fontWeight: 700, color: C.muted2, marginBottom: 6 }}>
          Total collected: <b style={{ color: C.green }}>AED {data.totalDisplay}</b> → Cash on hand
        </div>
      )}
      {(data.receipts ?? []).some((r: any) => r.customer_name === 'Customer') && (
        <label style={{ display: 'inline-block', marginBottom: 12, fontSize: 11.5, fontWeight: 700, color: C.pinkDeep, cursor: fixing ? 'wait' : 'pointer' }}>
          {fixing ? 'Fixing names…' : '⚙ Fix customer names (upload the Sales by Customer Detail CSV)'}
          <input type="file" accept=".csv,.xlsx" disabled={fixing} style={{ display: 'none' }} onChange={(e) => fixNames(e.target.files?.[0])} />
        </label>
      )}
      {(data.receipts ?? []).length > 0 && (
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="🔍 Search by name, mobile, or emirate…"
          style={{
            width: '100%', boxSizing: 'border-box', border: `1px solid ${C.line}`, borderRadius: 12,
            padding: '10px 13px', fontSize: 13, fontWeight: 600, outline: 'none', background: '#fff',
            color: C.ink, marginBottom: 12,
          }}
        />
      )}
      {(data.receipts ?? []).length === 0 && (
        <div style={{ textAlign: 'center', padding: '14px 4px' }}>
          <div style={{ fontSize: 12.5, color: C.muted, fontWeight: 600, marginBottom: 10 }}>No receipts yet.</div>
          <Button tone="ghost" onClick={async () => { const r = await api.finImportHistory(); alert(`Loaded ${r.receipts} sales from your QuickBooks history.`); load(); }}>Load sales history from QuickBooks</Button>
        </div>
      )}
      {(() => {
        const s = q.trim().toLowerCase();
        const list = (data.receipts ?? []).filter((r: any) =>
          !s ||
          `${r.customer_name ?? ''} ${r.customer_phone ?? ''} ${r.city ?? ''} ${r.number ?? ''} ${r.event_for ?? ''} ${r.theme ?? ''}`
            .toLowerCase()
            .includes(s),
        );
        if (s && list.length === 0) {
          return <div style={{ fontSize: 12.5, color: C.muted, fontWeight: 600, padding: '10px 2px' }}>No receipts match “{q}”.</div>;
        }
        // Group into months (list is already newest-first). The Owner sees a
        // per-month collected total in each divider; the Manager sees the
        // divider + count only (income totals stay the Owner's alone).
        const showTotals = data.totalDisplay != null;
        const monthKey = (d: any) => { const t = new Date(d); return isNaN(+t) ? '—' : `${t.getFullYear()}-${String(t.getMonth()).padStart(2, '0')}`; };
        const monthLabel = (d: any) => { const t = new Date(d); return isNaN(+t) ? 'Undated' : t.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }); };
        const totals: Record<string, number> = {};
        const counts: Record<string, number> = {};
        for (const r of list) { const k = monthKey(r.date); totals[k] = (totals[k] ?? 0) + Number(r.total_fils || 0); counts[k] = (counts[k] ?? 0) + 1; }
        const out: ReactNode[] = [];
        let cur: string | null = null;
        for (const r of list) {
          const k = monthKey(r.date);
          if (k !== cur) {
            cur = k;
            out.push(
              <div key={`m-${k}`} style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: out.length ? 16 : 4, marginBottom: 6, paddingBottom: 6, borderBottom: `2px solid ${C.line}` }}>
                <span style={{ ...fredoka(14), color: C.ink }}>{monthLabel(r.date)}</span>
                <span style={{ fontSize: 11, fontWeight: 700, color: C.muted }}>· {counts[k]} receipt{counts[k] > 1 ? 's' : ''}</span>
                {showTotals && (
                  <span style={{ marginLeft: 'auto', fontSize: 13, fontWeight: 800, color: C.green }}>AED {money(totals[k])}</span>
                )}
              </div>,
            );
          }
          out.push(
            <DocRow key={r.id} onClick={() => setSel(r)}
              title={r.customer_name} sub={`Receipt ${r.number} · ${fmtDate(r.date)}${r.city ? ` · ${r.city}` : ''}`}
              amount={r.totalDisplay}
              badge={<span style={{ ...pill, background: C.greenSoft, color: C.green }}>PAID</span>}
            />,
          );
        }
        return out;
      })()}
      {creating && <DocForm kind="receipt" isOwner={isOwner} onClose={() => setCreating(false)} onSaved={() => { setCreating(false); load(); }} />}
      {newOrder && (
        <Modal title="New order — send a link" onClose={() => setNewOrder(false)}>
          <NewOrder />
        </Modal>
      )}
      {addon && <AddonFlow onClose={() => setAddon(false)} />}
      {sel && <DocDetail doc={sel} kind="receipt" isOwner={isOwner} onClose={() => setSel(null)} onChanged={load} />}
    </Panel>
  );
}

// ── Expenses ─────────────────────────────────────────────────────────────────
function ReceiptViewer({ url, onClose }: { url: string; onClose: () => void }) {
  const isPdf = /\.pdf(\?|$)/i.test(url);
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.72)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 18 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ position: 'relative', maxWidth: '94vw', maxHeight: '90vh' }}>
        <button type="button" onClick={onClose} aria-label="Close" style={{ position: 'absolute', top: -14, insetInlineEnd: -14, width: 34, height: 34, borderRadius: '50%', border: 'none', background: '#fff', color: C.ink, fontWeight: 800, fontSize: 16, cursor: 'pointer', boxShadow: '0 2px 10px rgba(0,0,0,.35)', zIndex: 1 }}>✕</button>
        {isPdf ? (
          <iframe src={url} title="Receipt" style={{ width: '94vw', height: '86vh', border: 'none', borderRadius: 12, background: '#fff' }} />
        ) : (
          <img src={url} alt="Receipt" style={{ maxWidth: '94vw', maxHeight: '86vh', objectFit: 'contain', borderRadius: 12, background: '#fff' }} />
        )}
        <div style={{ textAlign: 'center', marginTop: 10 }}>
          <a href={url} target="_blank" rel="noreferrer" style={{ color: '#fff', fontWeight: 700, fontSize: 12.5 }}>Open full size ↗</a>
        </div>
      </div>
    </div>
  );
}

function ExpensesTab() {
  const now = new Date();
  const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const [month, setMonth] = useState(thisMonth);
  const [search, setSearch] = useState('');
  const [data, setData] = useState<any>(null);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [viewing, setViewing] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const searching = search.trim().length > 0;
  const load = () =>
    (searching ? api.expenses(undefined, search.trim()) : api.expenses(month))
      .then(setData)
      .catch(() => setData({ expenses: [] }));
  useEffect(() => {
    const t = setTimeout(load, searching ? 300 : 0); // debounce while typing a search
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month, search]);
  if (!data) return <Spinner />;
  const rows = data.expenses ?? [];
  const total = rows.reduce((s: number, e: any) => s + Number(e.amount_fils), 0);
  const shiftMonth = (delta: number) => {
    const [y, mo] = month.split('-').map(Number);
    const d = new Date(y, mo - 1 + delta, 1);
    setMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  };
  return (
    <Panel title="Expenses" action={
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <Button tone="ghost" onClick={() => setReviewing(true)}>📋 Accounts review</Button>
        <Button onClick={() => setCreating(true)}>+ New expense</Button>
      </div>
    }>
      {/* Search across ALL months by account name, supplier, or exact amount. */}
      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="🔎 Search by account, supplier, or amount…"
        style={{ width: '100%', boxSizing: 'border-box', border: '1px solid #e7dfe3', borderRadius: 10, padding: '9px 12px', fontWeight: 600, fontSize: 12.5, color: C.ink, marginBottom: 10 }}
      />
      {/* Month navigator — imported QuickBooks expenses sit on their original
          (historical) dates, so browse past months to see them. Hidden while searching. */}
      {!searching && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
          <button type="button" style={linkBtn} onClick={() => shiftMonth(-1)}>‹ Prev</button>
          <input
            type="month"
            value={month}
            max={thisMonth}
            onChange={(e) => setMonth(e.target.value || thisMonth)}
            style={{ border: '1px solid #e7dfe3', borderRadius: 8, padding: '5px 9px', fontWeight: 700, fontSize: 12.5, color: C.ink }}
          />
          <button type="button" style={linkBtn} onClick={() => shiftMonth(1)} disabled={month >= thisMonth}>Next ›</button>
        </div>
      )}
      <div style={{ fontSize: 12.5, fontWeight: 700, color: C.muted2, marginBottom: 12 }}>
        {searching ? `Results: ` : 'Total: '}
        <b style={{ color: C.ink }}>AED {money(total)}</b> · {rows.length} item(s)
      </div>
      {rows.length === 0 && <Empty>{searching ? 'No matching expenses.' : 'No expenses in this month. Use ‹ Prev to browse imported history.'}</Empty>}
      {rows.map((e: any) => (
        <DocRow key={e.id}
          title={prettyCat(e.category)}
          sub={`${fmtDate(e.spent_on)}${e.vendor ? ' · ' + e.vendor : ''}`}
          amount={money(Number(e.amount_fils))}
          action={
            <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              {e.receipt_url && (
                <button type="button" style={linkBtn} onClick={() => setViewing(e.receipt_url)}>🧾 Receipt</button>
              )}
              <button type="button" style={linkBtn} onClick={() => setEditing(e)}>Edit</button>
              <button type="button" style={{ ...linkBtn, color: C.red }} onClick={async () => { if (confirm('Delete this expense?')) { await api.deleteExpense(e.id); load(); } }}>Delete</button>
            </div>
          }
        />
      ))}
      {creating && <ExpenseForm categories={data.categories ?? []} onClose={() => setCreating(false)} onSaved={() => { setCreating(false); load(); }} />}
      {editing && <EditExpenseForm expense={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
      {viewing && <ReceiptViewer url={viewing} onClose={() => setViewing(null)} />}
      {reviewing && <AccountsReview onClose={() => setReviewing(false)} />}
    </Panel>
  );
}

/** Review report: each expense account with the suppliers filed under it, so
 *  the owner can check every supplier sits under the right account. Read-only. */
function AccountsReview({ onClose }: { onClose: () => void }) {
  const [data, setData] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [q, setQ] = useState('');
  useEffect(() => {
    api.expenseAccounts().then(setData).catch((e) => setErr(e?.message || 'Could not load.'));
  }, []);
  const accounts: any[] = data?.accounts ?? [];
  const needle = q.trim().toLowerCase();
  const shown = needle
    ? accounts.filter((a) => a.account.toLowerCase().includes(needle) ||
        a.suppliers.some((s: any) => (s.vendor || '').toLowerCase().includes(needle)))
    : accounts;
  return (
    <Modal title="Accounts review — suppliers under each account" onClose={onClose}>
      {err && <div style={{ color: C.red, fontWeight: 700, fontSize: 12.5, marginBottom: 8 }}>{err}</div>}
      {!data && !err && <Spinner />}
      {data && (
        <>
          <div style={{ fontSize: 12, color: C.muted2, fontWeight: 600, marginBottom: 10 }}>
            Every account is built from your real receipts. Tap an account to see the suppliers filed under it.
          </div>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="🔎 Filter by account or supplier…"
            style={{ width: '100%', boxSizing: 'border-box', border: '1px solid #e7dfe3', borderRadius: 10, padding: '9px 12px', fontWeight: 600, fontSize: 12.5, color: C.ink, marginBottom: 12 }}
          />
          {shown.length === 0 && <Empty>No matching accounts.</Empty>}
          {shown.map((a: any) => {
            const isOpen = needle ? true : open[a.account];
            return (
              <div key={a.account} style={{ border: `1px solid ${C.line}`, borderRadius: 12, marginBottom: 8, overflow: 'hidden' }}>
                <button
                  type="button"
                  onClick={() => setOpen((o) => ({ ...o, [a.account]: !o[a.account] }))}
                  style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '11px 13px', background: '#faf6f8', border: 'none', cursor: 'pointer', textAlign: 'left' }}
                >
                  <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                    <span style={{ color: C.muted2, fontSize: 11, fontWeight: 700 }}>{isOpen ? '▾' : '▸'}</span>
                    <span style={{ fontWeight: 800, fontSize: 13, color: C.ink, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{prettyCat(a.account)}</span>
                    <span style={{ fontSize: 11, fontWeight: 700, color: C.muted2 }}>· {a.suppliers.length} supplier(s)</span>
                  </span>
                  <span style={{ fontWeight: 800, fontSize: 12.5, color: C.pinkDeep, whiteSpace: 'nowrap' }}>AED {money(a.totalFils)}</span>
                </button>
                {isOpen && (
                  <div style={{ padding: '4px 13px 10px' }}>
                    {a.suppliers.map((s: any, i: number) => (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '7px 0', borderTop: i === 0 ? 'none' : `1px solid ${C.line}` }}>
                        <span style={{ fontSize: 12.5, color: s.vendor === '(no supplier)' ? C.muted2 : C.ink, fontWeight: 600, fontStyle: s.vendor === '(no supplier)' ? 'italic' : 'normal', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.vendor}</span>
                        <span style={{ fontSize: 11.5, color: C.muted2, fontWeight: 700, whiteSpace: 'nowrap' }}>{s.count}× · AED {money(s.totalFils)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </>
      )}
    </Modal>
  );
}

function ExpenseForm({ categories, onClose, onSaved }: { categories: string[]; onClose: () => void; onSaved: () => void }) {
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [supplier, setSupplier] = useState('');
  const [supOpen, setSupOpen] = useState(false);
  const [addingSupplier, setAddingSupplier] = useState(false);
  const [newSupplier, setNewSupplier] = useState('');
  const [category, setCategory] = useState(categories[0] ?? 'other');
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [spentOn, setSpentOn] = useState(new Date().toISOString().slice(0, 10));
  const [receiptUrl, setReceiptUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { api.suppliers().then((r) => setSuppliers(r.rows)).catch(() => setSuppliers([])); }, []);
  // Attach the receipt photo to the expense.
  const handleReceipt = async (f: File) => {
    setUploading(true); setErr(null);
    let url: string | null = null;
    try { url = await api.uploadImage(f, 'receipts'); setReceiptUrl(url); }
    catch (e: any) { setErr(e?.message ?? 'Upload failed'); }
    finally { setUploading(false); }
  };
  const addNew = async () => {
    const name = newSupplier.trim(); if (!name) return;
    try { await api.supplierCreate({ name }); const r = await api.suppliers(); setSuppliers(r.rows); setSupplier(name); setAddingSupplier(false); setNewSupplier(''); }
    catch (e: any) { setErr(e?.message || 'Could not add supplier.'); }
  };
  const save = async () => {
    const fils = Math.round((Number(amount.replace(/,/g, '')) || 0) * 100);
    if (fils <= 0) { setErr('Enter an amount.'); return; }
    setBusy(true); setErr(null);
    try {
      await api.addExpense({ category, description: description || prettyCat(category), amountFils: fils, vendor: supplier || undefined, spentOn, receiptUrl: receiptUrl || null, paymentMethod: 'cash' });
      onSaved();
    } catch (e: any) { setErr(e?.message || 'Could not save.'); } finally { setBusy(false); }
  };
  return (
    <Modal title="New expense" onClose={onClose} onSave={save} busy={busy || uploading} err={err}>
      <Field label="Receipt (optional)">
        <label style={{ ...input, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, color: receiptUrl ? C.green : C.pinkDeep, fontWeight: 700 }}>
          {uploading ? 'Uploading…' : receiptUrl ? '✓ Attached — tap to replace' : '📸 Snap or upload receipt'}
          <input type="file" accept="image/*" capture="environment" style={{ display: 'none' }} onChange={(e) => { const f = e.target.files?.[0]; if (f) handleReceipt(f); }} />
        </label>
      </Field>
      {receiptUrl && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
          <a href={receiptUrl} target="_blank" rel="noreferrer"><img src={receiptUrl} alt="receipt" style={{ width: 64, height: 64, objectFit: 'cover', borderRadius: 10, border: `1px solid ${C.line}` }} /></a>
        </div>
      )}
      <Field label="Supplier">
        {addingSupplier ? (
          <div style={{ display: 'flex', gap: 8 }}>
            <input value={newSupplier} onChange={(e) => setNewSupplier(e.target.value)} placeholder="New supplier name" style={input} autoFocus />
            <Button onClick={addNew}>Add</Button>
            <Button tone="ghost" onClick={() => setAddingSupplier(false)}>✕</Button>
          </div>
        ) : (
          // Custom tap-to-pick list. Native <datalist> is unreliable on iOS
          // Safari (the suggestions never drop down), which is why suppliers
          // "weren't showing" — this renders our own list so they always do.
          <div style={{ position: 'relative' }}>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                value={supplier}
                onChange={(e) => { setSupplier(e.target.value); setSupOpen(true); }}
                onFocus={() => setSupOpen(true)}
                onBlur={() => setTimeout(() => setSupOpen(false), 150)}
                placeholder="Type to search supplier…"
                style={input}
              />
              <Button tone="ghost" onClick={() => setAddingSupplier(true)}>+ New</Button>
            </div>
            {supOpen && (() => {
              const needle = supplier.trim().toLowerCase();
              const matches = (needle
                ? suppliers.filter((s) => String(s.name).toLowerCase().includes(needle))
                : suppliers
              ).slice(0, 8);
              if (matches.length === 0) return null;
              return (
                <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 20, background: '#fff', border: `1px solid ${C.line}`, borderRadius: 12, boxShadow: C.shadowLg, marginTop: 4, maxHeight: 220, overflowY: 'auto' }}>
                  {matches.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onMouseDown={(e) => { e.preventDefault(); setSupplier(String(s.name)); setSupOpen(false); }}
                      style={{ display: 'block', width: '100%', textAlign: 'left', padding: '10px 13px', border: 'none', borderBottom: `1px solid ${C.lineSoft}`, background: 'transparent', cursor: 'pointer', fontSize: 13, fontWeight: 600, color: C.ink }}
                    >
                      {s.name}
                    </button>
                  ))}
                </div>
              );
            })()}
          </div>
        )}
      </Field>
      <Field label="Date"><input type="date" value={spentOn} onChange={(e) => setSpentOn(e.target.value)} style={input} /></Field>
      <Field label="Type of expense *">
        <select value={category} onChange={(e) => setCategory(e.target.value)} style={input}>
          {categories.map((c) => <option key={c} value={c}>{prettyCat(c)}</option>)}
        </select>
      </Field>
      <Field label="Amount (AED) *"><input value={amount} inputMode="decimal" onChange={(e) => setAmount(e.target.value)} style={input} placeholder="0.00" /></Field>
      <Field label="Description / memo"><input value={description} onChange={(e) => setDescription(e.target.value)} style={input} /></Field>
      <div style={{ fontSize: 12, fontWeight: 700, color: C.muted2 }}>Paid from: <b style={{ color: C.ink }}>Cash on hand</b></div>
    </Modal>
  );
}

function EditExpenseForm({ expense, onClose, onSaved }: { expense: any; onClose: () => void; onSaved: () => void }) {
  const [category, setCategory] = useState<string>(expense.category || 'other');
  const [vendor, setVendor] = useState<string>(expense.vendor || '');
  const [amount, setAmount] = useState<string>(String((Number(expense.amount_fils) || 0) / 100));
  const [description, setDescription] = useState<string>(expense.description || '');
  const [spentOn, setSpentOn] = useState<string>(String(expense.spent_on || '').slice(0, 10));
  const [receiptUrl, setReceiptUrl] = useState<string | null>(expense.receipt_url ?? null);
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const save = async () => {
    const fils = Math.round((Number(amount.replace(/,/g, '')) || 0) * 100);
    if (fils <= 0) { setErr('Enter an amount.'); return; }
    setBusy(true); setErr(null);
    try {
      await api.updateExpense(expense.id, {
        category: (category || 'other').trim(),
        vendor: vendor.trim() || null,
        amountFils: fils,
        description: description.trim() || undefined,
        spentOn: spentOn || undefined,
        receiptUrl, // null clears the receipt, a URL sets/replaces it
      });
      onSaved();
    } catch (e: any) { setErr(e?.message || 'Could not save.'); } finally { setBusy(false); }
  };
  return (
    <Modal title="Edit expense" onClose={onClose} onSave={save} busy={busy || uploading} err={err}>
      <Field label="Account name"><input value={category} onChange={(e) => setCategory(e.target.value)} style={input} placeholder="e.g. Fuel, Salaries, Supplies" /></Field>
      <Field label="Supplier name"><input value={vendor} onChange={(e) => setVendor(e.target.value)} style={input} placeholder="e.g. Hot Pack Packaging" /></Field>
      <Field label="Date"><input type="date" value={spentOn} onChange={(e) => setSpentOn(e.target.value)} style={input} /></Field>
      <Field label="Amount (AED) *"><input value={amount} inputMode="decimal" onChange={(e) => setAmount(e.target.value)} style={input} placeholder="0.00" /></Field>
      <Field label="Description / memo"><input value={description} onChange={(e) => setDescription(e.target.value)} style={input} /></Field>
      <Field label="Receipt">
        <label style={{ ...input, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, color: receiptUrl ? C.green : C.muted, fontWeight: 700 }}>
          {uploading ? 'Uploading…' : receiptUrl ? '✓ Attached — tap to replace' : '📎 Upload / take photo'}
          <input type="file" accept="image/*" style={{ display: 'none' }} onChange={async (e) => {
            const f = e.target.files?.[0]; if (!f) return;
            setUploading(true); setErr(null);
            try { setReceiptUrl(await api.uploadImage(f, 'receipts')); }
            catch (err2: any) { setErr(err2?.message ?? 'Upload failed'); }
            finally { setUploading(false); }
          }} />
        </label>
      </Field>
      {receiptUrl && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
          <a href={receiptUrl} target="_blank" rel="noreferrer"><img src={receiptUrl} alt="receipt" style={{ width: 80, height: 80, objectFit: 'cover', borderRadius: 10, border: `1px solid ${C.line}` }} /></a>
          <button type="button" style={{ ...linkBtn, color: C.red }} onClick={() => setReceiptUrl(null)}>Remove receipt</button>
        </div>
      )}
    </Modal>
  );
}

// ── Shared: invoice / receipt create form ────────────────────────────────────
function DocForm({ kind, onClose, onSaved, initial, editId, isOwner }: { kind: 'invoice' | 'receipt'; onClose: () => void; onSaved: () => void; initial?: any; editId?: number; isOwner?: boolean }) {
  const [customer, setCustomer] = useState<{ id: number | null; name: string } | null>(initial?.customer ?? null);
  const [items, setItems] = useState<Array<{ name: string; qty: number; priceFils: number; description?: string }>>(initial?.items ?? []);
  const [discount, setDiscount] = useState(initial?.discount ?? '');
  const [shipping, setShipping] = useState(initial?.shipping ?? '');
  const [dueDate, setDueDate] = useState(initial?.dueDate ?? '');
  const [date, setDate] = useState(initial?.date ?? new Date().toISOString().slice(0, 10));
  const [message, setMessage] = useState(initial?.message ?? '');
  const [eventFor, setEventFor] = useState(initial?.eventFor ?? '');
  const [age, setAge] = useState(initial?.age ?? '');
  const [theme, setTheme] = useState(initial?.theme ?? '');
  const [eventTime, setEventTime] = useState(initial?.eventTime ?? '');
  const [dateTbd, setDateTbd] = useState<boolean>(initial?.dateTbd ?? false);
  const [paidWith, setPaidWith] = useState<string>(initial?.paidWith ?? 'Debit');
  const [commissionMarsha, setCommissionMarsha] = useState<boolean>(String(initial?.commissionRep ?? '').toLowerCase() === 'marsha');
  const [pickCustomer, setPickCustomer] = useState(false);
  const [pickItem, setPickItem] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const discountFils = Math.round((Number(discount.replace(/,/g, '')) || 0) * 100);
  const shippingFils = Math.round((Number(shipping.replace(/,/g, '')) || 0) * 100);
  const subtotal = items.reduce((s, l) => s + Math.round(l.qty * l.priceFils), 0);
  const total = subtotal - discountFils + shippingFils;

  const save = async () => {
    if (!customer) { setErr('Choose a customer.'); return; }
    if (items.length === 0) { setErr('Add at least one item.'); return; }
    setBusy(true); setErr(null);
    const body = { customerId: customer.id, customerName: customer.name, items, discountFils, shippingFils, message: message || undefined, eventFor: eventFor.trim() || null, age: age.trim() || null, theme: theme.trim() || null, eventTime: eventTime || null, dateTbd };
    try {
      if (kind === 'invoice') {
        const commissionRep = commissionMarsha ? 'Marsha' : null;
        if (editId) await api.finUpdateInvoice(editId, { ...body, dueDate: dueDate || null, commissionRep });
        else await api.finCreateInvoice({ ...body, dueDate: dueDate || null, status: 'sent', commissionRep });
      } else {
        const commissionRep = commissionMarsha ? 'Marsha' : null;
        if (editId) await api.finUpdateReceipt(editId, { ...body, date, paidWith, commissionRep });
        else await api.finCreateReceipt({ ...body, date, paidWith, commissionRep });
      }
      onSaved();
    } catch (e: any) { setErr(e?.message || 'Could not save.'); } finally { setBusy(false); }
  };

  return (
    <Modal title={kind === 'invoice' ? 'New invoice' : 'New sales receipt'} onClose={onClose} onSave={save} busy={busy} err={err} saveLabel={kind === 'invoice' ? 'Save & send' : 'Save'}>
      {/* Customer */}
      <button onClick={() => setPickCustomer(true)} style={pickRow}>
        <span style={{ color: customer ? C.ink : C.muted, fontWeight: 700 }}>{customer ? customer.name : 'Select or add a customer'}</span>
        <span style={{ color: C.pinkDeep, fontWeight: 800 }}>›</span>
      </button>

      {/* Items */}
      <div style={{ margin: '10px 0 4px', fontSize: 11, fontWeight: 800, color: C.muted, letterSpacing: '.4px' }}>ITEMS</div>
      {items.map((l, i) => (
        <div key={i} style={{ padding: '7px 0', borderBottom: `1px solid ${C.lineSoft}` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 12.5, fontWeight: 700, color: C.ink }}>{l.name}</div>
              <div style={{ fontSize: 11, color: C.muted }}>{l.qty} × AED {money(l.priceFils)}</div>
            </div>
            <input value={String(l.qty)} inputMode="numeric" onChange={(e) => setItems((a) => a.map((x, j) => j === i ? { ...x, qty: Number(e.target.value.replace(/[^\d]/g, '')) || 0 } : x))} style={{ ...input, width: 52, marginBottom: 0, padding: '6px 8px' }} />
            <div style={{ fontSize: 12.5, fontWeight: 800, color: C.ink, width: 92, textAlign: 'right' }}>AED {money(Math.round(l.qty * l.priceFils))}</div>
            <button onClick={() => setItems((a) => a.filter((_, j) => j !== i))} style={{ ...linkBtn, color: C.red }}>✕</button>
          </div>
          <textarea
            value={l.description ?? ''}
            onChange={(e) => setItems((a) => a.map((x, j) => j === i ? { ...x, description: e.target.value } : x))}
            placeholder="What's included / description (shows on the customer's invoice)…"
            rows={2}
            style={{ ...input, marginTop: 6, marginBottom: 0, padding: '7px 10px', fontSize: 12, fontWeight: 600, resize: 'vertical', width: '100%', boxSizing: 'border-box' }}
          />
        </div>
      ))}
      <button onClick={() => setPickItem(true)} style={{ ...linkBtn, color: C.pinkDeep, marginTop: 8, fontWeight: 800 }}>+ Add product or service</button>

      {/* Amounts */}
      <div style={{ marginTop: 14, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <Field label="Discount (AED)"><input value={discount} inputMode="decimal" onChange={(e) => setDiscount(e.target.value)} style={input} placeholder="0" /></Field>
        <Field label="Shipping (AED)"><input value={shipping} inputMode="decimal" onChange={(e) => setShipping(e.target.value)} style={input} placeholder="0" /></Field>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        {kind === 'invoice'
          ? <Field label="Due date"><input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} style={input} /></Field>
          : <Field label="Event date">
              <input type="date" value={dateTbd ? '' : date} disabled={dateTbd} onChange={(e) => setDate(e.target.value)} style={{ ...input, opacity: dateTbd ? 0.5 : 1 }} placeholder={dateTbd ? 'TBD' : undefined} />
            </Field>}
        <Field label="Event time"><input type="time" value={eventTime} onChange={(e) => setEventTime(e.target.value)} style={input} /></Field>
      </div>
      {kind === 'receipt' && (
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '2px 0 6px', fontSize: 12.5, fontWeight: 700, color: C.ink, cursor: 'pointer' }}>
          <input type="checkbox" checked={dateTbd} onChange={(e) => setDateTbd(e.target.checked)} />
          Date not decided yet (show “TBD” — no reminders sent until a date is set)
        </label>
      )}

      {/* Commission approval is the OWNER's decision alone: only the owner sees the
          switch. Marsha (or anyone else) can see it was approved, but can't grant
          it — nothing reaches her KPI until the owner ticks this. */}
      {isOwner ? (
        <label style={{ display: 'flex', alignItems: 'center', gap: 9, marginTop: 12, padding: '10px 12px', borderRadius: 12, border: `1px solid ${commissionMarsha ? C.pink : C.line}`, background: commissionMarsha ? C.pinkSoft : '#fff', cursor: 'pointer' }}>
          <input type="checkbox" checked={commissionMarsha} onChange={(e) => setCommissionMarsha(e.target.checked)} />
          <span style={{ fontSize: 12.5, fontWeight: 700, color: commissionMarsha ? C.pinkDeep : C.ink }}>
            💼 Marsha’s corporate deal — approve 2% commission
            <span style={{ display: 'block', fontSize: 10.5, fontWeight: 600, color: C.muted }}>Owner-only. Counts toward her KPI once approved, when the total is AED 20,000+ (events-based).</span>
          </span>
        </label>
      ) : commissionMarsha ? (
        <div style={{ marginTop: 12, padding: '10px 12px', borderRadius: 12, background: C.pinkSoft, fontSize: 12.5, fontWeight: 700, color: C.pinkDeep }}>
          ✓ Commission approved for Marsha
        </div>
      ) : null}

      {/* Party details echoed on the receipt — guest of honour + age + theme. */}
      <div style={{ marginTop: 4, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <Field label="Baby / celebrant name"><input value={eventFor} onChange={(e) => setEventFor(e.target.value)} style={input} placeholder="e.g. Sara" /></Field>
        <Field label="Age"><input value={age} onChange={(e) => setAge(e.target.value)} style={input} placeholder="e.g. 3" /></Field>
        <Field label="Theme"><input value={theme} onChange={(e) => setTheme(e.target.value)} style={input} placeholder="e.g. Mermaid" /></Field>
      </div>

      <div style={{ marginTop: 8, padding: '10px 12px', background: C.pinkSoft, borderRadius: 12 }}>
        <Row label="Subtotal" value={`AED ${money(subtotal)}`} />
        {discountFils > 0 && <Row label="Discount" value={`− AED ${money(discountFils)}`} />}
        {shippingFils > 0 && <Row label="Shipping" value={`AED ${money(shippingFils)}`} />}
        <div style={{ height: 1, background: C.line, margin: '6px 0' }} />
        <Row label={<b>Total</b>} value={<b style={{ ...fredoka(16), color: C.pinkDeep }}>AED {money(total)}</b>} />
      </div>
      <Field label="Message to customer (optional)"><input value={message} onChange={(e) => setMessage(e.target.value)} style={input} /></Field>
      {kind === 'receipt' && (
        <Field label="Payment method">
          <select value={paidWith} onChange={(e) => setPaidWith(e.target.value)} style={input}>
            {['Tabby', 'Tamara', 'Debit'].map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </Field>
      )}

      {pickCustomer && <CustomerPicker onPick={(c) => { setCustomer(c); setPickCustomer(false); }} onClose={() => setPickCustomer(false)} />}
      {pickItem && <ItemPicker onPick={(it) => { setItems((a) => [...a, { name: it.name, qty: 1, priceFils: it.priceFils, description: it.description ?? '' }]); setPickItem(false); }} onClose={() => setPickItem(false)} />}
    </Modal>
  );
}

// ── Detail view (tap a row): full document + Print / Email / Edit / Copy / Delete
function DocDetail({ doc, kind, onClose, onChanged, isOwner }: { doc: any; kind: 'invoice' | 'receipt'; onClose: () => void; onChanged: () => void; isOwner?: boolean }) {
  const [mode, setMode] = useState<'view' | 'edit' | 'copy'>('view');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [addon, setAddon] = useState(false);

  const toInitial = () => ({
    customer: { id: doc.customer_id ?? null, name: doc.customer_name },
    items: (doc.lineItems ?? []).map((l: any) => ({ name: l.name, qty: l.qty, priceFils: l.priceFils, description: l.description ?? '' })),
    discount: doc.discount_fils ? String(doc.discount_fils / 100) : '',
    shipping: doc.shipping_fils ? String(doc.shipping_fils / 100) : '',
    dueDate: doc.due_date ? String(doc.due_date).slice(0, 10) : '',
    date: doc.date ? String(doc.date).slice(0, 10) : new Date().toISOString().slice(0, 10),
    message: doc.message ?? '',
    eventFor: doc.event_for ?? '',
    age: doc.age ?? '',
    theme: doc.theme ?? '',
    eventTime: doc.event_time ?? '',
    dateTbd: doc.date_tbd ?? false,
    paidWith: doc.paid_with ?? 'Debit',
    commissionRep: doc.commission_rep ?? doc.commissionRep ?? null,
  });

  const print = () => {
    const w = window.open('', '_blank', 'width=620,height=800');
    if (!w) { setMsg('Allow pop-ups to download/print.'); return; }
    w.document.write(docHtml(doc, kind));
    w.document.close(); w.focus();
    setTimeout(() => { try { w.print(); } catch { /* */ } }, 400);
  };
  const email = async () => {
    setBusy(true); setMsg(null);
    try {
      const r = kind === 'receipt' ? await api.finEmailReceipt(doc.id) : await api.finEmailInvoice(doc.id);
      setMsg(r.sent ? `✓ Emailed to ${r.to}` : r.reason === 'no_email' ? 'This customer has no email on file.' : r.reason === 'email_disabled' ? 'Email is not set up yet.' : 'Could not send.');
    } catch { setMsg('Could not send.'); } finally { setBusy(false); }
  };
  const del = async () => {
    if (!confirm('Delete this document?')) return;
    if (kind === 'receipt') await api.finDeleteReceipt(doc.id); else await api.finDeleteInvoice(doc.id);
    onChanged(); onClose();
  };

  if (mode === 'edit') return <DocForm kind={kind} editId={doc.id} initial={toInitial()} isOwner={isOwner} onClose={() => setMode('view')} onSaved={() => { onChanged(); onClose(); }} />;
  if (mode === 'copy') return <DocForm kind={kind} initial={toInitial()} isOwner={isOwner} onClose={() => setMode('view')} onSaved={() => { onChanged(); onClose(); }} />;

  const paid = kind === 'receipt' || doc.status === 'paid';
  return (
    <Modal title={kind === 'receipt' ? 'Sales receipt' : 'Invoice'} onClose={onClose}>
      <div style={{ background: paid ? `linear-gradient(135deg,${C.mint},#3fb8ad)` : `linear-gradient(135deg,${C.pink},${C.pinkDeep})`, color: '#fff', borderRadius: 16, padding: '18px 20px', textAlign: 'center', marginBottom: 16 }}>
        <div style={{ fontSize: 14, fontWeight: 700, opacity: 0.95 }}>{doc.customer_name}</div>
        <div style={{ ...fredoka(30), marginTop: 2 }}>AED {doc.totalDisplay}</div>
        <div style={{ fontWeight: 800, letterSpacing: '1px', marginTop: 4, fontSize: 12 }}>{paid ? 'PAID' : (doc.status || 'SENT').toUpperCase()}</div>
      </div>
      <div style={{ fontSize: 11.5, color: C.muted, fontWeight: 700, marginBottom: 4 }}>
        {kind === 'receipt' ? 'SALES RECEIPT' : 'INVOICE'} #{doc.number} · {fmtDate(doc.date ?? doc.issue_date)}
      </div>
      {kind === 'receipt' && <div style={{ fontSize: 12, color: C.muted2, marginBottom: 10 }}>Deposit to: <b style={{ color: C.ink }}>Cash on hand</b></div>}
      {(doc.event_for || doc.age || doc.theme) && (
        <div style={{ marginBottom: 6 }}>
          {doc.event_for && <Row label="Celebration for" value={doc.event_for} />}
          {doc.age && <Row label="Age" value={String(doc.age)} />}
          {doc.theme && <Row label="Theme" value={doc.theme} />}
        </div>
      )}
      <div style={{ fontSize: 11, fontWeight: 800, color: C.muted, letterSpacing: '.4px', margin: '8px 0 4px' }}>{(doc.lineItems ?? []).length} ITEM(S)</div>
      {(doc.lineItems ?? []).map((l: any, i: number) => (
        <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: `1px solid ${C.lineSoft}` }}>
          <div style={{ flex: 1 }}><div style={{ fontSize: 13, fontWeight: 700, color: C.ink }}>{l.name}</div>{l.description && String(l.description).trim() && <div style={{ fontSize: 11.5, color: C.muted2, whiteSpace: 'pre-wrap', lineHeight: 1.5, marginTop: 2 }}>{l.description}</div>}<div style={{ fontSize: 11, color: C.muted }}>{l.qty} × AED {money(l.priceFils)}</div></div>
          <div style={{ fontSize: 13, fontWeight: 800, color: C.ink }}>AED {l.amountDisplay}</div>
        </div>
      ))}
      <div style={{ marginTop: 10 }}>
        <Row label="Subtotal" value={`AED ${money(doc.subtotal_fils)}`} />
        {doc.discount_fils > 0 && <Row label="Discount" value={`− AED ${money(doc.discount_fils)}`} />}
        {doc.shipping_fils > 0 && <Row label="Shipping" value={`AED ${money(doc.shipping_fils)}`} />}
        <Row label={<b>Total</b>} value={<b style={{ ...fredoka(15), color: C.pinkDeep }}>AED {doc.totalDisplay}</b>} />
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 18 }}>
        <Button tone="ghost" onClick={print}>⬇ Download / Print</Button>
        <Button tone="ghost" onClick={email} disabled={busy}>📧 Email</Button>
        <Button tone="ghost" onClick={() => setMode('edit')}>✏️ Edit</Button>
        <Button tone="ghost" onClick={() => setMode('copy')}>⧉ Copy</Button>
        {kind === 'receipt' && <Button tone="ghost" onClick={() => setAddon(true)}>➕ Add-on</Button>}
        <Button tone="danger" onClick={del}>🗑 Delete</Button>
      </div>
      {msg && <div style={{ marginTop: 10, fontWeight: 700, fontSize: 12.5, color: msg.startsWith('✓') ? C.green : C.red }}>{msg}</div>}
      {addon && <AddonFlow onClose={() => setAddon(false)} />}
    </Modal>
  );
}

function docHtml(doc: any, kind: 'invoice' | 'receipt') {
  const esc = (s: any) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
  const rows = (doc.lineItems ?? []).map((l: any) => {
    const desc = l.description && String(l.description).trim() ? `<br><span style="color:#666;font-size:12px;line-height:1.5">${esc(String(l.description).trim()).replace(/\n/g, '<br>')}</span>` : '';
    return `<tr><td style="padding:8px 0;border-bottom:1px solid #eee">${esc(l.name)}${desc}<br><span style="color:#999;font-size:12px">${l.qty} × AED ${money(l.priceFils)}</span></td><td style="padding:8px 0;border-bottom:1px solid #eee;text-align:right;font-weight:700">AED ${l.amountDisplay}</td></tr>`;
  }).join('');
  return `<!doctype html><html><head><meta charset="utf8"><title>Eventana ${kind} ${esc(doc.number)}</title></head><body style="font-family:Arial,sans-serif;color:#3B3641;max-width:560px;margin:0 auto;padding:24px">
    <div style="background:linear-gradient(135deg,#F06CA8,#E94F9C);color:#fff;border-radius:18px;padding:22px;text-align:center;margin-bottom:20px">
      <div style="font-size:22px;font-weight:800">Eventana</div>
      <div style="font-size:13px;opacity:.9">${kind === 'receipt' ? 'Sales Receipt' : 'Invoice'} · ${esc(doc.number)}</div>
      <div style="font-size:30px;font-weight:800;margin-top:8px">AED ${doc.totalDisplay}</div>
      ${kind === 'receipt' ? '<div style="margin-top:4px;font-weight:800;letter-spacing:1px">PAID</div>' : ''}
    </div>
    <div style="font-size:14px;margin-bottom:12px"><b>${esc(doc.customer_name)}</b><br><span style="color:#999">${fmtDate(doc.date ?? doc.issue_date)}</span></div>
    ${doc.event_for || doc.theme || doc.age ? `<table style="width:100%;font-size:13px;margin-bottom:12px">
      ${doc.event_for ? `<tr><td style="color:#999;padding:2px 0">Celebration for</td><td style="text-align:right;font-weight:700">${esc(doc.event_for)}</td></tr>` : ''}
      ${doc.age ? `<tr><td style="color:#999;padding:2px 0">Age</td><td style="text-align:right;font-weight:700">${esc(doc.age)}</td></tr>` : ''}
      ${doc.theme ? `<tr><td style="color:#999;padding:2px 0">Theme</td><td style="text-align:right;font-weight:700">${esc(doc.theme)}</td></tr>` : ''}
    </table>` : ''}
    <table style="width:100%;border-collapse:collapse;font-size:14px">${rows}</table>
    <table style="width:100%;margin-top:12px;font-size:14px">
      <tr><td style="color:#777">Subtotal</td><td style="text-align:right">AED ${money(doc.subtotal_fils)}</td></tr>
      ${doc.discount_fils > 0 ? `<tr><td style="color:#777">Discount</td><td style="text-align:right">− AED ${money(doc.discount_fils)}</td></tr>` : ''}
      ${doc.shipping_fils > 0 ? `<tr><td style="color:#777">Shipping</td><td style="text-align:right">AED ${money(doc.shipping_fils)}</td></tr>` : ''}
      <tr><td style="font-weight:800;padding-top:8px">Total</td><td style="text-align:right;font-weight:800;color:#E94F9C;padding-top:8px">AED ${doc.totalDisplay}</td></tr>
    </table>
    <div style="margin-top:24px;color:#bbb;font-size:12px;text-align:center">Thank you for choosing Eventana 🎉</div>
  </body></html>`;
}

function CustomerPicker({ onPick, onClose }: { onPick: (c: { id: number | null; name: string }) => void; onClose: () => void }) {
  const [q, setQ] = useState('');
  const [list, setList] = useState<any[]>([]);
  const [adding, setAdding] = useState(false);
  const [nc, setNc] = useState({ fullName: '', email: '', phone: '', backupPhone: '', emirate: '' });
  useEffect(() => { const t = setTimeout(() => api.finCustomers(q).then(setList).catch(() => setList([])), 250); return () => clearTimeout(t); }, [q]);
  return (
    <Modal title="Add customer" onClose={onClose}>
      {!adding ? (
        <>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search customers…" style={{ ...input, marginBottom: 10 }} autoFocus />
          <Button onClick={() => setAdding(true)} style={{ width: '100%', marginBottom: 10 }}>+ Add new customer</Button>
          <div style={{ maxHeight: 320, overflowY: 'auto' }}>
            {list.map((c) => (
              <button key={c.id} onClick={() => onPick({ id: c.id, name: c.full_name })} style={{ ...rowBtn }}>
                <span style={{ fontWeight: 700, color: C.ink }}>{c.full_name}</span>
                <span style={{ fontSize: 11, color: C.muted }}>{c.phone || c.email || c.emirate || ''}</span>
              </button>
            ))}
            {list.length === 0 && <div style={{ fontSize: 12.5, color: C.muted, padding: 10 }}>No matches.</div>}
          </div>
        </>
      ) : (
        <>
          <Field label="Customer name *"><input value={nc.fullName} onChange={(e) => setNc((s) => ({ ...s, fullName: e.target.value }))} style={input} autoFocus /></Field>
          <Field label="Email"><input value={nc.email} onChange={(e) => setNc((s) => ({ ...s, email: e.target.value }))} style={input} /></Field>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <Field label="Phone"><input value={nc.phone} onChange={(e) => setNc((s) => ({ ...s, phone: e.target.value }))} style={input} placeholder="05XXXXXXXX" /></Field>
            <Field label="Backup number"><input value={nc.backupPhone} onChange={(e) => setNc((s) => ({ ...s, backupPhone: e.target.value }))} style={input} placeholder="Optional" /></Field>
          </div>
          <Field label="Emirate">
            <select value={nc.emirate} onChange={(e) => setNc((s) => ({ ...s, emirate: e.target.value }))} style={input}>
              <option value="">— Select emirate —</option>
              {['Dubai', 'Abu Dhabi', 'Sharjah', 'Ajman', 'Umm Al Quwain', 'Ras Al Khaimah', 'Fujairah', 'Al Ain'].map((em) => <option key={em} value={em}>{em}</option>)}
            </select>
          </Field>
          <div style={{ display: 'flex', gap: 8 }}>
            <Button tone="ghost" onClick={() => setAdding(false)}>Back</Button>
            <div style={{ flex: 1 }} />
            <Button onClick={async () => { if (!nc.fullName.trim()) return; const c = await api.finAddCustomer(nc); onPick({ id: c.id, name: c.full_name }); }}>Save customer</Button>
          </div>
        </>
      )}
    </Modal>
  );
}

function ItemPicker({ onPick, onClose }: { onPick: (it: { name: string; priceFils: number; description?: string | null }) => void; onClose: () => void }) {
  const [items, setItems] = useState<any[]>([]);
  const [q, setQ] = useState('');
  const [custom, setCustom] = useState({ name: '', price: '', description: '' });
  const [saving, setSaving] = useState(false);
  useEffect(() => { api.finItems().then(setItems).catch(() => setItems([])); }, []);
  const filtered = items.filter((i) => i.name.toLowerCase().includes(q.toLowerCase()));
  return (
    <Modal title="Add product or service" onClose={onClose}>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search items…" style={{ ...input, marginBottom: 10 }} autoFocus />
      <div style={{ maxHeight: 260, overflowY: 'auto', marginBottom: 12 }}>
        {filtered.map((it, i) => (
          <button key={i} onClick={() => onPick({ name: it.name, priceFils: it.priceFils, description: it.description ?? '' })} style={rowBtn}>
            <span style={{ fontWeight: 700, color: C.ink }}>{it.name}</span>
            <span style={{ fontSize: 12, fontWeight: 700, color: C.muted2 }}>AED {money(it.priceFils)}</span>
          </button>
        ))}
      </div>
      <div style={{ fontSize: 11, fontWeight: 800, color: C.pinkDeep, letterSpacing: '.4px', marginBottom: 6 }}>➕ NEW PRODUCT / SERVICE</div>
      <div style={{ fontSize: 11, fontWeight: 600, color: C.muted, marginBottom: 8, lineHeight: 1.5 }}>Not in the list? Add it here — it’s saved for next time, and the owner is notified.</div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
        <div style={{ flex: 1 }}><Field label="Name"><input value={custom.name} onChange={(e) => setCustom((s) => ({ ...s, name: e.target.value }))} style={input} /></Field></div>
        <div style={{ width: 110 }}><Field label="Price (AED)"><input value={custom.price} inputMode="decimal" onChange={(e) => setCustom((s) => ({ ...s, price: e.target.value }))} style={input} /></Field></div>
      </div>
      <Field label="Description — what's included (shows on the customer's invoice)">
        <textarea value={custom.description} onChange={(e) => setCustom((s) => ({ ...s, description: e.target.value }))} rows={3} placeholder="e.g. 2-hour setup · balloon arch · themed backdrop · 1 host" style={{ ...input, resize: 'vertical', width: '100%', boxSizing: 'border-box' }} />
      </Field>
      <Button disabled={saving} onClick={async () => {
        const name = custom.name.trim(); if (!name) return;
        const priceFils = Math.round((Number(custom.price.replace(/,/g, '')) || 0) * 100);
        const description = custom.description.trim();
        setSaving(true);
        try { await api.finCreateItem(name, priceFils, description || undefined); } catch { /* still add the line even if save fails */ }
        setSaving(false);
        onPick({ name, priceFils, description });
      }} style={{ marginTop: 4 }}>{saving ? '…' : 'Save & add'}</Button>
    </Modal>
  );
}

// ── Shared bits ──────────────────────────────────────────────────────────────
function Modal({ title, children, onClose, onSave, busy, err, saveLabel }: { title: string; children: ReactNode; onClose: () => void; onSave?: () => void; busy?: boolean; err?: string | null; saveLabel?: string }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(59,54,65,.45)', zIndex: 1000, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '3vh 12px' }} onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ background: '#fff', borderRadius: 20, width: '100%', maxWidth: 480, maxHeight: '94vh', display: 'flex', flexDirection: 'column', boxShadow: C.shadowLg }}
      >
        {/* Header stays put; only the body scrolls, so Save is always reachable
            even when the form is taller than the screen (mobile). */}
        <div style={{ display: 'flex', alignItems: 'center', padding: '16px 20px 12px', flex: 'none', borderBottom: `1px solid ${C.lineSoft}` }}>
          <button onClick={onClose} style={{ ...linkBtn, color: C.muted }}>Cancel</button>
          <div style={{ ...fredoka(15), flex: 1, textAlign: 'center' }}>{title}</div>
          {onSave ? <button onClick={onSave} disabled={busy} style={{ ...linkBtn, color: C.pinkDeep, fontWeight: 800 }}>{busy ? '…' : (saveLabel ?? 'Save')}</button> : <span style={{ width: 40 }} />}
        </div>
        <div style={{ overflowY: 'auto', WebkitOverflowScrolling: 'touch', padding: '14px 20px 20px', flex: 1 }}>
          {children}
          {err && <div style={{ marginTop: 10, color: C.red, fontWeight: 700, fontSize: 12.5 }}>{err}</div>}
        </div>
      </div>
    </div>
  );
}

function DocRow({ title, sub, amount, badge, action, onClick }: { title: string; sub: string; amount: string; badge?: ReactNode; action?: ReactNode; onClick?: () => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 4px', borderBottom: `1px solid ${C.lineSoft}` }}>
      <div onClick={onClick} style={{ flex: 1, minWidth: 0, cursor: onClick ? 'pointer' : 'default' }}>
        <div style={{ fontSize: 13.5, fontWeight: 800, color: C.ink }}>{title}</div>
        <div style={{ fontSize: 11.5, color: C.muted, fontWeight: 600 }}>{sub}</div>
        {badge}
      </div>
      <div style={{ textAlign: 'right' }}>
        <div onClick={onClick} style={{ ...fredoka(15), color: C.ink, cursor: onClick ? 'pointer' : 'default' }}>AED {amount}</div>
        {action}
      </div>
    </div>
  );
}

function StatusBadge({ status, overdueDays }: { status: string; overdueDays: number }) {
  const map: Record<string, { bg: string; fg: string; text: string }> = {
    paid: { bg: C.greenSoft, fg: C.green, text: 'PAID' },
    overdue: { bg: C.redSoft, fg: C.red, text: `OVERDUE ${overdueDays}d` },
    sent: { bg: C.pinkSoft, fg: C.pinkDeep, text: 'SENT' },
    viewed: { bg: C.yellowSoft, fg: C.yellowInk, text: 'VIEWED' },
    draft: { bg: '#F6EDF2', fg: C.muted2, text: 'DRAFT' },
  };
  const s = map[status] ?? map.draft;
  return <span style={{ ...pill, background: s.bg, color: s.fg, marginTop: 4, display: 'inline-block' }}>{s.text}</span>;
}

function Row({ label, value }: { label: ReactNode; value: ReactNode }) {
  return <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, fontWeight: 700, color: C.muted2, padding: '2px 0' }}><span>{label}</span><span>{value}</span></div>;
}
function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label style={{ display: 'block', marginBottom: 10 }}><span style={{ display: 'block', fontSize: 11, fontWeight: 700, color: C.muted, marginBottom: 4 }}>{label}</span>{children}</label>;
}
function Empty({ children }: { children: ReactNode }) {
  return <div style={{ fontSize: 12.5, color: C.muted, fontWeight: 600, padding: '18px 4px', textAlign: 'center' }}>{children}</div>;
}

const fmtDate = (d: string) => d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '';
const prettyCat = (c: string) => {
  const s = (c || 'other').trim();
  // A real account name (already spaced or capitalised, e.g. a QuickBooks
  // account) is shown EXACTLY as stored. Only the old snake_case presets
  // (e.g. "food_beverage") get prettified into Title Case.
  if (/[A-Z]/.test(s) || /\s/.test(s)) return s;
  return s.replace(/_/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());
};

const input: CSSProperties = { width: '100%', border: `1px solid ${C.line}`, borderRadius: 10, padding: '9px 11px', fontSize: 12.5, fontWeight: 600, outline: 'none', background: '#fff', color: C.ink, marginBottom: 2 };
const linkBtn: CSSProperties = { background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 700, padding: 2 };
const rowBtn: CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', padding: '11px 8px', border: 'none', borderBottom: `1px solid ${C.lineSoft}`, background: 'none', cursor: 'pointer', textAlign: 'left' };
const pickRow: CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', padding: '13px 12px', border: `1px solid ${C.line}`, borderRadius: 12, background: '#fff', cursor: 'pointer' };
const pill: CSSProperties = { fontSize: 10, fontWeight: 800, padding: '3px 8px', borderRadius: 8, letterSpacing: '.3px' };
