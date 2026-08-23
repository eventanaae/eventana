import { useState } from 'react';
import type { ScreenProps } from '../App';
import { C, fredoka, money, Notice, PrimaryButton, Sheet, durationKey } from '../ui';

/** Kiosk colours the customer can pick for food & games stations. Soft pastel
 *  tones matched to the printed station-label artwork the owner supplied. */
const STATION_COLORS: Array<{ id: string; hex: string }> = [
  { id: 'purple', hex: '#C3B1E1' },
  { id: 'pink', hex: '#F4B3CC' },
  { id: 'green', hex: '#86C56A' },
  { id: 'yellow', hex: '#F1E58C' },
  { id: 'red', hex: '#E63B31' },
  { id: 'blue', hex: '#ADD4ED' },
  { id: 'brown', hex: '#B89A78' },
];

/** Mascot characters — one must be chosen when the Mascot service is added. */
const MASCOT_OPTIONS = ['Cocomelon', 'Stitch', 'Masha', 'Unicorn'];

export function Build({ catalogue, draft, update, quote, go, t }: ScreenProps) {
  const [detail, setDetail] = useState<Catalogue['services'][number] | null>(null);

  const evLabel =
    catalogue.celebrationTypes.find((e) => e.id === draft.celebrationType)?.label ?? 'Celebration';
  const missing = catalogue.missingServiceNotes[draft.celebrationType];

  const categories = catalogue.categories
    .filter((c) => c.celebrationTypes.includes(draft.celebrationType))
    .sort((a, b) => a.sortOrder - b.sortOrder);

  const rules = catalogue.rules as Record<string, number>;
  const threshold = rules.byoDiscountThresholdFils ?? 250_000;

  const toggle = (id: string, defaultQty: number) => {
    const next = { ...draft.services };
    if (next[id]) delete next[id];
    else next[id] = defaultQty;
    update({ services: next, packageId: null });
  };

  const count = Object.keys(draft.services).length;
  const eligible = quote?.eligibleSubtotalFils ?? 0;
  const progress = Math.min(100, Math.round((eligible / threshold) * 100));
  // A theme is only needed when a backdrop/decoration is in the cart. Food
  // stations, games, machines etc. skip the theme step entirely and go
  // straight to review (owner request).
  const themeRequired = Object.keys(draft.services).some(
    (id) => catalogue.services.find((s) => s.id === id)?.categoryId === 'backdrop',
  );

  return (
    <div style={{ animation: 'rise .35s ease' }}>
      <div style={{ padding: '8px 22px 20px' }}>
        <div style={{ ...fredoka(24), marginBottom: 4 }}>{t('build.title')}</div>
        <div style={{ fontSize: 12.5, fontWeight: 600, color: C.muted, marginBottom: 14 }}>
          {t('build.sub', { label: evLabel, aed: `${t('common.aed')} ${money(threshold)}` })}
        </div>

        {missing && (
          <div style={{ marginBottom: 14 }}>
            <div
              style={{
                background: '#fff', border: `1.5px dashed ${C.pinkDash}`, borderRadius: 16,
                padding: '12px 15px', fontSize: 11, fontWeight: 600, color: C.muted, lineHeight: 1.5,
              }}
            >
              {t('build.moreComing', { label: evLabel })}{' '}
              <span style={{ color: '#a76f8d' }}>{missing}</span>
            </div>
          </div>
        )}

        {quote && !quote.discountUnlocked && quote.remainingToUnlockFils > 0 && (
          <div style={{ marginBottom: 14 }}>
            <Notice tone="warn">
              {t('build.addToUnlock', { aed: `${t('common.aed')} ${money(quote.remainingToUnlockFils)}` })}
            </Notice>
          </div>
        )}
        {quote?.discountUnlocked && (
          <div style={{ marginBottom: 14, background: C.pink, borderRadius: 16, padding: '11px 15px', fontSize: 12.5, fontWeight: 700, color: '#fff' }}>
            {t('build.unlocked', { aed: `${t('common.aed')} ${money(quote.discountFils)}` })}
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
          {categories.map((cat) => {
            const items = catalogue.services.filter(
              (s) => s.categoryId === cat.id && s.celebrationTypes.includes(draft.celebrationType),
            );
            if (items.length === 0) return null;
            return (
              <div key={cat.id}>
                <div style={fredoka(16)}>{cat.name}</div>
                <div style={{ fontSize: 11, fontWeight: 600, color: C.muted, margin: '2px 0 10px', lineHeight: 1.5 }}>
                  {cat.note}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
                  {items.map((s) => {
                    const selected = Boolean(draft.services[s.id]);
                    const perChild = s.pricing.kind === 'per_child';
                    const perPiece = s.pricing.kind === 'per_piece';
                    const minQty = perChild
                      ? (s.pricing.minChildren ?? 20)
                      : perPiece
                        ? (s.pricing.minQuantity ?? 1)
                        : 1;
                    const unitNote = perChild
                      ? t('build.perChild', { n: minQty })
                      : perPiece && minQty > 1
                        ? t('build.eachMin', { n: minQty })
                        : s.badge ?? '';

                    return (
                      <div
                        key={s.id}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 12, background: '#fff',
                          borderRadius: 18, padding: '11px 13px', boxShadow: C.shadow,
                        }}
                      >
                        <div
                          onClick={() => setDetail(s)}
                          style={{ width: 52, height: 52, borderRadius: 15, background: s.gradient, flex: 'none', cursor: 'pointer' }}
                        />
                        <div onClick={() => setDetail(s)} style={{ flex: 1, cursor: 'pointer', minWidth: 0 }}>
                          <div style={{ fontWeight: 700, fontSize: 13 }}>{s.name}</div>
                          <div style={{ fontSize: 10.5, fontWeight: 600, color: C.muted, margin: '1px 0 3px' }}>
                            {s.shortDescription}
                          </div>
                          <div style={{ fontWeight: 700, fontSize: 13, color: C.pinkDeep }}>
                            AED {money(s.priceFils)}
                            {unitNote && (
                              <span style={{ fontWeight: 600, fontSize: 10, color: C.faint }}> · {unitNote}</span>
                            )}
                          </div>
                          {durationKey(s.categoryId, s.id) && (
                            <div style={{ fontSize: 10, fontWeight: 700, color: C.muted2, marginTop: 3 }}>
                              {t(durationKey(s.categoryId, s.id))}
                            </div>
                          )}
                          {s.needsAdminReview && (
                            <div style={{ fontSize: 9.5, fontWeight: 700, color: C.yellowInk, marginTop: 2 }}>
                              {t('build.pricePending')}
                            </div>
                          )}
                        </div>
                        <button
                          onClick={() => toggle(s.id, perChild ? draft.childrenCount : minQty)}
                          style={{
                            width: 36, height: 36, borderRadius: 14, border: 'none', cursor: 'pointer',
                            fontSize: 17, fontWeight: 700,
                            background: selected ? C.pink : C.pinkSoft,
                            color: selected ? '#fff' : C.pinkDeep,
                          }}
                        >
                          {selected ? '✓' : '＋'}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {count > 0 && (
        <div style={{ position: 'sticky', bottom: 0, padding: '0 14px 14px' }}>
          <div style={{ background: C.ink, borderRadius: 22, padding: '14px 18px', color: '#fff', boxShadow: '0 8px 24px rgba(59,54,65,.35)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, fontWeight: 600, color: '#cfc4cc' }}>
              <span>{t('build.yourParty', { n: count })}</span>
              <span>{t('build.eligibleSubtotal')}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 3, gap: 10 }}>
              <button
                onClick={() => go(themeRequired ? 'theme' : 'checkout')}
                style={{ background: C.pink, border: 'none', color: '#fff', fontWeight: 700, fontSize: 13, padding: '11px 18px', borderRadius: 16, cursor: 'pointer' }}
              >
                {themeRequired ? t('build.continueTheme') : t('build.continueReview')}
              </button>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontWeight: 700, fontSize: 18 }}>{t('common.aed')} {money(eligible)}</div>
                {quote?.discountUnlocked && (
                  <div style={{ fontSize: 11, color: C.yellow, fontWeight: 700 }}>{t('build.appliedAtCheckout')}</div>
                )}
              </div>
            </div>
            <div style={{ height: 5, background: 'rgba(255,255,255,.15)', borderRadius: 3, marginTop: 11, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${progress}%`, background: C.yellow, borderRadius: 3, transition: 'width .4s' }} />
            </div>
          </div>
        </div>
      )}

      <Sheet open={Boolean(detail)} onClose={() => setDetail(null)}>
        {detail && (
          <>
            <div style={{ height: 160, background: detail.gradient, borderRadius: '28px 28px 0 0' }} />
            <div style={{ padding: '18px 24px 0' }}>
              <div style={fredoka(21)}>{detail.name}</div>
              <div style={{ fontWeight: 700, fontSize: 15, color: C.pinkDeep, marginTop: 4 }}>
                AED {money(detail.priceFils)}
              </div>
              <div style={{ fontSize: 13, fontWeight: 600, color: C.muted2, marginTop: 8, lineHeight: 1.55 }}>
                {detail.detail ?? detail.shortDescription}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 14 }}>
                {detail.isInflatable && (
                  <Notice tone="warn">
                    {catalogue.notices.inflatableSocks} {catalogue.notices.inflatableNoFood}
                  </Notice>
                )}
                {detail.isFoodStation && <Notice tone="info">{catalogue.notices.foodStationOperated}</Notice>}
                {detail.pricing.kind === 'per_child' && (
                  <Notice tone="info">{catalogue.notices.activityMinimum}</Notice>
                )}
                {detail.needsAdminReview && (
                  <Notice tone="warn">{t('build.pendingAdmin')}</Notice>
                )}
              </div>

              {(detail.categoryId === 'food' || detail.categoryId === 'games') && (
                <div style={{ marginTop: 16 }}>
                  <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 9 }}>{t('build.kioskColor')}</div>
                  <div style={{ display: 'flex', gap: 11, flexWrap: 'wrap' }}>
                    {STATION_COLORS.map((c) => {
                      const active = draft.stationColors[detail.id] === c.id;
                      return (
                        <button
                          key={c.id}
                          type="button"
                          aria-label={c.id}
                          onClick={() => update({ stationColors: { ...draft.stationColors, [detail.id]: c.id } })}
                          style={{
                            width: 34, height: 34, borderRadius: '50%', background: c.hex, cursor: 'pointer',
                            border: active ? `3px solid ${C.ink}` : '2px solid rgba(0,0,0,.12)',
                            boxShadow: active ? '0 0 0 2px #fff inset' : 'none', outline: 'none', flex: 'none',
                          }}
                        />
                      );
                    })}
                  </div>
                </div>
              )}

              {detail.id === 'mascot' && (
                <div style={{ marginTop: 16 }}>
                  <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 9 }}>{t('build.mascotPick')}</div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {MASCOT_OPTIONS.map((m) => {
                      const active = draft.mascotChoice === m;
                      return (
                        <button
                          key={m}
                          type="button"
                          onClick={() => update({ mascotChoice: m })}
                          style={{
                            borderRadius: 12, padding: '10px 14px', cursor: 'pointer', fontWeight: 800, fontSize: 12.5,
                            border: `1.5px solid ${active ? C.pink : C.pinkLine}`,
                            background: active ? C.pinkSoft : '#fff', color: active ? C.pinkDeep : C.ink,
                          }}
                        >
                          {m}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {(() => {
                const inCart = Boolean(draft.services[detail.id]);
                const needsColor = detail.categoryId === 'food' || detail.categoryId === 'games';
                const needsMascot = detail.id === 'mascot';
                const missingColor = needsColor && !draft.stationColors[detail.id];
                const missingMascot = needsMascot && !draft.mascotChoice;
                const blockAdd = !inCart && (missingColor || missingMascot);
                return (
                  <div style={{ marginTop: 18 }}>
                    <PrimaryButton
                      disabled={blockAdd}
                      onClick={() => {
                        const min =
                          detail.pricing.kind === 'per_child'
                            ? draft.childrenCount
                            : (detail.pricing.minQuantity ?? 1);
                        toggle(detail.id, min);
                        setDetail(null);
                      }}
                    >
                      {inCart
                        ? t('build.removeFromParty')
                        : missingMascot
                          ? t('build.pickMascotFirst')
                          : missingColor
                            ? t('build.pickColorFirst')
                            : t('build.addToParty')}
                    </PrimaryButton>
                  </div>
                );
              })()}
            </div>
          </>
        )}
      </Sheet>
    </div>
  );
}

type Catalogue = import('../api').Catalogue;
