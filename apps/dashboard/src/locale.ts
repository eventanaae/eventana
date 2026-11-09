/**
 * Small locale helpers shared by the dashboard views.
 *
 *  • Dates: the business runs on Dubai time (UTC+4, no DST). "Today" must be the
 *    Dubai calendar day whatever the device clock/timezone says —
 *    `new Date().toISOString().slice(0, 10)` is the UTC day and is wrong between
 *    00:00 and 04:00 Dubai.
 *  • Digits: the team often types on an Arabic keyboard, which produces
 *    Arabic-Indic (٠-٩) or Persian (۰-۹) digits. `Number('٥٠')` is NaN and a
 *    `[^\d]` filter strips them, so normalise to ASCII before parsing.
 */

const DUBAI_OFFSET_MS = 4 * 3600 * 1000;

/** A moment → its Dubai calendar date as YYYY-MM-DD. */
export function dubaiYMD(d: Date = new Date()): string {
  return new Date(d.getTime() + DUBAI_OFFSET_MS).toISOString().slice(0, 10);
}

/** Today's date in Dubai as YYYY-MM-DD. */
export function dubaiToday(): string {
  return dubaiYMD(new Date());
}

/** Arabic-Indic / Persian digits (and the Arabic decimal/thousands marks) → ASCII. */
export function toAsciiDigits(s: string): string {
  return String(s ?? '')
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06F0))
    .replace(/٫/g, '.')   // Arabic decimal separator
    .replace(/٬/g, ',');  // Arabic thousands separator
}

/**
 * Parse a typed number (any digit script, thousands commas allowed). Returns NaN
 * for blank or invalid input so callers can tell "nothing typed" from 0.
 */
export function parseNumber(s: string | number | null | undefined): number {
  if (typeof s === 'number') return s;
  const t = toAsciiDigits(String(s ?? '')).replace(/,/g, '').trim();
  return t === '' ? NaN : Number(t);
}

/**
 * Full viewport height for drawers. `100vh` on mobile Safari includes the area
 * behind the URL bar, so the bottom of a full-height drawer is cut off; `100dvh`
 * tracks the visible area. Falls back to `100vh` where `dvh` isn't supported.
 */
export const FULL_HEIGHT: string =
  typeof CSS !== 'undefined' && typeof CSS.supports === 'function' && CSS.supports('height', '100dvh') ? '100dvh' : '100vh';
