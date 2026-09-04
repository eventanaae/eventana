import { useEffect, useRef, useState } from 'react';
import { C } from './ui';

type Pin = { lat: number; lng: number };

/** UAE centre (Dubai) — the initial view before the customer places a pin. */
const UAE_CENTER: Pin = { lat: 25.2048, lng: 55.2708 };

/** A bare "lat, lng" a customer might paste from a phone. Bounded to sane ranges. */
function parseLatLng(s: string): Pin | null {
  const m = s.trim().match(/^\s*(-?\d{1,2}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)\s*$/);
  if (!m) return null;
  const lat = parseFloat(m[1]);
  const lng = parseFloat(m[2]);
  if (Math.abs(lat) <= 90 && Math.abs(lng) <= 180) return { lat, lng };
  return null;
}

/** Pull coordinates out of a full (non-shortened) Google Maps link. */
function coordsFromMapsUrl(s: string): Pin | null {
  // .../@25.11,55.20,17z
  let m = s.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
  if (m) return { lat: parseFloat(m[1]), lng: parseFloat(m[2]) };
  // place data blob: !3d<lat>!4d<lng>
  m = s.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/);
  if (m) return { lat: parseFloat(m[1]), lng: parseFloat(m[2]) };
  // ?q=lat,lng  / query= / ll= / destination= / center=
  m = s.match(/[?&](?:q|query|ll|destination|center|daddr)=(-?\d+\.\d+),(-?\d+\.\d+)/);
  if (m) return { lat: parseFloat(m[1]), lng: parseFloat(m[2]) };
  return null;
}

/**
 * Google calls `window.gm_authFailure` when it rejects the key at runtime
 * (referrer restriction, billing, or a stripped Referer header on some mobile
 * browsers). When that happens Google paints its own grey "Oops!" box inside
 * the map div. We intercept it so the app can drop to the manual pin fallback
 * instead — the customer must never be stuck behind Google's error overlay.
 */
let authFailed = false;
const authListeners = new Set<() => void>();
function installAuthFailureHook() {
  const w = window as any;
  if (w.__eventanaAuthHook) return;
  w.__eventanaAuthHook = true;
  w.gm_authFailure = () => {
    authFailed = true;
    authListeners.forEach((fn) => fn());
  };
}

/**
 * Loads the Google Maps JS SDK exactly once per page. The browser key is
 * supplied at runtime (from the catalogue) so it never lives in the repo.
 */
let loaderPromise: Promise<any> | null = null;
function loadMaps(key: string): Promise<any> {
  const w = window as any;
  installAuthFailureHook();
  if (w.google?.maps) return Promise.resolve(w.google);
  if (loaderPromise) return loaderPromise;
  loaderPromise = new Promise((resolve, reject) => {
    if (!key) {
      reject(new Error('no-key'));
      return;
    }
    const cbName = '__eventanaMapsReady';
    w[cbName] = () => resolve(w.google);
    const s = document.createElement('script');
    s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&libraries=places&callback=${cbName}`;
    s.async = true;
    s.defer = true;
    // A failed load must not poison the singleton — clear it so a later mount
    // (or retry) can attempt the load again instead of reusing a rejection.
    s.onerror = () => { loaderPromise = null; reject(new Error('load-failed')); };
    document.head.appendChild(s);
  });
  return loaderPromise;
}

export function MapPicker({
  mapsKey,
  value,
  onChange,
  lang = 'ar',
}: {
  mapsKey: string | null;
  value: Pin | null;
  onChange: (pin: Pin, address?: string) => void;
  lang?: 'ar' | 'en';
}) {
  const ar = lang === 'ar';
  const boxRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const markerRef = useRef<any>(null);
  const geocoderRef = useRef<any>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  // The free-text resolver is built inside the map effect (it needs the live
  // map + geocoder + commit in scope); the search box calls it through this ref.
  const resolveRef = useRef<(raw: string) => void>();
  const [status, setStatus] = useState<'loading' | 'ready' | 'nokey' | 'error'>('loading');
  const [address, setAddress] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);
  const [searchBusy, setSearchBusy] = useState(false);
  const [searchErr, setSearchErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!mapsKey) {
      setStatus('nokey');
      return;
    }
    // If Google rejects the key at runtime (its grey "Oops!" overlay), fall
    // back to the manual pin so the customer can still finish booking.
    if (authFailed) { setStatus('error'); return; }
    const onAuthFail = () => { if (!cancelled) setStatus('error'); };
    authListeners.add(onAuthFail);
    loadMaps(mapsKey)
      .then((google) => {
        if (cancelled) return;
        // Build the map only AFTER the checkout card's entrance animation has
        // settled. On iOS Safari a map created inside a still-animating, clipped
        // ancestor paints a blank grey tile layer. A freshly downloaded SDK
        // outlasts the ~350ms animation on its own, but a cached SDK resolves
        // instantly — so wait explicitly, then repaint once tiles settle.
        window.setTimeout(() => {
          if (cancelled || authFailed || !boxRef.current) return;
          const start = value ?? UAE_CENTER;
          const map = new google.maps.Map(boxRef.current, {
            center: start,
            zoom: value ? 16 : 10,
            mapTypeControl: false,
            streetViewControl: false,
            fullscreenControl: false,
            clickableIcons: false,
            gestureHandling: 'greedy',
          });
          const marker = new google.maps.Marker({
            position: start,
            map,
            draggable: true,
            animation: value ? null : google.maps.Animation.DROP,
          });
          const geocoder = new google.maps.Geocoder();
          mapRef.current = map;
          markerRef.current = marker;
          geocoderRef.current = geocoder;

          const commit = (pin: Pin) => {
            marker.setPosition(pin);
            map.panTo(pin);
            geocoder.geocode({ location: pin }, (results: any[], gStatus: string) => {
              const label = gStatus === 'OK' && results?.[0] ? results[0].formatted_address : undefined;
              if (!cancelled) setAddress(label ?? null);
              onChange(pin, label);
            });
          };

          marker.addListener('dragend', (e: any) => commit({ lat: e.latLng.lat(), lng: e.latLng.lng() }));
          map.addListener('click', (e: any) => {
            if (map.getZoom() < 15) map.setZoom(16);
            commit({ lat: e.latLng.lat(), lng: e.latLng.lng() });
          });

          // ---- Search + paste-a-location -------------------------------------
          // Typeahead over UAE places (Places Autocomplete), plus a resolver for
          // anything the customer pastes: a Google Maps link, a Plus Code, or a
          // raw "lat,lng". This is how most people share a villa location here.
          if (searchRef.current && google.maps.places?.Autocomplete) {
            const ac = new google.maps.places.Autocomplete(searchRef.current, {
              fields: ['geometry'],
              componentRestrictions: { country: 'ae' },
            });
            ac.addListener('place_changed', () => {
              const loc = ac.getPlace()?.geometry?.location;
              if (loc) {
                if (map.getZoom() < 15) map.setZoom(16);
                commit({ lat: loc.lat(), lng: loc.lng() });
                if (!cancelled) setSearchErr(null);
              }
            });
          }

          resolveRef.current = (raw: string) => {
            const v = raw.trim();
            if (!v) return;
            // 1) a raw "lat, lng"
            let pin = parseLatLng(v);
            // 2) a full Google Maps link
            if (!pin && /https?:\/\//i.test(v)) pin = coordsFromMapsUrl(v);
            if (pin) {
              if (map.getZoom() < 15) map.setZoom(16);
              commit(pin);
              setSearchErr(null);
              return;
            }
            // 3) shortened Maps links redirect server-side; the browser can't
            //    follow them (CORS), so ask for the full address or code.
            if (/(maps\.app\.goo\.gl|goo\.gl\/maps)/i.test(v)) {
              setSearchErr(ar
                ? 'الرابط المختصر ما يفتح هنا — افتحيه ثم انسخي العنوان أو الكود الكامل'
                : 'Short links can’t open here — open it, then paste the full address or code');
              return;
            }
            // 4) a Plus Code or a plain address/area name → geocode it.
            setSearchBusy(true);
            geocoder.geocode({ address: v, region: 'AE' }, (res: any[], st: string) => {
              if (cancelled) return;
              setSearchBusy(false);
              const loc = st === 'OK' && res?.[0]?.geometry?.location;
              if (loc) {
                if (map.getZoom() < 15) map.setZoom(16);
                commit({ lat: loc.lat(), lng: loc.lng() });
                setSearchErr(null);
              } else {
                setSearchErr(ar
                  ? 'ما لقينا الموقع — جرّبي اسم المنطقة أو ثبّتي الدبوس يدوياً'
                  : 'Location not found — try the area name or drop the pin manually');
              }
            });
          };

          // Remeasure/repaint once the first tiles settle, then again shortly
          // after — corrects a layer measured mid-animation or mid-scroll.
          google.maps.event.addListenerOnce(map, 'idle', () => {
            if (cancelled) return;
            google.maps.event.trigger(map, 'resize');
            map.setCenter(start);
          });
          [250, 700].forEach((d) =>
            window.setTimeout(() => {
              if (cancelled) return;
              google.maps.event.trigger(map, 'resize');
              map.setCenter(start);
            }, d),
          );
          setStatus('ready');
        }, 420);
      })
      .catch((err) => {
        if (!cancelled) setStatus(err?.message === 'no-key' ? 'nokey' : 'error');
      });
    return () => {
      cancelled = true;
      authListeners.delete(onAuthFail);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapsKey]);

  const useMyLocation = () => {
    if (!navigator.geolocation || status !== 'ready') return;
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        const pin = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        const map = mapRef.current;
        const marker = markerRef.current;
        if (map && marker) {
          map.setZoom(17);
          map.panTo(pin);
          marker.setPosition(pin);
        }
        geocoderRef.current?.geocode({ location: pin }, (results: any[], gStatus: string) => {
          const label = gStatus === 'OK' && results?.[0] ? results[0].formatted_address : undefined;
          setAddress(label ?? null);
          onChange(pin, label);
        });
      },
      () => setLocating(false),
      { enableHighAccuracy: true, timeout: 8000 },
    );
  };

  // No key configured, or the SDK failed to load — fall back to a manual pin so
  // the customer can still book. Their emirate + address text still reach the team.
  if (status === 'nokey' || status === 'error') {
    const set = value ?? UAE_CENTER;
    return (
      <button
        type="button"
        onClick={() => onChange(set)}
        style={{
          width: '100%',
          border: `1.5px dashed ${value ? C.pink : C.pinkDash}`,
          background: value ? C.pinkSoft : '#fff',
          borderRadius: 14,
          padding: '16px 14px',
          fontWeight: 700,
          fontSize: 13,
          color: value ? C.pinkDeep : C.ink,
          cursor: 'pointer',
        }}
      >
        {value
          ? `✓ ${ar ? 'تم تحديد الموقع' : 'Location set'} · ${value.lat.toFixed(4)}, ${value.lng.toFixed(4)}`
          : (ar ? '📍 اضغطي لتحديد موقع الحفلة' : '📍 Tap to set your event location')}
      </button>
    );
  }

  return (
    <div>
      {/* Search an area, or paste a Maps link / Plus Code / coordinates. */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
        <input
          ref={searchRef}
          type="text"
          dir={ar ? 'rtl' : 'ltr'}
          placeholder={ar ? 'ابحثي عن المنطقة أو الصقي رابط/كود الموقع' : 'Search area, or paste a Maps link / code'}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              resolveRef.current?.((e.target as HTMLInputElement).value);
            }
          }}
          disabled={status !== 'ready'}
          style={{
            flex: 1,
            minWidth: 0,
            border: `1px solid ${C.pinkLine}`,
            borderRadius: 10,
            padding: '9px 12px',
            fontSize: 12.5,
            fontWeight: 600,
            color: C.ink,
            background: '#fff',
            outline: 'none',
          }}
        />
        <button
          type="button"
          onClick={() => resolveRef.current?.(searchRef.current?.value ?? '')}
          disabled={status !== 'ready' || searchBusy}
          style={{
            border: 'none',
            background: C.pink,
            color: '#fff',
            borderRadius: 10,
            padding: '0 15px',
            fontWeight: 800,
            fontSize: 12.5,
            cursor: 'pointer',
            whiteSpace: 'nowrap',
          }}
        >
          {searchBusy ? '…' : (ar ? 'انتقلي' : 'Go')}
        </button>
      </div>
      {searchErr && (
        <div style={{ fontSize: 11, fontWeight: 700, color: '#d0453f', marginBottom: 6, lineHeight: 1.4 }}>
          {searchErr}
        </div>
      )}
      <div
        ref={boxRef}
        style={{
          height: 220,
          borderRadius: 14,
          overflow: 'hidden',
          border: `1px solid ${C.pinkLine}`,
          background: C.pinkSoft,
          // iOS Safari: the checkout card runs a `transform`/`opacity` entrance
          // animation (@keyframes rise). A Google Map clipped by overflow+radius
          // inside that animated ancestor loses its GPU layer on the next repaint
          // and blanks out ("appears then disappears"). Pinning the map to its own
          // stable compositing layer keeps the ancestor from clipping it away.
          transform: 'translateZ(0)',
          WebkitTransform: 'translateZ(0)',
          isolation: 'isolate',
          willChange: 'transform',
        }}
      />
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
        <button
          type="button"
          onClick={useMyLocation}
          disabled={status !== 'ready' || locating}
          style={{
            border: `1px solid ${C.pinkLine}`,
            background: '#fff',
            borderRadius: 10,
            padding: '7px 12px',
            fontWeight: 700,
            fontSize: 12,
            color: C.pinkDeep,
            cursor: 'pointer',
            whiteSpace: 'nowrap',
          }}
        >
          {locating ? (ar ? 'جاري التحديد…' : 'Locating…') : (ar ? '📍 موقعي الحالي' : '📍 Use my location')}
        </button>
        <div style={{ fontSize: 11, fontWeight: 600, color: C.muted, lineHeight: 1.35 }}>
          {status === 'loading'
            ? (ar ? 'جاري تحميل الخريطة…' : 'Loading map…')
            : value
              ? (address ?? `${ar ? 'تم التحديد' : 'Pin set'} · ${value.lat.toFixed(4)}, ${value.lng.toFixed(4)}`)
              : (ar ? 'اضغطي على الخريطة أو اسحبي الدبوس لموقع الحفلة بالضبط' : 'Tap the map or drag the pin to your exact event spot')}
        </div>
      </div>
    </div>
  );
}
