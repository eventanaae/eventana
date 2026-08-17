import { useEffect, useRef, useState } from 'react';
import { C } from './ui';

type Pin = { lat: number; lng: number };

/** UAE centre (Dubai) — the initial view before the customer places a pin. */
const UAE_CENTER: Pin = { lat: 25.2048, lng: 55.2708 };

/**
 * Loads the Google Maps JS SDK exactly once per page. The browser key is
 * supplied at runtime (from the catalogue) so it never lives in the repo.
 */
let loaderPromise: Promise<any> | null = null;
function loadMaps(key: string): Promise<any> {
  const w = window as any;
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
    s.onerror = () => reject(new Error('load-failed'));
    document.head.appendChild(s);
  });
  return loaderPromise;
}

export function MapPicker({
  mapsKey,
  value,
  onChange,
}: {
  mapsKey: string | null;
  value: Pin | null;
  onChange: (pin: Pin, address?: string) => void;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const markerRef = useRef<any>(null);
  const geocoderRef = useRef<any>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'nokey' | 'error'>('loading');
  const [address, setAddress] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!mapsKey) {
      setStatus('nokey');
      return;
    }
    loadMaps(mapsKey)
      .then((google) => {
        if (cancelled || !boxRef.current) return;
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
        setStatus('ready');
      })
      .catch((err) => {
        if (!cancelled) setStatus(err?.message === 'no-key' ? 'nokey' : 'error');
      });
    return () => {
      cancelled = true;
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
        {value ? `✓ Location set · ${value.lat.toFixed(4)}, ${value.lng.toFixed(4)}` : '📍 Tap to set your event location'}
      </button>
    );
  }

  return (
    <div>
      <div
        ref={boxRef}
        style={{
          height: 220,
          borderRadius: 14,
          overflow: 'hidden',
          border: `1px solid ${C.pinkLine}`,
          background: C.pinkSoft,
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
          {locating ? 'Locating…' : '📍 Use my location'}
        </button>
        <div style={{ fontSize: 11, fontWeight: 600, color: C.muted, lineHeight: 1.35 }}>
          {status === 'loading'
            ? 'Loading map…'
            : value
              ? (address ?? `Pin set · ${value.lat.toFixed(4)}, ${value.lng.toFixed(4)}`)
              : 'Tap the map or drag the pin to your exact event spot'}
        </div>
      </div>
    </div>
  );
}
