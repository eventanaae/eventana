import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import { api } from '../api';
import { Button, C, Panel, Spinner, fredoka } from '../ui';

/**
 * Manager-created "manual" order for a WhatsApp customer. The manager picks the
 * priced items (package + optional add-on services + theme) and the date, time
 * and emirate; on Generate we create the order and return a secure payment link
 * to send the customer. The customer completes their own details and pays — the
 * booking then appears in the system like any other. Not revenue until paid.
 */
export function NewOrder() {
  const [cat, setCat] = useState<any>(null);
  const [customer, setCustomer] = useState({ name: '', phone: '', email: '' });
  const [celebrationType, setCelebrationType] = useState('kids');
  const [packageId, setPackageId] = useState<string>('');
  const [services, setServices] = useState<Record<string, number>>({});
  const [themeId, setThemeId] = useState<string>('');
  const [eventDate, setEventDate] = useState('');
  const [startTime, setStartTime] = useState('17:00');
  const [emirate, setEmirate] = useState('Dubai');
  const [childrenCount, setChildrenCount] = useState('15');

  const [preview, setPreview] = useState<{ totalDisplay: string; problems: any[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ payUrl: string; totalDisplay: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => { api.catalogue().then(setCat).catch(() => setCat(null)); }, []);

  const cart = useMemo(() => ({
    celebrationType,
    packageId: packageId || null,
    services: Object.entries(services).filter(([, q]) => q > 0).map(([serviceId, quantity]) => ({ serviceId, quantity })),
    themeId: themeId || null,
    customTheme: false,
    emirate,
    startTime,
    eventDate: eventDate || null,
    childrenCount: Number(childrenCount) || 0,
  }), [celebrationType, packageId, services, themeId, emirate, startTime, eventDate, childrenCount]);

  const emirates: string[] = useMemo(
    () => (cat?.deliveryZones ?? []).map((z: any) => z.emirate),
    [cat],
  );
  const eligibleServices = useMemo(
    () => (cat?.services ?? []).filter((s: any) => (s.celebrationTypes ?? []).includes(celebrationType)),
    [cat, celebrationType],
  );
  const eligiblePackages = useMemo(
    () => (celebrationType === 'kids' ? (cat?.packages ?? []) : []),
    [cat, celebrationType],
  );
  const eligibleThemes = useMemo(
    () => (cat?.themes ?? []).filter((t: any) => !t.celebrationType || t.celebrationType === celebrationType),
    [cat, celebrationType],
  );

  const doPreview = async () => {
    setError(null); setResult(null);
    try { const q = await api.quotePreview(cart); setPreview({ totalDisplay: q.totalDisplay, problems: q.problems ?? [] }); }
    catch (e: any) { setError(e?.message || 'Could not price this order.'); }
  };

  const generate = async () => {
    if (!customer.name.trim() || !customer.phone.trim() || !eventDate) {
      setError('Enter the customer name, phone, and event date.');
      return;
    }
    setBusy(true); setError(null); setResult(null);
    try {
      const r = await api.manualOrder({
        customer: { name: customer.name.trim(), phone: customer.phone.trim(), email: customer.email.trim() || undefined },
        cart,
      });
      setResult({ payUrl: r.payUrl, totalDisplay: r.totalDisplay });
    } catch (e: any) {
      setError(e?.message || 'Could not create the order.');
    } finally { setBusy(false); }
  };

  if (!cat) return <Spinner />;

  const waText = result
    ? `Hi ${customer.name || ''}! Here's your Eventana order — please complete your details and pay securely: ${result.payUrl}`
    : '';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 720 }}>
      <Panel title="Customer">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 10 }}>
          <Labeled label="Name *"><input value={customer.name} onChange={(e) => setCustomer((c) => ({ ...c, name: e.target.value }))} style={input} /></Labeled>
          <Labeled label="Phone *"><input value={customer.phone} onChange={(e) => setCustomer((c) => ({ ...c, phone: e.target.value }))} style={input} placeholder="05XXXXXXXX" /></Labeled>
          <Labeled label="Email (optional)"><input value={customer.email} onChange={(e) => setCustomer((c) => ({ ...c, email: e.target.value }))} style={input} /></Labeled>
        </div>
      </Panel>

      <Panel title="Event & items">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 10, marginBottom: 12 }}>
          <Labeled label="Celebration">
            <select value={celebrationType} onChange={(e) => { setCelebrationType(e.target.value); setPackageId(''); setServices({}); setThemeId(''); }} style={input}>
              {(cat.celebrationTypes ?? []).map((t: any) => <option key={t.id} value={t.id}>{t.label}</option>)}
            </select>
          </Labeled>
          <Labeled label="Date *"><input type="date" value={eventDate} onChange={(e) => setEventDate(e.target.value)} style={input} /></Labeled>
          <Labeled label="Time">
            <select value={startTime} onChange={(e) => setStartTime(e.target.value)} style={input}>
              {(cat.startTimes ?? ['17:00']).map((s: string) => <option key={s} value={s}>{s}</option>)}
            </select>
          </Labeled>
          <Labeled label="Emirate">
            <select value={emirate} onChange={(e) => setEmirate(e.target.value)} style={input}>
              {emirates.map((e) => <option key={e} value={e}>{e}</option>)}
            </select>
          </Labeled>
          <Labeled label="Guests"><input value={childrenCount} inputMode="numeric" onChange={(e) => setChildrenCount(e.target.value.replace(/[^\d]/g, ''))} style={input} /></Labeled>
        </div>

        {eligiblePackages.length > 0 && (
          <Labeled label="Package">
            <select value={packageId} onChange={(e) => setPackageId(e.target.value)} style={input}>
              <option value="">— None (build from services) —</option>
              {eligiblePackages.map((p: any) => <option key={p.id} value={p.id}>{p.name} — AED {(p.priceFils / 100).toLocaleString()}</option>)}
            </select>
          </Labeled>
        )}

        {eligibleThemes.length > 0 && (
          <Labeled label="Theme (optional)">
            <select value={themeId} onChange={(e) => setThemeId(e.target.value)} style={input}>
              <option value="">— None —</option>
              {eligibleThemes.map((t: any) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </Labeled>
        )}

        <div style={{ fontSize: 11.5, fontWeight: 700, color: C.muted, margin: '14px 0 6px' }}>Add-on services</div>
        <div style={{ maxHeight: 220, overflowY: 'auto', border: `1px solid ${C.line}`, borderRadius: 12 }}>
          {eligibleServices.map((s: any) => {
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
          {eligibleServices.length === 0 && <div style={{ padding: 12, fontSize: 12.5, color: C.muted, fontWeight: 600 }}>No services for this celebration type.</div>}
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 14, flexWrap: 'wrap' }}>
          <Button tone="ghost" onClick={doPreview}>Preview price</Button>
          {preview && (
            <span style={{ fontSize: 13.5, fontWeight: 800, color: preview.problems.length ? C.red : C.green }}>
              {preview.problems.length ? `Not bookable: ${preview.problems[0]?.message ?? 'check inputs'}` : `Total: AED ${preview.totalDisplay}`}
            </span>
          )}
          <div style={{ flex: 1 }} />
          <Button onClick={generate} disabled={busy}>{busy ? 'Creating…' : 'Generate payment link'}</Button>
        </div>
        {error && <div style={{ marginTop: 10, color: C.red, fontWeight: 700, fontSize: 12.5 }}>{error}</div>}
      </Panel>

      {result && (
        <Panel title="Payment link ready">
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>Total: AED {result.totalDisplay} · not counted as revenue until the customer pays.</div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <input readOnly value={result.payUrl} style={{ ...input, flex: 1, minWidth: 240, marginBottom: 0 }} onFocus={(e) => e.target.select()} />
            <Button onClick={() => { navigator.clipboard?.writeText(result.payUrl); setCopied(true); setTimeout(() => setCopied(false), 2000); }}>{copied ? 'Copied ✓' : 'Copy link'}</Button>
            <a href={`https://wa.me/?text=${encodeURIComponent(waText)}`} target="_blank" rel="noreferrer" style={{ textDecoration: 'none' }}>
              <Button tone="ghost">Open WhatsApp</Button>
            </a>
          </div>
          <div style={{ fontSize: 11.5, fontWeight: 600, color: C.muted, marginTop: 8 }}>
            The customer opens this link, completes their details (guest of honour, contact, exact location), accepts the Terms, and pays by card / Apple Pay. It then appears in Schedule &amp; the calendar automatically.
          </div>
        </Panel>
      )}
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
