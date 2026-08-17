import type { ScreenProps } from '../App';
import { C, fredoka, money, Notice } from '../ui';

export function Explore({ catalogue, draft, update, go }: ScreenProps) {
  const isKids = draft.celebrationType === 'kids';
  const evLabel =
    catalogue.celebrationTypes.find((e) => e.id === draft.celebrationType)?.label ?? 'Celebration';
  const kidsThemes = (() => {
    const k = catalogue.themes.filter((t) => t.celebrationType === 'kids');
    return k.length ? k : catalogue.themes;
  })();

  return (
    <div style={{ padding: '8px 22px 30px', animation: 'rise .35s ease' }}>
      <div style={{ ...fredoka(24), marginBottom: 4 }}>{isKids ? evLabel : 'Explore Packages'}</div>
      <div style={{ fontSize: 12.5, fontWeight: 600, color: C.muted, marginBottom: 16 }}>
        {isKids
          ? 'Pick a theme, choose a ready-made package, or build your own.'
          : 'Fixed packages — contents can’t be changed, but you can always add more.'}
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
          <div style={fredoka(16)}>{evLabel} packages are on the way ✨</div>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#a76f8d', margin: '6px 0 12px', lineHeight: 1.5 }}>
            Eventana is curating fixed packages for this celebration. Meanwhile, build it your way —
            backdrops, food stations &amp; more.
          </div>
          <button
            onClick={() => go('build')}
            style={{ background: C.pink, border: 'none', color: '#fff', fontWeight: 700, fontSize: 13, padding: '12px 22px', borderRadius: 18, cursor: 'pointer' }}
          >
            Build Your {evLabel}
          </button>
        </div>
      ) : (
        <>
          {/* Browse Themes — pick a look first, or skip straight to a package */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
            <span style={fredoka(17)}>Browse Themes</span>
            <span style={{ fontSize: 11, fontWeight: 700, color: C.faint }}>swipe →</span>
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
                      height: 96, borderRadius: 18, background: t.gradient, boxShadow: C.shadow,
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
              <Notice tone="ok">
                Theme selected — now pick a package below, or Build Your Own. You can fine-tune it later.
              </Notice>
            </div>
          )}

          <div style={{ ...fredoka(17), margin: '20px 0 12px' }}>Ready-Made Packages</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {catalogue.packages.map((p) => {
            const chips = p.items.slice(0, 3).map((i) => i.name);
            const singleUnit = p.items.some((i) =>
              i.assets.some((a) => a === 'bubble-house' || a === 'ball-pool-slide'),
            );
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
                    tabby · Easy Payment
                  </span>
                </div>
                <div style={{ padding: '15px 18px 17px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10 }}>
                    <span style={fredoka(16)}>{p.name}</span>
                    <span style={{ fontWeight: 700, fontSize: 16, color: C.pinkDeep, whiteSpace: 'nowrap', flex: 'none' }}>
                      AED {money(p.priceFils)}
                    </span>
                  </div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: C.muted, margin: '4px 0 10px' }}>
                    {p.capacity} · {p.durationHours} hours · {p.items.length} items included
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {chips.map((c) => (
                      <span key={c} style={{ background: C.pinkSoft, fontSize: 10.5, fontWeight: 600, padding: '4px 9px', borderRadius: 12, color: '#a76f8d', whiteSpace: 'nowrap' }}>
                        {c}
                      </span>
                    ))}
                  </div>
                  <div style={{ marginTop: 11, fontSize: 11.5, fontWeight: 700, color: singleUnit ? C.yellowInk : C.green }}>
                    {singleUnit
                      ? '● Limited — includes a single-unit inflatable'
                      : '● Available on your date'}
                  </div>
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
              <div style={fredoka(15)}>Build Your Own Party</div>
              <div style={{ fontSize: 11.5, fontWeight: 600, color: C.muted, marginTop: 2, lineHeight: 1.4 }}>
                Prefer to customize? Hand-pick every service and make it yours.
              </div>
            </div>
            <span style={{ color: C.pink, fontWeight: 700, fontSize: 18 }}>›</span>
          </div>
        </>
      )}
    </div>
  );
}
