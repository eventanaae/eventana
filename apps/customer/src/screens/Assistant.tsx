import { useRef, useState } from 'react';
import { api } from '../api';
import type { ScreenProps } from '../App';
import { C, fredoka, money } from '../ui';

const PROMPTS = [
  'What’s in the Golden package?',
  'I have 30 kids and AED 5,000',
  'My daughter is 6 and likes pink, but not Barbie',
  'How much is delivery to Sharjah?',
  'Is the Bubble House available?',
];

interface Ref { kind: string; id: string; name: string }
interface Msg {
  who: 'me' | 'ai';
  text: string;
  escalated?: boolean;
  refs?: Ref[];
}

export function Assistant({ catalogue, draft, update, go, customerName, t }: ScreenProps) {
  const firstName = (customerName || '').trim().split(' ')[0];
  const [messages, setMessages] = useState<Msg[]>([
    { who: 'ai', text: t('assistant.greeting', { name: firstName || t('common.friend') }) },
  ]);
  const [text, setText] = useState('');
  const [thinking, setThinking] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  // AI planner
  const [budget, setBudget] = useState('');
  const [kids, setKids] = useState(String(draft.childrenCount || 20));
  const [planBusy, setPlanBusy] = useState(false);
  const [plan, setPlan] = useState<Awaited<ReturnType<typeof api.plan>> | null>(null);

  const send = async (question: string) => {
    if (!question.trim() || thinking) return;
    setMessages((m) => [...m, { who: 'me', text: question }]);
    setText('');
    setThinking(true);
    try {
      const answer = await api.assistant(question, draft.celebrationType);
      setMessages((m) => [...m, { who: 'ai', text: answer.reply, escalated: answer.escalated, refs: answer.references }]);
    } catch {
      setMessages((m) => [...m, { who: 'ai', text: t('assistant.unreachable') }]);
    } finally {
      setThinking(false);
      setTimeout(() => endRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
    }
  };

  const buildPlan = async () => {
    setPlanBusy(true);
    setPlan(null);
    try {
      const p = await api.plan({
        celebrationType: draft.celebrationType,
        childrenCount: Math.max(1, Number(kids.replace(/\D/g, '')) || 20),
        budgetFils: budget ? Math.round(Number(budget.replace(/\D/g, '')) * 100) : null,
        age: draft.ageBand ?? undefined,
      });
      setPlan(p);
    } catch {
      /* keep the panel; the user can retry */
    } finally {
      setPlanBusy(false);
    }
  };

  const applyPlan = () => {
    if (!plan) return;
    update({
      celebrationType: plan.celebrationType,
      celebrationTypeChosen: true,
      buildAnswered: true,
      packageId: plan.packageId,
      services: plan.services,
      themeId: plan.themeId,
      customTheme: false,
      childrenCount: Math.max(1, Number(kids.replace(/\D/g, '')) || 20),
    });
    go(plan.packageId ? 'package' : 'build');
  };

  // Tapping a catalogue reference the assistant cited drops it into the plan.
  const applyRef = (r: Ref) => {
    if (r.kind === 'package') {
      update({ packageId: r.id, services: {}, celebrationTypeChosen: true });
      go('package');
    } else if (r.kind === 'theme') {
      update({ themeId: r.id, customTheme: false });
      go('theme');
    } else if (r.kind === 'service') {
      const s = catalogue.services.find((x) => x.id === r.id);
      const min = s?.pricing.kind === 'per_child' ? draft.childrenCount : (s?.pricing.minQuantity ?? 1);
      update({ services: { ...draft.services, [r.id]: min }, buildAnswered: true, celebrationTypeChosen: true });
      go('build');
    }
  };

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, animation: 'rise .35s ease' }}>
      <div style={{ padding: '8px 22px 12px', flex: 'none' }}>
        <button
          onClick={() => go('home')}
          style={{ background: 'none', border: 'none', color: C.muted, fontWeight: 700, fontSize: 13, cursor: 'pointer', padding: 0, marginBottom: 6 }}
        >
          {t('common.home')}
        </button>
        <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
          <div
            style={{
              width: 38, height: 38, borderRadius: 14, background: C.mint, color: '#fff',
              display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 17, flex: 'none',
            }}
          >
            ✦
          </div>
          <div>
            <div style={{ ...fredoka(19), lineHeight: 1.1 }}>{t('assistant.title')}</div>
            <div style={{ fontSize: 11, fontWeight: 600, color: C.muted }}>
              {t('assistant.sub')}
            </div>
          </div>
        </div>
      </div>

      {/* AI planner */}
      <div style={{ flex: 'none', padding: '0 22px 12px' }}>
        <div style={{ background: 'linear-gradient(135deg,#EAF6FF,#F3ECFB)', borderRadius: 18, padding: '14px 16px' }}>
          <div style={{ fontWeight: 800, fontSize: 13.5 }}>{t('plan.title')}</div>
          <div style={{ fontSize: 11, fontWeight: 600, color: '#5b6b8a', margin: '3px 0 10px', lineHeight: 1.4 }}>{t('plan.sub')}</div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
            <input
              inputMode="numeric" placeholder={t('plan.budget')} value={budget}
              onChange={(e) => setBudget(e.target.value.replace(/[^\d]/g, ''))}
              style={{ flex: 1, minWidth: 0, border: `1px solid ${C.pinkLine}`, borderRadius: 12, padding: '10px 12px', fontWeight: 700, fontSize: 12.5, background: '#fff', color: C.ink, outline: 'none' }}
            />
            <input
              inputMode="numeric" placeholder={t('plan.kids')} value={kids}
              onChange={(e) => setKids(e.target.value.replace(/[^\d]/g, ''))}
              style={{ width: 84, border: `1px solid ${C.pinkLine}`, borderRadius: 12, padding: '10px 12px', fontWeight: 700, fontSize: 12.5, background: '#fff', color: C.ink, outline: 'none' }}
            />
          </div>
          {!plan ? (
            <button
              onClick={buildPlan} disabled={planBusy}
              style={{ width: '100%', border: 'none', background: C.mint, color: '#fff', fontWeight: 700, fontSize: 13, padding: '11px 0', borderRadius: 12, cursor: 'pointer' }}
            >{planBusy ? t('plan.building') : t('plan.build')}</button>
          ) : (
            <div style={{ background: '#fff', borderRadius: 14, padding: '12px 14px' }}>
              <div style={{ fontSize: 12.5, fontWeight: 600, color: C.ink, lineHeight: 1.5 }}>{plan.summary}</div>
              {plan.themeName && (
                <div style={{ fontSize: 11, fontWeight: 700, color: C.pinkDeep, marginTop: 5 }}>🎨 {plan.themeName}</div>
              )}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 10, gap: 10 }}>
                <span style={{ fontSize: 11.5, fontWeight: 700, color: C.muted }}>{t('plan.estTotal')}: {t('common.aed')} {money(plan.estTotalFils)}</span>
                <button
                  onClick={applyPlan}
                  style={{ border: 'none', background: C.pink, color: '#fff', fontWeight: 700, fontSize: 12.5, padding: '9px 14px', borderRadius: 12, cursor: 'pointer' }}
                >{t('plan.addToCart')}</button>
              </div>
            </div>
          )}
        </div>
      </div>

      <div
        className="scroll"
        style={{ flex: 1, overflowY: 'auto', padding: '0 22px 12px', display: 'flex', flexDirection: 'column', gap: 10, minHeight: 0 }}
      >
        {messages.map((m, i) => (
          <div
            key={i}
            style={{
              alignSelf: m.who === 'me' ? 'flex-end' : 'flex-start',
              background: m.who === 'me' ? C.pink : m.escalated ? C.yellowSoft : '#fff',
              color: m.who === 'me' ? '#fff' : m.escalated ? C.yellowInk : C.ink,
              fontSize: 12.5, fontWeight: 600, padding: '12px 15px', borderRadius: 18,
              maxWidth: '84%', lineHeight: 1.5, boxShadow: C.shadow,
            }}
          >
            {m.text}
            {m.refs && m.refs.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                {m.refs.map((r) => (
                  <button
                    key={`${r.kind}-${r.id}`}
                    onClick={() => applyRef(r)}
                    style={{
                      border: `1px solid ${C.pinkLine}`, background: C.pinkSoft, color: C.pinkDeep,
                      fontWeight: 700, fontSize: 11, padding: '6px 11px', borderRadius: 14, cursor: 'pointer',
                    }}
                  >
                    ＋ {r.name}
                  </button>
                ))}
              </div>
            )}
            {m.escalated && (
              <div style={{ fontSize: 10.5, fontWeight: 700, marginTop: 6, letterSpacing: '.3px' }}>
                {t('assistant.escalated')}
              </div>
            )}
          </div>
        ))}
        {thinking && (
          <div style={{ alignSelf: 'flex-start', fontSize: 12, fontWeight: 600, color: C.muted, padding: '4px 6px' }}>
            {t('assistant.checking')}
          </div>
        )}
        <div ref={endRef} />
      </div>

      <div style={{ flex: 'none', padding: '0 22px 14px' }}>
        <div className="scroll" style={{ display: 'flex', gap: 7, overflowX: 'auto', margin: '0 -22px 10px', padding: '0 22px 2px' }}>
          {PROMPTS.map((p) => (
            <button
              key={p}
              onClick={() => send(p)}
              style={{
                flex: 'none', border: `1px solid ${C.pinkLine}`, background: '#fff', color: C.pinkDeep,
                fontSize: 11, fontWeight: 700, padding: '8px 13px', borderRadius: 16,
                cursor: 'pointer', whiteSpace: 'nowrap',
              }}
            >
              {p}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            placeholder={t('assistant.placeholder')}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && send(text)}
            style={{
              flex: 1, minWidth: 0, border: `1px solid ${C.pinkLine}`, borderRadius: 16,
              padding: '13px 16px', fontWeight: 600, fontSize: 12.5, background: '#fff',
              color: C.ink, outline: 'none',
            }}
          />
          <button
            onClick={() => send(text)}
            style={{ width: 44, height: 44, borderRadius: 16, border: 'none', background: C.mint, color: '#fff', fontSize: 16, cursor: 'pointer', flex: 'none' }}
          >
            ➤
          </button>
        </div>
      </div>
    </div>
  );
}
