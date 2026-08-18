import { useEffect, useState } from 'react';
import { api } from '../api';
import { Badge, Button, C, money, Panel, Spinner } from '../ui';

/**
 * Every rule Eventana operates by, editable here. The customer app reads
 * these from the engine at request time, so a change takes effect on the
 * next checkout — no app release, and nothing is hard-coded in the client.
 */
const MONEY_RULES: Array<{ key: string; label: string; help: string }> = [
  { key: 'byoDiscountThresholdFils', label: 'Build Your Own minimum spend', help: 'Eligible services must reach this before the discount unlocks. Delivery and the custom theme fee never count toward it.' },
  { key: 'customThemeFeeFils', label: 'Custom theme fee', help: 'Never discounted, never counts toward the minimum.' },
  { key: 'additionalHourFils', label: 'Additional hour', help: 'Sold after booking. The event still cannot run past midnight.' },
  { key: 'socksPerPairFils', label: 'Kids socks (per pair)', help: 'Offered after booking when the event includes an inflatable.' },
];

const NUMBER_RULES: Array<{ key: string; label: string; help: string; suffix?: string }> = [
  { key: 'byoDiscountPercent', label: 'Build Your Own discount', help: 'Applied to eligible services only.', suffix: '%' },
  { key: 'inventoryHoldMinutes', label: 'Inventory hold', help: 'How long checkout holds an asset before releasing it.', suffix: ' min' },
  { key: 'standardEventHours', label: 'Standard event length', help: 'The fixed party duration.', suffix: ' hours' },
  { key: 'latestEndHour', label: 'Latest end hour', help: '24 = midnight. No Eventana event may run past this.', suffix: ':00' },
  { key: 'activityMinimumChildren', label: 'Activity session minimum', help: 'Minimum billable children on a per-child activity.', suffix: ' kids' },
  { key: 'customTshirtMinimum', label: 'Customized t-shirt minimum', help: 'Minimum order quantity.', suffix: ' pcs' },
];

export function Settings() {
  const [data, setData] = useState<any>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [zoneDraft, setZoneDraft] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState<string | null>(null);

  const load = () =>
    api.settings().then((d) => {
      setData(d);
      setDraft(Object.fromEntries(Object.entries(d.rules).map(([k, v]) => [k, String(v)])));
      setZoneDraft(
        Object.fromEntries(
          d.deliveryZones.map((z: any) => [z.emirate, z.feeFils === null ? '' : String(z.feeFils / 100)]),
        ),
      );
    });

  useEffect(() => { load(); }, []);

  if (!data) return <Spinner />;

  const saveRules = async () => {
    const patch: Record<string, number | boolean> = {};
    for (const { key } of MONEY_RULES) {
      const value = Math.round(Number(draft[key]) );
      if (Number.isFinite(value)) patch[key] = value;
    }
    for (const { key } of NUMBER_RULES) {
      const value = Number(draft[key]);
      if (Number.isFinite(value)) patch[key] = value;
    }
    await api.saveRules(patch);
    setSaved('Pricing rules saved — the next checkout uses them.');
    load();
    setTimeout(() => setSaved(null), 4000);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {saved && (
        <div style={{ background: C.greenSoft, color: C.green, padding: '11px 16px', borderRadius: 12, fontSize: 12.5, fontWeight: 700 }}>
          {saved}
        </div>
      )}

      <Panel
        title="Pricing rules"
        action={<Button onClick={saveRules}>Save rules</Button>}
      >
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 16 }}>
          {MONEY_RULES.map((r) => (
            <div key={r.key}>
              <label style={labelStyle}>{r.label} (AED)</label>
              <input
                value={draft[r.key] ? String(Number(draft[r.key]) / 100) : ''}
                onChange={(e) =>
                  setDraft({ ...draft, [r.key]: String(Math.round(Number(e.target.value.replace(/[^\d.]/g, '')) * 100)) })
                }
                style={inputStyle}
              />
              <div style={helpStyle}>{r.help}</div>
            </div>
          ))}
          {NUMBER_RULES.map((r) => (
            <div key={r.key}>
              <label style={labelStyle}>
                {r.label}
                {r.suffix ?? ''}
              </label>
              <input
                value={draft[r.key] ?? ''}
                onChange={(e) => setDraft({ ...draft, [r.key]: e.target.value.replace(/[^\d.]/g, '') })}
                style={inputStyle}
              />
              <div style={helpStyle}>{r.help}</div>
            </div>
          ))}
        </div>
      </Panel>

      <Panel title="Delivery zones">
        <div style={{ fontSize: 12, fontWeight: 600, color: C.muted, marginBottom: 14, lineHeight: 1.6 }}>
          The customer never chooses a delivery fee — the engine derives it from the event location.
          Delivery is never discounted and never counts toward the Build Your Own minimum. Marking a
          zone unavailable blocks checkout for it entirely.
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {data.deliveryZones.map((z: any) => (
            <div key={z.emirate} style={{ border: `1px solid ${C.line}`, borderRadius: 14, padding: '12px 14px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ flex: 1, minWidth: 0, fontWeight: 700, fontSize: 13, color: C.ink }}>{z.zoneName}</span>
                <Badge tone={z.available ? 'ok' : 'error'}>{z.available ? 'Delivering' : 'Not serviced'}</Badge>
              </div>
              {z.specialConditions && (
                <div style={{ fontSize: 11, fontWeight: 600, color: C.muted, marginTop: 4 }}>{z.specialConditions}</div>
              )}
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 10 }}>
                <input
                  value={zoneDraft[z.emirate] ?? ''}
                  placeholder="Fee (AED)"
                  onChange={(e) => setZoneDraft({ ...zoneDraft, [z.emirate]: e.target.value.replace(/[^\d.]/g, '') })}
                  style={{ ...inputStyle, flex: 1, minWidth: 0, marginTop: 0 }}
                />
                <Button
                  tone="ghost"
                  style={{ padding: '9px 14px', fontSize: 11.5 }}
                  onClick={async () => {
                    const raw = zoneDraft[z.emirate];
                    await api.saveZone(z.emirate, { feeFils: raw === '' ? null : Math.round(Number(raw) * 100) });
                    setSaved(`${z.zoneName} delivery fee updated.`);
                    load();
                    setTimeout(() => setSaved(null), 4000);
                  }}
                >
                  Save
                </Button>
                <Button
                  tone="ghost"
                  style={{ padding: '9px 14px', fontSize: 11.5 }}
                  onClick={async () => { await api.saveZone(z.emirate, { available: !z.available }); load(); }}
                >
                  {z.available ? 'Stop' : 'Start'}
                </Button>
              </div>
            </div>
          ))}
        </div>
      </Panel>

      <Panel title="Integrations">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {data.integrations.map((i: any) => (
            <div key={i.name} style={{ border: `1px solid ${C.lineSoft}`, borderRadius: 12, padding: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                <span style={{ fontSize: 13.5, fontWeight: 700, textTransform: 'capitalize', flex: 1 }}>
                  {i.name}
                </span>
                <Badge tone={i.mode === 'live' ? 'ok' : i.mode === 'sandbox' ? 'warn' : 'neutral'}>
                  {i.mode}
                </Badge>
              </div>
              <div style={{ fontSize: 12, fontWeight: 600, color: C.muted2, lineHeight: 1.6 }}>{i.note}</div>
              <div style={{ fontSize: 11, fontWeight: 600, color: C.muted, marginTop: 6, fontFamily: 'ui-monospace, monospace' }}>
                Webhook: {i.webhookUrl}
              </div>
              {i.missing?.length > 0 && (
                <div style={{ fontSize: 11, fontWeight: 700, color: C.yellowInk, marginTop: 6 }}>
                  Missing: {i.missing.join(', ')}
                </div>
              )}
            </div>
          ))}

          <div style={{ border: `1px solid ${C.lineSoft}`, borderRadius: 12, padding: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
              <span style={{ fontSize: 13.5, fontWeight: 700, flex: 1 }}>Google Maps</span>
              <Badge tone={data.googleMaps.configured ? 'ok' : 'neutral'}>
                {data.googleMaps.configured ? 'configured' : 'not configured'}
              </Badge>
            </div>
            <div style={{ fontSize: 12, fontWeight: 600, color: C.muted2, lineHeight: 1.6 }}>
              {data.googleMaps.note}
            </div>
          </div>
        </div>

        <div
          style={{
            background: C.yellowSoft, color: C.yellowInk, borderRadius: 12,
            padding: '12px 15px', fontSize: 11.5, fontWeight: 600, lineHeight: 1.6, marginTop: 14,
          }}
        >
          <b>Secrets never live here.</b> Provider keys are read from the server’s environment
          variables only — never from this screen, never from the database, never from the mobile
          app. Anything pasted into a chat or a document should be treated as compromised and
          rotated.
        </div>
      </Panel>
    </div>
  );
}

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 11.5,
  fontWeight: 700,
  color: C.ink,
  marginBottom: 5,
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  border: `1px solid ${C.line}`,
  borderRadius: 10,
  padding: '9px 12px',
  fontSize: 12.5,
  fontWeight: 600,
  outline: 'none',
  background: '#fff',
  color: C.ink,
};

const helpStyle: React.CSSProperties = {
  fontSize: 10.5,
  fontWeight: 600,
  color: C.muted,
  marginTop: 5,
  lineHeight: 1.5,
};

void money;
