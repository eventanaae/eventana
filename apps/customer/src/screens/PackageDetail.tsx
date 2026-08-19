import { useState } from 'react';
import type { ScreenProps } from '../App';
import { C, fredoka, money, Notice, PrimaryButton, Sheet, itemIcon, wasPriceFils } from '../ui';

export function PackageDetail({ catalogue, draft, update, go, t, social }: ScreenProps) {
  const pkg = catalogue.packages.find((p) => p.id === draft.packageId);
  const [detail, setDetail] = useState<
    { name: string; detail: string; assets: string[] } | null
  >(null);

  if (!pkg) {
    return (
      <div style={{ padding: 30 }}>
        <button onClick={() => go('explore')} style={backStyle}>‹ Explore</button>
      </div>
    );
  }

  // Fixed-concept packages skip the normal theme step.
  const isSpa = pkg.id === 'spa';
  const isMovie = pkg.id === 'movie';

  return (
    <div style={{ animation: 'rise .35s ease', paddingBottom: 30 }}>
      <div style={{ position: 'relative' }}>
        {pkg.gallery && pkg.gallery.length > 0 ? (
          // Swipeable photo carousel — the customer flips through real setups.
          <div className="scroll" style={{ display: 'flex', overflowX: 'auto', scrollSnapType: 'x mandatory', WebkitOverflowScrolling: 'touch' }}>
            {pkg.gallery.map((url, i) => (
              <div key={i} style={{ flex: '0 0 100%', scrollSnapAlign: 'start', height: 250, background: `#f2e7ee url(${url}) center/cover no-repeat` }} />
            ))}
          </div>
        ) : (
          <div style={{ height: 210, background: pkg.coverImageUrl ? `#f2e7ee url(${pkg.coverImageUrl}) center/cover no-repeat` : pkg.gradient }} />
        )}
        <button
          onClick={() => go('explore')}
          style={{
            position: 'absolute', top: 14, left: 16, width: 36, height: 36, borderRadius: '50%',
            background: 'rgba(255,255,255,.92)', border: 'none', fontSize: 17, cursor: 'pointer', color: C.ink, zIndex: 2,
          }}
        >
          ‹
        </button>
        {pkg.gallery && pkg.gallery.length > 1 && (
          <span style={{ position: 'absolute', bottom: 12, right: 14, background: 'rgba(0,0,0,.5)', color: '#fff', fontSize: 11, fontWeight: 700, padding: '4px 11px', borderRadius: 20 }}>
            📷 {pkg.gallery.length} · {t('pkg.swipe')}
          </span>
        )}
      </div>

      <div style={{ padding: '20px 22px 0' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, marginBottom: 16 }}>
          <span style={{ ...fredoka(23), marginTop: 4 }}>{pkg.name}</span>
          <div style={{ textAlign: 'right', flex: 'none' }}>
            <div style={{ fontSize: 12.5, fontWeight: 700, color: C.muted, textDecoration: 'line-through' }}>AED {money(wasPriceFils(pkg.priceFils))}</div>
            <div style={{ fontWeight: 700, fontSize: 20, color: C.pinkDeep, lineHeight: 1.1 }}>AED {money(pkg.priceFils)}</div>
            <span style={{ display: 'inline-block', marginTop: 3, fontSize: 10, fontWeight: 800, color: '#fff', background: C.pink, borderRadius: 8, padding: '2px 8px' }}>{t('pkg.percentOff')}</span>
          </div>
        </div>
        {social?.packages[pkg.id] && social.packages[pkg.id].count > 0 && (
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontWeight: 800, color: C.yellowInk, background: C.yellowSoft, borderRadius: 12, padding: '5px 11px', fontSize: 12.5, marginBottom: 14 }}>
            ⭐ {social.packages[pkg.id].avg}
            <span style={{ fontWeight: 600, color: C.muted }}>· {social.packages[pkg.id].count} {social.packages[pkg.id].count === 1 ? 'review' : 'reviews'}</span>
          </div>
        )}

        {isSpa && (
          <div style={{ background: 'linear-gradient(135deg,#FDEFF6,#F3E9FB)', borderRadius: 18, padding: '14px 16px', marginBottom: 14 }}>
            <div style={{ ...fredoka(15), color: C.pinkDeep }}>A pamper day they’ll never forget 💅</div>
            <div style={{ fontSize: 12, fontWeight: 600, color: C.muted2, marginTop: 5, lineHeight: 1.55 }}>
              Robes on, music up — little guests enjoy kid-safe manis &amp; pedis, a braid corner,
              face masks and a glam setup. A calm, magical alternative to a traditional party, made
              for a girls’ celebration where everyone feels like a star.
            </div>
          </div>
        )}

        <div style={{ fontWeight: 700, fontSize: 15, margin: '4px 0 10px' }}>
          {t('pkg.whatsIncluded')}{' '}
          <span style={{ fontWeight: 600, fontSize: 11.5, color: C.muted }}>{t('pkg.tapForDetails')}</span>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
          {pkg.items.map((it) => (
            <div
              key={it.name}
              onClick={() => setDetail(it)}
              style={{
                display: 'flex', alignItems: 'center', gap: 12, background: '#fff',
                borderRadius: 18, padding: '11px 14px', cursor: 'pointer', boxShadow: C.shadow,
              }}
            >
              <div style={{ width: 44, height: 44, borderRadius: 14, background: pkg.gradient, flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22 }}>{itemIcon(it.name)}</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: 13 }}>{it.name}</div>
              </div>
              <span style={{ color: '#e8cbd9', fontSize: 17 }}>ⓘ</span>
            </div>
          ))}
        </div>

        {pkg.hasCastleChoice && (
          <div style={{ marginTop: 22 }}>
            <div style={{ fontWeight: 700, fontSize: 15 }}>{t('pkg.castleColor')}</div>
            <div style={{ fontSize: 11.5, fontWeight: 600, color: C.muted, margin: '3px 0 10px' }}>
              {t('pkg.castleAvail')}
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              {catalogue.castleVariants.map((cv) => {
                const active = draft.castleVariant === cv.code;
                return (
                  <div
                    key={cv.code}
                    onClick={() => update({ castleVariant: cv.code })}
                    style={{
                      flex: 1, textAlign: 'center', borderRadius: 18, padding: '12px 4px', cursor: 'pointer',
                      border: `2px solid ${active ? C.pink : C.pinkLine}`,
                      background: active ? C.pinkSoft : '#fff',
                    }}
                  >
                    <div style={{ width: 26, height: 26, borderRadius: '50%', background: cv.swatch, margin: '0 auto 7px', border: '1px solid rgba(59,54,65,.15)' }} />
                    <div style={{ fontSize: 11.5, fontWeight: 700 }}>{cv.name}</div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div style={{ marginTop: 24 }}>
          <PrimaryButton
            onClick={() => go(isMovie ? 'movieselect' : isSpa ? 'checkout' : 'theme')}
            disabled={pkg.hasCastleChoice && !draft.castleVariant}
          >
            {pkg.hasCastleChoice && !draft.castleVariant
              ? t('pkg.chooseCastle')
              : isMovie
                ? t('pkg.continueMovie')
                : isSpa
                  ? t('pkg.continueBooking')
                  : t('pkg.continueTheme')}
          </PrimaryButton>
        </div>

        {/* How the day runs + honest notes + fixed-items disclaimer — all at the bottom. */}
        <div style={{ background: C.pinkSoft, borderRadius: 18, padding: '14px 16px', marginTop: 22, display: 'flex', flexDirection: 'column', gap: 9 }}>
          <Point icon="⏱️" text={t('pkg.durationSetup')} />
          <Point icon="➕" text={t('pkg.extraHour')} />
          <Point icon="📸" text={t('pkg.imagesNote')} />
        </div>
        <div style={{ marginTop: 12 }}>
          <Notice tone="info">{catalogue.notices.packageItemsFixed}</Notice>
        </div>
      </div>

      <Sheet open={Boolean(detail)} onClose={() => setDetail(null)}>
        {detail && (
          <>
            <div style={{ height: 160, background: pkg.gradient, borderRadius: '28px 28px 0 0' }} />
            <div style={{ padding: '18px 24px 0' }}>
              <div style={fredoka(21)}>{detail.name}</div>
              <div style={{ fontSize: 13, fontWeight: 600, color: C.muted2, marginTop: 8, lineHeight: 1.55 }}>
                {detail.detail}
              </div>
            </div>
          </>
        )}
      </Sheet>
    </div>
  );
}

/** A small icon + line, used for the "how the day runs" notes. */
function Point({ icon, text }: { icon: string; text: string }) {
  return (
    <div style={{ display: 'flex', gap: 9, alignItems: 'flex-start' }}>
      <span style={{ fontSize: 13, flex: 'none', lineHeight: 1.5 }}>{icon}</span>
      <span style={{ fontSize: 11.5, fontWeight: 600, color: '#8a6f7d', lineHeight: 1.55 }}>{text}</span>
    </div>
  );
}

const backStyle: React.CSSProperties = {
  background: 'none',
  border: 'none',
  color: C.muted,
  fontWeight: 700,
  fontSize: 13,
  cursor: 'pointer',
  padding: 0,
};
