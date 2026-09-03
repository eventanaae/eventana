import { useEffect, useState } from 'react';
import { api } from '../api';
import { C, Card, Notice, Spinner } from '../ui';
import type { Lang, TFn } from '../i18n';

/**
 * Guest feedback screen — opened from the feedback link (?event=<id>&fb=<token>)
 * we send after a party. No account needed: the signed token authorises rating
 * exactly this one event, so a customer who booked without signing up can still
 * leave their feedback. Warm, friendly tone (most of our customers are Arabic).
 *
 * 4–5 stars → thank them + offer the Google review button.
 * 1–3 stars → they MUST say why; it stays internal (no Google link).
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

  const [stars, setStars] = useState(0);
  const [feedback, setFeedback] = useState('');
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    api
      .guestFeedbackInfo(event, token)
      .then((info) => {
        if (!alive) return;
        setHonour(info.honour);
        if (info.rating) {
          setStars(info.rating.stars);
          setFeedback(info.rating.feedback ?? '');
          setSaved(true);
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

  const submit = async () => {
    if (stars < 1) return;
    if (stars < 4 && !feedback.trim()) return; // 1–3 stars: must say why
    setSaving(true);
    try {
      await api.submitGuestFeedback(event, token, stars, feedback.trim() || undefined);
      setSaved(true);
    } catch {
      setInvalid(true);
    } finally {
      setSaving(false);
    }
  };

  const dir = lang === 'ar' ? 'rtl' : 'ltr';

  return (
    <div dir={dir} style={{ padding: '28px 18px', maxWidth: 460, margin: '0 auto', width: '100%', boxSizing: 'border-box' }}>
      {/* brand mark */}
      <div style={{ textAlign: 'center', marginBottom: 18 }}>
        <div style={{ fontSize: 30, fontWeight: 800, color: C.pink, letterSpacing: 0.3 }}>Eventana</div>
      </div>

      {loading ? (
        <Card><Spinner label={t('me.gfLoading')} /></Card>
      ) : invalid ? (
        <Card><Notice tone="warn">{t('me.gfInvalid')}</Notice></Card>
      ) : (
        <Card>
          <div style={{ fontWeight: 800, fontSize: 18 }}>{t('me.gfHi')}</div>
          <div style={{ fontSize: 13.5, fontWeight: 700, color: C.ink, margin: '6px 0 4px' }}>
            {honour ? t('me.gfHonour', { name: honour }) : t('me.rateTitle')}
          </div>
          <div style={{ fontSize: 11.5, fontWeight: 600, color: C.muted, marginBottom: 14 }}>
            {t('me.rateSub')}
          </div>

          {/* stars */}
          <div style={{ display: 'flex', gap: 7, marginBottom: 12, justifyContent: 'center' }}>
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                onClick={() => { setStars(n); setSaved(false); }}
                style={{
                  border: 'none', background: 'transparent', cursor: 'pointer',
                  fontSize: 36, lineHeight: 1, padding: 0,
                  filter: n <= stars ? 'none' : 'grayscale(1) opacity(0.35)',
                }}
                aria-label={`${n} star${n > 1 ? 's' : ''}`}
              >
                ⭐
              </button>
            ))}
          </div>

          {saved ? (
            <>
              <Notice tone="ok">{t('me.gfDone')}</Notice>
              {stars >= 4 && (
                <a
                  href="https://maps.google.com/?cid=6038496074473768848"
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    display: 'block', textAlign: 'center', textDecoration: 'none',
                    width: '100%', boxSizing: 'border-box', background: C.pink, color: '#fff',
                    fontWeight: 700, fontSize: 13, padding: '13px 0', borderRadius: 16, marginTop: 12,
                  }}
                >
                  ⭐ {t('me.rateGoogle')}
                </a>
              )}
            </>
          ) : (
            <>
              {stars >= 1 && stars < 4 && (
                <div style={{ fontSize: 11, fontWeight: 700, color: C.pink, marginBottom: 6 }}>{t('me.rateWhyRequired')}</div>
              )}
              <textarea
                placeholder={stars >= 1 && stars < 4 ? t('me.rateFeedbackReqPh') : t('me.rateFeedbackPh')}
                rows={3}
                value={feedback}
                onChange={(e) => setFeedback(e.target.value)}
                style={{
                  width: '100%', boxSizing: 'border-box',
                  border: `1px solid ${stars >= 1 && stars < 4 && !feedback.trim() ? C.pink : C.pinkLine}`,
                  borderRadius: 14, padding: '12px 14px', fontWeight: 600, fontSize: 12.5,
                  background: C.cream, color: C.ink, outline: 'none', resize: 'none', marginBottom: 12,
                }}
              />
              {(() => {
                const needWhy = stars >= 1 && stars < 4 && !feedback.trim();
                const blocked = stars < 1 || needWhy || saving;
                return (
                  <button
                    onClick={submit}
                    disabled={blocked}
                    style={{
                      width: '100%', background: blocked ? '#e6dcd6' : C.pink, color: '#fff', border: 'none',
                      fontWeight: 700, fontSize: 14, padding: '13px 0', borderRadius: 16,
                      cursor: blocked ? 'not-allowed' : 'pointer',
                    }}
                  >
                    {saving ? t('me.rateSaving') : t('me.rateSubmit')}
                  </button>
                );
              })()}
            </>
          )}
        </Card>
      )}
    </div>
  );
}
