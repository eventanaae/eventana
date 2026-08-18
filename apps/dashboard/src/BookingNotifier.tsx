import { useEffect, useRef, useState } from 'react';
import { api } from './api';
import { C, fredoka } from './ui';

/** A short, pleasant two-note chime via WebAudio — no asset to ship. */
function playChime() {
  try {
    const Ctx = window.AudioContext || (window as any).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const now = ctx.currentTime;
    [880, 1174.66].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      const t = now + i * 0.16;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.25, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.42);
    });
    setTimeout(() => ctx.close(), 1200);
  } catch {
    /* audio blocked — the visual toast still shows */
  }
}

/**
 * Polls for the newest booking and, when a new one lands, plays a chime and
 * shows a toast. Mounted once at the app root. Sound needs one user gesture
 * to unlock (browser policy); a hidden primer arms it on first click.
 */
export function BookingNotifier({ enabled }: { enabled: boolean }) {
  const [toast, setToast] = useState<any>(null);
  const lastId = useRef<string | null>(null);
  const primed = useRef(false);

  useEffect(() => {
    const prime = () => { primed.current = true; window.removeEventListener('pointerdown', prime); };
    window.addEventListener('pointerdown', prime);
    return () => window.removeEventListener('pointerdown', prime);
  }, []);

  useEffect(() => {
    if (!enabled) return;
    let stop = false;
    const poll = async () => {
      try {
        const b = await api.latestBooking();
        if (b && !stop) {
          if (lastId.current === null) {
            lastId.current = b.id; // first load — arm, don't alert
          } else if (b.id !== lastId.current) {
            lastId.current = b.id;
            setToast(b);
            if (primed.current) playChime();
            setTimeout(() => setToast((t: any) => (t?.id === b.id ? null : t)), 12_000);
          }
        }
      } catch {
        /* ignore — drivers/offline */
      }
    };
    poll();
    const timer = setInterval(poll, 20_000);
    return () => { stop = true; clearInterval(timer); };
  }, [enabled]);

  if (!toast) return null;

  return (
    <div
      onClick={() => setToast(null)}
      style={{
        position: 'fixed', top: 18, right: 18, zIndex: 50, cursor: 'pointer',
        background: '#fff', borderRadius: 16, boxShadow: '0 10px 40px rgba(59,54,65,.22)',
        border: `1px solid ${C.line}`, padding: '14px 18px', maxWidth: 340,
        display: 'flex', gap: 12, alignItems: 'center', animation: 'rise .3s ease',
      }}
    >
      <span style={{ fontSize: 26 }}>🎉</span>
      <div style={{ minWidth: 0 }}>
        <div style={{ ...fredoka(15) }}>New booking!</div>
        <div style={{ fontSize: 12, fontWeight: 600, color: C.muted, marginTop: 2 }}>
          {toast.customer} · {toast.package_name ?? toast.celebration_type} · {toast.emirate}
        </div>
        <div style={{ fontSize: 10.5, fontWeight: 700, color: C.pinkDeep, marginTop: 2 }}>
          {toast.id} · {new Date(toast.event_date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}
        </div>
      </div>
    </div>
  );
}
