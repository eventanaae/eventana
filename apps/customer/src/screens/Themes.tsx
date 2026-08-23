import { useMemo, useState } from 'react';
import type { ScreenProps } from '../App';
import { api, type Catalogue } from '../api';
import { C, fredoka, money, PrimaryButton, Sheet } from '../ui';

type Th = Catalogue['themes'][number];

export function Themes({
  catalogue,
  draft,
  update,
  go,
  custom,
  t,
}: ScreenProps & { custom: boolean }) {
  // A theme is only required when the booking includes a backdrop/decoration
  // (a package, or a Build service in the 'backdrop' category). Otherwise the
  // customer may continue with no theme.
  const themeRequired =
    Boolean(draft.packageId) ||
    Object.keys(draft.services).some(
      (id) => catalogue.services.find((s) => s.id === id)?.categoryId === 'backdrop',
    );
  const [query, setQuery] = useState('');
  const [tag, setTag] = useState('All');
  const [brief, setBrief] = useState<{
    theme: string; concept: string; child: string; age: string; colors: string; notes: string; refImages: string[];
  }>({ theme: '', concept: '', child: '', age: '', colors: '', notes: '', refImages: [] });
  const [refBusy, setRefBusy] = useState(false);
  const [refErr, setRefErr] = useState<string | null>(null);
  const [preview, setPreview] = useState<Th | null>(null);

  const addRefs = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setRefBusy(true);
    setRefErr(null);
    try {
      const urls: string[] = [];
      for (const f of Array.from(files).slice(0, 8)) {
        urls.push(await api.uploadThemeRef(f));
      }
      setBrief((b) => ({ ...b, refImages: [...b.refImages, ...urls].slice(0, 8) }));
    } catch {
      setRefErr(t('themes.refError'));
    } finally {
      setRefBusy(false);
    }
  };

  // The custom-theme design fee applies to kids parties only; every other
  // celebration has no ready themes, so a custom design is free.
  const feeFils = draft.celebrationType === 'kids' ? ((catalogue.rules.customThemeFeeFils as number) ?? 80_000) : 0;
  const feeLabel = feeFils > 0 ? `+ ${t('common.aed')} ${money(feeFils)}` : t('themes.noFee');
  const isKids = draft.celebrationType === 'kids';

  const library = useMemo(
    () =>
      catalogue.themes.filter((t) =>
        draft.celebrationType === 'customc' ? true : t.celebrationType === draft.celebrationType,
      ),
    [catalogue.themes, draft.celebrationType],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return library.filter(
      (t) =>
        // Only show themes that have real setup photos — no "Coming Soon"
        // placeholders. Celebrations with no ready themes get the custom /
        // write-your-own path instead.
        (Boolean(t.coverImageUrl) || (t.gallery?.length ?? 0) > 0) &&
        (!q || t.name.toLowerCase().includes(q)) &&
        (tag === 'All' || t.tags.includes(tag)),
    );
  }, [library, query, tag]);

  if (custom) {
    return (
      <div style={{ padding: '8px 22px 30px', animation: 'rise .35s ease' }}>
        <button onClick={() => go('theme')} style={backStyle}>{t('common.back')}</button>
        <div style={{ ...fredoka(24), marginTop: 8 }}>{t('themes.customTitle')}</div>

        <div
          style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            background: C.pinkSoft, borderRadius: 16, padding: '12px 16px', margin: '14px 0 12px',
          }}
        >
          <span style={{ fontSize: 12.5, fontWeight: 700 }}>{t('themes.customDesign')}</span>
          <span style={{ fontWeight: 700, color: C.pinkDeep }}>{feeLabel}</span>
        </div>
        <div style={{ fontSize: 11.5, fontWeight: 600, color: '#8a6f7d', lineHeight: 1.6, marginBottom: 18 }}>
          {t('themes.basedOnPackage')}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <input
            placeholder={t('themes.phTheme')}
            value={brief.theme}
            onChange={(e) => setBrief((b) => ({ ...b, theme: e.target.value }))}
            style={inputStyle}
          />
          <input
            placeholder={t('themes.phConcept')}
            value={brief.concept}
            onChange={(e) => setBrief((b) => ({ ...b, concept: e.target.value }))}
            style={inputStyle}
          />
          <input
            placeholder={t('themes.phColors')}
            value={brief.colors}
            onChange={(e) => setBrief((b) => ({ ...b, colors: e.target.value }))}
            style={inputStyle}
          />
          <div style={{ display: 'flex', gap: 12 }}>
            <input
              placeholder={t('themes.phChild')}
              value={brief.child}
              onChange={(e) => setBrief({ ...brief, child: e.target.value })}
              style={{ ...inputStyle, flex: 1, minWidth: 0 }}
            />
            <input
              placeholder={t('themes.phAge')}
              value={brief.age}
              onChange={(e) => setBrief({ ...brief, age: e.target.value })}
              style={{ ...inputStyle, width: 80 }}
            />
          </div>
          <textarea
            placeholder={t('themes.phNotes')}
            rows={3}
            value={brief.notes}
            onChange={(e) => setBrief({ ...brief, notes: e.target.value })}
            style={{ ...inputStyle, resize: 'none' }}
          />
        </div>

        {/* Optional reference images for the design team. */}
        <div style={{ marginTop: 16 }}>
          <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 8 }}>
            {t('themes.addRefs')}{' '}
            <span style={{ color: C.muted, fontWeight: 600 }}>· {t('themes.refsHint')}</span>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {brief.refImages.map((u) => (
              <div key={u} style={{ position: 'relative', width: 66, height: 66, borderRadius: 12, overflow: 'hidden', border: `1px solid ${C.pinkLine}` }}>
                <img src={u} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                <button
                  type="button"
                  onClick={() => setBrief((b) => ({ ...b, refImages: b.refImages.filter((x) => x !== u) }))}
                  style={{ position: 'absolute', top: 2, right: 2, width: 20, height: 20, borderRadius: '50%', border: 'none', background: 'rgba(0,0,0,.55)', color: '#fff', fontSize: 13, lineHeight: 1, cursor: 'pointer' }}
                >
                  ×
                </button>
              </div>
            ))}
            {brief.refImages.length < 8 && (
              <label style={{ width: 66, height: 66, borderRadius: 12, border: `1.5px dashed ${C.pinkDash}`, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', fontSize: 22, color: C.pink, background: '#fff' }}>
                {refBusy ? '…' : '＋'}
                <input type="file" accept="image/*" multiple hidden onChange={(e) => addRefs(e.target.files)} />
              </label>
            )}
          </div>
          {refErr && <div style={{ fontSize: 11, fontWeight: 600, color: C.red, marginTop: 6 }}>{refErr}</div>}
        </div>

        <div style={{ marginTop: 20 }}>
          <PrimaryButton
            disabled={!brief.theme.trim()}
            onClick={() => { update({ customTheme: true, themeId: null, themeBrief: brief }); go('checkout'); }}
          >
            {t('themes.addCustom')} · {feeLabel}
          </PrimaryButton>
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: '8px 22px 30px', animation: 'rise .35s ease' }}>
      <button onClick={() => go(draft.packageId ? 'package' : 'build')} style={backStyle}>{t('common.back')}</button>
      <div style={{ ...fredoka(24), marginTop: 8, marginBottom: 4 }}>{t('themes.chooseTheme')}</div>
      <div style={{ fontSize: 12.5, fontWeight: 600, color: C.muted, marginBottom: 12 }}>
        {t('themes.included')}
      </div>

      {/* Custom theme first — the premium, made-for-you option. */}
      <div
        onClick={() => go('custom')}
        style={{
          background: 'linear-gradient(135deg,#FDE0EE,#F3E9FB)', border: `1.5px solid ${C.pinkLine}`,
          borderRadius: 20, padding: '16px 18px', cursor: 'pointer', marginBottom: 16,
          display: 'flex', alignItems: 'center', gap: 14,
        }}
      >
        <div style={{ width: 46, height: 46, borderRadius: 15, background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, flex: 'none' }}>🎨</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={fredoka(15)}>{t('themes.createCustom')}</div>
          <div style={{ fontSize: 11.5, fontWeight: 600, color: '#8a6f7d', marginTop: 2 }}>
            {t('themes.willCreate')} <b style={{ color: C.pinkDeep }}>{feeLabel}</b>
          </div>
        </div>
        <span style={{ color: C.pink, fontWeight: 700, fontSize: 18 }}>›</span>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '0 0 12px' }}>
        <div style={{ flex: 1, height: 1, background: C.pinkLine }} />
        <span style={{ fontSize: 11.5, fontWeight: 700, color: C.muted }}>{t('themes.orChoose')}</span>
        <div style={{ flex: 1, height: 1, background: C.pinkLine }} />
      </div>

      <input
        placeholder={t('themes.search')}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        style={{ ...inputStyle, borderRadius: 16, marginBottom: 10 }}
      />

      {isKids && (
        <div className="scroll" style={{ display: 'flex', gap: 7, overflowX: 'auto', margin: '0 -22px 16px', padding: '0 22px 2px' }}>
          {['All', ...catalogue.themeTags].map((t) => {
            const active = tag === t;
            return (
              <button
                key={t}
                onClick={() => setTag(t)}
                style={{
                  flex: 'none', border: 'none',
                  background: active ? C.pink : C.pinkSoft,
                  color: active ? '#fff' : '#a76f8d',
                  fontSize: 11.5, fontWeight: 700, padding: '8px 13px',
                  borderRadius: 16, cursor: 'pointer', whiteSpace: 'nowrap',
                }}
              >
                {t}
              </button>
            );
          })}
        </div>
      )}

      {filtered.length === 0 && (
        <div style={{ textAlign: 'center', fontSize: 12, fontWeight: 600, color: C.muted, padding: '14px 0' }}>
          {t('themes.noMatch')}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        {[...filtered].sort((a, b) => (b.coverImageUrl ? 1 : 0) - (a.coverImageUrl ? 1 : 0)).map((th) => {
          const selected = draft.themeId === th.id;
          const photos = th.gallery ?? [];
          const cover = th.coverImageUrl ?? photos[0] ?? null;
          return (
            <div
              key={th.id}
              onClick={() => {
                // With photos, open the gallery so the customer can see real
                // examples; otherwise select the theme directly.
                if (photos.length > 0) setPreview(th);
                else update({ themeId: th.id, customTheme: false });
              }}
              style={{
                background: '#fff', borderRadius: 20, overflow: 'hidden', cursor: 'pointer',
                border: `2px solid ${selected ? C.pink : 'transparent'}`, boxShadow: C.shadow,
              }}
            >
              {/* Fixed-height cover — every card is exactly the same size. */}
              <div style={{ height: 118, background: cover ? `#f2e7ee url(${cover}) center/cover no-repeat` : th.gradient, position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {!cover && (
                  <span style={{ background: 'rgba(255,255,255,.9)', color: C.pinkDeep, fontSize: 11.5, fontWeight: 800, padding: '6px 14px', borderRadius: 20, letterSpacing: '.3px', boxShadow: '0 2px 8px rgba(0,0,0,.12)' }}>
                    {t('themes.comingSoon')}
                  </span>
                )}
                {photos.length > 0 && (
                  <span style={{ position: 'absolute', top: 8, left: 8, background: 'rgba(0,0,0,.55)', color: '#fff', fontSize: 10.5, fontWeight: 700, padding: '3px 8px', borderRadius: 20 }}>
                    📷 {photos.length}
                  </span>
                )}
                {selected && (
                  <span
                    style={{
                      position: 'absolute', top: 8, right: 8, background: C.pink, color: '#fff',
                      width: 22, height: 22, borderRadius: '50%', display: 'flex',
                      alignItems: 'center', justifyContent: 'center', fontSize: 12,
                    }}
                  >
                    ✓
                  </span>
                )}
              </div>
              <div style={{ padding: '10px 12px 12px' }}>
                <div style={{ fontWeight: 700, fontSize: 13 }}>{th.name}</div>
                <div style={{ display: 'flex', gap: 4, marginTop: 6 }}>
                  {th.colors.slice(0, 3).map((c, i) => (
                    <div key={i} style={{ width: 12, height: 12, borderRadius: '50%', background: c }} />
                  ))}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Theme gallery — real setup photos, every tile the same square size. */}
      <Sheet open={Boolean(preview)} onClose={() => setPreview(null)}>
        {preview && (
          <div style={{ padding: '20px 22px 8px' }}>
            <div style={{ ...fredoka(22) }}>{preview.name}</div>
            <div style={{ fontSize: 12, fontWeight: 600, color: C.muted, margin: '4px 0 12px' }}>
              {t('themes.galleryNote')}
            </div>
            {/* Select sits at the TOP so the customer never has to scroll the
                whole gallery to pick the theme. */}
            <div style={{ margin: '0 0 14px', position: 'sticky', top: 0, zIndex: 1 }}>
              <PrimaryButton
                onClick={() => { update({ themeId: preview.id, customTheme: false }); setPreview(null); }}
              >
                {draft.themeId === preview.id ? t('themes.selected') : t('themes.selectThis')}
              </PrimaryButton>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              {(preview.gallery ?? []).map((url, i) => (
                <div
                  key={i}
                  style={{
                    aspectRatio: '1 / 1', width: '100%', borderRadius: 14, overflow: 'hidden',
                    background: `#f2e7ee url(${url}) center/cover no-repeat`, border: `1px solid ${C.pinkLine}`,
                  }}
                />
              ))}
            </div>
          </div>
        )}
      </Sheet>

      {!themeRequired && !draft.themeId && !draft.customTheme && (
        <div style={{ marginTop: 16, fontSize: 11.5, fontWeight: 600, color: C.muted, textAlign: 'center', lineHeight: 1.5 }}>
          {t('themes.optionalHint')}
        </div>
      )}
      {(draft.themeId || draft.customTheme || !themeRequired) && (
        <div style={{ marginTop: 14 }}>
          <PrimaryButton onClick={() => go('checkout')}>
            {draft.themeId || draft.customTheme ? t('themes.reviewPay') : t('themes.skipTheme')}
          </PrimaryButton>
        </div>
      )}
    </div>
  );
}

const backStyle: React.CSSProperties = {
  background: 'none', border: 'none', color: C.muted, fontWeight: 700,
  fontSize: 13, cursor: 'pointer', padding: 0,
};

const inputStyle: React.CSSProperties = {
  border: `1px solid ${C.pinkLine}`, borderRadius: 16, padding: '14px 16px',
  fontWeight: 600, fontSize: 13, background: '#fff', color: C.ink,
  outline: 'none', width: '100%',
};
