import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CartInput } from '@eventana/shared';
import { api, type Catalogue, type QuoteResult } from './api';
import { C, Spinner, fredoka } from './ui';
import { Home } from './screens/Home';
import { Explore } from './screens/Explore';
import { PackageDetail } from './screens/PackageDetail';
import { Build } from './screens/Build';
import { BuildIntake } from './screens/BuildIntake';
import { Themes } from './screens/Themes';
import { Checkout } from './screens/Checkout';
import { PaymentReturn } from './screens/Payment';
import { MyEvent } from './screens/MyEvent';
import { Assistant } from './screens/Assistant';
import { Profile } from './screens/Profile';
import { Onboarding } from './screens/Onboarding';
import { MovieSelect } from './screens/MovieSelect';
import { ResetPassword } from './screens/ResetPassword';
import { useProfile } from './profile';
import { useLang, makeT, type Lang, type TFn } from './i18n';

export type Screen =
  | 'home' | 'explore' | 'package' | 'buildIntake' | 'build' | 'theme' | 'custom'
  | 'assistant' | 'movieselect' | 'checkout' | 'confirming' | 'myevent' | 'profile';

export interface Draft {
  celebrationType: string;
  /** True only once the customer has actively picked a celebration. */
  celebrationTypeChosen: boolean;
  /** Age band of the guest of honour, asked by the Build intake. */
  ageBand: string | null;
  /** True once the Build intake questions have all been answered. */
  buildAnswered: boolean;
  packageId: string | null;
  services: Record<string, number>;
  themeId: string | null;
  customTheme: boolean;
  castleVariant: string | null;
  emirate: string | null;
  startTime: string | null;
  eventDate: string;
  childrenCount: number;
  address: { area: string; street: string; villa: string; details: string };
  mapPin: { lat: number; lng: number } | null;
  provider: string;
  /** Movie Night selection — sent to the team so they prep the right film. */
  movie: string | null;
  /** Custom-theme brief — sent to the design team so nothing is lost. */
  themeBrief: {
    theme: string; concept: string; colors: string; child: string; age: string; notes: string;
    refImages?: string[];
  } | null;
  /** Who the celebration is for — stored separately from the account holder. */
  eventFor: string;
}

const emptyDraft: Draft = {
  celebrationType: 'kids',
  celebrationTypeChosen: false,
  ageBand: null,
  buildAnswered: false,
  packageId: null,
  services: {},
  themeId: null,
  customTheme: false,
  castleVariant: null,
  emirate: 'Dubai',
  startTime: '17:00',
  eventDate: defaultDate(),
  childrenCount: 25,
  address: { area: '', street: '', villa: '', details: '' },
  mapPin: null,
  provider: 'tabby',
  movie: null,
  themeBrief: null,
  eventFor: '',
};

/**
 * The in-progress party survives a refresh or an accidental app close, so a
 * customer never loses their selections before they reach checkout. Only the
 * event details are kept — never anything sensitive. Cleared on a completed
 * booking (see `reset`).
 */
const DRAFT_KEY = 'eventana.draft';
function loadDraft(): Draft | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const d = { ...emptyDraft, ...(JSON.parse(raw) as Draft) };
    // A stale draft whose date has passed is reset to a fresh plausible date.
    if (!d.eventDate || d.eventDate < new Date().toISOString().slice(0, 10)) d.eventDate = defaultDate();
    return d;
  } catch {
    return null;
  }
}
function saveDraft(d: Draft): void {
  try { localStorage.setItem(DRAFT_KEY, JSON.stringify(d)); } catch { /* storage full/unavailable */ }
}

/** Next Saturday — the app opens on a plausible party date. */
function defaultDate(): string {
  const d = new Date();
  d.setDate(d.getDate() + ((6 - d.getDay() + 7) % 7 || 7));
  return d.toISOString().slice(0, 10);
}

/** The draft as the server's cart shape. */
export function toCart(draft: Draft): CartInput & Record<string, unknown> {
  return {
    celebrationType: draft.celebrationType as CartInput['celebrationType'],
    packageId: draft.packageId,
    services: Object.entries(draft.services)
      .filter(([, qty]) => qty > 0)
      .map(([serviceId, quantity]) => ({ serviceId, quantity })),
    themeId: draft.themeId,
    customTheme: draft.customTheme,
    emirate: draft.emirate as CartInput['emirate'],
    startTime: draft.startTime,
    eventDate: draft.eventDate,
    childrenCount: draft.childrenCount,
    castleVariant: draft.castleVariant,
    address: draft.address,
    mapPin: draft.mapPin,
    eventFor: draft.eventFor.trim() || undefined,
    // Previously frontend-only and silently dropped at checkout — now sent so
    // the team gets the exact age, the chosen film, and the custom-theme brief.
    ageBand: draft.ageBand ?? undefined,
    movie: draft.movie ?? undefined,
    themeBrief: draft.customTheme && draft.themeBrief ? draft.themeBrief : undefined,
  };
}

export default function App() {
  const { profile, save: saveProfile } = useProfile();
  const { lang, setLang } = useLang();
  const t = useMemo(() => makeT(lang), [lang]);
  const [catalogue, setCatalogue] = useState<Catalogue | null>(null);
  const [screen, setScreen] = useState<Screen>('home');
  const [draft, setDraft] = useState<Draft>(() => loadDraft() ?? emptyDraft);
  const [quote, setQuote] = useState<QuoteResult | null>(null);
  // True when the live price couldn't be fetched (e.g. a mobile network blip),
  // so the UI can offer a retry instead of a dead "AED —". Bumping the nonce
  // re-runs the quote effect on demand.
  const [quoteError, setQuoteError] = useState(false);
  const [quoteNonce, setQuoteNonce] = useState(0);
  const retryQuote = useCallback(() => setQuoteNonce((n) => n + 1), []);
  const [orderId, setOrderId] = useState<string | null>(null);
  const [eventId, setEventId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Password-reset deep link (?reset=<token>) — handled before anything else.
  const [resetToken] = useState<string | null>(() => {
    try { return new URLSearchParams(window.location.search).get('reset'); } catch { return null; }
  });

  const [social, setSocial] = useState<Awaited<ReturnType<typeof api.socialProof>> | null>(null);

  useEffect(() => {
    api.catalogue().then(setCatalogue).catch((e) => setError(e.message));
    api.socialProof().then(setSocial).catch(() => setSocial(null));
  }, []);

  // Returning from a provider's hosted checkout.
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const returned = params.get('order');
    if (returned) {
      setOrderId(returned);
      setScreen('confirming');
      history.replaceState({}, '', location.pathname);
    }
  }, []);

  const update = useCallback((patch: Partial<Draft>) => {
    setDraft((d) => ({ ...d, ...patch }));
  }, []);

  // Keep the in-progress party saved so nothing is lost on refresh/close.
  useEffect(() => { saveDraft(draft); }, [draft]);

  /**
   * Live total. Debounced, and every response is checked against the
   * request that produced it so a slow earlier reply cannot overwrite a
   * newer one.
   */
  const seq = useRef(0);
  useEffect(() => {
    const cart = toCart(draft);
    if (!cart.packageId && cart.services.length === 0) {
      setQuote(null);
      setQuoteError(false);
      return;
    }
    const mine = ++seq.current;
    const timer = setTimeout(() => {
      api
        .quote(cart)
        .then((q) => {
          if (mine === seq.current) { setQuote(q); setQuoteError(false); }
        })
        .catch(() => {
          // Keep the last good total on screen if we have one; only flag the
          // error so the customer can retry. A blank cart already returned above.
          if (mine === seq.current) setQuoteError(true);
        });
    }, 180);
    return () => clearTimeout(timer);
  }, [draft, quoteNonce]);

  // `go` is stable across renders, so it reads the draft through a ref
  // rather than closing over a stale copy.
  const draftRef = useRef(draft);
  draftRef.current = draft;

  /**
   * Central navigation, and the single place the Build gate is enforced.
   *
   * Build Your Own is priced and filtered by celebration type and child
   * count, so the service list must never open with those unanswered.
   * Routing through here means every entry point — home buttons, the
   * celebration cards, the Explore fallback, the bottom nav, and any
   * added later — is gated automatically rather than by remembering.
   */
  const go = useCallback((next: Screen) => {
    const target = next === 'build' && !draftRef.current.buildAnswered ? 'buildIntake' : next;
    setScreen(target);
    document.getElementById('screen-scroll')?.scrollTo({ top: 0 });
  }, []);

  /**
   * The intake's own way into Build.
   *
   * It cannot use `go('build')`: the answers are still queued in a state
   * update at that moment, so the gate would read the pre-answer draft
   * and bounce the customer straight back to the questions. This applies
   * the answers and navigates in the same commit, and takes the answers
   * as its argument rather than trusting state — so it is not a general
   * bypass. Every other caller still goes through the gate.
   */
  const startBuild = useCallback((answers: Partial<Draft>) => {
    setDraft((d) => ({ ...d, ...answers, buildAnswered: true }));
    setScreen('build');
    document.getElementById('screen-scroll')?.scrollTo({ top: 0 });
  }, []);

  /**
   * One-tap rebooking: pull the exact selections from a past booking into a
   * fresh draft (new date, re-pin) and drop the customer at review & pay.
   */
  const rebook = useCallback(
    async (eventId: string) => {
      const prior = (await api.rebook(eventId)) as Partial<Draft>;
      setDraft({
        ...emptyDraft,
        ...prior,
        celebrationTypeChosen: true,
        buildAnswered: true,
        eventDate: defaultDate(),
        startTime: '17:00',
        provider: 'tabby',
      });
      go('checkout');
    },
    [go],
  );

  const reset = useCallback(() => {
    setDraft({ ...emptyDraft, eventDate: defaultDate() });
    setQuote(null);
    setOrderId(null);
    try { localStorage.removeItem(DRAFT_KEY); } catch { /* ignore */ }
  }, []);

  const shared = useMemo(
    () => ({
      catalogue: catalogue!,
      draft,
      update,
      quote,
      quoteError,
      retryQuote,
      go,
      reset,
      startBuild,
      customerName: profile?.name ?? '',
      lang,
      t,
      social,
    }),
    [catalogue, draft, update, quote, quoteError, retryQuote, go, reset, startBuild, profile?.name, lang, t, social],
  );

  // Password reset takes precedence over everything (deep link from email).
  if (resetToken) {
    return (
      <Frame lang={lang}>
        <ResetPassword token={resetToken} t={t} />
      </Frame>
    );
  }

  // First run: ask the customer's name and birthday before anything else.
  if (!profile) {
    return (
      <Frame lang={lang}>
        <Onboarding onDone={saveProfile} t={t} lang={lang} setLang={setLang} />
      </Frame>
    );
  }

  if (error) {
    return (
      <Frame lang={lang}>
        <div style={{ padding: '60px 34px', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
          <div style={{ fontSize: 40, marginBottom: 6 }}>🎈</div>
          <div style={{ ...fredoka(21) }}>{t('error.title')}</div>
          <div style={{ fontSize: 13, fontWeight: 600, color: C.muted, lineHeight: 1.6, margin: '8px 0 22px' }}>
            {t('error.body')}
          </div>
          <button
            onClick={() => { setError(null); api.catalogue().then(setCatalogue).catch((e) => setError(e.message)); }}
            style={{ background: C.pink, color: '#fff', border: 'none', fontWeight: 700, fontSize: 14, padding: '13px 30px', borderRadius: 18, cursor: 'pointer' }}
          >
            {t('common.tryAgain')}
          </button>
          <a href="https://wa.me/971564500777" style={{ marginTop: 14, fontSize: 12.5, fontWeight: 700, color: C.pinkDeep, textDecoration: 'none' }}>
            {t('common.whatsapp')}
          </a>
        </div>
      </Frame>
    );
  }

  if (!catalogue) {
    return (
      <Frame lang={lang}>
        <Spinner label={t('load.app')} />
      </Frame>
    );
  }

  const tabs: Array<{ id: Screen; label: string; icon: string }> = [
    { id: 'home', label: t('nav.home'), icon: '⌂' },
    { id: 'explore', label: t('nav.explore'), icon: '◎' },
    { id: 'myevent', label: t('nav.myevent'), icon: '✦' },
    { id: 'profile', label: t('nav.profile'), icon: '☺' },
  ];

  const showTabs = screen !== 'confirming';

  return (
    <Frame lang={lang}>
      <div
        id="screen-scroll"
        className="scroll"
        style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}
      >
        {screen === 'home' && <Home {...shared} />}
        {screen === 'explore' && <Explore {...shared} />}
        {screen === 'package' && <PackageDetail {...shared} />}
        {screen === 'buildIntake' && <BuildIntake {...shared} />}
        {screen === 'build' && <Build {...shared} />}
        {(screen === 'theme' || screen === 'custom') && (
          <Themes {...shared} custom={screen === 'custom'} />
        )}
        {screen === 'assistant' && <Assistant {...shared} />}
        {screen === 'movieselect' && <MovieSelect {...shared} />}
        {screen === 'checkout' && (
          <Checkout {...shared} onOrder={(id) => { setOrderId(id); go('confirming'); }} />
        )}
        {screen === 'confirming' && orderId && (
          <PaymentReturn
            orderId={orderId}
            onConfirmed={(id) => { setEventId(id); reset(); go('myevent'); }}
            onRetry={() => go('checkout')}
            t={t}
          />
        )}
        {screen === 'myevent' && <MyEvent eventId={eventId} onPickEvent={setEventId} go={go} t={t} lang={lang} />}
        {screen === 'profile' && <Profile go={go} onRebook={rebook} t={t} lang={lang} setLang={setLang} />}
      </div>

      {showTabs && (
        <div
          style={{
            flex: 'none',
            display: 'flex',
            borderTop: `1px solid ${C.pinkLine}`,
            background: '#fff',
            padding: '8px 0 10px',
          }}
        >
          {tabs.map((t) => {
            const active =
              screen === t.id ||
              (t.id === 'explore' &&
                ['package', 'buildIntake', 'build', 'theme', 'custom', 'checkout'].includes(screen));
            return (
              <button
                key={t.id}
                onClick={() => go(t.id)}
                style={{
                  flex: 1,
                  border: 'none',
                  background: 'none',
                  cursor: 'pointer',
                  color: active ? C.pinkDeep : C.muted,
                  fontWeight: 700,
                  fontSize: 10.5,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 3,
                }}
              >
                <span style={{ fontSize: 17 }}>{t.icon}</span>
                {t.label}
              </button>
            );
          })}
        </div>
      )}
    </Frame>
  );
}

/** The phone frame. Full-bleed on a real phone, a device card on desktop. */
function Frame({ children, lang = 'en' }: { children: React.ReactNode; lang?: Lang }) {
  return (
    <div
      dir={lang === 'ar' ? 'rtl' : 'ltr'}
      style={{
        minHeight: '100dvh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 'env(safe-area-inset-top) 0 0',
      }}
    >
      <div
        style={{
          width: 390,
          maxWidth: '100vw',
          height: 844,
          maxHeight: '100dvh',
          background: C.cream,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          position: 'relative',
          boxShadow: '0 10px 40px rgba(59,54,65,.18)',
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '14px 22px 8px',
            fontSize: 13,
            fontWeight: 700,
            flex: 'none',
          }}
        >
          <span>{new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</span>
          <span style={{ fontSize: 11, letterSpacing: '.5px', color: C.muted }}>●●● ▲ ▮</span>
        </div>
        {children}
      </div>
    </div>
  );
}

export interface ScreenProps {
  catalogue: Catalogue;
  draft: Draft;
  update: (patch: Partial<Draft>) => void;
  quote: QuoteResult | null;
  /** True when the last live-price fetch failed (network blip). */
  quoteError: boolean;
  /** Re-run the live-price fetch on demand (retry button). */
  retryQuote: () => void;
  go: (s: Screen) => void;
  reset: () => void;
  /** Used only by the Build intake — see App.startBuild. */
  startBuild: (answers: Partial<Draft>) => void;
  /** The name captured at first run, shown in greetings. */
  customerName: string;
  /** Current language and its translator. */
  lang: Lang;
  t: TFn;
  /** Real ratings + testimonials from confirmed events (null until loaded). */
  social: {
    packages: Record<string, { avg: number; count: number }>;
    overall: { avg: number; count: number };
    testimonials: Array<{ stars: number; feedback: string; name: string }>;
  } | null;
}
