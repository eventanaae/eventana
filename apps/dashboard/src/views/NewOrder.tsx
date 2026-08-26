import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import { api } from '../api';
import { Button, C, Panel, Spinner, fredoka } from '../ui';

/**
 * Manual order — product selection only.
 *
 * The manager picks WHAT the customer wants (celebration type + package +
 * add-on services + optional theme); the system prices it and returns a unique
 * link. The customer opens the link, and on the normal checkout fills in ALL
 * their own details (name, contact, event date & time, location + map pin,
 * guest of honour…), accepts the Terms and pays. Nothing about the customer or
 * the event is entered here. After payment everything is automatic: the order
 * appears in the dashboard with the customer's details, the amount posts to
 * Sales, and the event + team tasks are created.
 */
export function NewOrder() {
  const [cat, setCat] = useState<any>(null);
  const [celebrationType, setCelebrationType] = useState('kids');
  const [packageId, setPackageId] = useState<string>('');
  const [services, setServices] = useState<Record<string, number>>({});
  const [themeId, setThemeId] = useState<string>('');

  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ link: string; subtotalDisplay: string; items: any[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => { api.catalogue().then(setCat).catch(() => setCat(null)); }, []);

  const eligiblePackages = useMemo(
    () => (celebrationType === 'kids' ? (cat?.packages ?? []) : []),
    [cat, celebrationType],
  );
  const eligibleThemes = useMemo(
    () => (cat?.themes ?? []).filter((t: any) => !t.celebrationType || t.celebrationType === celebrationType),
    [cat, celebrationType],
  );
  const eligibleServices = useMemo(
    () => (cat?.services ?? []).filter((s: any) => (s.celebrationTypes ?? []).includes(celebrationType)),
    [cat, celebrationType],
  );

  const hasSelection = Boolean(packageId) || Object.values(services).some((q) => q > 0);

  const generate = async () => {
    if (!hasSelection) { setError('Pick a package or at least one add-on service.'); return; }
    setBusy(true); setError(null); setResult(null);
    try {
      const r = await api.createOffer({
        celebrationType,
        packageId: packageId || null,
        services: Object.entries(services).filter(([, q]) => q > 0).map(([serviceId, quantity]) => ({ serviceId, quantity })),
        themeId: themeId || null,
      });
      setResult({ link: r.link, subtotalDisplay: r.subtotalDisplay, items: r.items });
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
      <Panel title="New order — choose the products">
        <div style={{ fontSize: 12, fontWeight: 600, color: C.muted, marginBottom: 12, lineHeight: 1.6 }}>
          Pick what the customer wants. They'll open the link and fill in their own details, date, location and pay.
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 10, marginBottom: 12 }}>
          <Labeled label="Celebration">
            <select
              value={celebrationType}
              onChange={(e) => { setCelebrationType(e.target.value); setPackageId(''); setServices({}); setThemeId(''); }}
              style={input}
            >
              {(cat.celebrationTypes ?? []).map((t: any) => <option key={t.id} value={t.id}>{t.label}</option>)}
            </select>
          </Labeled>

          {eligiblePackages.length > 0 && (
            <Labeled label="Package">
              <select value={packageId} onChange={(e) => setPackageId(e.target.value)} style={input}>
                <option value="">— None (build from services) —</option>
                {eligiblePackages.map((p: any) => (
                  <option key={p.id} value={p.id}>{p.name} — AED {(p.priceFils / 100).toLocaleString()}</option>
                ))}
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

        <div style={{ fontSize: 11.5, fontWeight: 700, color: C.muted, margin: '4px 0 6px' }}>Add-on services</div>
        <div style={{ maxHeight: 240, overflowY: 'auto', border: `1px solid ${C.line}`, borderRadius: 12 }}>
          {eligibleServices.map((s: any) => {
            const qty = services[s.id] ?? 0;
            const on = qty > 0;
            const per = s.pricing?.kind === 'per_piece' || s.pricing?.kind === 'per_child';
            return (
              <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', borderBottom: `1px solid ${C.lineSoft}` }}>
                <input
                  type="checkbox"
                  checked={on}
                  onChange={(e) => setServices((m) => ({ ...m, [s.id]: e.target.checked ? (s.pricing?.minQuantity ?? s.pricing?.minChildren ?? 1) : 0 }))}
                />
                <span style={{ flex: 1, fontSize: 12.5, fontWeight: 600 }}>{s.name}</span>
                {on && per && (
                  <input
                    value={qty}
                    inputMode="numeric"
                    onChange={(e) => setServices((m) => ({ ...m, [s.id]: Number(e.target.value.replace(/[^\d]/g, '')) || 0 }))}
                    style={{ ...input, width: 64, marginBottom: 0 }}
                  />
                )}
                <span style={{ fontSize: 11.5, fontWeight: 700, color: C.muted, whiteSpace: 'nowrap' }}>AED {(s.priceFils / 100).toLocaleString()}</span>
              </div>
            );
          })}
          {eligibleServices.length === 0 && <div style={{ padding: 12, fontSize: 12.5, color: C.muted, fontWeight: 600 }}>No services for this celebration type.</div>}
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 14 }}>
          <div style={{ flex: 1 }} />
          <Button onClick={generate} disabled={busy || !hasSelection}>{busy ? 'Generating…' : 'Generate link'}</Button>
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
            <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: `1px solid ${C.line}`, marginTop: 6, paddingTop: 6 }}>
              <span style={{ fontWeight: 800 }}>Products subtotal</span>
              <span style={{ ...fredoka(15), color: C.pinkDeep }}>AED {result.subtotalDisplay}</span>
            </div>
            <div style={{ fontSize: 11, fontWeight: 600, color: C.muted, marginTop: 4 }}>Delivery is added once the customer picks their emirate.</div>
          </div>

          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <input readOnly value={result.link} style={{ ...input, flex: 1, minWidth: 240, marginBottom: 0 }} onFocus={(e) => e.target.select()} />
            <Button onClick={() => { navigator.clipboard?.writeText(result.link); setCopied(true); setTimeout(() => setCopied(false), 2000); }}>{copied ? 'Copied ✓' : 'Copy link'}</Button>
            <a href={`https://wa.me/?text=${encodeURIComponent(waText)}`} target="_blank" rel="noreferrer" style={{ textDecoration: 'none' }}>
              <Button tone="ghost">Open WhatsApp</Button>
            </a>
          </div>
          <div style={{ fontSize: 11.5, fontWeight: 600, color: C.muted, marginTop: 8, lineHeight: 1.6 }}>
            The customer opens this link, completes all their own details (contact, event date &amp; time, location, guest of honour), accepts the Terms, and pays. It then appears in Schedule &amp; the calendar, posts to Sales, and creates the team's tasks — automatically. One link books once.
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
