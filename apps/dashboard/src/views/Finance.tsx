import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { api } from '../api';
import { Button, C, fredoka, Panel, Spinner } from '../ui';

const pad = (n: number) => String(n).padStart(2, '0');
const monthLabel = (m: string) => {
  const [y, mo] = m.split('-').map(Number);
  return new Date(y, mo - 1, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
};
const shortMonth = (m: string) => {
  const [y, mo] = m.split('-').map(Number);
  return new Date(y, mo - 1, 1).toLocaleDateString('en-GB', { month: 'short' });
};

const navBtn: CSSProperties = {
  border: `1px solid ${C.line}`, background: '#fff', borderRadius: 8,
  padding: '5px 10px', fontWeight: 700, fontSize: 12, cursor: 'pointer', color: C.ink,
};

const CAT_COLORS: Record<string, string> = {
  inventory: '#E94F9C', salaries: '#6C7BF0', rent: '#F0A24F', fuel: '#4FBFA0',
  marketing: '#B96CF0', maintenance: '#F06C6C', supplies: '#4F9CF0', utilities: '#8FBF4F', other: '#b3a8a0',
};

export function Finance() {
  const now = new Date();
  const [month, setMonth] = useState(`${now.getFullYear()}-${pad(now.getMonth() + 1)}`);
  const [fin, setFin] = useState<any>(null);
  const [exp, setExp] = useState<any>(null);
  const [form, setForm] = useState({ category: 'other', description: '', amount: '', vendor: '', spentOn: '', paymentMethod: '' });
  const [receiptUrl, setReceiptUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = () => {
    setFin(null);
    void api.finance(month).then(setFin);
    void api.expenses(month).then(setExp);
  };
  useEffect(load, [month]);

  const shift = (delta: number) => {
    const [y, m] = month.split('-').map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    setMonth(`${d.getFullYear()}-${pad(d.getMonth() + 1)}`);
  };

  const addExpense = async () => {
    const amountFils = Math.round(Number(form.amount) * 100);
    if (!form.description.trim() || !Number.isFinite(amountFils) || amountFils <= 0) return;
    setSaving(true);
    try {
      await api.addExpense({
        category: form.category,
        description: form.description.trim(),
        amountFils,
        vendor: form.vendor.trim() || undefined,
        spentOn: form.spentOn || undefined,
        receiptUrl: receiptUrl || undefined,
        paymentMethod: form.paymentMethod || undefined,
      });
      setForm({ category: form.category, description: '', amount: '', vendor: '', spentOn: '', paymentMethod: form.paymentMethod });
      setReceiptUrl(null);
      load();
    } finally {
      setSaving(false);
    }
  };

  if (!fin) return <Spinner />;

  const maxTrend = Math.max(1, ...fin.trend.map((t: any) => Math.max(t.revenueFils, t.expenseFils)));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <Panel
        title={`Finance — ${monthLabel(month)}`}
        action={
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <button
              onClick={async () => {
                try {
                  const r = await api.emailFinanceReport(month);
                  alert(r.sent > 0 ? `Report emailed to ${r.sent} recipient(s).` : 'No recipients configured (set FINANCE_REPORT_TO or add manager emails).');
                } catch (e: any) {
                  alert(e?.message ?? 'Could not send the report.');
                }
              }}
              style={{ ...navBtn, color: C.pinkDeep, borderColor: C.pink }}
            >
              ✉ Email report
            </button>
            <button onClick={() => shift(-1)} style={navBtn}>‹</button>
            <button onClick={() => setMonth(`${now.getFullYear()}-${pad(now.getMonth() + 1)}`)} style={navBtn}>This month</button>
            <button onClick={() => shift(1)} style={navBtn}>›</button>
          </div>
        }
      >
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 12 }}>
          <Tile label="Revenue" value={`AED ${fin.revenueDisplay}`} accent={C.green} />
          <Tile label="Expenses" value={`AED ${fin.expensesDisplay}`} accent="#F06C6C" />
          <Tile
            label={`Net profit · ${fin.marginPct}% margin`}
            value={`${fin.profitNegative ? '−' : ''}AED ${fin.profitDisplay}`}
            accent={fin.profitNegative ? '#F06C6C' : C.green}
          />
          <Tile label="Tips collected (to staff)" value={`AED ${fin.tipsCollectedDisplay}`} sub="pass-through, not revenue" />
        </div>
      </Panel>

      <Panel title="6-month trend">
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 14, height: 170, padding: '0 4px' }}>
          {fin.trend.map((t: any) => (
            <div key={t.month} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
              <div style={{ flex: 1, display: 'flex', alignItems: 'flex-end', gap: 4, width: '100%', justifyContent: 'center' }}>
                <div
                  title={`Revenue AED ${t.revenueDisplay}`}
                  style={{ width: '38%', background: C.green, borderRadius: '4px 4px 0 0', height: `${(t.revenueFils / maxTrend) * 100}%`, minHeight: t.revenueFils > 0 ? 3 : 0 }}
                />
                <div
                  title={`Expenses AED ${t.expenseDisplay}`}
                  style={{ width: '38%', background: '#F0A6A6', borderRadius: '4px 4px 0 0', height: `${(t.expenseFils / maxTrend) * 100}%`, minHeight: t.expenseFils > 0 ? 3 : 0 }}
                />
              </div>
              <div style={{ fontSize: 10.5, fontWeight: 700, color: t.month === month ? C.pinkDeep : C.muted }}>
                {shortMonth(t.month)}
              </div>
              <div style={{ fontSize: 9.5, fontWeight: 700, color: t.profitFils < 0 ? '#F06C6C' : C.green }}>
                {t.profitFils < 0 ? '−' : ''}{t.profitDisplay}
              </div>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 16, marginTop: 10, fontSize: 11, fontWeight: 700, color: C.muted }}>
          <span><span style={{ color: C.green }}>■</span> Revenue</span>
          <span><span style={{ color: '#F0A6A6' }}>■</span> Expenses</span>
          <span>· profit under each month</span>
        </div>
      </Panel>

      {fin.byCategory.length > 0 && (
        <Panel title="Expenses by category">
          {fin.byCategory.map((c: any) => (
            <div key={c.category} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
              <span style={{ width: 90, fontSize: 12, fontWeight: 700, textTransform: 'capitalize' }}>{c.category}</span>
              <div style={{ flex: 1, background: C.lineSoft, borderRadius: 6, height: 14, overflow: 'hidden' }}>
                <div style={{ width: `${(c.amountFils / fin.expensesFils) * 100}%`, background: CAT_COLORS[c.category] ?? C.pink, height: '100%' }} />
              </div>
              <span style={{ width: 90, textAlign: 'right', fontSize: 12, fontWeight: 700 }}>AED {c.amountDisplay}</span>
            </div>
          ))}
        </Panel>
      )}

      <Panel title="Record an expense">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'flex-end' }}>
          <label style={fieldWrap}>
            <span style={fieldLabel}>Category</span>
            <select value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))} style={input}>
              {(exp?.categories ?? Object.keys(CAT_COLORS)).map((c: string) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </label>
          <label style={{ ...fieldWrap, flex: 2, minWidth: 180 }}>
            <span style={fieldLabel}>Description</span>
            <input value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} placeholder="e.g. Helium refill" style={input} />
          </label>
          <label style={fieldWrap}>
            <span style={fieldLabel}>Amount (AED)</span>
            <input value={form.amount} inputMode="decimal" onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value.replace(/[^\d.]/g, '') }))} placeholder="0.00" style={input} />
          </label>
          <label style={fieldWrap}>
            <span style={fieldLabel}>Vendor</span>
            <input value={form.vendor} onChange={(e) => setForm((f) => ({ ...f, vendor: e.target.value }))} placeholder="optional" style={input} />
          </label>
          <label style={fieldWrap}>
            <span style={fieldLabel}>Paid by</span>
            <select value={form.paymentMethod} onChange={(e) => setForm((f) => ({ ...f, paymentMethod: e.target.value }))} style={input}>
              <option value="">—</option>
              {(exp?.paymentMethods ?? ['cash', 'card', 'bank_transfer', 'cheque', 'other']).map((p: string) => (
                <option key={p} value={p}>{p.replace('_', ' ')}</option>
              ))}
            </select>
          </label>
          <label style={fieldWrap}>
            <span style={fieldLabel}>Date</span>
            <input type="date" value={form.spentOn} onChange={(e) => setForm((f) => ({ ...f, spentOn: e.target.value }))} style={input} />
          </label>
          <label style={{ ...fieldWrap, minWidth: 130 }}>
            <span style={fieldLabel}>Receipt</span>
            <label style={{ ...input, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, color: receiptUrl ? C.green : C.muted }}>
              {uploading ? 'Uploading…' : receiptUrl ? '✓ Attached' : '📎 Add photo'}
              <input
                type="file"
                accept="image/*"
                style={{ display: 'none' }}
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  setUploading(true);
                  try { setReceiptUrl(await api.uploadImage(f, 'receipts')); }
                  catch (err: any) { alert(err?.message ?? 'Upload failed'); }
                  finally { setUploading(false); }
                }}
              />
            </label>
          </label>
          <Button onClick={addExpense} disabled={saving || uploading || !form.description.trim() || !form.amount}>
            {saving ? 'Saving…' : 'Add expense'}
          </Button>
        </div>
        {receiptUrl && (
          <div style={{ marginTop: 8 }}>
            <img src={receiptUrl} alt="receipt" style={{ height: 54, borderRadius: 8, border: `1px solid ${C.line}` }} />
          </div>
        )}
      </Panel>

      <Panel title={`Expenses — ${monthLabel(month)}`}>
        {!exp ? (
          <Spinner />
        ) : exp.expenses.length === 0 ? (
          <div style={{ fontSize: 12.5, fontWeight: 600, color: C.muted }}>No expenses recorded this month.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
            {exp.expenses.map((e: any) => (
              <div key={e.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 11, border: `1px solid ${C.line}`, borderRadius: 14, padding: '12px 14px' }}>
                <span style={{ width: 10, height: 10, borderRadius: '50%', background: CAT_COLORS[e.category] ?? C.pink, marginTop: 4, flex: 'none' }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 13 }}>
                    {e.description}
                    {e.receipt_url && (
                      <a href={e.receipt_url} target="_blank" rel="noreferrer" style={{ marginLeft: 8, fontSize: 11, fontWeight: 700, color: C.pinkDeep, textDecoration: 'none' }}>📎</a>
                    )}
                  </div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: C.muted, marginTop: 2, textTransform: 'capitalize' }}>
                    {String(e.category).replace('_', ' ')} · {String(e.spent_on).slice(0, 10)}{e.vendor ? ` · ${e.vendor}` : ''}{e.payment_method ? ` · ${String(e.payment_method).replace('_', ' ')}` : ''}
                  </div>
                </div>
                <div style={{ textAlign: 'right', flex: 'none' }}>
                  <div style={{ fontWeight: 800, fontSize: 13.5 }}>AED {e.amountDisplay}</div>
                  <button
                    onClick={async () => { await api.deleteExpense(e.id); load(); }}
                    style={{ border: 'none', background: 'transparent', color: C.red, fontWeight: 700, fontSize: 11, cursor: 'pointer', padding: '2px 0 0' }}
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}

function Tile({ label, value, accent, sub }: { label: string; value: string; accent?: string; sub?: string }) {
  return (
    <div style={{ background: '#fff', border: `1px solid ${C.line}`, borderRadius: 14, padding: '13px 15px' }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, marginBottom: 5 }}>{label}</div>
      <div style={{ ...fredoka(20), color: accent ?? C.ink }}>{value}</div>
      {sub && <div style={{ fontSize: 10, fontWeight: 600, color: C.muted, marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

const fieldWrap: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4, flex: 1, minWidth: 110 };
const fieldLabel: CSSProperties = { fontSize: 10.5, fontWeight: 700, color: C.muted };
const input: CSSProperties = {
  border: `1px solid ${C.line}`, borderRadius: 10, padding: '9px 11px',
  fontSize: 12.5, fontWeight: 600, outline: 'none', background: '#fff', color: C.ink,
};
