import { useEffect, useState } from 'react';
import { api } from '../api';
import { Button, C, fredoka, Panel, Spinner } from '../ui';

const input: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box', border: `1px solid ${C.line}`, borderRadius: 10,
  padding: '10px 12px', fontSize: 13, fontWeight: 600, color: C.ink, outline: 'none',
};

/**
 * Products & services catalogue: the reusable custom items the team bills with.
 * Edit a price or the description (which prints on the customer's invoice), add
 * a new one, or remove it. Manager/owner only.
 */
export function Products() {
  const [rows, setRows] = useState<any[] | null>(null);
  const [editing, setEditing] = useState<any | null>(null);
  const [adding, setAdding] = useState(false);
  const load = () => api.products().then((r) => setRows(r.rows)).catch(() => setRows([]));
  useEffect(() => { load(); }, []);
  if (!rows) return <Spinner />;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <Panel title={`🎁 Products & services (${rows.length})`} action={<Button onClick={() => setAdding(true)}>+ New</Button>}>
        <div style={{ fontSize: 11.5, fontWeight: 600, color: C.muted, marginBottom: 10, lineHeight: 1.5 }}>
          The description is what customers see on their invoice — keep it clear (what's included).
        </div>
        {rows.length === 0 ? (
          <div style={{ color: C.muted, fontWeight: 600, fontSize: 13 }}>No custom products yet — add one to reuse it while billing.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {rows.map((p) => (
              <div key={p.id} onClick={() => setEditing(p)} className="tap" style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '11px 4px', borderBottom: `1px solid ${C.lineSoft}`, cursor: 'pointer' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 700, color: C.ink }}>{p.name}</div>
                  {p.description && <div style={{ fontSize: 11.5, fontWeight: 600, color: C.muted2, lineHeight: 1.5, marginTop: 2, whiteSpace: 'pre-wrap' }}>{p.description}</div>}
                </div>
                <div style={{ ...fredoka(14), color: C.pinkDeep, whiteSpace: 'nowrap' }}>AED {p.priceDisplay}</div>
                <span style={{ color: C.muted, fontWeight: 800 }}>›</span>
              </div>
            ))}
          </div>
        )}
      </Panel>
      {(editing || adding) && (
        <ProductEditor
          item={editing}
          onClose={() => { setEditing(null); setAdding(false); }}
          onSaved={() => { setEditing(null); setAdding(false); load(); }}
        />
      )}
    </div>
  );
}

function ProductEditor({ item, onClose, onSaved }: { item: any | null; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(item?.name ?? '');
  const [price, setPrice] = useState(item ? String((item.priceFils ?? 0) / 100) : '');
  const [description, setDescription] = useState(item?.description ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const save = async () => {
    if (!name.trim()) { setErr('Name is required.'); return; }
    const priceFils = Math.round((Number(String(price).replace(/,/g, '')) || 0) * 100);
    setBusy(true); setErr(null);
    try {
      if (item) await api.productUpdate(item.id, { name: name.trim(), priceFils, description: description.trim() || null });
      else await api.finCreateItem(name.trim(), priceFils, description.trim() || undefined);
      onSaved();
    } catch (e: any) { setErr(e?.message ?? 'Could not save.'); } finally { setBusy(false); }
  };
  const del = async () => {
    if (!item) return;
    setBusy(true);
    try { await api.productDelete(item.id); onSaved(); } catch (e: any) { setErr(e?.message ?? 'Could not delete.'); setBusy(false); }
  };
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(59,54,65,.45)', zIndex: 1000, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '6vh 12px', overflowY: 'auto' }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', borderRadius: 20, padding: 20, width: '100%', maxWidth: 460, boxShadow: C.shadowLg }}>
        <div style={{ ...fredoka(17), marginBottom: 14 }}>{item ? 'Edit product' : 'New product'}</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}><span style={lbl}>Name</span><input value={name} onChange={(e) => setName(e.target.value)} style={input} /></label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}><span style={lbl}>Price (AED)</span><input value={price} inputMode="decimal" onChange={(e) => setPrice(e.target.value)} style={input} /></label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}><span style={lbl}>Description — what's included (shows on invoice)</span><textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={4} style={{ ...input, resize: 'vertical' }} /></label>
          {err && <div style={{ color: C.red, fontSize: 12.5, fontWeight: 700 }}>{err}</div>}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Button onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save'}</Button>
            <Button tone="ghost" onClick={onClose}>Cancel</Button>
            <div style={{ flex: 1 }} />
            {item && <button onClick={del} disabled={busy} style={{ border: 'none', background: 'none', color: C.red, fontWeight: 800, fontSize: 12.5, cursor: 'pointer' }}>Delete</button>}
          </div>
        </div>
      </div>
    </div>
  );
}

const lbl: React.CSSProperties = { fontSize: 11, fontWeight: 700, letterSpacing: 0.3, textTransform: 'uppercase', color: C.muted2 };
