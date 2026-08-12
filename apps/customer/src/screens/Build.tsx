import { useState } from 'react';
import type { ScreenProps } from '../App';
import { C, fredoka, money, Notice, PrimaryButton, Sheet } from '../ui';

export function Build({ catalogue, draft, update, quote, go }: ScreenProps) {
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

  return (
    <div style={{ animation: 'rise .35s ease' }}>
      <div style={{ padding: '8px 22px 20px' }}>
        <div style={{ ...fredoka(24), marginBottom: 4 }}>Build Your Own</div>
        <div style={{ fontSize: 12.5, fontWeight: 600, color: C.muted, marginBottom: 14 }}>
          {evLabel} · Pick services individually. Reach AED {money(threshold)} in eligible services to
          unlock 15% off.
        </div>

        {missing && (
          <div style={{ marginBottom: 14 }}>
            <div
              style={{
                background: '#fff', border: `1.5px dashed ${C.pinkDash}`, borderRadius: 16,
                padding: '12px 15px', fontSize: 11, fontWeight: 600, color: C.muted, lineHeight: 1.5,
              }}
            >
              More {evLabel} services coming from Eventana:{' '}
              <span style={{ color: '#a76f8d' }}>{missing} — NEEDS EVENTANA ADMIN INPUT</span>
            </div>
          </div>
        )}

        {quote && !quote.discountUnlocked && quote.remainingToUnlockFils > 0 && (
          <div style={{ marginBottom: 14 }}>
            <Notice tone="warn">
              Add AED {money(quote.remainingToUnlockFils)} more to unlock 15% off ✨
            </Notice>
          </div>
        )}
        {quote?.discountUnlocked && (
          <div style={{ marginBottom: 14, background: C.pink, borderRadius: 16, padding: '11px 15px', fontSize: 12.5, fontWeight: 700, color: '#fff' }}>
            15% OFF UNLOCKED 🎉 &nbsp;You’re saving AED {money(quote.discountFils)}
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
                      ? `per child · min ${minQty}`
                      : perPiece && minQty > 1
                        ? `each · min ${minQty}`
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
                          {s.needsAdminReview && (
                            <div style={{ fontSize: 9.5, fontWeight: 700, color: C.yellowInk, marginTop: 2 }}>
                              PRICE PENDING EVENTANA ADMIN
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
              <span>Your Party · {count} services</span>
              <span>Eligible subtotal</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 3, gap: 10 }}>
              <button
                onClick={() => go('theme')}
                style={{ background: C.pink, border: 'none', color: '#fff', fontWeight: 700, fontSize: 13, padding: '11px 18px', borderRadius: 16, cursor: 'pointer' }}
              >
                Continue — Theme ›
              </button>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontWeight: 700, fontSize: 18 }}>AED {money(eligible)}</div>
                {quote?.discountUnlocked && (
                  <div style={{ fontSize: 11, color: C.yellow, fontWeight: 700 }}>15% applied at checkout</div>
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
                  <Notice tone="warn">
                    This price is awaiting confirmation from Eventana admin.
                  </Notice>
                )}
              </div>
              <div style={{ marginTop: 18 }}>
                <PrimaryButton
                  onClick={() => {
                    const min =
                      detail.pricing.kind === 'per_child'
                        ? draft.childrenCount
                        : (detail.pricing.minQuantity ?? 1);
                    toggle(detail.id, min);
                    setDetail(null);
                  }}
                >
                  {draft.services[detail.id] ? 'Remove from my party' : 'Add to my party'}
                </PrimaryButton>
              </div>
            </div>
          </>
        )}
      </Sheet>
    </div>
  );
}

type Catalogue = import('../api').Catalogue;
