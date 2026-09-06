import { useEffect, useState } from 'react';
import { api } from '../api';
import { C, Card, Notice, Spinner, money } from '../ui';
import type { Lang, TFn } from '../i18n';

// Managed "Eventana Events" listing (Al Barsha, Dubai — CID 0x53cd0c2fb8998790).
// Replaces the old duplicate-listing link so reviews land on the real profile.
const GOOGLE_REVIEW_URL = 'https://g.page/r/CZCHmbgvDM1TEBE/review';
const TIP_PRESETS = [5000, 10000, 15000];

/**
 * Guest feedback — opened from the feedback link (?event=&fb=&rate=1). No account
 * needed: the signed token authorises rating exactly this one event. A three-step
 * pop-up:
 *   1. Stars                         → Next
 *   2. Tip the crew (optional)       → Next
 *   3. 4–5★ → straight to Google (no "why"); 1–3★ → say why, then Submit.
 * The star rating is saved to our dashboard in BOTH paths, so a Google-bound
 * review still reflects there (the review TEXT itself lives on Google).
 */
export function GuestFeedback({
  event,
  token,
  t,
  lang,
}: {
  event: string;
  token: string;
  t: TFn;
  lang: Lang;
}) {
  const [loading, setLoading] = useState(true);
  const [invalid, setInvalid] = useState(false);
  const [honour, setHonour] = useState<string | null>(null);

  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [stars, setStars] = useState(0);
  const [feedback, setFeedback] = useState('');
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  const [amountFils, setAmountFils] = useState<number>(TIP_PRESETS[1]);
  const [customAed, setCustomAed] = useState('');
  const [tipping, setTipping] = useState(false);
  const [tipError, setTipError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api
      .guestFeedbackInfo(event, token)
      .then((info) => {
        if (!alive) return;
        setHonour(info.honour);
        if (info.rating) {
          // Already rated — jump to the final step and reflect their score.
          setStars(info.rating.stars);
          setFeedback(info.rating.feedback ?? '');
          setSaved(true);
          setStep(3);
        }
        setLoading(false);
      })
      .catch(() => {
        if (!alive) return;
        setInvalid(true);
        setLoading(false);
      });
    return () => { alive = false; };
  }, [event, token]);

  const isHappy = stars >= 4; // 4–5★ → Google. 1–3★ → say why (internal only).

  /** Persist the rating (idempotent server-side). For a happy score no reason is
   *  needed; for 1–3★ the reason is required and passed in. */
  const saveRating = async (reason?: string): Promise<boolean> => {
    setSaving(true);
    try {
      await api.submitGuestFeedback(event, token, stars, reason?.trim() || undefined);
      setSaved(true);
      return true;
    } catch {
      setInvalid(true);
      return false;
    } finally {
      setSaving(false);
    }
  };

  // Step 1 → 2. A happy rating is saved right away, so the dashboard reflects it
  // even if they head off to Google without finishing.
  const fromStars = async () => {
    if (stars < 1) return;
    if (isHappy) await saveRating();
    setStep(2);
  };

  const effectiveTip = customAed ? Math.round(Number(customAed) * 100) : amountFils;
  const sendTip = async () => {
    if (!Number.isFinite(effectiveTip) || effectiveTip < 500) { setTipError(t('me.tipMin')); return; }
    setTipping(true);
    setTipError(null);
    try {
      const res = await api.tipCheckout(event, effectiveTip, null, token);
      if (res.checkoutUrl) window.location.href = res.checkoutUrl;
      else setTipError(t('me.errCheckout'));
    } catch (e: any) {
      setTipError(e?.body?.message ?? e?.message ?? t('me.errTip'));
    } finally {
      setTipping(false);
    }
  };

  const submitWhy = async () => {
    if (stars < 1 || !feedback.trim()) return;
    await saveRating(feedback);
  };

  const dir = lang === 'ar' ? 'rtl' : 'ltr';
  const Dot = ({ on }: { on: boolean }) => (
    <span style={{ width: 8, height: 8, borderRadius: '50%', background: on ? C.pink : C.pinkLine, display: 'inline-block' }} />
  );

  return (
    <div dir={dir} style={{ minHeight: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px 16px', boxSizing: 'border-box' }}>
      <div style={{ width: '100%', maxWidth: 420 }}>
        <div style={{ textAlign: 'center', marginBottom: 16 }}>
          <div style={{ fontSize: 28, fontWeight: 800, color: C.pink, letterSpacing: 0.3 }}>Eventana</div>
        </div>

        {loading ? (
          <Card><Spinner label={t('me.gfLoading')} /></Card>
        ) : invalid ? (
          <Card><Notice tone="warn">{t('me.gfInvalid')}</Notice></Card>
        ) : (
          <Card>
            {/* step dots */}
            <div style={{ display: 'flex', gap: 6, justifyContent: 'center', marginBottom: 14 }}>
              <Dot on={step >= 1} /><Dot on={step >= 2} /><Dot on={step >= 3} />
            </div>

            {/* ── Step 1: stars ── */}
            {step === 1 && (
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontWeight: 800, fontSize: 18 }}>{t('me.gfHi')}</div>
                <div style={{ fontSize: 14, fontWeight: 700, color: C.ink, margin: '6px 0 4px' }}>
                  {honour ? t('me.gfHonour', { name: honour }) : t('me.rateTitle')}
                </div>
                <div style={{ fontSize: 11.5, fontWeight: 600, color: C.muted, marginBottom: 16 }}>{t('me.rateSub')}</div>
                <div style={{ display: 'flex', gap: 8, marginBottom: 20, justifyContent: 'center' }}>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <button
                      key={n}
                      onClick={() => setStars(n)}
                      aria-label={`${n}`}
                      style={{ border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 40, lineHeight: 1, padding: 0, filter: n <= stars ? 'none' : 'grayscale(1) opacity(0.35)', transition: 'filter .15s' }}
                    >⭐</button>
                  ))}
                </div>
                <button
                  onClick={fromStars}
                  disabled={stars < 1 || saving}
                  style={{ width: '100%', background: stars < 1 ? '#e6dcd6' : C.pink, color: '#fff', border: 'none', fontWeight: 700, fontSize: 14, padding: '13px 0', borderRadius: 16, cursor: stars < 1 ? 'not-allowed' : 'pointer' }}
                >{saving ? t('me.rateSaving') : t('common.next')}</button>
              </div>
            )}

            {/* ── Step 2: tip ── */}
            {step === 2 && (
              <div>
                <div style={{ fontWeight: 800, fontSize: 16, textAlign: 'center' }}>{t('me.tipTitle')}</div>
                <div style={{ fontSize: 11.5, fontWeight: 600, color: C.muted, textAlign: 'center', margin: '6px 0 14px', lineHeight: 1.6 }}>{t('me.tipSub')}</div>
                <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                  {TIP_PRESETS.map((a) => (
                    <button
                      key={a}
                      onClick={() => { setAmountFils(a); setCustomAed(''); }}
                      style={{ flex: 1, border: `1.5px solid ${!customAed && amountFils === a ? C.pink : C.pinkLine}`, background: !customAed && amountFils === a ? C.pinkSoft : '#fff', color: C.pinkDeep, fontWeight: 800, fontSize: 14, padding: '11px 0', borderRadius: 14, cursor: 'pointer' }}
                    >{t('common.aed')} {money(a)}</button>
                  ))}
                </div>
                <input
                  inputMode="decimal"
                  placeholder={t('me.tipCustom')}
                  value={customAed}
                  onChange={(e) => setCustomAed(e.target.value.replace(/[^0-9.]/g, ''))}
                  style={{ width: '100%', boxSizing: 'border-box', border: `1px solid ${customAed ? C.pink : C.pinkLine}`, borderRadius: 14, padding: '11px 14px', fontWeight: 700, fontSize: 13, background: C.cream, color: C.ink, outline: 'none', marginBottom: 10 }}
                />
                {tipError && <Notice tone="warn">{tipError}</Notice>}
                <button
                  onClick={sendTip}
                  disabled={tipping}
                  style={{ width: '100%', background: C.pink, color: '#fff', border: 'none', fontWeight: 700, fontSize: 14, padding: '13px 0', borderRadius: 16, cursor: 'pointer', marginTop: 4 }}
                >{tipping ? t('me.rateSaving') : t('me.tipGive', { aed: `${t('common.aed')} ${money(effectiveTip)}` })}</button>
                <button
                  onClick={() => setStep(3)}
                  style={{ width: '100%', background: 'none', border: 'none', color: C.muted, fontWeight: 700, fontSize: 13, padding: '12px 0 0', cursor: 'pointer' }}
                >{t('me.tipSkip')} ›</button>
              </div>
            )}

            {/* ── Step 3: Google (happy) or why (unhappy) ── */}
            {step === 3 && (
              <div style={{ textAlign: 'center' }}>
                {isHappy ? (
                  <>
                    <div style={{ fontSize: 30, marginBottom: 6 }}>🌸</div>
                    <div style={{ fontWeight: 800, fontSize: 17, marginBottom: 4 }}>{t('me.gfDone')}</div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: C.muted, marginBottom: 16, lineHeight: 1.6 }}>{t('me.gfGoogleAsk')}</div>
                    <a
                      href={GOOGLE_REVIEW_URL}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ display: 'block', textAlign: 'center', textDecoration: 'none', width: '100%', boxSizing: 'border-box', background: C.pink, color: '#fff', fontWeight: 700, fontSize: 14, padding: '14px 0', borderRadius: 16 }}
                    >⭐ {t('me.rateGoogle')}</a>
                  </>
                ) : saved ? (
                  <>
                    <div style={{ fontSize: 30, marginBottom: 6 }}>💛</div>
                    <div style={{ fontWeight: 800, fontSize: 17 }}>{t('me.gfThanksInternal')}</div>
                  </>
                ) : (
                  <div style={{ textAlign: dir === 'rtl' ? 'right' : 'left' }}>
                    <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 4, textAlign: 'center' }}>{t('me.gfWhyTitle')}</div>
                    <div style={{ fontSize: 11.5, fontWeight: 700, color: C.pink, marginBottom: 8, textAlign: 'center' }}>{t('me.rateWhyRequired')}</div>
                    <textarea
                      placeholder={t('me.rateFeedbackReqPh')}
                      rows={4}
                      value={feedback}
                      onChange={(e) => setFeedback(e.target.value)}
                      style={{ width: '100%', boxSizing: 'border-box', border: `1px solid ${!feedback.trim() ? C.pink : C.pinkLine}`, borderRadius: 14, padding: '12px 14px', fontWeight: 600, fontSize: 12.5, background: C.cream, color: C.ink, outline: 'none', resize: 'none', marginBottom: 12 }}
                    />
                    <button
                      onClick={submitWhy}
                      disabled={!feedback.trim() || saving}
                      style={{ width: '100%', background: !feedback.trim() ? '#e6dcd6' : C.pink, color: '#fff', border: 'none', fontWeight: 700, fontSize: 14, padding: '13px 0', borderRadius: 16, cursor: !feedback.trim() ? 'not-allowed' : 'pointer' }}
                    >{saving ? t('me.rateSaving') : t('me.rateSubmit')}</button>
                  </div>
                )}
              </div>
            )}
          </Card>
        )}
      </div>
    </div>
  );
}
