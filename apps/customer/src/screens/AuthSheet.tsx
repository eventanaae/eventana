import { useState } from 'react';
import { api } from '../api';
import { saveAccount, type Account } from '../account';
import { loadProfile, saveProfile } from '../profile';
import { C, fredoka, Notice, PrimaryButton } from '../ui';
import { uaeMobile } from './ShopCheckout';
import type { Lang, TFn } from '../i18n';

/**
 * Sign-in / create-account sheet for the customer app, opened from Profile or
 * the empty My Event screen. Two tabs: Log in (email + password) and Create
 * account (name + email + UAE mobile + password). Booking still works fully as
 * a guest — this just lets someone keep an account for bookings, points and
 * rewards. On success the session token is saved and the app reloads so every
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
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState(initialEmail ?? '');
  const [dob, setDob] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [forgotMsg, setForgotMsg] = useState<string | null>(null);

  const emailOk = /.+@.+\..+/.test(email.trim());
  const nameOk = name.trim().split(/\s+/).filter(Boolean).length >= 2;
  const phoneOk = Boolean(uaeMobile(phone));
  const loginReady = emailOk && password.length >= 1;
  const registerReady = nameOk && emailOk && phoneOk && password.length >= 6;

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const acc =
        mode === 'login'
          ? await api.login({ email: email.trim(), password })
          : await api.register({
              name: name.trim(),
              email: email.trim(),
              phone: phone.trim(),
              password,
              dateOfBirth: dob || undefined,
            });
      saveAccount(acc);
      // Mirror the name (and birthday) into the on-device profile so the Home
      // greeting and avatar show the signed-in customer immediately.
      const existing = loadProfile();
      saveProfile({
        name: acc.name,
        birthday: mode === 'register' ? dob : existing?.birthday ?? '',
      });
      onSignedIn(acc);
    } catch (e: any) {
      setError(
        mode === 'register' && e?.body?.error === 'email_taken'
          ? t('auth.emailTaken')
          : mode === 'login'
            ? t('auth.failed')
            : e?.body?.message ?? t('auth.registerFailed'),
      );
      setBusy(false);
    }
  };

  const forgot = async () => {
    if (!emailOk) { setError(t('auth.enterEmail')); return; }
    setError(null);
    try { await api.forgotPassword(email.trim()); } catch { /* never reveal */ }
    setForgotMsg(t('auth.resetSent'));
  };

  const tab = (m: 'login' | 'register', label: string) => (
    <button
      onClick={() => { setMode(m); setError(null); setForgotMsg(null); }}
      style={{
        flex: 1, background: 'none', border: 'none', cursor: 'pointer', padding: '10px 0',
        fontWeight: 800, fontSize: 13.5, color: mode === m ? C.pinkDeep : C.muted,
        borderBottom: `2.5px solid ${mode === m ? C.pink : 'transparent'}`,
      }}
    >
      {label}
    </button>
  );

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 70, background: 'rgba(40,20,35,.5)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}
      onClick={onClose}
    >
      <div
        dir={ar ? 'rtl' : 'ltr'}
        onClick={(e) => e.stopPropagation()}
        style={{ background: '#fff', width: '100%', maxWidth: 460, borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: '18px 22px 32px', animation: 'rise .3s ease' }}
      >
        <div style={{ display: 'flex', gap: 6, marginBottom: 16, borderBottom: `1px solid ${C.pinkLine}` }}>
          {tab('login', t('auth.tabLogin'))}
          {tab('register', t('auth.tabRegister'))}
        </div>

        <div style={{ ...fredoka(19), marginBottom: 4 }}>{mode === 'login' ? t('auth.title') : t('auth.registerTitle')}</div>
        <div style={{ fontSize: 12.5, fontWeight: 600, color: C.muted, marginBottom: 14, lineHeight: 1.5 }}>
          {mode === 'login' ? t('auth.sub') : t('auth.registerSub')}
        </div>

        {mode === 'register' && (
          <input placeholder={`${t('auth.name')} *`} value={name} onChange={(e) => setName(e.target.value)} style={field} />
        )}
        <input placeholder={`${t('auth.email')} *`} value={email} onChange={(e) => setEmail(e.target.value)} autoCapitalize="none" style={field} />
        {mode === 'register' && (
          <input placeholder={`${t('auth.phone')} *`} value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" style={field} />
        )}
        {mode === 'register' && (
          <div style={{ marginBottom: 11 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, marginBottom: 5 }}>{t('auth.dob')}</div>
            <input type="date" value={dob} onChange={(e) => setDob(e.target.value)} max={new Date().toISOString().slice(0, 10)} style={{ ...field, marginBottom: 0 }} />
          </div>
        )}
        <input type="password" placeholder={`${t('auth.password')} *`} value={password} onChange={(e) => setPassword(e.target.value)} style={field} />

        {error && <div style={{ marginBottom: 10 }}><Notice tone="error">{error}</Notice></div>}
        {forgotMsg && <div style={{ marginBottom: 10 }}><Notice tone="ok">{forgotMsg}</Notice></div>}

        <PrimaryButton
          disabled={(mode === 'login' ? !loginReady : !registerReady) || busy}
          onClick={submit}
        >
          {busy ? t('auth.signingIn') : mode === 'login' ? t('auth.signIn') : t('auth.createAccount')}
        </PrimaryButton>

        {mode === 'login' && (
          <button onClick={forgot} style={{ background: 'none', border: 'none', color: C.pinkDeep, fontWeight: 700, fontSize: 12, cursor: 'pointer', width: '100%', marginTop: 12 }}>
            {t('auth.forgot')}
          </button>
        )}
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
