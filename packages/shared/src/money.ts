/**
 * Money handling.
 *
 * Every amount in Eventana is stored and computed as an integer number of
 * FILS (1 AED = 100 fils). Floating point is never used for money: a 15%
 * discount on an odd subtotal (AED 2,599 -> 389.85) is exact in fils and
 * lossy in floats, and payment providers reconcile to the fils.
 *
 * Catalogue prices are authored in whole AED because that is how the
 * Eventana catalogue is priced; `aed()` lifts them into fils at the edge.
 */

/** Whole (or fractional) AED -> fils. `aed(780)` -> 78000. */
export function aed(amount: number): number {
  return Math.round(amount * 100);
}

/** Fils -> a display string with thousands separators, e.g. "7,229" or "7,229.50". */
export function formatAed(fils: number): string {
  const negative = fils < 0;
  const abs = Math.abs(fils);
  const whole = Math.floor(abs / 100);
  const cents = abs % 100;
  const body = whole.toLocaleString('en-US') + (cents ? '.' + String(cents).padStart(2, '0') : '');
  return negative ? '-' + body : body;
}

/**
 * Fils -> the 2-decimal string shape every payment provider expects
 * ("7229.00"). Never send a Number: JSON floats re-introduce the rounding
 * error this module exists to avoid.
 */
export function providerAmount(fils: number): string {
  const negative = fils < 0;
  const abs = Math.abs(fils);
  return (negative ? '-' : '') + Math.floor(abs / 100) + '.' + String(abs % 100).padStart(2, '0');
}

/** Percentage of an amount, rounded half-up to the nearest fils. */
export function percentOf(fils: number, percent: number): number {
  return Math.round((fils * percent) / 100);
}

/**
 * A 24-hour "HH:MM" clock time -> a friendly 12-hour label, e.g.
 * "18:00" -> "6:00 PM", "09:30" -> "9:30 AM". Empty/unparseable input is
 * returned unchanged so it never throws in a template. Used everywhere a
 * time is shown to a person — the owner reads AM/PM, not a 24-hour clock.
 */
export function to12h(hhmm: string | null | undefined): string {
  if (!hhmm) return '';
  const m = /^(\d{1,2}):(\d{2})/.exec(String(hhmm).trim());
  if (!m) return String(hhmm);
  let h = Number(m[1]);
  const min = m[2];
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12;
  if (h === 0) h = 12;
  return `${h}:${min} ${ampm}`;
}

/** A "HH:MM"–"HH:MM" pair -> "6:00 PM – 10:00 PM". */
export function timeRange12h(start: string | null | undefined, end: string | null | undefined): string {
  const s = to12h(start);
  const e = to12h(end);
  return e ? `${s} – ${e}` : s;
}
