import { useEffect, useState } from 'react';
import { api } from '../api';
import { C, Panel, Button, Spinner, Badge } from '../ui';

/**
 * Bank Inbox (#16) — every RAKBANK transaction arrives here as a PENDING row.
 * Marsha attaches the receipt and approves → it posts to Expenses. Only the
 * OWNER sees the "Ignore" button (owner's rule).
 */

const CATEGORIES = ['general', 'inventory', 'supplies', 'fuel', 'marketing', 'maintenance', 'rent', 'utilities', 'salaries', 'transfer', 'other'];
const KIND_LABEL: Record<string, string> = { purchase: '🛒 Purchase', withdrawal: '🏧 Withdrawal', transfer: '🔁 Transfer', other: '• Other' };

type Tab = 'pending' | 'approved' | 'ignored';

export function BankInbox({ role }: { role?: string }) {
  const isOwner = role === 'owner';
  const [tab, setTab] = useState<Tab>('pending');
  const [rows, setRows] = useState<any[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [cat, setCat] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);

  const load = (t: Tab) => {
    setRows(null);
    api.bankTransactions(t).then((r) => setRows(Array.isArray(r) ? r : [])).catch(() => setRows([]));
  };
  useEffect(() => { load(tab); }, [tab]);

  async function uploadReceipt(id: string, file: File) {
    setBusy(id); setErr(null);
    try {
      const url = await api.uploadImage(file, 'receipts');
      await api.bankTxReceipt(id, url);
      setRows((rs) => rs?.map((r) => r.id === id ? { ...r, receipt_url: url } : r) ?? rs);
    } catch { setErr('تعذّر رفع الإيصال — حاولي مرة ثانية'); } finally { setBusy(null); }
  }

  async function approve(row: any) {
    setBusy(row.id); setErr(null);
    try {
      await api.bankTxApprove(row.id, { category: cat[row.id] || (row.kind === 'transfer' ? 'transfer' : 'general') });
      setRows((rs) => rs?.filter((r) => r.id !== row.id) ?? rs);
    } catch (e: any) { setErr(e?.message || 'تعذّر الاعتماد'); } finally { setBusy(null); }
  }

  async function ignore(row: any) {
    if (!isOwner) return;
    setBusy(row.id); setErr(null);
    try {
      await api.bankTxIgnore(row.id);
      setRows((rs) => rs?.filter((r) => r.id !== row.id) ?? rs);
    } catch (e: any) { setErr(e?.message || 'تعذّر التجاهل'); } finally { setBusy(null); }
  }

  const pendingCount = tab === 'pending' && rows ? rows.length : null;

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <Panel style={{ background: C.gradHero, border: 'none' }}>
        <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 1.1, textTransform: 'uppercase', color: C.pinkDeep }}>Finance · Bank Inbox</div>
        <div style={{ fontSize: 24, fontWeight: 800, color: C.ink, margin: '6px 0 6px' }}>🏦 عمليات البنك</div>
        <div style={{ fontSize: 13.5, color: C.inkSoft, maxWidth: 640 }}>
          كل عملية من RAKBANK تطلع هنا. ارفعي الإيصال واضغطي <b>اعتماد</b> عشان تتحفظ كمصروف. {isOwner ? 'التجاهل للأونر فقط.' : 'التجاهل يسويه الأونر.'}
        </div>
      </Panel>

      <div style={{ display: 'flex', gap: 8 }}>
        {(['pending', 'approved', 'ignored'] as Tab[]).map((t) => (
          <button key={t} onClick={() => setTab(t)} style={{
            fontFamily: 'inherit', fontSize: 13, fontWeight: 700, cursor: 'pointer', borderRadius: 20, padding: '7px 15px',
            border: `1px solid ${tab === t ? C.pink : C.line}`, background: tab === t ? C.pinkSoft : '#fff', color: tab === t ? C.pinkDeep : C.inkSoft,
          }}>{t === 'pending' ? '⏳ معلّقة' : t === 'approved' ? '✅ معتمدة' : '🚫 متجاهَلة'}{pendingCount != null && t === 'pending' ? ` (${pendingCount})` : ''}</button>
        ))}
      </div>

      {err && <div style={{ background: '#fdecea', color: '#b3261e', border: '1px solid #f7c6c1', borderRadius: 10, padding: '10px 13px', fontSize: 13, fontWeight: 600 }}>{err}</div>}

      {rows === null ? <Spinner /> : rows.length === 0 ? (
        <Panel><div style={{ textAlign: 'center', color: C.muted2, padding: 30, fontWeight: 600 }}>ما فيه عمليات هنا 🌸</div></Panel>
      ) : (
        <div style={{ display: 'grid', gap: 12 }}>
          {rows.map((r) => (
            <Panel key={r.id} style={{ padding: 16 }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10 }}>
                <div style={{ fontSize: 22, fontWeight: 800, color: r.direction === 'credit' ? C.mintDeep : C.ink, fontVariantNumeric: 'tabular-nums' }}>
                  {r.direction === 'credit' ? '+' : ''}AED {r.amountDisplay}
                </div>
                <Badge tone="neutral">{KIND_LABEL[r.kind] ?? r.kind}</Badge>
                <div style={{ flex: 1 }} />
                <div style={{ fontSize: 12.5, color: C.muted2, fontWeight: 600 }}>{r.posted_on ?? ''}</div>
              </div>
              <div style={{ fontSize: 15, fontWeight: 700, color: C.ink, marginTop: 6 }}>{r.merchant || '—'}</div>

              {tab === 'pending' ? (
                <>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', marginTop: 12 }}>
                    <label style={{ fontSize: 12, fontWeight: 700, color: C.muted2 }}>التصنيف:</label>
                    <select value={cat[r.id] ?? (r.kind === 'transfer' ? 'transfer' : 'general')} onChange={(e) => setCat((c) => ({ ...c, [r.id]: e.target.value }))}
                      style={{ fontFamily: 'inherit', fontSize: 13, padding: '8px 10px', borderRadius: 10, border: `1px solid ${C.line}`, background: '#fff', color: C.ink }}>
                      {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                    <label style={{ fontSize: 13, fontWeight: 700, color: C.pinkDeep, cursor: 'pointer', border: `1px dashed ${C.pink}`, borderRadius: 10, padding: '8px 12px', background: C.pinkSoft }}>
                      {r.receipt_url ? '✓ إيصال مرفق — تغيير' : '📎 ارفعي الإيصال'}
                      <input type="file" accept="image/*,application/pdf" hidden disabled={busy === r.id}
                        onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadReceipt(r.id, f); }} />
                    </label>
                    {r.receipt_url && <a href={r.receipt_url} target="_blank" rel="noopener" style={{ fontSize: 12.5, color: C.pinkDeep, fontWeight: 600 }}>عرض الإيصال ↗</a>}
                  </div>
                  <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                    <Button onClick={() => approve(r)} disabled={busy === r.id || !r.receipt_url}>
                      {busy === r.id ? '...' : '✅ اعتماد'}
                    </Button>
                    {isOwner && (
                      <button onClick={() => ignore(r)} disabled={busy === r.id} style={{
                        fontFamily: 'inherit', fontSize: 13.5, fontWeight: 700, cursor: 'pointer', borderRadius: 11, padding: '10px 16px',
                        border: `1px solid ${C.line}`, background: '#fff', color: C.muted2,
                      }}>🚫 تجاهل</button>
                    )}
                    {!r.receipt_url && <span style={{ fontSize: 12, color: C.muted2, alignSelf: 'center' }}>ارفعي الإيصال أول عشان تعتمدين</span>}
                  </div>
                </>
              ) : (
                <div style={{ display: 'flex', gap: 12, marginTop: 8, fontSize: 12.5, color: C.muted2, fontWeight: 600 }}>
                  <span>{tab === 'approved' ? `✅ اعتمدها ${r.decided_by ?? ''}` : `🚫 تجاهلها ${r.decided_by ?? ''}`}</span>
                  {r.receipt_url && <a href={r.receipt_url} target="_blank" rel="noopener" style={{ color: C.pinkDeep }}>الإيصال ↗</a>}
                </div>
              )}
            </Panel>
          ))}
        </div>
      )}
    </div>
  );
}
