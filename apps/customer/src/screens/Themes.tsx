import { useMemo, useState } from 'react';
import type { ScreenProps } from '../App';
import { C, fredoka, money, PrimaryButton } from '../ui';

export function Themes({
  catalogue,
  draft,
  update,
  go,
  custom,
}: ScreenProps & { custom: boolean }) {
  const [query, setQuery] = useState('');
  const [tag, setTag] = useState('All');
  const [brief, setBrief] = useState({ theme: '', concept: '', child: '', age: '', colors: '', notes: '' });

  const feeFils = (catalogue.rules.customThemeFeeFils as number) ?? 80_000;
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
        (!q || t.name.toLowerCase().includes(q)) &&
        (tag === 'All' || t.tags.includes(tag)),
    );
  }, [library, query, tag]);

  if (custom) {
    return (
      <div style={{ padding: '8px 22px 30px', animation: 'rise .35s ease' }}>
        <button onClick={() => go('theme')} style={backStyle}>‹ Themes</button>
        <div style={{ ...fredoka(24), marginTop: 8 }}>Custom Theme ✨</div>

        <div
          style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            background: C.pinkSoft, borderRadius: 16, padding: '12px 16px', margin: '14px 0 12px',
          }}
        >
          <span style={{ fontSize: 12.5, fontWeight: 700 }}>Custom Theme Design</span>
          <span style={{ fontWeight: 700, color: C.pinkDeep }}>+ AED {money(feeFils)}</span>
        </div>
        <div style={{ fontSize: 11, fontWeight: 600, color: C.muted, lineHeight: 1.55, marginBottom: 18 }}>
          This theme isn’t part of Eventana’s standard collection, so our design team will create it
          from scratch. The fee is never discounted and doesn’t count toward the 15% minimum.
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {[
            ['theme', 'Requested theme (e.g. Butterfly Garden)'],
            ['concept', 'Character or concept'],
            ['colors', 'Preferred colors'],
          ].map(([key, placeholder]) => (
            <input
              key={key}
              placeholder={placeholder}
              value={brief[key as keyof typeof brief]}
              onChange={(e) => setBrief({ ...brief, [key]: e.target.value })}
              style={inputStyle}
            />
          ))}
          <div style={{ display: 'flex', gap: 12 }}>
            <input
              placeholder="Child's name"
              value={brief.child}
              onChange={(e) => setBrief({ ...brief, child: e.target.value })}
              style={{ ...inputStyle, flex: 1, minWidth: 0 }}
            />
            <input
              placeholder="Age"
              value={brief.age}
              onChange={(e) => setBrief({ ...brief, age: e.target.value })}
              style={{ ...inputStyle, width: 80 }}
            />
          </div>
          <textarea
            placeholder="Special requests"
            rows={3}
            value={brief.notes}
            onChange={(e) => setBrief({ ...brief, notes: e.target.value })}
            style={{ ...inputStyle, resize: 'none' }}
          />
        </div>

        <div style={{ marginTop: 20 }}>
          <PrimaryButton
            disabled={!brief.theme.trim()}
            onClick={() => { update({ customTheme: true, themeId: null }); go('checkout'); }}
          >
            Add Custom Theme · AED {money(feeFils)}
          </PrimaryButton>
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: '8px 22px 30px', animation: 'rise .35s ease' }}>
      <button onClick={() => go(draft.packageId ? 'package' : 'build')} style={backStyle}>‹ Back</button>
      <div style={{ ...fredoka(24), marginTop: 8, marginBottom: 4 }}>Choose Your Theme</div>
      <div style={{ fontSize: 12.5, fontWeight: 600, color: C.muted, marginBottom: 12 }}>
        Standard Eventana themes are included — no extra charge.
      </div>

      <input
        placeholder="Search themes…"
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
          No themes match — try a different search, or create a custom theme below.
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        {filtered.map((t) => {
          const selected = draft.themeId === t.id;
          return (
            <div
              key={t.id}
              onClick={() => update({ themeId: t.id, customTheme: false })}
              style={{
                background: '#fff', borderRadius: 20, overflow: 'hidden', cursor: 'pointer',
                border: `2px solid ${selected ? C.pink : 'transparent'}`, boxShadow: C.shadow,
              }}
            >
              <div style={{ height: 96, background: t.coverImageUrl ? `url(${t.coverImageUrl}) center/cover` : t.gradient, position: 'relative' }}>
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
                <div style={{ fontWeight: 700, fontSize: 13 }}>{t.name}</div>
                <div style={{ display: 'flex', gap: 4, marginTop: 6 }}>
                  {t.colors.slice(0, 3).map((c, i) => (
                    <div key={i} style={{ width: 12, height: 12, borderRadius: '50%', background: c }} />
                  ))}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div
        style={{
          marginTop: 18, background: '#fff', border: `1.5px dashed ${C.pinkDash}`,
          borderRadius: 20, padding: '18px 20px', textAlign: 'center',
        }}
      >
        <div style={{ fontFamily: "'Sacramento', cursive", fontSize: 22, color: C.pinkDeep, lineHeight: 1 }}>
          Can’t find your theme?
        </div>
        <div style={{ fontSize: 11.5, fontWeight: 600, color: C.muted, margin: '6px 0 12px' }}>
          Our design team will create it from scratch ·{' '}
          <b style={{ color: C.pinkDeep }}>+ AED {money(feeFils)}</b>
        </div>
        <button
          onClick={() => go('custom')}
          style={{ background: C.pinkSoft, border: 'none', color: C.pinkDeep, fontWeight: 700, fontSize: 13, padding: '11px 20px', borderRadius: 16, cursor: 'pointer' }}
        >
          Create a Custom Theme ✨
        </button>
      </div>

      {(draft.themeId || draft.customTheme) && (
        <div style={{ marginTop: 20 }}>
          <PrimaryButton onClick={() => go('checkout')}>Continue — Review &amp; Pay</PrimaryButton>
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
