import { useEffect, useState } from 'react';
import { api, type PromoCode } from '../api';
import { Button, C, Panel, Spinner } from '../ui';

const input: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box', border: `1px solid ${C.line}`, borderRadius: 10,
  padding: '10px 12px', fontSize: 13, fontWeight: 600, color: C.ink, outline: 'none', background: '#fff',
};
const lbl: React.CSSProperties = { fontSize: 11, fontWeight: 700, letterSpacing: 0.3, textTransform: 'uppercase', color: C.muted2, marginBottom: 4, display: 'block' };

/** Describe a code's benefit in words a customer would recognise. */
function benefit(c: PromoCode): string {
  return c.kind === 'percent' ? `${c.value}% off` : `AED ${Math.round(c.value / 100)} off`;
}

/**
 * Discount Codes — the owner/manager self-serve promo-code manager. Create a
 * public code (percent or fixed AED), see how many times each has been used,
 * and switch one off without losing its history. The same codes customers type
 * at checkout; validation & one-use-per-customer are enforced server-side.
 */
export function Discounts() {
  const [codes, setCodes] = useState<PromoCode[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [busyCode, setBusyCode] = useState<string | null>(null);

  const load = () => api.promoCodes().then((r) => setCodes(r.codes)).catch(() => setCodes([]));
  useEffect(() => { load(); }, []);

  const toggle = async (c: PromoCode) => {
    setBusyCode(c.code);
    try {
      await api.setPromoCodeActive(c.code, !c.active);
      await load();
    } finally {
      setBusyCode(null);
    }
  };

  if (!codes) return <Spinner />;
  const active = codes.filter((c) => c.active);
  const off = codes.filter((c) => !c.active);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <Panel
        title={`🏷️ Discount Codes (${active.length} live)`}
        action={<Button onClick={() => setAdding(true)}>+ New code</Button>}
      >
        <div style={{ fontSize: 12, fontWeight: 600, color: C.muted, marginBottom: 12, lineHeight: 1.5 }}>
          Codes customers type at checkout. Each customer can use a code once. Turning a code off
          keeps its history — you can turn it back on any time.
        </div>
        {codes.length === 0 ? (
          <div style={{ color: C.muted, fontWeight: 600, fontSize: 13 }}>No codes yet — create your first one.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {[...active, ...off].map((c) => (
              <div key={c.code} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 4px', borderBottom: `1px solid ${C.lineSoft}`, opacity: c.active ? 1 : 0.6 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 14, fontWeight: 800, color: C.ink, letterSpacing: 0.5, fontFamily: 'ui-monospace, Menlo, monospace' }}>{c.code}</span>
                    <span style={{ fontSize: 11, fontWeight: 800, color: C.pinkDeep, background: C.pinkSoft, padding: '2px 8px', borderRadius: 20 }}>{benefit(c)}</span>
                    {!c.active && <span style={{ fontSize: 10.5, fontWeight: 700, color: C.muted2, background: C.lineSoft, padding: '2px 8px', borderRadius: 20 }}>OFF</span>}
                  </div>
                  <div style={{ fontSize: 11.5, fontWeight: 600, color: C.muted, marginTop: 3 }}>
                    {[
                      c.minSpendFils > 0 ? `min spend AED ${Math.round(c.minSpendFils / 100)}` : null,
                      `used ${c.uses}${c.maxUses != null ? ` / ${c.maxUses}` : ''}`,
                      c.expiresOn ? `expires ${c.expiresOn}` : null,
                    ].filter(Boolean).join(' · ')}
                  </div>
                </div>
                <Button tone={c.active ? 'ghost' : 'primary'} disabled={busyCode === c.code} onClick={() => toggle(c)}>
                  {busyCode === c.code ? '…' : c.active ? 'Turn off' : 'Turn on'}
                </Button>
              </div>
            ))}
          </div>
        )}
      </Panel>

      {adding && <CodeCreator onClose={() => setAdding(false)} onCreated={() => { setAdding(false); load(); }} />}
    </div>
  );
}

function CodeCreator({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [code, setCode] = useState('');
  const [kind, setKind] = useState<'percent' | 'fixed'>('percent');
  const [value, setValue] = useState('');
  const [minSpend, setMinSpend] = useState('');
  const [maxUses, setMaxUses] = useState('');
  const [expiresOn, setExpiresOn] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const save = async () => {
    const clean = code.trim().toUpperCase();
    if (!/^[A-Z0-9]{3,24}$/.test(clean)) { setErr('Code must be 3–24 letters/numbers, no spaces.'); return; }
    const v = Number(value);
    if (!Number.isFinite(v) || v <= 0) { setErr('Enter the discount amount.'); return; }
    if (kind === 'percent' && (v < 1 || v > 100)) { setErr('A percentage must be between 1 and 100.'); return; }
    setBusy(true); setErr(null);
    try {
      await api.createPromoCode({
        code: clean,
        kind,
        value: Math.round(v),
        minSpendAed: minSpend ? Math.max(0, Math.round(Number(minSpend))) : 0,
        maxUses: maxUses ? Math.max(1, Math.round(Number(maxUses))) : null,
        expiresOn: expiresOn || null,
      });
      onCreated();
    } catch (e: any) {
      setErr(typeof e?.message === 'string' && e.message ? e.message : 'Could not create the code — please try again.');
      setBusy(false);
    }
  };

  return (
    <Panel title="New discount code">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div>
          <label style={lbl}>Code</label>
          <input style={{ ...input, textTransform: 'uppercase', letterSpacing: 1, fontWeight: 800 }} value={code}
            onChange={(e) => setCode(e.target.value)} placeholder="SUMMER20" maxLength={24} />
          <div style={{ fontSize: 11, fontWeight: 600, color: C.muted, marginTop: 4 }}>Letters &amp; numbers only — this is what the customer types.</div>
        </div>

        <div>
          <label style={lbl}>Discount type</label>
          <div style={{ display: 'flex', gap: 8 }}>
            {(['percent', 'fixed'] as const).map((k) => (
              <button key={k} onClick={() => setKind(k)} className="press"
                style={{ flex: 1, padding: '10px 12px', borderRadius: 12, cursor: 'pointer', fontWeight: 700, fontSize: 12.5,
                  border: `1.5px solid ${kind === k ? C.pinkDeep : C.line}`, background: kind === k ? C.pinkSoft : '#fff', color: kind === k ? C.pinkDeep : C.inkSoft }}>
                {k === 'percent' ? '% Percentage' : 'AED Fixed amount'}
              </button>
            ))}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 10 }}>
          <div style={{ flex: 1 }}>
            <label style={lbl}>{kind === 'percent' ? 'Percent off (1–100)' : 'Amount off (AED)'}</label>
            <input style={input} value={value} onChange={(e) => setValue(e.target.value.replace(/[^0-9]/g, ''))}
              inputMode="numeric" placeholder={kind === 'percent' ? '20' : '100'} />
          </div>
          <div style={{ flex: 1 }}>
            <label style={lbl}>Min spend (AED, optional)</label>
            <input style={input} value={minSpend} onChange={(e) => setMinSpend(e.target.value.replace(/[^0-9]/g, ''))}
              inputMode="numeric" placeholder="0" />
          </div>
        </div>

        <div style={{ display: 'flex', gap: 10 }}>
          <div style={{ flex: 1 }}>
            <label style={lbl}>Max total uses (optional)</label>
            <input style={input} value={maxUses} onChange={(e) => setMaxUses(e.target.value.replace(/[^0-9]/g, ''))}
              inputMode="numeric" placeholder="Unlimited" />
          </div>
          <div style={{ flex: 1 }}>
            <label style={lbl}>Expires on (optional)</label>
            <input style={input} type="date" value={expiresOn} min={new Date().toISOString().slice(0, 10)}
              onChange={(e) => setExpiresOn(e.target.value)} />
          </div>
        </div>

        {err && <div style={{ fontSize: 12.5, fontWeight: 700, color: C.red, background: C.redSoft, padding: '9px 12px', borderRadius: 10 }}>{err}</div>}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <Button tone="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={save} disabled={busy}>{busy ? 'Creating…' : 'Create code'}</Button>
        </div>
      </div>
    </Panel>
  );
}
