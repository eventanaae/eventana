import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CartInput } from '@eventana/shared';
import { api, type Catalogue, type QuoteResult } from './api';
import { C, Spinner } from './ui';
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
import { useProfile } from './profile';

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
  /** Movie Night selection — frontend-only, like ageBand. */
  movie: string | null;
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
};

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
  };
}

export default function App() {
  const { profile, save: saveProfile } = useProfile();
  const [catalogue, setCatalogue] = useState<Catalogue | null>(null);
  const [screen, setScreen] = useState<Screen>('home');
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [quote, setQuote] = useState<QuoteResult | null>(null);
  const [orderId, setOrderId] = useState<string | null>(null);
  const [eventId, setEventId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.catalogue().then(setCatalogue).catch((e) => setError(e.message));
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
      return;
    }
    const mine = ++seq.current;
    const timer = setTimeout(() => {
      api
        .quote(cart)
        .then((q) => {
          if (mine === seq.current) setQuote(q);
        })
        .catch(() => {
          if (mine === seq.current) setQuote(null);
        });
    }, 180);
    return () => clearTimeout(timer);
  }, [draft]);

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

  const reset = useCallback(() => {
    setDraft({ ...emptyDraft, eventDate: defaultDate() });
    setQuote(null);
    setOrderId(null);
  }, []);

  const shared = useMemo(
    () => ({
      catalogue: catalogue!,
      draft,
      update,
      quote,
      go,
      reset,
      startBuild,
      customerName: profile?.name ?? '',
    }),
    [catalogue, draft, update, quote, go, reset, startBuild, profile?.name],
  );

  // First run: ask the customer's name and birthday before anything else.
  if (!profile) {
    return (
      <Frame>
        <Onboarding onDone={saveProfile} />
      </Frame>
    );
  }

  if (error) {
    return (
      <Frame>
        <div style={{ padding: 40, textAlign: 'center' }}>
          <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 8 }}>
            Can’t reach Eventana
          </div>
          <div style={{ fontSize: 12.5, fontWeight: 600, color: C.muted, lineHeight: 1.6 }}>
            {error}
            <br />
            Start the engine with <code>npm run dev:api</code>.
          </div>
        </div>
      </Frame>
    );
  }

  if (!catalogue) {
    return (
      <Frame>
        <Spinner label="Loading Eventana…" />
      </Frame>
    );
  }

  const tabs: Array<{ id: Screen; label: string; icon: string }> = [
    { id: 'home', label: 'Home', icon: '⌂' },
    { id: 'explore', label: 'Explore', icon: '◎' },
    { id: 'myevent', label: 'My Event', icon: '✦' },
    { id: 'profile', label: 'Profile', icon: '☺' },
  ];

  const showTabs = screen !== 'confirming';

  return (
    <Frame>
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
          />
        )}
        {screen === 'myevent' && <MyEvent eventId={eventId} onPickEvent={setEventId} go={go} />}
        {screen === 'profile' && <Profile go={go} />}
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
function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div
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
  go: (s: Screen) => void;
  reset: () => void;
  /** Used only by the Build intake — see App.startBuild. */
  startBuild: (answers: Partial<Draft>) => void;
  /** The name captured at first run, shown in greetings. */
  customerName: string;
}
