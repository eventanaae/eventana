import { useEffect, useState } from 'react';
import { api } from '../api';
import { Badge, Button, C, fredoka, Panel, Spinner } from '../ui';

const input: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box', border: `1px solid ${C.line}`, borderRadius: 10,
  padding: '10px 12px', fontSize: 13, fontWeight: 600, color: C.ink, outline: 'none',
};
const lbl: React.CSSProperties = { fontSize: 11, fontWeight: 700, letterSpacing: 0.3, textTransform: 'uppercase', color: C.muted2 };

/**
 * Products & services — the REAL customer catalogue (packages + services, with
 * the prices customers pay), plus reusable custom billing items. Editing a
 * catalogue price here flows straight to the customer app when they book.
 * Manager/owner only.
 */
export function Products() {
  const [cat, setCat] = useState<{ packages: any[]; services: any[] } | null>(null);
  const [custom, setCustom] = useState<any[] | null>(null);
  const [edit, setEdit] = useState<{ kind: 'package' | 'service'; item: any } | null>(null);
  const [editCustom, setEditCustom] = useState<any | null>(null);
  const [addCustom, setAddCustom] = useState(false);

  const load = () => {
    api.catalog().then(setCat).catch(() => setCat({ packages: [], services: [] }));
    api.products().then((r) => setCustom(r.rows)).catch(() => setCustom([]));
  };
  useEffect(() => { load(); }, []);
  if (!cat || !custom) return <Spinner />;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 760 }}>
      <div style={{ background: C.pinkSoft, borderRadius: 12, padding: '11px 14px', fontSize: 12, fontWeight: 700, color: C.pinkDeep, lineHeight: 1.5 }}>
        💡 These are the packages &amp; services customers book. A price you set here shows to customers immediately.
      </div>

      <Panel title={`🎁 Packages (${cat.packages.length})`}>
        <CatalogList items={cat.packages} onEdit={(item) => setEdit({ kind: 'package', item })} />
      </Panel>

      <Panel title={`✨ Services & add-ons (${cat.services.length})`}>
        <CatalogList items={cat.services} onEdit={(item) => setEdit({ kind: 'service', item })} />
      </Panel>

      <Panel title={`🧾 Custom billing items (${custom.length})`} action={<Button onClick={() => setAddCustom(true)}>+ New</Button>}>
        <div style={{ fontSize: 11.5, fontWeight: 600, color: C.muted, marginBottom: 10, lineHeight: 1.5 }}>
          For one-off items on invoices &amp; receipts (not shown in the customer catalogue). The description prints on the customer's invoice.
        </div>
        {custom.length === 0 ? (
          <div style={{ color: C.muted, fontWeight: 600, fontSize: 13 }}>None yet — add one to reuse it while billing.</div>
        ) : custom.map((p) => (
          <div key={p.id} onClick={() => setEditCustom(p)} className="tap" style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '11px 4px', borderBottom: `1px solid ${C.lineSoft}`, cursor: 'pointer' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13.5, fontWeight: 700, color: C.ink }}>{p.name}</div>
              {p.description && <div style={{ fontSize: 11.5, fontWeight: 600, color: C.muted2, lineHeight: 1.5, marginTop: 2, whiteSpace: 'pre-wrap' }}>{p.description}</div>}
            </div>
            <div style={{ ...fredoka(14), color: C.pinkDeep, whiteSpace: 'nowrap' }}>AED {p.priceDisplay}</div>
            <span style={{ color: C.muted, fontWeight: 800 }}>›</span>
          </div>
        ))}
      </Panel>

      {edit && <CatalogEditor kind={edit.kind} item={edit.item} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); load(); }} />}
      {(editCustom || addCustom) && (
        <CustomEditor item={editCustom} onClose={() => { setEditCustom(null); setAddCustom(false); }} onSaved={() => { setEditCustom(null); setAddCustom(false); load(); }} />
      )}
    </div>
  );
}

function CatalogList({ items, onEdit }: { items: any[]; onEdit: (item: any) => void }) {
  if (items.length === 0) return <div style={{ color: C.muted, fontWeight: 600, fontSize: 13 }}>Nothing here yet.</div>;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {items.map((it) => (
        <div key={it.id} onClick={() => onEdit(it)} className="tap" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 4px', borderBottom: `1px solid ${C.lineSoft}`, cursor: 'pointer', opacity: it.active ? 1 : 0.5 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13.5, fontWeight: 700, color: C.ink }}>{it.name}</div>
            {it.category && <div style={{ fontSize: 11, fontWeight: 600, color: C.muted }}>{it.category}</div>}
          </div>
          {!it.active && <Badge tone="neutral">Hidden</Badge>}
          <div style={{ ...fredoka(14), color: C.pinkDeep, whiteSpace: 'nowrap' }}>AED {it.priceDisplay}</div>
          <span style={{ color: C.muted, fontWeight: 800 }}>›</span>
        </div>
      ))}
    </div>
  );
}

function CatalogEditor({ kind, item, onClose, onSaved }: { kind: 'package' | 'service'; item: any; onClose: () => void; onSaved: () => void }) {
  const [price, setPrice] = useState(String((item.priceFils ?? 0) / 100));
  const [active, setActive] = useState<boolean>(item.active !== false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const save = async () => {
    const priceFils = Math.round((Number(String(price).replace(/,/g, '')) || 0) * 100);
    setBusy(true); setErr(null);
    try {
      const patch = { priceFils, active };
      if (kind === 'package') await api.packageUpdate(item.id, patch);
      else await api.serviceUpdate(item.id, patch);
      onSaved();
    } catch (e: any) { setErr(e?.message ?? 'Could not save.'); } finally { setBusy(false); }
  };
  return (
    <Modal title={item.name} onClose={onClose}>
      <div style={{ fontSize: 11.5, fontWeight: 600, color: C.muted, marginBottom: 12 }}>
        {kind === 'package' ? 'Package' : 'Service'} — the price customers see when booking.
      </div>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 5, marginBottom: 12 }}>
        <span style={lbl}>Price (AED)</span>
        <input value={price} inputMode="decimal" onChange={(e) => setPrice(e.target.value)} style={input} autoFocus />
      </label>
      <label style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 14, cursor: 'pointer' }}>
        <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
        <span style={{ fontSize: 12.5, fontWeight: 700, color: C.ink }}>Visible to customers</span>
      </label>
      {err && <div style={{ color: C.red, fontSize: 12.5, fontWeight: 700, marginBottom: 10 }}>{err}</div>}
      <div style={{ display: 'flex', gap: 8 }}>
        <Button onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save'}</Button>
        <Button tone="ghost" onClick={onClose}>Cancel</Button>
      </div>
    </Modal>
  );
}

function CustomEditor({ item, onClose, onSaved }: { item: any | null; onClose: () => void; onSaved: () => void }) {
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
    <Modal title={item ? 'Edit item' : 'New custom item'} onClose={onClose}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}><span style={lbl}>Name</span><input value={name} onChange={(e) => setName(e.target.value)} style={input} /></label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}><span style={lbl}>Price (AED)</span><input value={price} inputMode="decimal" onChange={(e) => setPrice(e.target.value)} style={input} /></label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}><span style={lbl}>Description — what's included (prints on invoice)</span><textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={4} style={{ ...input, resize: 'vertical' }} /></label>
        {err && <div style={{ color: C.red, fontSize: 12.5, fontWeight: 700 }}>{err}</div>}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Button onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save'}</Button>
          <Button tone="ghost" onClick={onClose}>Cancel</Button>
          <div style={{ flex: 1 }} />
          {item && <button onClick={del} disabled={busy} style={{ border: 'none', background: 'none', color: C.red, fontWeight: 800, fontSize: 12.5, cursor: 'pointer' }}>Delete</button>}
        </div>
      </div>
    </Modal>
  );
}

function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(59,54,65,.45)', zIndex: 1000, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '6vh 12px', overflowY: 'auto' }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', borderRadius: 20, padding: 20, width: '100%', maxWidth: 460, boxShadow: C.shadowLg }}>
        <div style={{ ...fredoka(17), marginBottom: 14 }}>{title}</div>
        {children}
      </div>
    </div>
  );
}
