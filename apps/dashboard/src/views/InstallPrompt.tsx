import { useEffect, useState } from 'react';
import { C, fredoka } from '../ui';

/**
 * A gentle "install this as an app" banner, shown only to people who are viewing
 * the dashboard in the browser (not already installed). Android/Chrome fires
 * `beforeinstallprompt`, so we show a one-tap Install button; iOS Safari has no
 * such event, so we show the Share → Add to Home Screen steps. Dismissible, and
 * it stays hidden for two weeks after a dismiss (per-device, localStorage).
 */
const DISMISS_KEY = 'ev_install_dismissed';
const HIDE_MS = 14 * 24 * 3600 * 1000;

function isStandalone(): boolean {
  try {
    return window.matchMedia('(display-mode: standalone)').matches || (navigator as any).standalone === true;
  } catch { return false; }
}

export function InstallPrompt() {
  const [deferred, setDeferred] = useState<any>(null);
  const [show, setShow] = useState(false);
  const [iosSteps, setIosSteps] = useState(false);

  useEffect(() => {
    if (isStandalone()) return; // already installed — nothing to offer
    let dismissed = 0;
    try { dismissed = Number(localStorage.getItem(DISMISS_KEY) || 0); } catch { /* ignore */ }
    if (dismissed && Date.now() - dismissed < HIDE_MS) return;

    const ua = navigator.userAgent || '';
    const isIOS = /iPad|iPhone|iPod/.test(ua) || (ua.includes('Mac') && 'ontouchend' in document);
    if (isIOS) { setShow(true); return; }

    const onBip = (e: any) => { e.preventDefault(); setDeferred(e); setShow(true); };
    window.addEventListener('beforeinstallprompt', onBip);
    return () => window.removeEventListener('beforeinstallprompt', onBip);
  }, []);

  if (!show) return null;

  const dismiss = () => {
    try { localStorage.setItem(DISMISS_KEY, String(Date.now())); } catch { /* ignore */ }
    setShow(false);
  };
  const install = async () => {
    if (!deferred) return;
    try { deferred.prompt(); await deferred.userChoice; } catch { /* ignore */ }
    setDeferred(null);
    dismiss();
  };
  const isIOS = !deferred;

  return (
    <div style={{ background: '#fff', border: `1px solid ${C.line}`, borderRadius: 18, boxShadow: C.shadow, overflow: 'hidden', marginBottom: 14 }}>
      <div style={{ height: 5, background: C.rainbow }} />
      <div style={{ padding: '13px 15px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <img src="/icons/icon-192.png" alt="Eventana Ops" width={44} height={44} style={{ borderRadius: 12, flex: 'none', border: `1px solid ${C.line}` }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ ...fredoka(15) }}>Install Eventana Ops</div>
            <div style={{ fontSize: 12, fontWeight: 600, color: C.muted, lineHeight: 1.4 }}>
              Add it to your home screen — opens full-screen like an app.
            </div>
          </div>
          <button onClick={dismiss} aria-label="Dismiss" style={{ flex: 'none', border: 'none', background: 'transparent', color: C.muted, fontSize: 18, fontWeight: 800, cursor: 'pointer', lineHeight: 1, padding: 4 }}>✕</button>
        </div>

        {isIOS ? (
          <div style={{ marginTop: 11 }}>
            <button
              onClick={() => setIosSteps((s) => !s)}
              className="press"
              style={{ width: '100%', border: 'none', borderRadius: 12, padding: '10px', fontWeight: 800, fontSize: 13, cursor: 'pointer', background: C.gradPink, color: '#fff' }}
            >
              {iosSteps ? 'Hide steps' : 'How to install'}
            </button>
            {iosSteps && (
              <ol style={{ margin: '11px 0 2px', paddingInlineStart: 20, fontSize: 12.5, fontWeight: 600, color: C.ink, lineHeight: 1.7 }}>
                <li>Tap the <b>Share</b> button <span style={{ color: C.pinkDeep }}>⬆️</span> at the bottom of Safari.</li>
                <li>Choose <b>“Add to Home Screen”</b>.</li>
                <li>Tap <b>Add</b> — the Eventana Ops icon appears on your home screen.</li>
              </ol>
            )}
          </div>
        ) : (
          <button
            onClick={install}
            className="press"
            style={{ marginTop: 11, width: '100%', border: 'none', borderRadius: 12, padding: '11px', fontWeight: 800, fontSize: 13.5, cursor: 'pointer', background: C.gradPink, color: '#fff' }}
          >
            Install app
          </button>
        )}
      </div>
    </div>
  );
}
