import { useEffect, useState } from 'react';
import { api } from '../api';
import { Button, C, fredoka, Panel, Spinner } from '../ui';

const input: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box', border: `1px solid ${C.line}`, borderRadius: 10,
  padding: '10px 12px', fontSize: 13, fontWeight: 600, color: C.ink, outline: 'none',
};
const lbl: React.CSSProperties = { fontSize: 11, fontWeight: 700, letterSpacing: 0.3, textTransform: 'uppercase', color: C.muted2 };

/** The suppliers directory — who we buy from, how to reach them, what they supply. */
export function Suppliers() {
  const [rows, setRows] = useState<any[] | null>(null);
  const [editing, setEditing] = useState<any | null>(null);
  const [adding, setAdding] = useState(false);
  const load = () => api.suppliers().then((r) => setRows(r.rows)).catch(() => setRows([]));
  useEffect(() => { load(); }, []);
  if (!rows) return <Spinner />;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <Panel title={`🚚 Suppliers (${rows.length})`} action={<Button onClick={() => setAdding(true)}>+ New</Button>}>
        {rows.length === 0 ? (
          <div style={{ color: C.muted, fontWeight: 600, fontSize: 13 }}>No suppliers yet — add the vendors you buy from.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {rows.map((s) => (
              <div key={s.id} onClick={() => setEditing(s)} className="tap" style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '11px 4px', borderBottom: `1px solid ${C.lineSoft}`, cursor: 'pointer' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 700, color: C.ink }}>{s.name}</div>
                  {s.supplies && <div style={{ fontSize: 11.5, fontWeight: 600, color: C.pinkDeep, marginTop: 1 }}>{s.supplies}</div>}
                  <div style={{ fontSize: 11.5, fontWeight: 600, color: C.muted, marginTop: 2 }}>
                    {[s.contact, s.phone, s.email].filter(Boolean).join(' · ') || 'No contact details'}
                  </div>
                </div>
                <span style={{ color: C.muted, fontWeight: 800 }}>›</span>
              </div>
            ))}
          </div>
        )}
      </Panel>
      {(editing || adding) && (
        <SupplierEditor supplier={editing} onClose={() => { setEditing(null); setAdding(false); }} onSaved={() => { setEditing(null); setAdding(false); load(); }} />
      )}
    </div>
  );
}

function SupplierEditor({ supplier, onClose, onSaved }: { supplier: any | null; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({
    name: supplier?.name ?? '', contact: supplier?.contact ?? '', phone: supplier?.phone ?? '',
    email: supplier?.email ?? '', supplies: supplier?.supplies ?? '', note: supplier?.note ?? '',
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const set = (k: string, v: string) => setF((s) => ({ ...s, [k]: v }));
  const save = async () => {
    if (!f.name.trim()) { setErr('Name is required.'); return; }
    setBusy(true); setErr(null);
    const body = { name: f.name.trim(), contact: f.contact.trim(), phone: f.phone.trim(), email: f.email.trim(), supplies: f.supplies.trim(), note: f.note.trim() };
    try {
      if (supplier) await api.supplierUpdate(supplier.id, body);
      else await api.supplierCreate(body);
      onSaved();
    } catch (e: any) { setErr(e?.message ?? 'Could not save.'); } finally { setBusy(false); }
  };
  const del = async () => {
    if (!supplier) return;
    setBusy(true);
    try { await api.supplierDelete(supplier.id); onSaved(); } catch (e: any) { setErr(e?.message ?? 'Could not delete.'); setBusy(false); }
  };
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(59,54,65,.45)', zIndex: 1000, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '6vh 12px', overflowY: 'auto' }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', borderRadius: 20, padding: 20, width: '100%', maxWidth: 460, boxShadow: C.shadowLg }}>
        <div style={{ ...fredoka(17), marginBottom: 14 }}>{supplier ? 'Edit supplier' : 'New supplier'}</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Field label="Supplier name"><input value={f.name} onChange={(e) => set('name', e.target.value)} style={input} /></Field>
          <Field label="What they supply"><input value={f.supplies} onChange={(e) => set('supplies', e.target.value)} placeholder="e.g. balloons, backdrops" style={input} /></Field>
          <Field label="Contact person"><input value={f.contact} onChange={(e) => set('contact', e.target.value)} style={input} /></Field>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <Field label="Phone"><input value={f.phone} onChange={(e) => set('phone', e.target.value)} style={input} /></Field>
            <Field label="Email"><input value={f.email} onChange={(e) => set('email', e.target.value)} style={input} /></Field>
          </div>
          <Field label="Notes"><textarea value={f.note} onChange={(e) => set('note', e.target.value)} rows={3} style={{ ...input, resize: 'vertical' }} /></Field>
          {err && <div style={{ color: C.red, fontSize: 12.5, fontWeight: 700 }}>{err}</div>}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Button onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save'}</Button>
            <Button tone="ghost" onClick={onClose}>Cancel</Button>
            <div style={{ flex: 1 }} />
            {supplier && <button onClick={del} disabled={busy} style={{ border: 'none', background: 'none', color: C.red, fontWeight: 800, fontSize: 12.5, cursor: 'pointer' }}>Delete</button>}
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}><span style={lbl}>{label}</span>{children}</label>;
}
