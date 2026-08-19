import type { ScreenProps } from '../App';
import { C, fredoka, money, Notice } from '../ui';

export function Explore({ catalogue, draft, update, go, t, social }: ScreenProps) {
  const isKids = draft.celebrationType === 'kids';
  const evLabel =
    catalogue.celebrationTypes.find((e) => e.id === draft.celebrationType)?.label ?? 'Celebration';
  const kidsThemes = (() => {
    const k = catalogue.themes.filter((t) => t.celebrationType === 'kids');
    return k.length ? k : catalogue.themes;
  })();

  return (
    <div style={{ padding: '8px 22px 30px', animation: 'rise .35s ease' }}>
      <div style={{ ...fredoka(24), marginBottom: 4 }}>{isKids ? evLabel : t('explore.title')}</div>
      <div style={{ fontSize: 12.5, fontWeight: 600, color: C.muted, marginBottom: 16 }}>
        {isKids ? t('explore.subKids') : t('explore.subFixed')}
      </div>

      <div className="scroll" style={{ display: 'flex', gap: 8, marginBottom: 18, overflowX: 'auto', paddingBottom: 2 }}>
        {catalogue.celebrationTypes.map((ev) => {
          const active = draft.celebrationType === ev.id;
          return (
            <button
              key={ev.id}
              onClick={() =>
                update({
                  celebrationType: ev.id,
                  celebrationTypeChosen: true,
                  // A new celebration re-asks the Build intake.
                  buildAnswered: draft.celebrationType === ev.id ? draft.buildAnswered : false,
                  packageId: null,
                  services: {},
                  themeId: null,
                  customTheme: false,
                })
              }
              style={{
                flex: 'none', border: 'none',
                background: active ? C.pink : C.pinkSoft,
                color: active ? '#fff' : '#a76f8d',
                fontSize: 12, fontWeight: 700, padding: '8px 14px',
                borderRadius: 20, cursor: 'pointer', whiteSpace: 'nowrap',
              }}
            >
              {ev.label}
            </button>
          );
        })}
      </div>

      {!isKids ? (
        <div style={{ background: C.pinkSoft, borderRadius: 22, padding: 20, textAlign: 'center' }}>
          <div style={fredoka(16)}>{t('explore.comingTitle', { label: evLabel })}</div>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#a76f8d', margin: '6px 0 12px', lineHeight: 1.5 }}>
            {t('explore.comingBody')}
          </div>
          <button
            onClick={() => go('build')}
            style={{ background: C.pink, border: 'none', color: '#fff', fontWeight: 700, fontSize: 13, padding: '12px 22px', borderRadius: 18, cursor: 'pointer' }}
          >
            {t('explore.buildYour', { label: evLabel })}
          </button>
        </div>
      ) : (
        <>
          {/* Browse Themes — pick a look first, or skip straight to a package */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
            <span style={fredoka(17)}>{t('explore.browseThemes')}</span>
            <span style={{ fontSize: 11, fontWeight: 700, color: C.faint }}>{t('common.swipe')}</span>
          </div>
          <div className="scroll" style={{ display: 'flex', gap: 12, overflowX: 'auto', margin: '0 -22px 6px', padding: '0 22px 6px' }}>
            {kidsThemes.map((t) => {
              const active = draft.themeId === t.id;
              return (
                <div
                  key={t.id}
                  onClick={() => update({ themeId: active ? null : t.id, customTheme: false })}
                  style={{ flex: 'none', width: 132, cursor: 'pointer' }}
                >
                  <div
                    style={{
                      height: 96, borderRadius: 18, boxShadow: C.shadow,
                      background: t.coverImageUrl ? `#f2e7ee url(${t.coverImageUrl}) center/cover no-repeat` : t.gradient,
                      border: `2.5px solid ${active ? C.pink : 'transparent'}`,
                    }}
                  />
                  <div style={{ fontSize: 11.5, fontWeight: 700, padding: '8px 2px 0', textAlign: 'center', color: active ? C.pinkDeep : C.ink }}>
                    {active ? `✓ ${t.name}` : t.name}
                  </div>
                </div>
              );
            })}
          </div>
          {draft.themeId && (
            <div style={{ margin: '2px 0 6px' }}>
              <Notice tone="ok">{t('explore.themeSelected')}</Notice>
            </div>
          )}

          <div style={{ ...fredoka(17), margin: '20px 0 12px' }}>{t('explore.readyMade')}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {catalogue.packages.map((p) => {
            // A short, on-brand reason to book — falls back to nothing if a
            // package has no blurb yet (t() returns the key when unknown).
            const descKey = `pkgDesc.${p.id}`;
            const desc = t(descKey);
            const hasDesc = Boolean(desc) && desc !== descKey;
            return (
              <div
                key={p.id}
                onClick={() => { update({ packageId: p.id, services: {} }); go('package'); }}
                style={{ background: '#fff', borderRadius: 24, overflow: 'hidden', boxShadow: C.shadowLg, cursor: 'pointer' }}
              >
                <div style={{ height: 150, background: p.gradient, position: 'relative' }}>
                  <span style={{ position: 'absolute', top: 12, left: 12, background: '#fff', color: C.pinkDeep, fontSize: 9.5, fontWeight: 700, padding: '4px 10px', borderRadius: 20, letterSpacing: '.5px' }}>
                    {p.tag}
                  </span>
                  <span style={{ position: 'absolute', top: 12, right: 12, background: '#C7F2C2', color: '#2e7d4f', fontSize: 9.5, fontWeight: 700, padding: '4px 10px', borderRadius: 20 }}>
                    {t('explore.easyPay')}
                  </span>
                </div>
                <div style={{ padding: '15px 18px 17px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10 }}>
                    <span style={fredoka(16)}>{p.name}</span>
                    <span style={{ fontWeight: 700, fontSize: 16, color: C.pinkDeep, whiteSpace: 'nowrap', flex: 'none' }}>
                      AED {money(p.priceFils)}
                    </span>
                  </div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: C.muted, margin: '4px 0 0', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span>{p.capacity} · {p.durationHours} {t('home.hours')}</span>
                    {social?.packages[p.id] && social.packages[p.id].count > 0 && (
                      <span style={{ fontWeight: 800, color: C.yellowInk, background: C.yellowSoft, borderRadius: 10, padding: '2px 8px', whiteSpace: 'nowrap' }}>
                        ⭐ {social.packages[p.id].avg} ({social.packages[p.id].count})
                      </span>
                    )}
                  </div>
                  {hasDesc && (
                    <div style={{ marginTop: 9, fontSize: 12.5, fontWeight: 600, color: C.muted2, lineHeight: 1.55 }}>
                      {desc}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
          </div>

          {/* Build Your Own — part of the Kids Birthday experience */}
          <div
            onClick={() => go('build')}
            style={{
              marginTop: 18, display: 'flex', alignItems: 'center', gap: 14, background: '#fff',
              borderRadius: 22, padding: 16, boxShadow: C.shadowLg, cursor: 'pointer',
              border: `1.5px dashed ${C.pinkDash}`,
            }}
          >
            <div style={{ width: 50, height: 50, borderRadius: 16, background: 'linear-gradient(135deg,#E9F8F5,#BDEBE4)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 23, flex: 'none' }}>
              🎨
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={fredoka(15)}>{t('explore.byoTitle')}</div>
              <div style={{ fontSize: 11.5, fontWeight: 600, color: C.muted, marginTop: 2, lineHeight: 1.4 }}>
                {t('explore.byoSub')}
              </div>
            </div>
            <span style={{ color: C.pink, fontWeight: 700, fontSize: 18 }}>›</span>
          </div>
        </>
      )}
    </div>
  );
}
