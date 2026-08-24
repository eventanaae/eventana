import type { ScreenProps } from '../App';
import { C, fredoka, money, PrimaryButton } from '../ui';
import { SHOP_SERVICE_IDS, SHOP_DIGITAL_IDS } from '@eventana/shared';

type Catalogue = import('../api').Catalogue;
type Svc = Catalogue['services'][number];

/**
 * Standalone shop for custom printed & digital goods — ordered on their own,
 * no party. Digital items are emailed; printed items ship after ~2 weeks.
 */
export function Shop({ catalogue, shopCart, setShopCart, go, t }: ScreenProps) {
  const items = SHOP_SERVICE_IDS
    .map((id) => catalogue.services.find((s) => s.id === id))
    .filter((s): s is Svc => Boolean(s));
  const digital = items.filter((s) => SHOP_DIGITAL_IDS.has(s.id));
  const printed = items.filter((s) => !SHOP_DIGITAL_IDS.has(s.id));

  const minQty = (s: Svc) => (s.pricing.kind === 'per_piece' ? (s.pricing.minQuantity ?? 1) : 1);
  const setQty = (id: string, q: number) =>
    setShopCart((c) => {
      const next = { ...c };
      if (q <= 0) delete next[id];
      else next[id] = q;
      return next;
    });

  const count = Object.values(shopCart).reduce((a, b) => a + b, 0);
  const subtotalFils = items.reduce((sum, s) => sum + s.priceFils * (shopCart[s.id] ?? 0), 0);

  const Row = (s: Svc) => {
    const qty = shopCart[s.id] ?? 0;
    const min = minQty(s);
    const per = s.pricing.kind === 'per_piece';
    return (
      <div key={s.id} style={{ display: 'flex', gap: 12, alignItems: 'center', background: '#fff', borderRadius: 16, padding: '12px 13px', boxShadow: C.shadow }}>
        <div style={{ width: 46, height: 46, borderRadius: 13, background: s.gradient, flex: 'none' }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 13 }}>{s.name}</div>
          <div style={{ fontSize: 10.5, fontWeight: 600, color: C.muted, marginTop: 1, lineHeight: 1.4 }}>{s.shortDescription}</div>
          <div style={{ fontSize: 12, fontWeight: 800, color: C.pinkDeep, marginTop: 4 }}>
            {t('common.aed')} {money(s.priceFils)}{per ? t('shop.each') : ''}
          </div>
        </div>
        {qty > 0 ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 'none' }}>
            <button onClick={() => setQty(s.id, qty <= min ? 0 : qty - (per ? 1 : 1))} style={stepBtn}>−</button>
            <span style={{ fontWeight: 800, fontSize: 13, minWidth: 20, textAlign: 'center' }}>{qty}</span>
            <button onClick={() => setQty(s.id, qty + 1)} style={stepBtn}>＋</button>
          </div>
        ) : (
          <button onClick={() => setQty(s.id, min)} style={{ border: 'none', background: C.pinkSoft, color: C.pinkDeep, fontWeight: 700, fontSize: 12, padding: '9px 15px', borderRadius: 12, cursor: 'pointer', flex: 'none' }}>
            ＋ {t('shop.add')}
          </button>
        )}
      </div>
    );
  };

  return (
    <div style={{ padding: '8px 22px 30px', animation: 'rise .35s ease' }}>
      <button onClick={() => go('home')} style={backStyle}>{t('common.home')}</button>
      <div style={{ ...fredoka(24), marginTop: 8 }}>{t('shop.title')}</div>
      <div style={{ fontSize: 12.5, fontWeight: 600, color: C.muted, margin: '4px 0 20px', lineHeight: 1.5 }}>
        {t('shop.sub')}
      </div>

      <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 10 }}>💌 {t('shop.digital')}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 9, marginBottom: 24 }}>{digital.map(Row)}</div>

      <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>🎁 {t('shop.printed')}</div>
      <div style={{ fontSize: 11, fontWeight: 600, color: C.muted, marginBottom: 10 }}>{t('shop.printedNote')}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 9, marginBottom: 24 }}>{printed.map(Row)}</div>

      {count > 0 && (
        <div style={{ position: 'sticky', bottom: 0, paddingBottom: 6 }}>
          <div style={{ background: C.ink, borderRadius: 20, padding: '13px 18px', color: '#fff', boxShadow: '0 8px 24px rgba(59,54,65,.35)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 600, color: '#cfc4cc' }}>{t('shop.itemsN', { n: count })}</div>
              <div style={{ fontWeight: 800, fontSize: 18 }}>{t('common.aed')} {money(subtotalFils)}</div>
            </div>
            <PrimaryButton onClick={() => go('shopcheckout')}>{t('shop.checkout')}</PrimaryButton>
          </div>
        </div>
      )}
    </div>
  );
}

const stepBtn: React.CSSProperties = {
  width: 30, height: 30, borderRadius: 9, border: `1.5px solid ${C.pinkLine}`, background: '#fff',
  color: C.pinkDeep, fontWeight: 800, fontSize: 16, cursor: 'pointer', lineHeight: 1,
};
const backStyle: React.CSSProperties = {
  background: 'none', border: 'none', color: C.muted, fontWeight: 700, fontSize: 13, cursor: 'pointer', padding: 0,
};
