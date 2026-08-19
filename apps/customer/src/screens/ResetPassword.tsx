import { useState } from 'react';
import { api } from '../api';
import { saveAccount } from '../account';
import { C, fredoka, Notice, PrimaryButton } from '../ui';
import type { TFn } from '../i18n';

/**
 * Reached from the password-reset email link (app opens with ?reset=<token>).
 * Sets a new password, signs the customer in, then drops them into the app.
 */
export function ResetPassword({ token, t }: { token: string; t: TFn }) {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (password.length < 6) return;
    setBusy(true);
    setError(null);
    try {
      const acc = await api.resetPassword(token, password);
      saveAccount(acc);
      // Reload without the ?reset param — the app comes up signed in.
      window.location.href = window.location.pathname;
    } catch (e: any) {
      setError(e?.body?.message ?? t('reset.invalid'));
      setBusy(false);
    }
  };

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '40px 26px 28px', animation: 'rise .35s ease' }}>
      <div style={{ fontFamily: "'Sacramento', cursive", fontSize: 28, color: C.pinkDeep, lineHeight: 1 }}>Eventana</div>
      <div style={{ ...fredoka(24), lineHeight: 1.2, marginTop: 10 }}>{t('reset.title')}</div>
      <div style={{ fontSize: 12.5, fontWeight: 600, color: C.muted, margin: '8px 0 24px', lineHeight: 1.6 }}>
        {t('reset.sub')}
      </div>

      <input
        type="password"
        placeholder={t('reset.newPassword')}
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && submit()}
        style={{
          border: `1px solid ${C.pinkLine}`, borderRadius: 14, padding: '13px 15px',
          fontWeight: 600, fontSize: 13, background: '#fff', color: C.ink, outline: 'none', width: '100%', marginBottom: 12,
        }}
      />
      {error && <div style={{ marginBottom: 12 }}><Notice tone="error">{error}</Notice></div>}
      <PrimaryButton disabled={password.length < 6 || busy} onClick={submit}>
        {busy ? t('reset.saving') : t('reset.submit')}
      </PrimaryButton>
    </div>
  );
}
