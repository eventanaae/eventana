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

const AGE_BANDS = [
  { id: '1-3', label: '1–3 years', sub: 'Toddlers' },
  { id: '4-6', label: '4–6 years', sub: 'Little ones' },
  { id: '7-9', label: '7–9 years', sub: 'Big kids' },
  { id: '10-12', label: '10–12 years', sub: 'Tweens' },
  { id: '13+', label: '13+ years', sub: 'Teens & up' },
  { id: 'adults', label: 'Adults', sub: 'Grown-up celebration' },
];

export function BuildIntake({ catalogue, draft, go, startBuild }: ScreenProps) {
  // Pre-select only what the customer actually chose — never a default,
  // or the question would count as answered without being asked.
  const [type, setType] = useState<string | null>(
    draft.celebrationTypeChosen ? draft.celebrationType : null,
  );
  const [age, setAge] = useState<string | null>(draft.ageBand);
  const [children, setChildren] = useState<string>(
    draft.buildAnswered ? String(draft.childrenCount) : '',
  );

  const childCount = Number(children.replace(/\D/g, ''));
  const complete = Boolean(type) && Boolean(age) && childCount > 0;

  const start = () => {
    startBuild({
      celebrationType: type!,
      celebrationTypeChosen: true,
      ageBand: age,
      childrenCount: childCount,
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
        ‹ Home
      </button>

      <div style={{ ...fredoka(24), marginTop: 8 }}>Let’s build your party ✨</div>
      <div style={{ fontSize: 12.5, fontWeight: 600, color: C.muted, margin: '4px 0 20px', lineHeight: 1.5 }}>
        Three quick questions so we show you the right services and the right prices.
      </div>

      {/* 1 — celebration type */}
      <Question step={1} title="What are you celebrating?" />
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

      {/* 2 — age band */}
      <Question step={2} title="How old is the guest of honour?" />
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 24 }}>
        {AGE_BANDS.map((band) => {
          const active = age === band.id;
          return (
            <button
              key={band.id}
              onClick={() => setAge(band.id)}
              style={{
                border: `1.5px solid ${active ? C.pink : C.pinkLine}`,
                background: active ? C.pinkSoft : '#fff',
                color: active ? C.pinkDeep : C.ink,
                borderRadius: 16, padding: '10px 14px', cursor: 'pointer', textAlign: 'left',
              }}
            >
              <div style={{ fontSize: 12.5, fontWeight: 700 }}>{band.label}</div>
              <div style={{ fontSize: 10, fontWeight: 600, color: C.muted, marginTop: 1 }}>{band.sub}</div>
            </button>
          );
        })}
      </div>

      {/* 3 — head count */}
      <Question step={3} title="How many children are attending?" />
      <input
        placeholder="e.g. 25"
        inputMode="numeric"
        value={children}
        onChange={(e) => setChildren(e.target.value.replace(/\D/g, '').slice(0, 3))}
        style={{
          width: '100%', border: `1px solid ${C.pinkLine}`, borderRadius: 16,
          padding: '14px 16px', fontWeight: 600, fontSize: 14, background: '#fff',
          color: C.ink, outline: 'none',
        }}
      />
      <div style={{ fontSize: 11, fontWeight: 600, color: C.muted, margin: '7px 0 24px', lineHeight: 1.5 }}>
        Activity sessions are priced per child with a minimum of 20 children, so we need this to
        show you accurate prices.
      </div>

      <PrimaryButton disabled={!complete} onClick={start}>
        {complete ? 'Start building' : 'Answer all three to continue'}
      </PrimaryButton>
    </div>
  );
}

function Question({ step, title }: { step: number; title: string }) {
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
    </div>
  );
}
