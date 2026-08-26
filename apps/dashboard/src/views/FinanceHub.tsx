import { useEffect, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { api } from '../api';
import { Button, C, Panel, Spinner, fredoka, money } from '../ui';

/**
 * The dashboard's finance hub — a lean, QuickBooks-style set of tools:
 *   Accounting · Sales & Get Paid (Invoices + Sales receipts) · Expenses.
 * Deliberately simple: a list per document with a single "+" that opens one
 * short form. Cash on hand is the only account. Uses the migrated customer book
 * and the catalogue for line items.
 */

type Tab = 'sales' | 'expenses' | 'accounting';

export function FinanceHub() {
  const [tab, setTab] = useState<Tab>('sales');
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 900 }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <TabBtn on={tab === 'sales'} onClick={() => setTab('sales')}>💸 Sales &amp; Get Paid</TabBtn>
        <TabBtn on={tab === 'expenses'} onClick={() => setTab('expenses')}>🧾 Expenses</TabBtn>
        <TabBtn on={tab === 'accounting'} onClick={() => setTab('accounting')}>🏦 Accounting</TabBtn>
      </div>
      {tab === 'sales' && <SalesTab />}
      {tab === 'expenses' && <ExpensesTab />}
      {tab === 'accounting' && <AccountingTab />}
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
function SalesTab() {
  const [sub, setSub] = useState<'invoices' | 'receipts'>('invoices');
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', gap: 8 }}>
        <SubBtn on={sub === 'invoices'} onClick={() => setSub('invoices')}>Invoices</SubBtn>
        <SubBtn on={sub === 'receipts'} onClick={() => setSub('receipts')}>Sales receipts</SubBtn>
      </div>
      {sub === 'invoices' ? <InvoicesList /> : <ReceiptsList />}
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

function InvoicesList() {
  const [data, setData] = useState<any>(null);
  const [creating, setCreating] = useState(false);
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
        <DocRow key={inv.id}
          title={inv.customer_name} sub={`Invoice ${inv.number} · ${fmtDate(inv.issue_date)}`}
          amount={inv.totalDisplay}
          badge={<StatusBadge status={inv.status} overdueDays={inv.overdueDays} />}
          action={inv.status !== 'paid' ? <button style={linkBtn} onClick={async () => { await api.finSetInvoiceStatus(inv.id, 'paid'); load(); }}>Mark paid</button> : null}
        />
      ))}
      {creating && <DocForm kind="invoice" onClose={() => setCreating(false)} onSaved={() => { setCreating(false); load(); }} />}
    </Panel>
  );
}

function ReceiptsList() {
  const [data, setData] = useState<any>(null);
  const [creating, setCreating] = useState(false);
  const load = () => api.finReceipts().then(setData).catch(() => setData({ receipts: [] }));
  useEffect(() => { load(); }, []);
  if (!data) return <Spinner />;
  return (
    <Panel title="Sales receipts" action={<Button onClick={() => setCreating(true)}>+ New receipt</Button>}>
      <div style={{ fontSize: 12.5, fontWeight: 700, color: C.muted2, marginBottom: 12 }}>
        Total collected: <b style={{ color: C.green }}>AED {data.totalDisplay ?? '0'}</b> → Cash on hand
      </div>
      {(data.receipts ?? []).length === 0 && <Empty>No receipts yet. Record a paid sale.</Empty>}
      {(data.receipts ?? []).map((r: any) => (
        <DocRow key={r.id}
          title={r.customer_name} sub={`Receipt ${r.number} · ${fmtDate(r.date)}`}
          amount={r.totalDisplay}
          badge={<span style={{ ...pill, background: C.greenSoft, color: C.green }}>PAID</span>}
          action={<button style={{ ...linkBtn, color: C.red }} onClick={async () => { if (confirm('Delete this receipt?')) { await api.finDeleteReceipt(r.id); load(); } }}>Delete</button>}
        />
      ))}
      {creating && <DocForm kind="receipt" onClose={() => setCreating(false)} onSaved={() => { setCreating(false); load(); }} />}
    </Panel>
  );
}

// ── Expenses ─────────────────────────────────────────────────────────────────
function ExpensesTab() {
  const [data, setData] = useState<any>(null);
  const [creating, setCreating] = useState(false);
  const load = () => api.expenses().then(setData).catch(() => setData({ expenses: [] }));
  useEffect(() => { load(); }, []);
  if (!data) return <Spinner />;
  const total = (data.expenses ?? []).reduce((s: number, e: any) => s + Number(e.amount_fils), 0);
  return (
    <Panel title={`Expenses · ${data.month ?? ''}`} action={<Button onClick={() => setCreating(true)}>+ New expense</Button>}>
      <div style={{ fontSize: 12.5, fontWeight: 700, color: C.muted2, marginBottom: 12 }}>
        This month: <b style={{ color: C.ink }}>AED {money(total)}</b> · paid from Cash on hand
      </div>
      {(data.expenses ?? []).length === 0 && <Empty>No expenses this month.</Empty>}
      {(data.expenses ?? []).map((e: any) => (
        <DocRow key={e.id}
          title={prettyCat(e.category)} sub={`${fmtDate(e.spent_on)}${e.vendor ? ' · ' + e.vendor : ''}`}
          amount={money(Number(e.amount_fils))}
          action={<button style={{ ...linkBtn, color: C.red }} onClick={async () => { if (confirm('Delete this expense?')) { await api.deleteExpense(e.id); load(); } }}>Delete</button>}
        />
      ))}
      {creating && <ExpenseForm categories={data.categories ?? []} onClose={() => setCreating(false)} onSaved={() => { setCreating(false); load(); }} />}
    </Panel>
  );
}

function ExpenseForm({ categories, onClose, onSaved }: { categories: string[]; onClose: () => void; onSaved: () => void }) {
  const [category, setCategory] = useState(categories[0] ?? 'other');
  const [vendor, setVendor] = useState('');
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [spentOn, setSpentOn] = useState(new Date().toISOString().slice(0, 10));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const save = async () => {
    const fils = Math.round((Number(amount.replace(/,/g, '')) || 0) * 100);
    if (fils <= 0) { setErr('Enter an amount.'); return; }
    setBusy(true); setErr(null);
    try {
      await api.addExpense({ category, description: description || prettyCat(category), amountFils: fils, vendor: vendor || undefined, spentOn, paymentMethod: 'cash' });
      onSaved();
    } catch (e: any) { setErr(e?.message || 'Could not save.'); } finally { setBusy(false); }
  };
  return (
    <Modal title="New expense" onClose={onClose} onSave={save} busy={busy} err={err}>
      <Field label="Date"><input type="date" value={spentOn} onChange={(e) => setSpentOn(e.target.value)} style={input} /></Field>
      <Field label="Who you paid (vendor)"><input value={vendor} onChange={(e) => setVendor(e.target.value)} style={input} placeholder="e.g. Hot Pack Packaging" /></Field>
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

// ── Shared: invoice / receipt create form ────────────────────────────────────
function DocForm({ kind, onClose, onSaved }: { kind: 'invoice' | 'receipt'; onClose: () => void; onSaved: () => void }) {
  const [customer, setCustomer] = useState<{ id: number | null; name: string } | null>(null);
  const [items, setItems] = useState<Array<{ name: string; qty: number; priceFils: number }>>([]);
  const [discount, setDiscount] = useState('');
  const [shipping, setShipping] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [message, setMessage] = useState('');
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
    const body = { customerId: customer.id, customerName: customer.name, items, discountFils, shippingFils, message: message || undefined };
    try {
      if (kind === 'invoice') await api.finCreateInvoice({ ...body, dueDate: dueDate || null, status: 'sent' });
      else await api.finCreateReceipt({ ...body, date, paidWith: 'Cash' });
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
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 0', borderBottom: `1px solid ${C.lineSoft}` }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12.5, fontWeight: 700, color: C.ink }}>{l.name}</div>
            <div style={{ fontSize: 11, color: C.muted }}>{l.qty} × AED {money(l.priceFils)}</div>
          </div>
          <input value={String(l.qty)} inputMode="numeric" onChange={(e) => setItems((a) => a.map((x, j) => j === i ? { ...x, qty: Number(e.target.value.replace(/[^\d]/g, '')) || 0 } : x))} style={{ ...input, width: 52, marginBottom: 0, padding: '6px 8px' }} />
          <div style={{ fontSize: 12.5, fontWeight: 800, color: C.ink, width: 92, textAlign: 'right' }}>AED {money(Math.round(l.qty * l.priceFils))}</div>
          <button onClick={() => setItems((a) => a.filter((_, j) => j !== i))} style={{ ...linkBtn, color: C.red }}>✕</button>
        </div>
      ))}
      <button onClick={() => setPickItem(true)} style={{ ...linkBtn, color: C.pinkDeep, marginTop: 8, fontWeight: 800 }}>+ Add product or service</button>

      {/* Amounts */}
      <div style={{ marginTop: 14, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <Field label="Discount (AED)"><input value={discount} inputMode="decimal" onChange={(e) => setDiscount(e.target.value)} style={input} placeholder="0" /></Field>
        <Field label="Shipping (AED)"><input value={shipping} inputMode="decimal" onChange={(e) => setShipping(e.target.value)} style={input} placeholder="0" /></Field>
      </div>
      {kind === 'invoice'
        ? <Field label="Due date"><input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} style={input} /></Field>
        : <Field label="Date"><input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={input} /></Field>}

      <div style={{ marginTop: 8, padding: '10px 12px', background: C.pinkSoft, borderRadius: 12 }}>
        <Row label="Subtotal" value={`AED ${money(subtotal)}`} />
        {discountFils > 0 && <Row label="Discount" value={`− AED ${money(discountFils)}`} />}
        {shippingFils > 0 && <Row label="Shipping" value={`AED ${money(shippingFils)}`} />}
        <div style={{ height: 1, background: C.line, margin: '6px 0' }} />
        <Row label={<b>Total</b>} value={<b style={{ ...fredoka(16), color: C.pinkDeep }}>AED {money(total)}</b>} />
      </div>
      <Field label="Message to customer (optional)"><input value={message} onChange={(e) => setMessage(e.target.value)} style={input} /></Field>
      {kind === 'receipt' && <div style={{ fontSize: 12, fontWeight: 700, color: C.muted2 }}>Deposit to: <b style={{ color: C.ink }}>Cash on hand</b></div>}

      {pickCustomer && <CustomerPicker onPick={(c) => { setCustomer(c); setPickCustomer(false); }} onClose={() => setPickCustomer(false)} />}
      {pickItem && <ItemPicker onPick={(it) => { setItems((a) => [...a, { name: it.name, qty: 1, priceFils: it.priceFils }]); setPickItem(false); }} onClose={() => setPickItem(false)} />}
    </Modal>
  );
}

function CustomerPicker({ onPick, onClose }: { onPick: (c: { id: number | null; name: string }) => void; onClose: () => void }) {
  const [q, setQ] = useState('');
  const [list, setList] = useState<any[]>([]);
  const [adding, setAdding] = useState(false);
  const [nc, setNc] = useState({ fullName: '', email: '', phone: '' });
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
          <Field label="Phone"><input value={nc.phone} onChange={(e) => setNc((s) => ({ ...s, phone: e.target.value }))} style={input} /></Field>
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

function ItemPicker({ onPick, onClose }: { onPick: (it: { name: string; priceFils: number }) => void; onClose: () => void }) {
  const [items, setItems] = useState<any[]>([]);
  const [q, setQ] = useState('');
  const [custom, setCustom] = useState({ name: '', price: '' });
  useEffect(() => { api.finItems().then(setItems).catch(() => setItems([])); }, []);
  const filtered = items.filter((i) => i.name.toLowerCase().includes(q.toLowerCase()));
  return (
    <Modal title="Add product or service" onClose={onClose}>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search items…" style={{ ...input, marginBottom: 10 }} autoFocus />
      <div style={{ maxHeight: 260, overflowY: 'auto', marginBottom: 12 }}>
        {filtered.map((it, i) => (
          <button key={i} onClick={() => onPick({ name: it.name, priceFils: it.priceFils })} style={rowBtn}>
            <span style={{ fontWeight: 700, color: C.ink }}>{it.name}</span>
            <span style={{ fontSize: 12, fontWeight: 700, color: C.muted2 }}>AED {money(it.priceFils)}</span>
          </button>
        ))}
      </div>
      <div style={{ fontSize: 11, fontWeight: 800, color: C.muted, letterSpacing: '.4px', marginBottom: 6 }}>OR CUSTOM ITEM</div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
        <div style={{ flex: 1 }}><Field label="Name"><input value={custom.name} onChange={(e) => setCustom((s) => ({ ...s, name: e.target.value }))} style={input} /></Field></div>
        <div style={{ width: 110 }}><Field label="Price (AED)"><input value={custom.price} inputMode="decimal" onChange={(e) => setCustom((s) => ({ ...s, price: e.target.value }))} style={input} /></Field></div>
        <Button onClick={() => { if (!custom.name.trim()) return; onPick({ name: custom.name.trim(), priceFils: Math.round((Number(custom.price.replace(/,/g, '')) || 0) * 100) }); }} style={{ marginBottom: 8 }}>Add</Button>
      </div>
    </Modal>
  );
}

// ── Shared bits ──────────────────────────────────────────────────────────────
function Modal({ title, children, onClose, onSave, busy, err, saveLabel }: { title: string; children: ReactNode; onClose: () => void; onSave?: () => void; busy?: boolean; err?: string | null; saveLabel?: string }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(59,54,65,.45)', zIndex: 1000, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '4vh 12px', overflowY: 'auto' }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', borderRadius: 20, padding: 20, width: '100%', maxWidth: 480, boxShadow: C.shadowLg }}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 14 }}>
          <button onClick={onClose} style={{ ...linkBtn, color: C.muted }}>Cancel</button>
          <div style={{ ...fredoka(15), flex: 1, textAlign: 'center' }}>{title}</div>
          {onSave ? <button onClick={onSave} disabled={busy} style={{ ...linkBtn, color: C.pinkDeep, fontWeight: 800 }}>{busy ? '…' : (saveLabel ?? 'Save')}</button> : <span style={{ width: 40 }} />}
        </div>
        {children}
        {err && <div style={{ marginTop: 10, color: C.red, fontWeight: 700, fontSize: 12.5 }}>{err}</div>}
      </div>
    </div>
  );
}

function DocRow({ title, sub, amount, badge, action }: { title: string; sub: string; amount: string; badge?: ReactNode; action?: ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 4px', borderBottom: `1px solid ${C.lineSoft}` }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13.5, fontWeight: 800, color: C.ink }}>{title}</div>
        <div style={{ fontSize: 11.5, color: C.muted, fontWeight: 600 }}>{sub}</div>
        {badge}
      </div>
      <div style={{ textAlign: 'right' }}>
        <div style={{ ...fredoka(15), color: C.ink }}>AED {amount}</div>
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
const prettyCat = (c: string) => (c || 'other').replace(/_/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());

const input: CSSProperties = { width: '100%', border: `1px solid ${C.line}`, borderRadius: 10, padding: '9px 11px', fontSize: 12.5, fontWeight: 600, outline: 'none', background: '#fff', color: C.ink, marginBottom: 2 };
const linkBtn: CSSProperties = { background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 700, padding: 2 };
const rowBtn: CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', padding: '11px 8px', border: 'none', borderBottom: `1px solid ${C.lineSoft}`, background: 'none', cursor: 'pointer', textAlign: 'left' };
const pickRow: CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', padding: '13px 12px', border: `1px solid ${C.line}`, borderRadius: 12, background: '#fff', cursor: 'pointer' };
const pill: CSSProperties = { fontSize: 10, fontWeight: 800, padding: '3px 8px', borderRadius: 8, letterSpacing: '.3px' };
