import { useEffect, useState } from 'react';
import { api } from '../api';
import { C, fredoka, Panel, Button, Spinner, Badge } from '../ui';

const input: React.CSSProperties = {
  border: `1.5px solid ${C.line}`, borderRadius: 12, padding: '10px 12px',
  fontSize: 14, fontWeight: 600, color: C.ink, background: '#fff', width: '100%', outline: 'none',
};

/**
 * Customers Master (CRM). The real customer book: search, see lifetime spend and
 * order history, the next upcoming party, and edit contact details — including a
 * primary AND an alternative mobile number. Emirate only (per-event addresses
 * live inside the order). Manager + owner only.
 */
export function Customers() {
  const [rows, setRows] = useState<any[] | null>(null);
  const [q, setQ] = useState('');
  const [sel, setSel] = useState<number | null>(null);

  const load = (search?: string) => {
    setRows(null);
    api.customers(search).then(setRows).catch(() => setRows([]));
  };
  useEffect(() => { load(); }, []);
  // Debounced search.
  useEffect(() => {
    const t = setTimeout(() => load(q.trim() || undefined), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 900 }}>
      <input
        placeholder="Search by name, phone, email or emirate…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        style={{ ...input, fontSize: 15, padding: '12px 14px' }}
      />
      {!rows ? <Spinner /> : rows.length === 0 ? (
        <Panel title="Customers"><div style={{ color: C.muted, fontWeight: 600, fontSize: 13 }}>No customers found.</div></Panel>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: C.muted2 }}>{rows.length} customer{rows.length === 1 ? '' : 's'}</div>
          {rows.map((c) => (
            <button
              key={c.id}
              onClick={() => setSel(c.id)}
              style={{
                display: 'flex', alignItems: 'center', gap: 12, textAlign: 'left', cursor: 'pointer',
                border: `1px solid ${C.line}`, background: '#fff', borderRadius: 14, padding: '12px 14px',
              }}
            >
              <div style={{ width: 38, height: 38, borderRadius: 999, background: C.pinkSoft, color: C.pinkDeep, display: 'grid', placeItems: 'center', fontWeight: 800, fontSize: 15, flex: 'none' }}>
                {String(c.name || '?').trim().charAt(0).toUpperCase()}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 800, fontSize: 14, color: C.ink, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.name}</div>
                <div style={{ fontSize: 12, fontWeight: 600, color: C.muted2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {c.phone || 'No phone'}{c.emirate ? ` · ${c.emirate}` : ''}
                </div>
              </div>
              {c.nextEventDate && <Badge tone="info">📅 {c.nextEventDate}</Badge>}
              <div style={{ textAlign: 'right', flex: 'none' }}>
                <div style={{ ...fredoka(15), color: C.pinkDeep }}>AED {c.spendDisplay}</div>
                <div style={{ fontSize: 11, fontWeight: 700, color: C.muted }}>{c.orders} order{c.orders === 1 ? '' : 's'}</div>
              </div>
            </button>
          ))}
        </div>
      )}
      {sel != null && <CustomerDrawer id={sel} onClose={() => setSel(null)} onSaved={() => load(q.trim() || undefined)} />}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      <span style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: 0.3, textTransform: 'uppercase', color: C.muted2 }}>{label}</span>
      {children}
    </label>
  );
}

function CustomerDrawer({ id, onClose, onSaved }: { id: number; onClose: () => void; onSaved: () => void }) {
  const [data, setData] = useState<any>(null);
  const [form, setForm] = useState<any>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    api.customer(id).then((d) => { setData(d); setForm({ fullName: d.name || '', email: d.email || '', phone: d.phone || '', backupPhone: d.phoneAlt || '', emirate: d.emirate || '' }); }).catch(() => setData(null));
  }, [id]);

  const save = async () => {
    setBusy(true); setMsg(null);
    try {
      await api.updateCustomer(id, form);
      setMsg('Saved ✓');
      onSaved();
      setTimeout(() => setMsg(null), 1500);
    } catch (e: any) { setMsg(e?.message ?? 'Could not save'); } finally { setBusy(false); }
  };

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(40,20,35,0.4)', zIndex: 60, display: 'flex', justifyContent: 'flex-end' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: 'min(460px, 100%)', height: '100%', background: C.bg, boxShadow: '-8px 0 30px rgba(0,0,0,0.15)', overflowY: 'auto', padding: 18 }}>
        {!data ? <Spinner /> : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <h2 style={{ ...fredoka(20), color: C.ink, margin: 0 }}>{data.name}</h2>
              <button onClick={onClose} style={{ border: 'none', background: 'none', fontSize: 22, cursor: 'pointer', color: C.muted }}>×</button>
            </div>

            <div style={{ display: 'flex', gap: 10 }}>
              <div style={{ flex: 1, background: C.pinkSoft, borderRadius: 12, padding: '10px 12px' }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: C.muted2 }}>Lifetime spend</div>
                <div style={{ ...fredoka(18), color: C.pinkDeep }}>AED {data.spendDisplay}</div>
              </div>
              <div style={{ flex: 1, background: C.mintSoft, borderRadius: 12, padding: '10px 12px' }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: C.muted2 }}>Orders</div>
                <div style={{ ...fredoka(18), color: C.mintDeep }}>{data.orders}</div>
              </div>
            </div>

            <Panel title="Contact details">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <Field label="Name"><input value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} style={input} /></Field>
                <Field label="Email"><input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} style={input} /></Field>
                <Field label="Primary mobile"><input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+9715XXXXXXXX" style={input} /></Field>
                <Field label="Alternative mobile"><input value={form.backupPhone} onChange={(e) => setForm({ ...form, backupPhone: e.target.value })} placeholder="+9715XXXXXXXX" style={input} /></Field>
                <Field label="Emirate"><input value={form.emirate} onChange={(e) => setForm({ ...form, emirate: e.target.value })} style={input} /></Field>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <Button onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save changes'}</Button>
                  {msg && <span style={{ fontSize: 12.5, fontWeight: 700, color: msg.includes('✓') ? C.green : C.red }}>{msg}</span>}
                </div>
                <div style={{ fontSize: 11, color: C.muted, lineHeight: 1.5 }}>UAE numbers are auto-formatted to +9715XXXXXXXX on save. The per-event delivery address lives inside each order, not here.</div>
              </div>
            </Panel>

            {data.upcoming?.length > 0 && (
              <Panel title="Upcoming events">
                {data.upcoming.map((e: any) => (
                  <div key={e.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: `1px solid ${C.lineSoft}`, fontSize: 13, fontWeight: 600 }}>
                    <span style={{ color: C.ink }}>{e.event_date} · {e.emirate}</span>
                    <Badge tone="info">{e.phase}</Badge>
                  </div>
                ))}
              </Panel>
            )}

            <Panel title={`Order history (${data.history?.length ?? 0})`}>
              {(!data.history || data.history.length === 0) ? (
                <div style={{ color: C.muted, fontWeight: 600, fontSize: 13 }}>No sales on record yet.</div>
              ) : data.history.map((h: any) => (
                <div key={h.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '9px 0', borderBottom: `1px solid ${C.lineSoft}` }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: C.ink }}>{h.eventFor ? `${h.eventFor}${h.theme ? ` · ${h.theme}` : ''}` : `Receipt #${h.number}`}</div>
                    <div style={{ fontSize: 11.5, fontWeight: 600, color: C.muted2 }}>{h.date} · {h.paidWith}</div>
                  </div>
                  <div style={{ ...fredoka(14), color: C.ink }}>AED {h.totalDisplay}</div>
                </div>
              ))}
            </Panel>
          </div>
        )}
      </div>
    </div>
  );
}
