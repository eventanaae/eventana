import type { ScreenProps } from '../App';
import { C, fredoka, PrimaryButton } from '../ui';

/**
 * Movie Night has a fixed concept, so it skips theme selection and instead
 * asks the customer to pick the film.
 *
 * This is a curated list of well-known, family-friendly titles shown as
 * TEXT ONLY — we deliberately do not display official posters or artwork,
 * which are the studios' copyright. Only the titles (plain text, not
 * protectable) are shown. Streaming availability is verified/managed by the
 * team, not claimed here.
 */
interface Movie {
  id: string;
  title: string;
  age: string;
}

const MOVIES: Movie[] = [
  { id: 'frozen', title: 'Frozen', age: 'G' },
  { id: 'frozen2', title: 'Frozen II', age: 'PG' },
  { id: 'moana', title: 'Moana', age: 'PG' },
  { id: 'encanto', title: 'Encanto', age: 'PG' },
  { id: 'coco', title: 'Coco', age: 'PG' },
  { id: 'toystory', title: 'Toy Story', age: 'G' },
  { id: 'toystory4', title: 'Toy Story 4', age: 'G' },
  { id: 'nemo', title: 'Finding Nemo', age: 'G' },
  { id: 'lionking', title: 'The Lion King', age: 'PG' },
  { id: 'zootopia', title: 'Zootopia', age: 'PG' },
  { id: 'despicable', title: 'Despicable Me', age: 'PG' },
  { id: 'minions', title: 'Minions', age: 'PG' },
  { id: 'kungfupanda', title: 'Kung Fu Panda', age: 'PG' },
  { id: 'shrek', title: 'Shrek', age: 'PG' },
  { id: 'madagascar', title: 'Madagascar', age: 'PG' },
  { id: 'httyd', title: 'How to Train Your Dragon', age: 'PG' },
  { id: 'incredibles', title: 'The Incredibles', age: 'PG' },
  { id: 'ratatouille', title: 'Ratatouille', age: 'G' },
  { id: 'paddington', title: 'Paddington', age: 'PG' },
  { id: 'sing', title: 'Sing', age: 'PG' },
];

export function MovieSelect({ draft, update, go, t }: ScreenProps) {
  const selected = draft.movie;
  // draft.movie holds either a known movie id or a free-typed title.
  const known = MOVIES.some((m) => m.id === selected);
  const customVal = known ? '' : (selected ?? '');

  return (
    <div style={{ animation: 'rise .35s ease', paddingBottom: 30 }}>
      <div style={{ padding: '8px 22px 0' }}>
        <button
          onClick={() => go('package')}
          style={{ background: 'none', border: 'none', color: C.muted, fontWeight: 700, fontSize: 13, cursor: 'pointer', padding: 0 }}
        >
          {t('common.back')}
        </button>
        <div style={{ ...fredoka(24), marginTop: 8 }}>{t('movie.title')}</div>
        <div style={{ fontSize: 12.5, fontWeight: 600, color: C.muted, margin: '4px 0 16px', lineHeight: 1.5 }}>
          {t('movie.sub')}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
          {MOVIES.map((m) => {
            const active = selected === m.id;
            return (
              <div
                key={m.id}
                onClick={() => update({ movie: m.id })}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  borderRadius: 14,
                  cursor: 'pointer',
                  background: active ? C.pinkSoft : '#fff',
                  boxShadow: C.shadow,
                  border: `2px solid ${active ? C.pink : C.pinkLine}`,
                  padding: '13px 15px',
                }}
              >
                <span
                  style={{
                    width: 22, height: 22, borderRadius: '50%', flexShrink: 0,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 12, fontWeight: 700,
                    background: active ? C.pink : 'transparent',
                    color: active ? '#fff' : 'transparent',
                    border: active ? 'none' : `2px solid ${C.pinkLine}`,
                  }}
                >
                  ✓
                </span>
                <span style={{ flex: 1, fontSize: 14, fontWeight: 700, color: C.ink, lineHeight: 1.25 }}>
                  {m.title}
                </span>
                <span style={{ background: '#F4EEF2', color: C.muted, fontSize: 10, fontWeight: 700, padding: '3px 9px', borderRadius: 10, flexShrink: 0 }}>
                  {m.age}
                </span>
              </div>
            );
          })}
        </div>

        {/* Or type any other title. */}
        <div style={{ marginTop: 18 }}>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: C.ink, marginBottom: 7 }}>{t('movie.typeOwn')}</div>
          <input
            value={customVal}
            onChange={(e) => update({ movie: e.target.value || null })}
            placeholder={t('movie.typePlaceholder')}
            style={{
              width: '100%', border: `1.5px solid ${customVal ? C.pink : C.pinkLine}`, borderRadius: 14,
              padding: '12px 15px', fontWeight: 700, fontSize: 13.5, background: '#fff', color: C.ink, outline: 'none',
            }}
          />
          <div style={{ fontSize: 10.5, fontWeight: 600, color: C.muted, marginTop: 7, lineHeight: 1.5 }}>
            {t('movie.streamNote')}
          </div>
        </div>
      </div>

      <div style={{ position: 'sticky', bottom: 0, padding: '12px 16px', background: 'linear-gradient(transparent, rgba(255,253,250,.95) 30%)' }}>
        <PrimaryButton disabled={!selected} onClick={() => go('checkout')}>
          {selected ? t('movie.continue') : t('movie.pick')}
        </PrimaryButton>
      </div>
    </div>
  );
}
