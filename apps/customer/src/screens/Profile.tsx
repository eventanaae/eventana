import { useEffect, useState } from 'react';
import { api } from '../api';
import type { Screen } from '../App';
import { C, fredoka, Spinner } from '../ui';
import { loadProfile } from '../profile';
import { loadAccount, clearAccount } from '../account';
import { LangToggle } from '../LangToggle';
import { AuthSheet } from './AuthSheet';
import { EditProfileSheet } from './EditProfileSheet';
import type { Lang, TFn } from '../i18n';

export function Profile({
  go,
  onRebook,
  onOpenEvent,
  t,
  lang,
  setLang,
}: {
  go: (s: Screen) => void;
  onRebook: (eventId: string) => Promise<void>;
  onOpenEvent: (eventId: string) => void;
  t: TFn;
  lang: Lang;
  setLang: (l: Lang) => void;
}) {
  const [events, setEvents] = useState<any[] | null>(null);
  const [rebooking, setRebooking] = useState<string | null>(null);
  const [rewards, setRewards] = useState<Awaited<ReturnType<typeof api.rewards>> | null>(null);
  const [copied, setCopied] = useState(false);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const [showAuth, setShowAuth] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const dateFmt = (iso: string | null) =>
    iso ? new Date(iso).toLocaleDateString(lang === 'ar' ? 'ar-AE' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
  const account = loadAccount();
  const profile = loadProfile();
  const name = account?.name?.trim() || profile?.name?.trim() || t('profile.guest');
  const initial = (name[0] || '☺').toUpperCase();
  const subline = profile?.birthday
    ? `🎂 ${new Date(profile.birthday).toLocaleDateString(lang === 'ar' ? 'ar-AE' : 'en-GB', { day: 'numeric', month: 'long' })}`
    : t('profile.completeProfile');

  useEffect(() => {
    api.events().then(setEvents).catch(() => setEvents([]));
    api.rewards().then(setRewards).catch(() => setRewards(null));
  }, []);

  return (
    <div style={{ padding: '8px 22px 30px', animation: 'rise .35s ease' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 15, marginBottom: 22 }}>
        <div
          style={{
            width: 58, height: 58, borderRadius: '50%', background: C.pink, color: '#fff',
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 21,
          }}
        >
          {initial}
        </div>
        <div style={{ flex: 1 }}>
          <div style={fredoka(20)}>{name}</div>
          <div style={{ fontSize: 12, fontWeight: 600, color: C.muted }}>{subline}</div>
        </div>
        <LangToggle lang={lang} setLang={setLang} />
      </div>

      {!account ? (
        <button
          onClick={() => setShowAuth(true)}
          style={{ width: '100%', background: C.pink, color: '#fff', border: 'none', fontWeight: 800, fontSize: 14, padding: '13px', borderRadius: 16, cursor: 'pointer', marginBottom: 16 }}
        >
          {t('auth.login')}
        </button>
      ) : (
        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          <button
            onClick={() => setShowEdit(true)}
            style={{ flex: 1, background: C.pinkSoft, color: C.pinkDeep, border: 'none', fontWeight: 700, fontSize: 12.5, padding: '12px', borderRadius: 14, cursor: 'pointer' }}
          >
            {t('auth.editProfile')}
          </button>
          <button
            onClick={() => { clearAccount(); window.location.reload(); }}
            style={{ flex: 1, background: '#fff', color: C.muted, border: `1px solid ${C.pinkLine}`, fontWeight: 700, fontSize: 12.5, padding: '12px', borderRadius: 14, cursor: 'pointer' }}
          >
            {t('auth.logout')}
          </button>
        </div>
      )}

      <div
        onClick={() => { if (rewards && rewards.history.length > 0) setShowHistory(true); }}
        style={{ background: 'linear-gradient(135deg,#5BCFC5,#3aa79d)', borderRadius: 24, padding: '20px 22px', color: '#fff', marginBottom: 16, cursor: rewards && rewards.history.length > 0 ? 'pointer' : 'default' }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <span style={fredoka(17)}>{t('profile.rewards')}</span>
          <span style={{ background: 'rgba(255,255,255,.25)', fontSize: 10, fontWeight: 700, padding: '4px 10px', borderRadius: 12, letterSpacing: '.4px' }}>
            {rewards?.tier ?? '—'}
          </span>
        </div>
        <div style={{ fontSize: 32, fontWeight: 700, margin: '12px 0 2px' }}>
          {rewards ? rewards.points.toLocaleString('en-US') : '—'}{' '}
          <span style={{ fontSize: 13, fontWeight: 600, opacity: 0.85 }}>{t('profile.points')}</span>
        </div>
        <div style={{ fontSize: 11.5, fontWeight: 600, opacity: 0.9 }}>
          {!rewards
            ? t('profile.loadingRewards')
            : rewards.nextTier
              ? `${rewards.pointsToNextTier.toLocaleString('en-US')} ${t('profile.points')} → ${rewards.nextTier}`
              : t('profile.topTier')}
        </div>
        {rewards && rewards.nextTier && (
          <div style={{ height: 6, background: 'rgba(255,255,255,.25)', borderRadius: 3, marginTop: 10, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${rewards.progressPct}%`, background: C.yellow, borderRadius: 3, transition: 'width .5s' }} />
          </div>
        )}
        <div style={{ fontSize: 10.5, fontWeight: 600, opacity: 0.85, marginTop: 10 }}>
          {t('profile.pointsToward')}
        </div>
        {rewards && rewards.history.length > 0 && (
          <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid rgba(255,255,255,.22)', fontSize: 11.5, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span>{t('profile.viewHistory')}</span>
            <span style={{ fontSize: 14 }}>{lang === 'ar' ? '‹' : '›'}</span>
          </div>
        )}
      </div>

      {rewards?.referralCode && (
        <div style={{ background: 'linear-gradient(135deg,#FDE0EE,#F9C6DC)', borderRadius: 20, padding: '16px 18px', marginBottom: 16 }}>
          <div style={{ fontWeight: 800, fontSize: 14 }}>{t('profile.referTitle')}</div>
          <div style={{ fontSize: 11.5, fontWeight: 600, color: '#8b5d74', margin: '5px 0 12px', lineHeight: 1.5 }}>
            {t('profile.referSub')}
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <div style={{ flex: 1, background: '#fff', borderRadius: 12, padding: '11px 14px', fontWeight: 800, fontSize: 16, letterSpacing: '2px', color: C.pinkDeep, textAlign: 'center' }}>
              {rewards.referralCode}
            </div>
            <button
              onClick={async () => {
                const msg = `${t('profile.referSub')} ${rewards.referralCode}`;
                try {
                  if (navigator.share) await navigator.share({ text: msg });
                  else { await navigator.clipboard.writeText(rewards.referralCode!); setCopied(true); setTimeout(() => setCopied(false), 1500); }
                } catch { /* dismissed */ }
              }}
              style={{ border: 'none', background: C.pink, color: '#fff', fontWeight: 700, fontSize: 12.5, padding: '11px 16px', borderRadius: 12, cursor: 'pointer', whiteSpace: 'nowrap' }}
            >
              {copied ? t('profile.copied') : t('profile.share')}
            </button>
          </div>
          {rewards.creditFils > 0 && (
            <div style={{ marginTop: 10, fontSize: 12, fontWeight: 700, color: C.green }}>
              {t('profile.credit')}: AED {(rewards.creditFils / 100).toLocaleString('en-US')}
            </div>
          )}
        </div>
      )}

      {rewards?.vouchers && rewards.vouchers.length > 0 && (
        <div style={{ background: 'linear-gradient(135deg,#FFEFD4,#FFDCEA)', borderRadius: 20, padding: '16px 18px', marginBottom: 16 }}>
          <div style={{ fontWeight: 800, fontSize: 14 }}>🎁 {t('profile.voucherTitle')}</div>
          {rewards.vouchers.map((v) => (
            <div key={v.code} style={{ marginTop: 10 }}>
              <div style={{ fontSize: 11.5, fontWeight: 600, color: '#9a6a4c', marginBottom: 6, lineHeight: 1.5 }}>
                {t('profile.voucherSub', { amount: String(Math.round(v.amountFils / 100)), min: String(Math.round(v.minSpendFils / 100)) })}
                {v.expiresAt
                  ? ` · ${t('profile.voucherExpiry', { date: new Date(v.expiresAt).toLocaleDateString(lang === 'ar' ? 'ar-AE' : 'en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) })}`
                  : ''}
              </div>
              <button
                onClick={async () => {
                  try { await navigator.clipboard.writeText(v.code); setCopiedCode(v.code); setTimeout(() => setCopiedCode(null), 1500); } catch { /* ignore */ }
                }}
                style={{ width: '100%', background: '#fff', border: `1.5px dashed ${C.pink}`, borderRadius: 12, padding: '11px 14px', fontWeight: 800, fontSize: 15, letterSpacing: '1.5px', color: C.pinkDeep, cursor: 'pointer', textAlign: 'center' }}
              >
                {copiedCode === v.code ? t('profile.copied') : `${v.code}  ⧉`}
              </button>
            </div>
          ))}
        </div>
      )}

      {rewards && rewards.history.length > 0 && (
        <div style={{ background: '#fff', borderRadius: 20, padding: '15px 18px', boxShadow: C.shadow, marginBottom: 16 }}>
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 10 }}>{t('profile.activity')}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {rewards.history.slice(0, 5).map((h, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 11.5, fontWeight: 600, color: C.muted }}>{h.reason}</span>
                <span style={{ fontWeight: 700, fontSize: 12.5, color: h.points < 0 ? C.red : C.green, whiteSpace: 'nowrap' }}>
                  {h.points < 0 ? '' : '+'}{h.points.toLocaleString('en-US')}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 10 }}>{t('profile.myEvents')}</div>
      {events === null ? (
        <Spinner />
      ) : events.length === 0 ? (
        <div style={{ fontSize: 12, fontWeight: 600, color: C.muted, lineHeight: 1.6 }}>
          {t('profile.noBookings')}{' '}
          <a onClick={() => go('explore')} style={{ cursor: 'pointer' }}>
            {t('profile.exploreToStart')}
          </a>{' '}
          {t('profile.toGetStarted')}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {events.map((e) => (
            <div
              key={e.id}
              onClick={() => onOpenEvent(e.id)}
              style={{
                background: '#fff', borderRadius: 18, padding: '13px 16px', boxShadow: C.shadow,
                display: 'flex', alignItems: 'center', gap: 13, cursor: 'pointer',
              }}
            >
              <div style={{ width: 44, height: 44, borderRadius: 14, background: 'linear-gradient(135deg,#F9C6DC,#F7C948)', flex: 'none' }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 12.5 }}>{e.packageName ?? 'Celebration'}</div>
                <div style={{ fontSize: 11, fontWeight: 600, color: C.muted }}>
                  {new Date(e.date).toLocaleDateString(lang === 'ar' ? 'ar-AE' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric' })} · {e.emirate} · {t('common.aed')} {e.totalDisplay}
                </div>
              </div>
              <button
                disabled={rebooking === e.id}
                onClick={async (ev) => {
                  ev.stopPropagation();
                  setRebooking(e.id);
                  try { await onRebook(e.id); } catch { setRebooking(null); }
                }}
                style={{
                  background: C.pinkSoft, border: 'none', color: C.pinkDeep, fontWeight: 700,
                  fontSize: 10.5, padding: '8px 11px', borderRadius: 12, cursor: 'pointer', whiteSpace: 'nowrap',
                  opacity: rebooking === e.id ? 0.6 : 1,
                }}
              >
                {rebooking === e.id ? t('profile.opening') : t('profile.bookAgain')}
              </button>
            </div>
          ))}
        </div>
      )}

      <div style={{ marginTop: 20, textAlign: 'center', fontSize: 11, fontWeight: 600, color: C.faint }}>
        @eventana.uae · +971 56 450 0777
      </div>

      {showAuth && (
        <AuthSheet
          t={t}
          lang={lang}
          onClose={() => setShowAuth(false)}
          onSignedIn={() => window.location.reload()}
        />
      )}
      {showEdit && (
        <EditProfileSheet
          t={t}
          lang={lang}
          onClose={() => setShowEdit(false)}
          onSaved={() => window.location.reload()}
        />
      )}

      {showHistory && rewards && (
        <div
          onClick={() => setShowHistory(false)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(60,40,52,.5)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 70 }}
          dir={lang === 'ar' ? 'rtl' : 'ltr'}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ background: '#fff', borderRadius: '22px 22px 0 0', width: '100%', maxWidth: 480, maxHeight: '78vh', display: 'flex', flexDirection: 'column', animation: 'rise .3s ease' }}
          >
            <div style={{ padding: '18px 22px 10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={fredoka(18)}>{t('profile.historyTitle')}</span>
              <button onClick={() => setShowHistory(false)} style={{ border: 'none', background: C.cream, borderRadius: '50%', width: 30, height: 30, fontSize: 15, cursor: 'pointer', color: C.muted }}>✕</button>
            </div>
            <div className="scroll" style={{ overflowY: 'auto', padding: '4px 22px 26px' }}>
              {rewards.history.map((h, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, padding: '11px 0', borderBottom: i < rewards.history.length - 1 ? `1px solid ${C.pinkLine}` : 'none' }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: C.ink }}>{h.reason}</div>
                    <div style={{ fontSize: 11, fontWeight: 600, color: C.muted, marginTop: 2 }}>{dateFmt(h.at)}</div>
                  </div>
                  <div style={{ fontWeight: 800, fontSize: 14, color: h.points < 0 ? C.red : C.green, whiteSpace: 'nowrap' }}>
                    {h.points < 0 ? '−' : '+'}{Math.abs(h.points).toLocaleString('en-US')} {t('profile.points')}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
