import { useEffect } from 'react';
import { C } from '../ui';
import type { Lang } from '../i18n';
import { landingCopy, type LandingRoute } from '../landing';

/**
 * A search-ad landing page.
 *
 * Rendered instead of the phone frame when the URL matches a landing slug, so
 * a visitor arriving from Google sees a page — headline, what's included,
 * proof, one button — rather than the first screen of an app they have never
 * used. The button then drops them into the real booking journey with the
 * celebration type already chosen, which is the whole point: the ad's promise
 * and the first screen of the funnel finally say the same thing.
 *
 * Why a <style> block rather than the inline styles used everywhere else in
 * this app: this is the one screen that must lay out for a 1440px desktop as
 * well as a phone, and media queries cannot be expressed inline. The rules are
 * namespaced under `.lp` so they cannot leak into the app screens.
 */
export function Landing({
  route,
  lang,
  setLang,
  social,
  onStart,
}: {
  route: LandingRoute;
  lang: Lang;
  setLang: (l: Lang) => void;
  /** Real ratings and testimonials; null until loaded, and often null on a
   *  cold ad click — the page must read well without them. */
  social: {
    overall: { avg: number; count: number };
    testimonials: Array<{ stars: number; feedback: string; name: string }>;
  } | null;
  onStart: () => void;
}) {
  const copy = landingCopy(route, lang);
  const ar = lang === 'ar';

  // The <title> and description are per-route: this is the only place the app
  // has ever had something specific to say to a crawler or a shared link.
  useEffect(() => {
    document.title = copy.title;
    let tag = document.querySelector('meta[name="description"]');
    if (!tag) {
      tag = document.createElement('meta');
      tag.setAttribute('name', 'description');
      document.head.appendChild(tag);
    }
    tag.setAttribute('content', copy.description);
  }, [copy.title, copy.description]);

  const testimonials = (social?.testimonials ?? []).filter((x) => x.feedback).slice(0, 3);
  const rating = social?.overall;

  return (
    <div className="lp" dir={ar ? 'rtl' : 'ltr'}>
      <style>{LP_CSS}</style>

      <header className="lp-bar">
        <div className="lp-wrap lp-bar-in">
          <span className="lp-logo">Eventana</span>
          <nav className="lp-bar-actions">
            <button className="lp-lang" onClick={() => setLang(ar ? 'en' : 'ar')}>
              {ar ? 'EN' : 'ع'}
            </button>
            <a className="lp-tel" href="tel:+971564500777">056 450 0777</a>
            <button className="lp-btn lp-btn-sm" onClick={onStart}>{copy.cta}</button>
          </nav>
        </div>
      </header>

      <section className="lp-hero">
        <div className="lp-wrap lp-hero-in">
          <div className="lp-hero-copy">
            <h1>{copy.headline}</h1>
            <p className="lp-sub">{copy.subhead}</p>
            <div className="lp-cta-row">
              <button className="lp-btn" onClick={onStart}>{copy.cta}</button>
              <a className="lp-wa" href="https://wa.me/971564500777">
                {ar ? 'أو تواصلي واتساب' : 'or message us on WhatsApp'}
              </a>
            </div>
            <ul className="lp-badges">
              <li>{ar ? 'حجز ودفع أونلاين' : 'Book & pay online'}</li>
              <li>{ar ? 'تجهيز في موقعك' : 'Set up at your venue'}</li>
              <li>{ar ? 'كل الإمارات' : 'All emirates'}</li>
            </ul>
          </div>
          <div className="lp-hero-art" aria-hidden="true">
            <span className="lp-blob lp-blob-1" />
            <span className="lp-blob lp-blob-2" />
            <span className="lp-blob lp-blob-3" />
          </div>
        </div>
      </section>

      <section className="lp-wrap lp-block">
        <h2>{ar ? 'يشمل التجهيز' : "What's included"}</h2>
        <ul className="lp-grid">
          {copy.includes.map((line) => (
            <li key={line} className="lp-card">{line}</li>
          ))}
        </ul>
      </section>

      {(rating?.count ?? 0) > 0 && (
        <section className="lp-wrap lp-block">
          <h2>{ar ? 'من عملائنا' : 'From our customers'}</h2>
          <p className="lp-rating">
            {rating!.avg.toFixed(1)} ★ · {rating!.count} {ar ? 'تقييم من حفلات مؤكدة' : 'ratings from confirmed events'}
          </p>
          {testimonials.length > 0 && (
            <ul className="lp-grid lp-grid-3">
              {testimonials.map((x, i) => (
                <li key={i} className="lp-card lp-quote">
                  <span className="lp-stars">{'★'.repeat(Math.max(1, Math.min(5, x.stars)))}</span>
                  <p>{x.feedback}</p>
                  <span className="lp-name">{x.name}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <section className="lp-final">
        <div className="lp-wrap">
          <h2>{ar ? 'جاهزة نبدأ؟' : 'Ready to start?'}</h2>
          <p>
            {ar
              ? 'اختاري الباقة والثيم والتاريخ، وادفعي أونلاين. التأكيد فوري بدون مكالمات.'
              : 'Pick your package, theme and date and pay online. Instant confirmation, no phone tag.'}
          </p>
          <button className="lp-btn" onClick={onStart}>{copy.cta}</button>
        </div>
      </section>

      <footer className="lp-foot">
        <div className="lp-wrap lp-foot-in">
          <span>Eventana Events · Al Barsha 2, Dubai</span>
          <span>
            <a href="tel:+971564500777">056 450 0777</a>
            {' · '}
            <a href="https://wa.me/971564500777">WhatsApp</a>
            {' · '}
            <a href="mailto:hello@eventanauae.com">hello@eventanauae.com</a>
          </span>
        </div>
      </footer>
    </div>
  );
}

/* Namespaced under .lp so nothing here reaches the app screens. */
const LP_CSS = `
.lp { background: ${C.cream}; color: ${C.ink}; min-height: 100dvh; display: flex; flex-direction: column; }
.lp * { box-sizing: border-box; }
.lp-wrap { width: 100%; max-width: 1080px; margin: 0 auto; padding-inline: 22px; }

.lp-bar { position: sticky; top: 0; z-index: 5; background: rgba(255,253,250,.92);
  backdrop-filter: blur(8px); border-bottom: 1px solid ${C.pinkLine}; }
.lp-bar-in { display: flex; align-items: center; justify-content: space-between; gap: 12px; height: 62px; }
.lp-logo { font-family: 'Fredoka', sans-serif; font-weight: 700; font-size: 21px; color: ${C.pinkDeep}; }
.lp-bar-actions { display: flex; align-items: center; gap: 10px; }
.lp-lang { background: none; border: 1px solid ${C.pinkLine}; color: ${C.ink}; border-radius: 100px;
  width: 34px; height: 30px; font-weight: 700; font-size: 12px; cursor: pointer; }
.lp-tel { display: none; font-weight: 700; font-size: 13.5px; color: ${C.ink}; text-decoration: none; }

.lp-btn { background: ${C.pinkDeep}; color: #fff; border: none; border-radius: 22px;
  font-family: inherit; font-weight: 700; font-size: 15px; padding: 15px 30px; cursor: pointer;
  box-shadow: ${C.shadowLg}; }
.lp-btn:hover { background: ${C.pink}; }
.lp-btn:focus-visible { outline: 3px solid ${C.mint}; outline-offset: 2px; }
.lp-btn-sm { font-size: 13px; padding: 10px 18px; border-radius: 18px; }

.lp-hero { padding: 34px 0 10px; }
.lp-hero-in { display: grid; grid-template-columns: 1fr; gap: 26px; align-items: center; }
.lp-hero h1 { font-family: 'Fredoka', sans-serif; font-weight: 700; font-size: clamp(29px, 6vw, 50px);
  line-height: 1.18; margin: 0; text-wrap: balance; }
.lp-sub { font-size: clamp(15px, 2.2vw, 18px); font-weight: 500; color: ${C.muted2};
  line-height: 1.65; margin: 16px 0 26px; max-width: 34em; }
.lp-cta-row { display: flex; align-items: center; gap: 18px; flex-wrap: wrap; }
.lp-wa { font-weight: 700; font-size: 13.5px; color: ${C.pinkDeep}; text-decoration: none; }
.lp-wa:hover { text-decoration: underline; }
.lp-badges { list-style: none; display: flex; flex-wrap: wrap; gap: 8px; padding: 0; margin: 26px 0 0; }
.lp-badges li { background: ${C.pinkSoft}; color: ${C.pinkDeep}; border-radius: 100px;
  padding: 7px 14px; font-size: 12.5px; font-weight: 700; }

.lp-hero-art { display: none; position: relative; height: 320px; }
.lp-blob { position: absolute; border-radius: 50%; display: block; }
.lp-blob-1 { width: 210px; height: 210px; background: ${C.pinkSoft}; top: 10px; inset-inline-end: 30px; }
.lp-blob-2 { width: 130px; height: 130px; background: ${C.mintSoft}; bottom: 20px; inset-inline-end: 170px; }
.lp-blob-3 { width: 92px; height: 92px; background: ${C.yellowSoft}; top: 150px; inset-inline-end: 0; }

.lp-block { padding: 40px 22px 10px; }
.lp-block h2 { font-family: 'Fredoka', sans-serif; font-weight: 600; font-size: clamp(21px, 3vw, 28px);
  margin: 0 0 18px; text-wrap: balance; }
.lp-grid { list-style: none; padding: 0; margin: 0; display: grid; gap: 12px;
  grid-template-columns: 1fr; }
.lp-card { background: ${C.card}; border: 1px solid ${C.pinkLine}; border-radius: 18px;
  padding: 18px 20px; font-size: 14.5px; font-weight: 600; line-height: 1.6; box-shadow: ${C.shadow}; }
.lp-rating { font-weight: 700; font-size: 15px; color: ${C.yellowInk}; margin: 0 0 16px; }
.lp-quote { display: flex; flex-direction: column; gap: 8px; }
.lp-quote p { margin: 0; font-weight: 500; color: ${C.muted2}; }
.lp-stars { color: ${C.yellow}; letter-spacing: 2px; }
.lp-name { font-size: 12.5px; font-weight: 700; color: ${C.muted}; }

.lp-final { margin-top: 46px; padding: 46px 0 50px; background: ${C.pinkSoft}; text-align: center; }
.lp-final h2 { font-family: 'Fredoka', sans-serif; font-weight: 700; font-size: clamp(23px, 3.4vw, 31px); margin: 0; }
.lp-final p { font-size: 15px; font-weight: 500; color: ${C.muted2}; line-height: 1.65;
  margin: 12px auto 24px; max-width: 34em; }

.lp-foot { border-top: 1px solid ${C.pinkLine}; padding: 22px 0 30px; margin-top: auto; }
.lp-foot-in { display: flex; flex-wrap: wrap; gap: 8px 18px; justify-content: space-between;
  font-size: 12.5px; font-weight: 600; color: ${C.muted}; }
.lp-foot a { color: ${C.muted2}; text-decoration: none; }
.lp-foot a:hover { text-decoration: underline; }

@media (min-width: 760px) {
  .lp-tel { display: inline; }
  .lp-hero { padding: 60px 0 20px; }
  .lp-hero-in { grid-template-columns: 1.25fr 1fr; gap: 40px; }
  .lp-hero-art { display: block; }
  .lp-grid { grid-template-columns: repeat(2, 1fr); }
  .lp-grid-3 { grid-template-columns: repeat(3, 1fr); }
  .lp-block { padding: 56px 22px 10px; }
}
@media (min-width: 1040px) {
  .lp-grid { grid-template-columns: repeat(3, 1fr); }
}
@media (prefers-reduced-motion: reduce) {
  .lp * { animation: none !important; transition: none !important; }
}
`;
