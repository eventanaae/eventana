/**
 * Seed / update the drivers roster from the environment, so their phone numbers
 * (PII) never live in the repo. Set DRIVERS_SEED to a JSON array of
 * { name, phone?, kind?, active? }; each is matched to a driver by name
 * (case-insensitive) and upserted. Idempotent. No-op when unset.
 *
 *   DRIVERS_SEED='[{"name":"Shan","phone":"+9715...","kind":"main"}]'
 *
 * kind: 'main' (Shan — drives the van) | 'own_car' (brings their own car) |
 * 'van' (part-timer who drives the company van).
 */
import { pool } from './pool.js';

interface Entry { name: string; phone?: string; kind?: string; active?: boolean }

const KINDS = new Set(['main', 'own_car', 'van']);

export async function seedDriversFromEnv(): Promise<void> {
  const raw = process.env.DRIVERS_SEED;
  if (!raw) return;
  let entries: Entry[];
  try {
    entries = JSON.parse(raw);
  } catch {
    console.error('[drivers] DRIVERS_SEED is not valid JSON — skipping');
    return;
  }
  if (!Array.isArray(entries) || entries.length === 0) return;

  for (const e of entries) {
    if (!e?.name?.trim()) continue;
    const kind = e.kind && KINDS.has(e.kind) ? e.kind : 'own_car';
    const phone = typeof e.phone === 'string' ? e.phone : null;
    const active = e.active === undefined ? true : !!e.active;
    await pool.query(
      `INSERT INTO drivers (name, phone, kind, active) VALUES ($1,$2,$3,$4)
       ON CONFLICT (lower(name)) DO UPDATE
         SET phone  = COALESCE(EXCLUDED.phone, drivers.phone),
             kind   = EXCLUDED.kind,
             active = EXCLUDED.active`,
      [e.name.trim(), phone, kind, active],
    );
    console.log(`[drivers] ${e.name}: kind=${kind} phone=${phone ? 'set' : '—'} active=${active}`);
  }
}
