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

export function BuildIntake({ catalogue, draft, go, startBuild, t }: ScreenProps) {
  // Pre-select only what the customer actually chose — never a default,
  // or the question would count as answered without being asked.
  const [type, setType] = useState<string | null>(
    draft.celebrationTypeChosen ? draft.celebrationType : null,
  );
  // Age is captured as a group (Kids / Baby) plus a typed number, stored as a
  // single readable string on the draft (e.g. "Kids · 5", "Baby · 8").
  const initGroup = draft.ageBand
    ? (/adult/i.test(draft.ageBand) ? 'Adult' : /kid/i.test(draft.ageBand) ? 'Kids' : null)
    : null;
  const [ageGroup, setAgeGroup] = useState<string | null>(initGroup);
  const [ageNum, setAgeNum] = useState<string>(draft.ageBand ? (draft.ageBand.match(/\d+/)?.[0] ?? '') : '');
  const ageBand = ageGroup ? `${ageGroup}${ageNum.trim() ? ` · ${ageNum.trim()}` : ''}` : null;

  // Age is optional — it only helps the team tailor the party, never the price.
  // The celebration type is the one answer we truly need to open Build.
  const complete = Boolean(type);

  const start = () => {
    startBuild({
      celebrationType: type!,
      celebrationTypeChosen: true,
      ageBand,
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

      {/* 2 — age of the guest of honour (optional): pick a group, then type it */}
      <Question step={2} title={t('intake.q2')} optional={t('intake.optional')} />
      <div style={{ display: 'flex', gap: 9, marginBottom: ageGroup ? 10 : 26 }}>
        {(['Adult', 'Kids'] as const).map((g) => {
          const active = ageGroup === g;
          return (
            <button
              key={g}
              type="button"
              onClick={() => setAgeGroup(active ? null : g)}
              style={{
                flex: 1, borderRadius: 14, padding: '13px 6px', cursor: 'pointer', fontWeight: 800, fontSize: 14,
                border: `1.5px solid ${active ? C.pink : C.pinkLine}`,
                background: active ? C.pinkSoft : '#fff', color: active ? C.pinkDeep : C.ink,
              }}
            >
              {t(g === 'Adult' ? 'intake.adult' : 'intake.kids')}
            </button>
          );
        })}
      </div>
      {ageGroup && (
        <input
          value={ageNum}
          onChange={(e) => setAgeNum(e.target.value.replace(/[^0-9]/g, '').slice(0, 3))}
          inputMode="numeric"
          placeholder={t(ageGroup === 'Adult' ? 'intake.agePhAdult' : 'intake.agePhKids')}
          style={{
            width: '100%', border: `1.5px solid ${ageNum ? C.pink : C.pinkLine}`, borderRadius: 14,
            padding: '13px 15px', fontWeight: 700, fontSize: 14, background: '#fff', color: C.ink,
            outline: 'none', marginBottom: 26,
          }}
        />
      )}

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
