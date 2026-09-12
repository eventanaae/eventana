import { useState } from 'react';
import type { CSSProperties } from 'react';
import type { ScreenProps } from '../App';
import { C, fredoka, PrimaryButton } from '../ui';

/**
 * Quick book — a guided 3-step start: (1) occasion → (2) date → (3) what kind
 * (a ready package / stations / decor-only). It captures the date up front (the
 * rest of the app only asks at checkout) and drops the customer straight into the
 * matching flow. Reuses the shared draft, so nothing is re-entered later.
 */
export function QuickBook({ catalogue, draft, update, go, t }: ScreenProps) {
  const [step, setStep] = useState(1);
  const minDate = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);

  const pickOccasion = (id: string) => {
    update({
      celebrationType: id,
      celebrationTypeChosen: true,
      buildAnswered: draft.celebrationType === id ? draft.buildAnswered : false,
      packageId: null,
      services: {},
      themeId: null,
      customTheme: false,
    });
    setStep(2);
  };

  // Full package → wherever the catalogue routes this occasion (kids → ready-made
  // packages via Explore; occasions with no packages fall back to Build). Stations
  // / decor are always à-la-carte, so they go straight to Build.
  const chooseType = (kind: 'package' | 'stations' | 'decor') => {
    if (kind === 'package') {
      const route = catalogue.celebrationTypes.find((e) => e.id === draft.celebrationType)?.route ?? 'build';
      go(route);
    } else go('build');
  };

  const sub: CSSProperties = { fontSize: 13.5, fontWeight: 600, color: C.muted, margin: '8px 0 20px', lineHeight: 1.55 };

  return (
    <div style={{ padding: '10px 22px 40px', animation: 'rise .35s ease' }}>
      <button
        onClick={() => (step > 1 ? setStep(step - 1) : go('home'))}
        style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: C.ink, padding: '4px 0 6px' }}
      >‹</button>

      {/* progress */}
      <div style={{ display: 'flex', gap: 6, justifyContent: 'center', margin: '2px 0 20px' }}>
        {[1, 2, 3].map((n) => (
          <div key={n} style={{ width: n === step ? 24 : 8, height: 8, borderRadius: 8, background: n <= step ? C.pink : '#eeddea', transition: 'all .2s' }} />
        ))}
      </div>

      {step === 1 && (
        <>
          <div style={fredoka(23)}>{t('qb.step1Title')}</div>
          <div style={sub}>{t('qb.step1Sub')}</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            {catalogue.celebrationTypes.map((ev) => (
              <div
                key={ev.id}
                onClick={() => pickOccasion(ev.id)}
                style={{ borderRadius: 20, cursor: 'pointer', border: `2px solid ${draft.celebrationType === ev.id ? C.pink : 'transparent'}`, background: '#fff', overflow: 'hidden', boxShadow: C.shadow }}
              >
                <div style={{ height: 52, background: ev.gradient }} />
                <div style={{ padding: '9px 12px 11px' }}>
                  <div style={{ fontWeight: 700, fontSize: 12.5 }}>{ev.label}</div>
                  <div style={{ fontSize: 10, fontWeight: 600, color: C.muted, marginTop: 2 }}>{ev.sub}</div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {step === 2 && (
        <>
          <div style={fredoka(23)}>{t('qb.step2Title')}</div>
          <div style={sub}>{t('qb.step2Sub')}</div>
          <input
            type="date"
            value={draft.eventDate}
            min={minDate}
            onChange={(e) => update({ eventDate: e.target.value })}
            style={{ width: '100%', border: `1.5px solid ${C.pinkLine}`, borderRadius: 14, padding: '13px 15px', fontSize: 16, fontFamily: 'inherit', color: C.ink, background: '#fff', boxSizing: 'border-box' }}
          />
          <div style={{ marginTop: 24 }}>
            <PrimaryButton onClick={() => setStep(3)} disabled={!draft.eventDate}>{t('qb.next')}</PrimaryButton>
          </div>
        </>
      )}

      {step === 3 && (
        <>
          <div style={fredoka(23)}>{t('qb.step3Title')}</div>
          <div style={sub}>{t('qb.step3Sub')}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <TypeCard icon="🎁" tint="linear-gradient(135deg,#FDE0EE,#F9C6DC)" title={t('qb.package')} desc={t('qb.packageSub')} onClick={() => chooseType('package')} />
            <TypeCard icon="🍿" tint="linear-gradient(135deg,#E9F8F5,#BDEBE4)" title={t('qb.stations')} desc={t('qb.stationsSub')} onClick={() => chooseType('stations')} />
            <TypeCard icon="🎈" tint="linear-gradient(135deg,#F3E9FB,#D9B8E8)" title={t('qb.decor')} desc={t('qb.decorSub')} onClick={() => chooseType('decor')} />
          </div>
        </>
      )}
    </div>
  );
}

function TypeCard({ icon, tint, title, desc, onClick }: { icon: string; tint: string; title: string; desc: string; onClick: () => void }) {
  return (
    <div onClick={onClick} style={{ display: 'flex', alignItems: 'center', gap: 14, background: '#fff', borderRadius: 22, padding: '14px 16px', boxShadow: C.shadowLg, cursor: 'pointer' }}>
      <div style={{ width: 52, height: 52, borderRadius: 18, background: tint, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24, flex: 'none' }}>{icon}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={fredoka(15)}>{title}</div>
        <div style={{ fontSize: 11.5, fontWeight: 600, color: C.muted, marginTop: 2, lineHeight: 1.4 }}>{desc}</div>
      </div>
      <span style={{ color: C.pink, fontWeight: 700, fontSize: 18 }}>›</span>
    </div>
  );
}
