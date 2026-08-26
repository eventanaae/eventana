import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import { api } from '../api';
import { Button, C, Panel, Spinner, fredoka } from '../ui';

/**
 * Manual order — product builder only.
 *
 * The manager builds WHAT the customer is buying: celebration type + package +
 * add-on services (searchable), any ad-hoc custom products, an optional manual
 * discount / delivery / custom-theme charge, and reference images for the team.
 * Then Generate link. The customer opens it and, on the normal checkout, fills
 * in ALL their own details (name, contact, event date & time, location + map
 * pin, guest of honour), accepts the Terms and pays. Nothing about the customer
 * or the event is entered here. After payment everything is automatic: the order
 * appears in the dashboard with the customer's details, the amount posts to
 * Sales, and the event + team tasks (with the reference images) are created.
 */
export function NewOrder() {
  const [cat, setCat] = useState<any>(null);
  const [celebrationType, setCelebrationType] = useState('kids');
  const [packageId, setPackageId] = useState<string>('');
  const [services, setServices] = useState<Record<string, number>>({});
  const [themeId, setThemeId] = useState<string>('');
  const [search, setSearch] = useState('');

  const [customItems, setCustomItems] = useState<Array<{ name: string; priceFils: number; qty: number }>>([]);
  const [cpName, setCpName] = useState('');
  const [cpPrice, setCpPrice] = useState('');

  const [discount, setDiscount] = useState('');
  const [delivery, setDelivery] = useState('');            // blank = automatic from emirate
  const [customTheme, setCustomTheme] = useState('');

  const [refImages, setRefImages] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);

  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => { api.catalogue().then(setCat).catch(() => setCat(null)); }, []);

  const eligiblePackages = useMemo(() => (celebrationType === 'kids' ? (cat?.packages ?? []) : []), [cat, celebrationType]);
  const eligibleThemes = useMemo(() => (cat?.themes ?? []).filter((t: any) => !t.celebrationType || t.celebrationType === celebrationType), [cat, celebrationType]);
  const eligibleServices = useMemo(() => (cat?.services ?? []).filter((s: any) => (s.celebrationTypes ?? []).includes(celebrationType)), [cat, celebrationType]);
  const shownServices = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? eligibleServices.filter((s: any) => String(s.name).toLowerCase().includes(q)) : eligibleServices;
  }, [eligibleServices, search]);

  const toFils = (s: string) => Math.round((Number(String(s).replace(/,/g, '')) || 0) * 100);
  const money = (fils: number) => (fils / 100).toLocaleString('en-US', { maximumFractionDigits: 2 });

  // Live estimate (authoritative price comes back from Generate).
  const est = useMemo(() => {
    const pkg = eligiblePackages.find((p: any) => p.id === packageId);
    const svc = Object.entries(services).filter(([, q]) => q > 0).reduce((sum, [id, q]) => {
      const s = (cat?.services ?? []).find((x: any) => x.id === id);
      return sum + (s ? s.priceFils * (q || 1) : 0);
    }, 0);
    const custom = customItems.reduce((s, c) => s + c.priceFils * (c.qty || 1), 0);
    const products = (pkg ? pkg.priceFils : 0) + svc + custom;
    const disc = toFils(discount);
    const del = delivery.trim() === '' ? null : toFils(delivery);
    const theme = toFils(customTheme);
    const total = products + theme - disc + (del ?? 0);
    return { products, disc, del, theme, total };
  }, [eligiblePackages, packageId, services, cat, customItems, discount, delivery, customTheme]);

  const hasSelection = Boolean(packageId) || Object.values(services).some((q) => q > 0) || customItems.length > 0;

  const addImages = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploading(true); setError(null);
    try {
      const urls: string[] = [];
      for (const f of Array.from(files).slice(0, 8)) urls.push(await api.uploadImage(f, 'themes'));
      setRefImages((p) => [...p, ...urls].slice(0, 8));
    } catch { setError('Could not upload an image. Please try again.'); } finally { setUploading(false); }
  };

  const addCustomProduct = () => {
    if (!cpName.trim() || toFils(cpPrice) <= 0) return;
    setCustomItems((a) => [...a, { name: cpName.trim(), priceFils: toFils(cpPrice), qty: 1 }]);
    setCpName(''); setCpPrice('');
  };

  const generate = async () => {
    if (!hasSelection) { setError('Pick a package, an add-on, or add a product.'); return; }
    setBusy(true); setError(null); setResult(null);
    try {
      const del = delivery.trim() === '' ? null : toFils(delivery);
      const r = await api.createOffer({
        celebrationType,
        packageId: packageId || null,
        services: Object.entries(services).filter(([, q]) => q > 0).map(([serviceId, quantity]) => ({ serviceId, quantity })),
        themeId: themeId || null,
        customItems,
        discountFils: toFils(discount),
        deliveryFils: del,
        customThemeFils: toFils(customTheme),
        refImages,
      });
      setResult(r);
    } catch (e: any) {
      setError(e?.message || 'Could not generate the link.');
    } finally { setBusy(false); }
  };

  if (!cat) return <Spinner />;

  const waText = result
    ? `Hi! 🎀 Here's your Eventana order. Open the link to choose your date, location & details and pay securely: ${result.link}`
    : '';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 720 }}>
      <Panel title="New order — build the products">
        <div style={{ fontSize: 12, fontWeight: 600, color: C.muted, marginBottom: 12, lineHeight: 1.6 }}>
          Pick what the customer wants. They'll open the link and fill in their own details, date, location and pay.
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 10, marginBottom: 12 }}>
          <Labeled label="Celebration">
            <select value={celebrationType} onChange={(e) => { setCelebrationType(e.target.value); setPackageId(''); setServices({}); setThemeId(''); }} style={input}>
              {(cat.celebrationTypes ?? []).map((t: any) => <option key={t.id} value={t.id}>{t.label}</option>)}
            </select>
          </Labeled>
          {eligiblePackages.length > 0 && (
            <Labeled label="Package">
              <select value={packageId} onChange={(e) => setPackageId(e.target.value)} style={input}>
                <option value="">— None (build from services) —</option>
                {eligiblePackages.map((p: any) => <option key={p.id} value={p.id}>{p.name} — AED {(p.priceFils / 100).toLocaleString()}</option>)}
              </select>
            </Labeled>
          )}
          {eligibleThemes.length > 0 && (
            <Labeled label="Theme (optional — customer can change)">
              <select value={themeId} onChange={(e) => setThemeId(e.target.value)} style={input}>
                <option value="">— Let the customer choose —</option>
                {eligibleThemes.map((t: any) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </Labeled>
          )}
        </div>

        {/* Add-ons — searchable */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '4px 0 6px', gap: 10 }}>
          <span style={{ fontSize: 11.5, fontWeight: 700, color: C.muted }}>Add-on services</span>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="🔍 Search add-ons…" style={{ ...input, width: 200, marginBottom: 0 }} />
        </div>
        <div style={{ maxHeight: 240, overflowY: 'auto', border: `1px solid ${C.line}`, borderRadius: 12 }}>
          {shownServices.map((s: any) => {
            const qty = services[s.id] ?? 0;
            const on = qty > 0;
            const per = s.pricing?.kind === 'per_piece' || s.pricing?.kind === 'per_child';
            return (
              <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', borderBottom: `1px solid ${C.lineSoft}` }}>
                <input type="checkbox" checked={on} onChange={(e) => setServices((m) => ({ ...m, [s.id]: e.target.checked ? (s.pricing?.minQuantity ?? s.pricing?.minChildren ?? 1) : 0 }))} />
                <span style={{ flex: 1, fontSize: 12.5, fontWeight: 600 }}>{s.name}</span>
                {on && per && (
                  <input value={qty} inputMode="numeric" onChange={(e) => setServices((m) => ({ ...m, [s.id]: Number(e.target.value.replace(/[^\d]/g, '')) || 0 }))} style={{ ...input, width: 64, marginBottom: 0 }} />
                )}
                <span style={{ fontSize: 11.5, fontWeight: 700, color: C.muted, whiteSpace: 'nowrap' }}>AED {(s.priceFils / 100).toLocaleString()}</span>
              </div>
            );
          })}
          {shownServices.length === 0 && <div style={{ padding: 12, fontSize: 12.5, color: C.muted, fontWeight: 600 }}>{search ? 'No add-ons match your search.' : 'No services for this celebration type.'}</div>}
        </div>

        {/* Custom products */}
        <div style={{ fontSize: 11.5, fontWeight: 700, color: C.muted, margin: '14px 0 6px' }}>Custom products</div>
        {customItems.map((c, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: `1px solid ${C.lineSoft}` }}>
            <span style={{ flex: 1, fontSize: 12.5, fontWeight: 600 }}>{c.name}</span>
            <span style={{ fontSize: 12, fontWeight: 700, color: C.muted }}>AED {money(c.priceFils)}</span>
            <button onClick={() => setCustomItems((a) => a.filter((_, j) => j !== i))} style={{ ...linkBtn, color: C.red }}>✕</button>
          </div>
        ))}
        <div style={{ display: 'flex', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
          <input value={cpName} onChange={(e) => setCpName(e.target.value)} placeholder="Product name" style={{ ...input, flex: 2, minWidth: 140, marginBottom: 0 }} />
          <input value={cpPrice} onChange={(e) => setCpPrice(e.target.value)} inputMode="decimal" placeholder="Price (AED)" style={{ ...input, flex: 1, minWidth: 90, marginBottom: 0 }} />
          <Button tone="ghost" onClick={addCustomProduct}>+ Add product</Button>
        </div>

        {/* Manual price overrides */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 10, marginTop: 14 }}>
          <Labeled label="Discount (AED)"><input value={discount} inputMode="decimal" onChange={(e) => setDiscount(e.target.value)} style={input} placeholder="0" /></Labeled>
          <Labeled label="Delivery (AED) — blank = auto"><input value={delivery} inputMode="decimal" onChange={(e) => setDelivery(e.target.value)} style={input} placeholder="Auto from emirate" /></Labeled>
          <Labeled label="Custom theme price (AED)"><input value={customTheme} inputMode="decimal" onChange={(e) => setCustomTheme(e.target.value)} style={input} placeholder="0" /></Labeled>
        </div>

        {/* Reference images */}
        <div style={{ fontSize: 11.5, fontWeight: 700, color: C.muted, margin: '14px 0 6px' }}>Reference images (sent to the team with the order)</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          {refImages.map((u, i) => (
            <div key={i} style={{ position: 'relative' }}>
              <img src={u} alt="ref" style={{ width: 56, height: 56, objectFit: 'cover', borderRadius: 10, border: `1px solid ${C.line}` }} />
              <button onClick={() => setRefImages((a) => a.filter((_, j) => j !== i))} style={{ position: 'absolute', top: -6, right: -6, background: C.red, color: '#fff', border: 'none', borderRadius: '50%', width: 18, height: 18, fontSize: 11, cursor: 'pointer', lineHeight: '18px' }}>✕</button>
            </div>
          ))}
          {refImages.length < 8 && (
            <label style={{ width: 56, height: 56, border: `1px dashed ${C.line}`, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: uploading ? 'wait' : 'pointer', color: C.muted, fontSize: 20 }}>
              {uploading ? '…' : '+'}
              <input type="file" accept="image/*" multiple disabled={uploading} style={{ display: 'none' }} onChange={(e) => addImages(e.target.files)} />
            </label>
          )}
        </div>

        {/* Live total */}
        <div style={{ marginTop: 16, padding: '10px 12px', background: C.pinkSoft, borderRadius: 12 }}>
          <Row label="Products" value={`AED ${money(est.products)}`} />
          {est.theme > 0 && <Row label="Custom theme" value={`AED ${money(est.theme)}`} />}
          {est.disc > 0 && <Row label="Discount" value={`− AED ${money(est.disc)}`} />}
          <Row label="Delivery" value={est.del == null ? 'Auto — from emirate' : `AED ${money(est.del)}`} />
          <div style={{ height: 1, background: C.line, margin: '6px 0' }} />
          <Row label={<b>Total</b>} value={<b style={{ ...fredoka(16), color: C.pinkDeep }}>AED {money(est.total)}{est.del == null ? ' + delivery' : ''}</b>} />
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 14 }}>
          <div style={{ flex: 1 }} />
          <Button onClick={generate} disabled={busy || !hasSelection || uploading}>{busy ? 'Generating…' : 'Generate link'}</Button>
        </div>
        {error && <div style={{ marginTop: 10, color: C.red, fontWeight: 700, fontSize: 12.5 }}>{error}</div>}
      </Panel>

      {result && (
        <Panel title="Link ready — send it to the customer">
          <div style={{ marginBottom: 10 }}>
            {result.items.map((it: any, i: number) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, padding: '3px 0' }}>
                <span style={{ fontWeight: 600, color: C.ink }}>{it.quantity > 1 ? `${it.quantity}× ` : ''}{it.label}</span>
                <span style={{ fontWeight: 700, color: C.muted }}>AED {it.amountDisplay}</span>
              </div>
            ))}
            {Number(String(result.discountDisplay).replace(/,/g, '')) > 0 && <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, padding: '3px 0' }}><span style={{ fontWeight: 600, color: C.green }}>Discount</span><span style={{ fontWeight: 700, color: C.green }}>− AED {result.discountDisplay}</span></div>}
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, padding: '3px 0' }}><span style={{ fontWeight: 600 }}>Delivery</span><span style={{ fontWeight: 700, color: C.muted }}>{result.deliveryAuto ? 'Auto at checkout' : `AED ${result.deliveryDisplay}`}</span></div>
            <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: `1px solid ${C.line}`, marginTop: 6, paddingTop: 6 }}>
              <span style={{ fontWeight: 800 }}>Total</span>
              <span style={{ ...fredoka(15), color: C.pinkDeep }}>AED {result.totalDisplay}{result.deliveryAuto ? ' + delivery' : ''}</span>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <input readOnly value={result.link} style={{ ...input, flex: 1, minWidth: 240, marginBottom: 0 }} onFocus={(e) => e.target.select()} />
            <Button onClick={() => { navigator.clipboard?.writeText(result.link); setCopied(true); setTimeout(() => setCopied(false), 2000); }}>{copied ? 'Copied ✓' : 'Copy link'}</Button>
            <a href={`https://wa.me/?text=${encodeURIComponent(waText)}`} target="_blank" rel="noreferrer" style={{ textDecoration: 'none' }}>
              <Button tone="ghost">Open WhatsApp</Button>
            </a>
          </div>
          <div style={{ fontSize: 11.5, fontWeight: 600, color: C.muted, marginTop: 8, lineHeight: 1.6 }}>
            The customer opens this link, completes all their own details, accepts the Terms, and pays. It then appears in Schedule &amp; the calendar, posts to Sales, and creates the team's tasks — automatically. One link books once.
          </div>
        </Panel>
      )}
    </div>
  );
}

function Row({ label, value }: { label: React.ReactNode; value: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '3px 0', fontSize: 12.5, fontWeight: 700, color: C.ink }}>
      <span style={{ color: C.muted2 }}>{label}</span><span>{value}</span>
    </div>
  );
}

function Labeled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'block', marginBottom: 8 }}>
      <span style={{ display: 'block', fontSize: 11, fontWeight: 700, color: C.muted, marginBottom: 4 }}>{label}</span>
      {children}
    </label>
  );
}

const input: CSSProperties = {
  width: '100%', border: `1px solid ${C.line}`, borderRadius: 10, padding: '9px 11px',
  fontSize: 12.5, fontWeight: 600, outline: 'none', background: '#fff', color: C.ink, marginBottom: 2,
};
const linkBtn: CSSProperties = { background: 'none', border: 'none', fontWeight: 800, fontSize: 13, cursor: 'pointer', padding: '2px 6px' };
