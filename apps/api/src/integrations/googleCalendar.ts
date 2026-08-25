/**
 * Google Calendar sync — service-account model.
 *
 * Every confirmed booking is mirrored into one shared team calendar so the
 * whole crew sees it in their own Google Calendar. No per-user OAuth, no
 * expiring tokens: a service account signs a short-lived JWT, exchanges it
 * for an access token, and writes to the calendar it's been shared on.
 *
 * Entirely optional and always non-fatal — if the credentials aren't set, or
 * Google is unreachable, the booking still succeeds; the calendar just isn't
 * updated. Auth uses node:crypto (RS256) and global fetch, no extra deps.
 */
import { createSign } from 'node:crypto';
import { pool } from '../db/pool.js';
import { config } from '../config.js';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/calendar.events';
const API = 'https://www.googleapis.com/calendar/v3/calendars';

interface ServiceAccount {
  client_email: string;
  private_key: string;
}

function credentials(): { sa: ServiceAccount; calendarId: string } | null {
  const { serviceAccountJson, calendarId } = config.googleCalendar;
  if (!serviceAccountJson || !calendarId) return null;
  try {
    const sa = JSON.parse(serviceAccountJson) as ServiceAccount;
    if (!sa.client_email || !sa.private_key) return null;
    return { sa, calendarId };
  } catch {
    console.error('[calendar] GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON');
    return null;
  }
}

export function calendarEnabled(): boolean {
  return credentials() !== null;
}

/**
 * Live connectivity probe: exchanges the JWT and lists one event on the
 * configured calendar (within the calendar.events scope). Returns only a
 * status — no secret leaves. Used to verify setup end-to-end.
 */
export async function checkCalendarConnection(): Promise<{
  configured: boolean;
  ok: boolean;
  error?: string;
}> {
  const creds = credentials();
  if (!creds) return { configured: false, ok: false, error: 'not configured' };
  try {
    const token = await accessToken(creds.sa);
    const cal = encodeURIComponent(creds.calendarId);
    const res = await fetch(`${API}/${cal}/events?maxResults=1`, {
      headers: { authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      return { configured: true, ok: false, error: `${res.status}: ${(await res.text()).slice(0, 400)}` };
    }
    return { configured: true, ok: true };
  } catch (err) {
    return { configured: true, ok: false, error: (err as Error).message.slice(0, 400) };
  }
}

let cachedToken: { value: string; expiresAt: number } | null = null;

async function accessToken(sa: ServiceAccount): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.value;

  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const claims = Buffer.from(
    JSON.stringify({ iss: sa.client_email, scope: SCOPE, aud: TOKEN_URL, iat: now, exp: now + 3600 }),
  ).toString('base64url');
  const signingInput = `${header}.${claims}`;
  const signer = createSign('RSA-SHA256');
  signer.update(signingInput);
  signer.end();
  const signature = signer.sign(sa.private_key).toString('base64url');
  const assertion = `${signingInput}.${signature}`;

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });
  if (!res.ok) throw new Error(`token exchange failed: ${res.status} ${await res.text()}`);
  const json = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = { value: json.access_token, expiresAt: Date.now() + json.expires_in * 1000 };
  return json.access_token;
}

/**
 * Normalise an events.event_date to a plain `YYYY-MM-DD`. node-postgres returns
 * a DATE column as a JS Date, and `String(date)` yields `"Fri Aug 30 2026 …"`,
 * so slicing that gives Google a garbage date and a bare 400. Handle both a
 * Date object and an already-ISO string. The server runs in UTC, so the Date is
 * at UTC midnight and toISOString keeps the calendar day.
 */
function ymd(eventDate: unknown): string {
  if (eventDate instanceof Date) return eventDate.toISOString().slice(0, 10);
  const s = String(eventDate);
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : new Date(s).toISOString().slice(0, 10);
}

/** 'HH:MM' or 'HH:MM:SS' → 'HH:MM:SS' (local wall time, paired with a timeZone). */
function hms(time: string): string {
  const [h = '0', m = '0'] = String(time).split(':');
  return `${h.padStart(2, '0')}:${m.padStart(2, '0')}:00`;
}

/** '24:00' (midnight end) → the next day at 00:00; otherwise same day. */
function endDateTime(eventDate: string, endTime: string): string {
  const [h] = endTime.split(':').map(Number);
  if (h >= 24) {
    const d = new Date(`${eventDate}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 1);
    return `${d.toISOString().slice(0, 10)}T00:00:00`;
  }
  return `${eventDate}T${hms(endTime)}`;
}

function buildEventBody(ev: any) {
  const cart = (ev.cart ?? {}) as { eventFor?: string; address?: { details?: string } };
  const date = ymd(ev.event_date);
  const who = cart.eventFor ? `${cart.eventFor}'s ` : '';
  const what = ev.package_name ?? (ev.custom_theme ? `${ev.celebration_type} · custom theme` : ev.celebration_type);
  const lat = Number(ev.map_lat);
  const lng = Number(ev.map_lng);
  const hasPin = lat !== 0 || lng !== 0;
  const addressText = cart.address?.details || ev.emirate || 'UAE';
  const mapsUrl = hasPin ? `https://www.google.com/maps/search/?api=1&query=${lat},${lng}` : null;

  const lines = [
    `Booking ${ev.id}`,
    `Customer: ${ev.customer_name ?? '—'}${ev.phone ? ` · ${ev.phone}` : ''}`,
    cart.eventFor ? `Guest of honour: ${cart.eventFor}` : null,
    `Status: ${ev.phase}`,
    mapsUrl ? `Location: ${mapsUrl}` : null,
    config.publicDashboardUrl ? `Ops: ${config.publicDashboardUrl}` : null,
  ].filter(Boolean);

  return {
    summary: `🎉 ${who}${what}`.trim(),
    location: hasPin ? `${addressText} (${lat},${lng})` : addressText,
    description: lines.join('\n'),
    start: { dateTime: `${date}T${hms(ev.start_time)}`, timeZone: 'Asia/Dubai' },
    end: { dateTime: endDateTime(date, ev.base_end_time), timeZone: 'Asia/Dubai' },
    status: ev.phase === 'Cancelled' ? 'cancelled' : 'confirmed',
  };
}

async function loadEvent(eventId: string): Promise<any | null> {
  const { rows } = await pool.query(
    `SELECT e.*, c.name AS customer_name, c.phone, o.cart, p.name AS package_name
       FROM events e
       LEFT JOIN customers c ON c.id = e.customer_id
       LEFT JOIN orders o    ON o.id = e.order_id
       LEFT JOIN packages p  ON p.id = e.package_id
      WHERE e.id = $1`,
    [eventId],
  );
  return rows[0] ?? null;
}

/**
 * Create or update the calendar entry for an event. Safe to call repeatedly:
 * it PATCHes the existing entry when one is already linked, else creates one
 * and stores its id. Never throws — logs and moves on.
 */
export async function syncEventToCalendar(eventId: string): Promise<void> {
  const creds = credentials();
  if (!creds) return;
  try {
    const ev = await loadEvent(eventId);
    if (!ev) return;

    const token = await accessToken(creds.sa);
    const cal = encodeURIComponent(creds.calendarId);
    const existing = ev.google_calendar_event_id as string | null;
    const url = existing ? `${API}/${cal}/events/${existing}` : `${API}/${cal}/events`;
    const res = await fetch(url, {
      method: existing ? 'PATCH' : 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(buildEventBody(ev)),
    });

    // A linked id that Google no longer has (410/404) — drop it and recreate.
    if (existing && (res.status === 404 || res.status === 410)) {
      await pool.query(`UPDATE events SET google_calendar_event_id = NULL WHERE id = $1`, [eventId]);
      return syncEventToCalendar(eventId);
    }
    if (!res.ok) throw new Error(`calendar write failed: ${res.status} ${await res.text()}`);

    if (!existing) {
      const created = (await res.json()) as { id: string };
      await pool.query(`UPDATE events SET google_calendar_event_id = $2 WHERE id = $1`, [
        eventId,
        created.id,
      ]);
    }
  } catch (err) {
    console.error(`[calendar] sync failed for ${eventId}:`, (err as Error).message);
  }
}
