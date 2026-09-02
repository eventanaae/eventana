import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { C, fredoka, Spinner } from '../ui';

/**
 * One customer's WhatsApp conversation, with the reply box.
 *
 * A Cloud API number can never be opened in the WhatsApp phone app, so this is
 * the only place the team can answer an enquiry. Without it the Leads screen
 * shows a customer waiting and offers no way to reach her.
 */

interface Message {
  id: number;
  direction: 'in' | 'out';
  body: string | null;
  sentBy: 'agent' | 'staff' | null;
  createdAt: string;
}

interface Window24 {
  open: boolean;
  lastInboundAt: string | null;
  hoursLeft: number | null;
}

const time = (iso: string) => {
  try {
    return new Date(iso).toLocaleString(undefined, {
      day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return iso;
  }
};

export function LeadThread({
  phone,
  name,
  onClose,
}: {
  phone: string;
  name: string | null;
  onClose: () => void;
}) {
  const [messages, setMessages] = useState<Message[] | null>(null);
  const [window24, setWindow24] = useState<Window24 | null>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);

  const load = () =>
    api
      .whatsappMessages(phone)
      .then((d) => { setMessages(d.messages ?? []); setWindow24(d.window ?? null); })
      .catch((e) => { setMessages([]); setError(e?.message ?? 'Could not load the conversation.'); });

  useEffect(() => {
    load();
    // A customer can reply while the thread is open; poll so it stays live.
    const t = setInterval(load, 20_000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phone]);

  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }); }, [messages?.length]);

  const send = async () => {
    const body = draft.trim();
    if (!body) return setError('Write a message first.');
    setError(null);
    setSending(true);
    try {
      const res = await api.whatsappReply(phone, body);
      setMessages(res.messages ?? []);
      setDraft('');
      load();
    } catch (e: any) {
      setError(e?.message ?? 'The message could not be sent.');
    } finally {
      setSending(false);
    }
  };

  const closed = window24 ? !window24.open : false;

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 50, background: 'rgba(43,38,49,.45)',
        display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: C.bg, width: '100%', maxWidth: 560, height: '90vh',
          borderTopLeftRadius: 20, borderTopRightRadius: 20,
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
        }}
      >
        {/* header */}
        <div style={{
          background: '#fff', borderBottom: `1px solid ${C.line}`, padding: '14px 16px',
          display: 'flex', alignItems: 'center', gap: 12, flex: 'none',
        }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ ...fredoka(15) }}>{name || 'Unnamed'}</div>
            <div style={{ fontSize: 12, fontWeight: 600, color: C.muted }}>+{phone}</div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{
              border: 'none', background: C.pinkSoft, color: C.pinkDeep, width: 32, height: 32,
              borderRadius: 999, fontSize: 17, fontWeight: 800, cursor: 'pointer', flex: 'none',
            }}
          >
            ×
          </button>
        </div>

        {/* thread */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '14px 16px' }}>
          {!messages ? (
            <Spinner />
          ) : messages.length === 0 ? (
            <div style={{ fontSize: 12.5, fontWeight: 600, color: C.muted, textAlign: 'center', padding: '30px 0', lineHeight: 1.7 }}>
              No messages stored yet.
              <br />
              Conversations appear here from the moment WhatsApp is connected — anything older lives
              only in the phone app.
            </div>
          ) : (
            messages.map((m) => {
              const mine = m.direction === 'out';
              return (
                <div key={m.id} style={{ display: 'flex', justifyContent: mine ? 'flex-end' : 'flex-start', marginBottom: 9 }}>
                  <div style={{ maxWidth: '78%' }}>
                    <div style={{
                      background: mine ? C.pink : '#fff',
                      color: mine ? '#fff' : C.ink,
                      border: mine ? 'none' : `1px solid ${C.line}`,
                      borderRadius: mine ? '14px 14px 4px 14px' : '14px 14px 14px 4px',
                      padding: '9px 13px', fontSize: 13, fontWeight: 500, lineHeight: 1.55,
                      whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                    }}>
                      {m.body}
                    </div>
                    <div style={{
                      fontSize: 10.5, fontWeight: 600, color: C.muted, marginTop: 3,
                      textAlign: mine ? 'right' : 'left',
                    }}>
                      {time(m.createdAt)}
                      {m.sentBy === 'agent' && ' · auto-reply'}
                      {m.sentBy === 'staff' && ' · team'}
                    </div>
                  </div>
                </div>
              );
            })
          )}
          <div ref={endRef} />
        </div>

        {/* reply */}
        <div style={{ background: '#fff', borderTop: `1px solid ${C.line}`, padding: '12px 16px', flex: 'none' }}>
          {closed && (
            <div style={{
              background: C.yellowSoft, border: '1px solid #eddcbe', borderRadius: 10,
              padding: '10px 12px', fontSize: 12, fontWeight: 600, color: C.yellowInk,
              lineHeight: 1.6, marginBottom: 10,
            }}>
              WhatsApp closes the free reply window 24 hours after a customer’s last message. To
              reach her now you need an approved template — or wait for her to write again.
            </div>
          )}
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
            <textarea
              value={draft}
              onChange={(e) => { setDraft(e.target.value); setError(null); }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void send(); }
              }}
              rows={2}
              disabled={closed || sending}
              placeholder={closed ? 'Reply window closed' : 'Write a reply…'}
              style={{
                flex: 1, border: `1px solid ${C.line}`, borderRadius: 12, padding: '10px 12px',
                fontSize: 13, fontWeight: 500, lineHeight: 1.5, resize: 'vertical',
                outline: 'none', background: closed ? C.bg : '#fff', color: C.ink,
                fontFamily: 'inherit',
              }}
            />
            <button
              onClick={() => void send()}
              disabled={closed || sending || !draft.trim()}
              style={{
                border: 'none', borderRadius: 12, padding: '11px 18px', flex: 'none',
                background: closed || !draft.trim() ? C.line : C.pink,
                color: closed || !draft.trim() ? C.muted : '#fff',
                fontWeight: 800, fontSize: 13,
                cursor: closed || sending || !draft.trim() ? 'default' : 'pointer',
              }}
            >
              {sending ? '…' : 'Send'}
            </button>
          </div>
          {error && (
            <div style={{ fontSize: 12, fontWeight: 700, color: C.red, marginTop: 8 }}>{error}</div>
          )}
          {!closed && window24?.hoursLeft != null && (
            <div style={{ fontSize: 11, fontWeight: 600, color: C.muted, marginTop: 7 }}>
              {window24.hoursLeft} hours left to reply freely. Sends as Eventana on WhatsApp.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
