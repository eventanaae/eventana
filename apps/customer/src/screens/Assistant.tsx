import { useRef, useState } from 'react';
import { api } from '../api';
import type { ScreenProps } from '../App';
import { C, fredoka } from '../ui';

const PROMPTS = [
  'What’s in the Golden package?',
  'I have 30 kids and AED 5,000',
  'My daughter is 6 and likes pink, but not Barbie',
  'How much is delivery to Sharjah?',
  'Is the Bubble House available?',
];

interface Msg {
  who: 'me' | 'ai';
  text: string;
  escalated?: boolean;
}

export function Assistant({ draft, go, customerName }: ScreenProps) {
  const firstName = (customerName || '').trim().split(' ')[0];
  const [messages, setMessages] = useState<Msg[]>([
    {
      who: 'ai',
      text: `Hi ${firstName || 'there'} ✨ I’m your Eventana event assistant. Ask me about packages, prices, availability or themes — I only quote what’s in Eventana’s system.`,
    },
  ]);
  const [text, setText] = useState('');
  const [thinking, setThinking] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  const send = async (question: string) => {
    if (!question.trim() || thinking) return;
    setMessages((m) => [...m, { who: 'me', text: question }]);
    setText('');
    setThinking(true);
    try {
      const answer = await api.assistant(question, draft.celebrationType);
      setMessages((m) => [...m, { who: 'ai', text: answer.reply, escalated: answer.escalated }]);
    } catch {
      setMessages((m) => [
        ...m,
        { who: 'ai', text: 'I couldn’t reach Eventana’s catalogue just now. Please try again.' },
      ]);
    } finally {
      setThinking(false);
      setTimeout(() => endRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
    }
  };

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, animation: 'rise .35s ease' }}>
      <div style={{ padding: '8px 22px 12px', flex: 'none' }}>
        <button
          onClick={() => go('home')}
          style={{ background: 'none', border: 'none', color: C.muted, fontWeight: 700, fontSize: 13, cursor: 'pointer', padding: 0, marginBottom: 6 }}
        >
          ‹ Home
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
            <div style={{ ...fredoka(19), lineHeight: 1.1 }}>Eventana Assistant</div>
            <div style={{ fontSize: 11, fontWeight: 600, color: C.muted }}>
              Answers from Eventana’s live catalogue
            </div>
          </div>
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
            {m.escalated && (
              <div style={{ fontSize: 10.5, fontWeight: 700, marginTop: 6, letterSpacing: '.3px' }}>
                PASSED TO A HUMAN
              </div>
            )}
          </div>
        ))}
        {thinking && (
          <div style={{ alignSelf: 'flex-start', fontSize: 12, fontWeight: 600, color: C.muted, padding: '4px 6px' }}>
            Checking the catalogue…
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
            placeholder="Ask about packages, themes, availability…"
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
