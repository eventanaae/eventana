import { useState } from 'react';
import type { ScreenProps } from '../App';
import { C, fredoka, money, Notice, PrimaryButton, Sheet } from '../ui';

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
      <div style={{ height: 210, background: pkg.gradient, position: 'relative' }}>
        <button
          onClick={() => go('explore')}
          style={{
            position: 'absolute', top: 14, left: 16, width: 36, height: 36, borderRadius: '50%',
            background: 'rgba(255,255,255,.92)', border: 'none', fontSize: 17, cursor: 'pointer', color: C.ink,
          }}
        >
          ‹
        </button>
      </div>

      <div style={{ padding: '20px 22px 0' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10 }}>
          <span style={fredoka(23)}>{pkg.name}</span>
          <span style={{ fontWeight: 700, fontSize: 19, color: C.pinkDeep, whiteSpace: 'nowrap', flex: 'none' }}>
            AED {money(pkg.priceFils)}
          </span>
        </div>
        <div style={{ fontSize: 12.5, fontWeight: 600, color: C.muted, margin: '5px 0 16px' }}>
          {pkg.capacity} · {pkg.durationHours} {t('pkg.hourEvent')} · {t('pkg.setupIncluded')}
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

        {/* How the day runs + the honest "photos are illustrative" note. */}
        <div style={{ background: C.pinkSoft, borderRadius: 18, padding: '14px 16px', marginBottom: 12, display: 'flex', flexDirection: 'column', gap: 9 }}>
          <Point icon="⏱️" text={t('pkg.durationSetup')} />
          <Point icon="➕" text={t('pkg.extraHour')} />
          <Point icon="📸" text={t('pkg.imagesNote')} />
        </div>

        <div style={{ marginBottom: 10 }}>
          <Notice tone="info">{catalogue.notices.packageItemsFixed}</Notice>
        </div>

        <div style={{ fontWeight: 700, fontSize: 15, margin: '16px 0 10px' }}>
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
              <div style={{ width: 44, height: 44, borderRadius: 14, background: pkg.gradient, flex: 'none' }} />
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
