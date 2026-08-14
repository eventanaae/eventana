/**
 * Lightweight on-device customer profile.
 *
 * The first time the app opens it asks only for a name and a birthday, so
 * greetings can be personal and we can wish the customer on their special
 * day. This is stored locally (no password, no account) — a full customer
 * sign-in with per-account order history is a larger, separate feature.
 */
import { useState } from 'react';

export interface Profile {
  name: string;
  /** ISO date, yyyy-mm-dd. */
  birthday: string;
}

const KEY = 'eventana.profile';

export function loadProfile(): Profile | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as Profile;
    return p && typeof p.name === 'string' && p.name.trim() ? p : null;
  } catch {
    return null;
  }
}

export function saveProfile(p: Profile): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* storage unavailable — the session keeps the value in memory anyway */
  }
}

export function useProfile() {
  const [profile, setProfile] = useState<Profile | null>(() => loadProfile());
  const save = (p: Profile) => {
    saveProfile(p);
    setProfile(p);
  };
  return { profile, save };
}
