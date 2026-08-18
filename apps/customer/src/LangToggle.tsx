import { C } from './ui';
import type { Lang } from './i18n';

/** A compact English / العربية switch used on first run and in Profile. */
export function LangToggle({ lang, setLang }: { lang: Lang; setLang: (l: Lang) => void }) {
  const opts: Array<{ id: Lang; label: string }> = [
    { id: 'en', label: 'EN' },
    { id: 'ar', label: 'العربية' },
  ];
  return (
    <div style={{ display: 'inline-flex', background: C.pinkSoft, borderRadius: 100, padding: 3, gap: 2 }}>
      {opts.map((o) => {
        const active = lang === o.id;
        return (
          <button
            key={o.id}
            onClick={() => setLang(o.id)}
            style={{
              border: 'none',
              cursor: 'pointer',
              borderRadius: 100,
              padding: '5px 13px',
              fontSize: 12,
              fontWeight: 700,
              background: active ? C.pink : 'transparent',
              color: active ? '#fff' : C.pinkDeep,
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
