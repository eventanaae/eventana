import { useState } from 'react';
import type { CSSProperties } from 'react';
import type { ScreenProps } from '../App';
import { api } from '../api';
import { C, fredoka, Notice, PrimaryButton } from '../ui';

/**
 * "Leave your number" — a visitor who isn't ready to book can ask us to reach
 * out. Posts to /api/lead, which creates a lead in the team's Leads screen and
 * alerts them. This is the website's only lead-capture point.
 */
export function LeadForm({ go, t, customerName }: ScreenProps) {
  const [name, setName] = useState(customerName || '');
  const [phone, setPhone] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const valid = name.trim().length > 0 && phone.replace(/\D/g, '').length >= 7;

  const submit = async () => {
    if (!valid || busy) return;
    setBusy(true);
    setErr(null);
    try {
      await api.lead({ name: name.trim(), phone: phone.trim(), message: message.trim() || undefined });
      setDone(true);
    } catch {
      setErr(t('lead.error'));
    } finally {
      setBusy(false);
    }
  };

  const inputStyle: CSSProperties = {
    width: '100%', padding: '13px 15px', borderRadius: 14, border: '1.5px solid #f0e2ea',
    fontSize: 15, fontFamily: 'inherit', background: '#fff', outline: 'none', boxSizing: 'border-box',
  };
  const label: CSSProperties = { fontSize: 12.5, fontWeight: 700, color: C.muted, margin: '2px 2px 6px' };

  if (done) {
    return (
      <div style={{ padding: '22px 22px 40px', textAlign: 'center', animation: 'rise .35s ease' }}>
        <div style={{ fontSize: 60, marginTop: 24 }}>💛</div>
        <div style={{ ...fredoka(23), marginTop: 10 }}>{t('lead.done')}</div>
        <div style={{ fontSize: 14, fontWeight: 600, color: C.muted, margin: '10px auto 26px', maxWidth: 320, lineHeight: 1.6 }}>
          {t('lead.doneSub')}
        </div>
        <PrimaryButton onClick={() => go('home')}>{t('lead.backHome')}</PrimaryButton>
      </div>
    );
  }

  return (
    <div style={{ padding: '10px 22px 40px', animation: 'rise .35s ease' }}>
      <button onClick={() => go('home')} style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: C.ink, padding: '4px 0 10px' }}>‹</button>
      <div style={{ ...fredoka(24) }}>{t('lead.title')}</div>
      <div style={{ fontSize: 14, fontWeight: 600, color: C.muted, margin: '8px 0 22px', lineHeight: 1.6 }}>
        {t('lead.sub')}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div>
          <div style={label}>{t('lead.name')}</div>
          <input style={inputStyle} value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
        </div>
        <div>
          <div style={label}>{t('lead.phone')}</div>
          <input style={inputStyle} type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="05x xxx xxxx" maxLength={20} />
        </div>
        <div>
          <div style={label}>{t('lead.message')}</div>
          <textarea style={{ ...inputStyle, minHeight: 90, resize: 'vertical' }} value={message} onChange={(e) => setMessage(e.target.value)} maxLength={1000} />
        </div>
      </div>

      {err && <div style={{ marginTop: 14 }}><Notice tone="warn">{err}</Notice></div>}

      <div style={{ marginTop: 22 }}>
        <PrimaryButton onClick={submit} disabled={!valid || busy}>
          {busy ? t('lead.sending') : t('lead.submit')}
        </PrimaryButton>
      </div>
    </div>
  );
}
