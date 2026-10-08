import { useState } from 'react';
import type { ScreenProps } from '../App';
import { C, fredoka, PrimaryButton } from '../ui';

/**
 * The gate in front of Build Your Own.
 *
 * The service list is priced and filtered by celebration type and by the
 * number of children (activity sessions are per child with a minimum of
 * 20). Opening it with those unanswered would show the wrong categories
 * and the wrong prices — so EVERY route into Build passes through here
 * first, including the bottom navigation. App.tsx enforces it centrally:
 * `go('build')` redirects here until the answers exist, so a new entry
 * point cannot forget to ask.
 */

export function BuildIntake({ catalogue, draft, go, startBuild, t, lang }: ScreenProps) {
  // Pre-select only what the customer actually chose — never a default,
  // or the question would count as answered without being asked.
  const [type, setType] = useState<string | null>(
    draft.celebrationTypeChosen ? draft.celebrationType : null,
  );

  // The celebration type is the one answer we need to open Build. The guest of
  // honour's age is asked later, on checkout only (owner 2026-10-07).
  const complete = Boolean(type);

  const start = () => {
    startBuild({
      celebrationType: type!,
      celebrationTypeChosen: true,
      // A different celebration prices differently — start its build clean.
      ...(type !== draft.celebrationType
        ? { services: {}, packageId: null, themeId: null, customTheme: false }
        : {}),
    });
  };

  return (
    <div style={{ padding: '8px 22px 30px', animation: 'rise .35s ease' }}>
      <button
        onClick={() => go('home')}
        style={{ background: 'none', border: 'none', color: C.muted, fontWeight: 700, fontSize: 13, cursor: 'pointer', padding: 0 }}
      >
        {t('common.home')}
      </button>

      <div style={{ ...fredoka(24), marginTop: 8 }}>{t('intake.title')}</div>
      <div style={{ fontSize: 12.5, fontWeight: 600, color: C.muted, margin: '4px 0 20px', lineHeight: 1.5 }}>
        {t('intake.sub')}
      </div>

      {/* 1 — celebration type */}
      <Question step={1} title={t('intake.q1')} />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 24 }}>
        {catalogue.celebrationTypes.map((ev) => {
          const active = type === ev.id;
          return (
            <div
              key={ev.id}
              onClick={() => setType(ev.id)}
              style={{
                borderRadius: 18, cursor: 'pointer', background: '#fff', overflow: 'hidden',
                border: `2px solid ${active ? C.pink : 'transparent'}`,
                boxShadow: C.shadow,
              }}
            >
              <div style={{ height: 44, background: ev.gradient }} />
              <div style={{ padding: '8px 11px 10px' }}>
                <div style={{ fontWeight: 700, fontSize: 12.5 }}>{lang === 'ar' ? (ev.labelAr ?? ev.label) : ev.label}</div>
                <div style={{ fontSize: 10, fontWeight: 600, color: C.muted, marginTop: 2 }}>{lang === 'ar' ? (ev.subAr ?? ev.sub) : ev.sub}</div>
              </div>
            </div>
          );
        })}
      </div>

      <PrimaryButton disabled={!complete} onClick={start}>
        {complete ? t('intake.start') : t('intake.startDisabledType')}
      </PrimaryButton>
    </div>
  );
}

function Question({ step, title, optional }: { step: number; title: string; optional?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 10 }}>
      <div
        style={{
          width: 22, height: 22, borderRadius: '50%', background: C.pinkSoft, color: C.pinkDeep,
          fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center',
          justifyContent: 'center', flex: 'none',
        }}
      >
        {step}
      </div>
      <div style={{ fontWeight: 700, fontSize: 14 }}>{title}</div>
      {optional && (
        <span style={{ fontSize: 11, fontWeight: 700, color: C.muted }}>· {optional}</span>
      )}
    </div>
  );
}
