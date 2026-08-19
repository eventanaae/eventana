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

// The guest of honour's exact age. Kids run 1–15; "Adult" covers grown-up
// celebrations. Stored as a plain string on the draft (a frontend-only
// field — it is never sent to the server), so the format is free to change.
const AGES: string[] = Array.from({ length: 15 }, (_, i) => String(i + 1)).concat('Adult');

export function BuildIntake({ catalogue, draft, go, startBuild, t, lang }: ScreenProps) {
  // Pre-select only what the customer actually chose — never a default,
  // or the question would count as answered without being asked.
  const [type, setType] = useState<string | null>(
    draft.celebrationTypeChosen ? draft.celebrationType : null,
  );
  const [age, setAge] = useState<string | null>(draft.ageBand);

  // Age is optional — it only helps the team tailor the party, never the price.
  // The celebration type is the one answer we truly need to open Build.
  const complete = Boolean(type);

  const start = () => {
    startBuild({
      celebrationType: type!,
      celebrationTypeChosen: true,
      ageBand: age,
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
                <div style={{ fontWeight: 700, fontSize: 12.5 }}>{ev.label}</div>
                <div style={{ fontSize: 10, fontWeight: 600, color: C.muted, marginTop: 2 }}>{ev.sub}</div>
              </div>
            </div>
          );
        })}
      </div>

      {/* 2 — exact age of the guest of honour (optional) */}
      <Question step={2} title={t('intake.q2')} optional={t('intake.optional')} />
      <div style={{ position: 'relative', marginBottom: 8 }}>
        <select
          value={age ?? ''}
          onChange={(e) => setAge(e.target.value || null)}
          style={{
            width: '100%',
            appearance: 'none',
            WebkitAppearance: 'none',
            border: `1.5px solid ${age ? C.pink : C.pinkLine}`,
            borderRadius: 14,
            padding: '13px 40px 13px 15px',
            fontWeight: 700,
            fontSize: 14,
            background: '#fff',
            color: age ? C.ink : C.muted,
            outline: 'none',
            cursor: 'pointer',
          }}
        >
          <option value="">{t('intake.agePlaceholder')}</option>
          {AGES.map((a) => (
            <option key={a} value={a}>
              {a === 'Adult' ? t('intake.adult') : t('intake.yearsOld', { age: a })}
            </option>
          ))}
        </select>
        <span
          style={{
            position: 'absolute',
            top: '50%',
            [lang === 'ar' ? 'left' : 'right']: 15,
            transform: 'translateY(-50%)',
            pointerEvents: 'none',
            color: C.muted,
            fontSize: 12,
          }}
        >
          ▼
        </span>
      </div>
      <div style={{ fontSize: 11, fontWeight: 600, color: C.muted, margin: '2px 0 26px', lineHeight: 1.5 }}>
        {age && age !== 'Adult'
          ? t('intake.turning', { age })
          : t('intake.swipeAge')}
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
