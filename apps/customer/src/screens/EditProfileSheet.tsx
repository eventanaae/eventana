import { useEffect, useState } from 'react';
import { api } from '../api';
import { loadProfile, saveProfile } from '../profile';
import { uaeMobile } from './ShopCheckout';
import { C, fredoka, Notice, PrimaryButton, Spinner } from '../ui';
import type { Lang, TFn } from '../i18n';

/**
 * Edit-profile sheet for a signed-in customer: name, mobile and date of birth
 * (email is read-only here). Loads the current values from the server, saves
 * changes via PATCH /api/customers/me, and mirrors the name/birthday into the
 * on-device profile so the greeting updates. Reloads on save.
 */
export function EditProfileSheet({
  t,
  lang,
  onClose,
  onSaved,
}: {
  t: TFn;
  lang: Lang;
  onClose: () => void;
  onSaved: () => void;
}) {
  const ar = lang === 'ar';
  const [loaded, setLoaded] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [dob, setDob] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .me()
      .then((m) => {
        setName(m.name ?? '');
        setEmail(m.email ?? '');
        setPhone(m.phone ?? '');
        setDob(m.dateOfBirth ?? '');
      })
      .catch(() => setError(t('auth.registerFailed')))
      .finally(() => setLoaded(true));
  }, []);

  const nameOk = name.trim().split(/\s+/).filter(Boolean).length >= 2;
  const phoneOk = Boolean(uaeMobile(phone));
  const canSave = nameOk && phoneOk && !busy;

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.updateMe({ name: name.trim(), phone: phone.trim(), dateOfBirth: dob || undefined });
      const existing = loadProfile();
      saveProfile({ name: name.trim(), birthday: dob || existing?.birthday || '' });
      onSaved();
    } catch {
      setError(t('auth.registerFailed'));
      setBusy(false);
    }
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
        <div style={{ ...fredoka(20), marginBottom: 14 }}>{t('auth.editTitle')}</div>
        {!loaded ? (
          <Spinner />
        ) : (
          <>
            <div style={label}>{t('auth.name')}</div>
            <input value={name} onChange={(e) => setName(e.target.value)} style={field} />
            <div style={label}>{t('auth.phone')}</div>
            <input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" style={field} />
            <div style={label}>{t('auth.dob')}</div>
            <input type="date" value={dob} onChange={(e) => setDob(e.target.value)} max={new Date().toISOString().slice(0, 10)} style={field} />
            <div style={label}>{t('auth.emailReadonly')}</div>
            <input value={email} readOnly style={{ ...field, background: '#f6f1f4', color: C.muted }} />

            {error && <div style={{ marginBottom: 10 }}><Notice tone="error">{error}</Notice></div>}
            <PrimaryButton disabled={!canSave} onClick={save}>
              {busy ? t('auth.saving') : t('auth.save')}
            </PrimaryButton>
            <button onClick={onClose} style={{ background: 'none', border: 'none', color: C.muted, fontWeight: 700, fontSize: 12.5, cursor: 'pointer', width: '100%', marginTop: 10 }}>
              {t('common.back')}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

const field: React.CSSProperties = {
  width: '100%', border: `1.5px solid ${C.pinkLine}`, borderRadius: 14, padding: '12px 15px',
  fontWeight: 600, fontSize: 13.5, background: '#fff', color: C.ink, outline: 'none', marginBottom: 12,
};
const label: React.CSSProperties = {
  fontSize: 11, fontWeight: 700, color: C.muted, marginBottom: 5,
};
