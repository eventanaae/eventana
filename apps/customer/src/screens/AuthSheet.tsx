import { useState } from 'react';
import { api } from '../api';
import { saveAccount, type Account } from '../account';
import { C, fredoka, Notice, PrimaryButton } from '../ui';
import type { Lang, TFn } from '../i18n';

/**
 * A lightweight sign-in sheet for a returning customer, opened from Profile or
 * the empty My Event screen. Browsing and booking still work as a guest; this
 * just lets someone with an account sign in to see their bookings, rewards and
 * vouchers. On success the session token is saved and the app reloads so every
 * screen picks up the signed-in state.
 */
export function AuthSheet({
  t,
  lang,
  initialEmail,
  onClose,
  onSignedIn,
}: {
  t: TFn;
  lang: Lang;
  initialEmail?: string;
  onClose: () => void;
  onSignedIn: (acc: Account) => void;
}) {
  const ar = lang === 'ar';
  const [email, setEmail] = useState(initialEmail ?? '');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [forgotMsg, setForgotMsg] = useState<string | null>(null);
  const emailOk = /.+@.+\..+/.test(email.trim());

  const submit = async () => {
    if (!emailOk || password.length < 1) return;
    setBusy(true);
    setError(null);
    try {
      const acc = await api.login({ email: email.trim(), password });
      saveAccount(acc);
      onSignedIn(acc);
    } catch {
      setError(t('auth.failed'));
      setBusy(false);
    }
  };

  const forgot = async () => {
    if (!emailOk) { setError(t('auth.enterEmail')); return; }
    setError(null);
    try { await api.forgotPassword(email.trim()); } catch { /* never reveal */ }
    setForgotMsg(t('auth.resetSent'));
  };

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 70, background: 'rgba(40,20,35,.5)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}
      onClick={onClose}
    >
      <div
        dir={ar ? 'rtl' : 'ltr'}
        onClick={(e) => e.stopPropagation()}
        style={{ background: '#fff', width: '100%', maxWidth: 460, borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: '22px 22px 32px', animation: 'rise .3s ease' }}
      >
        <div style={{ ...fredoka(21), marginBottom: 4 }}>{t('auth.title')}</div>
        <div style={{ fontSize: 12.5, fontWeight: 600, color: C.muted, marginBottom: 16, lineHeight: 1.5 }}>{t('auth.sub')}</div>
        <input
          placeholder={t('auth.email')}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoCapitalize="none"
          style={field}
        />
        <input
          type="password"
          placeholder={t('auth.password')}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          style={field}
        />
        {error && <div style={{ marginBottom: 10 }}><Notice tone="error">{error}</Notice></div>}
        {forgotMsg && <div style={{ marginBottom: 10 }}><Notice tone="ok">{forgotMsg}</Notice></div>}
        <PrimaryButton disabled={!emailOk || password.length < 1 || busy} onClick={submit}>
          {busy ? t('auth.signingIn') : t('auth.signIn')}
        </PrimaryButton>
        <button onClick={forgot} style={{ background: 'none', border: 'none', color: C.pinkDeep, fontWeight: 700, fontSize: 12, cursor: 'pointer', width: '100%', marginTop: 12 }}>
          {t('auth.forgot')}
        </button>
        <button onClick={onClose} style={{ background: 'none', border: 'none', color: C.muted, fontWeight: 700, fontSize: 12.5, cursor: 'pointer', width: '100%', marginTop: 8 }}>
          {t('common.back')}
        </button>
      </div>
    </div>
  );
}

const field: React.CSSProperties = {
  width: '100%', border: `1.5px solid ${C.pinkLine}`, borderRadius: 14, padding: '13px 15px',
  fontWeight: 600, fontSize: 13.5, background: '#fff', color: C.ink, outline: 'none', marginBottom: 11,
};
