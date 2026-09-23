import { useEffect, useState } from 'react';
import { api } from '../api';
import { C, fredoka } from '../ui';

/**
 * "Turn on notifications" — asks the staff member to allow browser/PWA push, then
 * subscribes this device and sends a test so they see it works. Web Push shows on
 * the phone screen (with the system sound) even when the app is closed.
 *
 * Shown only when it can actually work: the browser supports push, permission is
 * still "default" (not yet decided), and — on iPhone — only once the app is
 * installed to the Home Screen (iOS only allows push for installed PWAs).
 */
const DISMISS_KEY = 'ev_push_dismissed';
const HIDE_MS = 14 * 24 * 3600 * 1000;

function isStandalone(): boolean {
  try { return window.matchMedia('(display-mode: standalone)').matches || (navigator as any).standalone === true; } catch { return false; }
}
function urlB64ToUint8(base64: string): Uint8Array {
  const pad = '='.repeat((4 - (base64.length % 4)) % 4);
  const b = (base64 + pad).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export function NotificationsPrompt() {
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
    if (!supported) return;
    if (Notification.permission !== 'default') return; // already granted or denied
    let dismissed = 0;
    try { dismissed = Number(localStorage.getItem(DISMISS_KEY) || 0); } catch { /* ignore */ }
    if (dismissed && Date.now() - dismissed < HIDE_MS) return;
    const ua = navigator.userAgent || '';
    const isIOS = /iPad|iPhone|iPod/.test(ua) || (ua.includes('Mac') && 'ontouchend' in document);
    // On iPhone push only works once installed to the Home Screen.
    if (isIOS && !isStandalone()) return;
    setShow(true);
  }, []);

  const dismiss = () => {
    try { localStorage.setItem(DISMISS_KEY, String(Date.now())); } catch { /* ignore */ }
    setShow(false);
  };

  const enable = async () => {
    setBusy(true); setErr(null);
    try {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') { setErr('Notifications are blocked. You can enable them in your browser settings.'); setBusy(false); return; }
      const { key, enabled } = await api.pushVapidKey();
      if (!enabled || !key) { setErr('Notifications aren’t set up on the server yet.'); setBusy(false); return; }
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToUint8(key) as any });
      await api.pushSubscribe((sub as any).toJSON());
      await api.pushTest().catch(() => {});
      try { localStorage.setItem('ev_push_on', '1'); } catch { /* ignore */ }
      setDone(true);
      setTimeout(() => setShow(false), 3500);
    } catch {
      setErr('Couldn’t turn on notifications. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  if (!show) return null;

  return (
    <div style={{ background: '#fff', border: `1px solid ${C.line}`, borderRadius: 18, boxShadow: C.shadow, overflow: 'hidden', marginBottom: 14 }}>
      <div style={{ height: 5, background: `linear-gradient(90deg,${C.pinkDeep},${C.pink})` }} />
      <div style={{ padding: '13px 15px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 44, height: 44, borderRadius: 12, background: C.pinkSoft, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, flex: 'none' }}>🔔</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ ...fredoka(15) }}>{done ? 'Notifications are on 🎉' : 'Turn on notifications'}</div>
            <div style={{ fontSize: 12, fontWeight: 600, color: C.muted, lineHeight: 1.4 }}>
              {done ? 'You’ll get alerts on your phone — even when the app is closed.' : 'Get new bookings, tasks and alerts on your phone, with sound.'}
            </div>
          </div>
          {!done && <button onClick={dismiss} aria-label="Dismiss" style={{ flex: 'none', border: 'none', background: 'transparent', color: C.muted, fontSize: 18, fontWeight: 800, cursor: 'pointer', lineHeight: 1, padding: 4 }}>✕</button>}
        </div>
        {err && <div style={{ marginTop: 9, fontSize: 12, fontWeight: 600, color: C.red, lineHeight: 1.4 }}>{err}</div>}
        {!done && (
          <button
            onClick={enable}
            disabled={busy}
            className={busy ? undefined : 'press'}
            style={{ marginTop: 11, width: '100%', border: 'none', borderRadius: 12, padding: '11px', fontWeight: 800, fontSize: 13.5, cursor: busy ? 'default' : 'pointer', background: C.gradPink, color: '#fff', opacity: busy ? 0.6 : 1 }}
          >
            {busy ? 'Turning on…' : 'Enable notifications'}
          </button>
        )}
      </div>
    </div>
  );
}
