/**
 * Seed / update the part-timer contacts (clowns / face-painters) from the
 * environment, so their phone numbers (PII) never live in the repo. Set
 * PARTTIMERS_SEED to a JSON array of { name, phone?, active? }; matched by name
 * (case-insensitive) and upserted. Idempotent. No-op when unset.
 */
import { pool } from './pool.js';

interface Entry { name: string; phone?: string; active?: boolean }

export async function seedPartTimersFromEnv(): Promise<void> {
  const raw = process.env.PARTTIMERS_SEED;
  if (!raw) return;
  let entries: Entry[];
  try { entries = JSON.parse(raw); } catch { console.error('[part-timers] PARTTIMERS_SEED is not valid JSON — skipping'); return; }
  if (!Array.isArray(entries) || entries.length === 0) return;
  for (const e of entries) {
    if (!e?.name?.trim()) continue;
    const name = e.name.trim();
    const norm = name.toLowerCase();
    const phone = typeof e.phone === 'string' ? e.phone : null;
    const active = e.active === undefined ? true : !!e.active;
    await pool.query(
      `INSERT INTO part_timers (name, name_norm, phone, active) VALUES ($1,$2,$3,$4)
       ON CONFLICT (name_norm) DO UPDATE
         SET name = EXCLUDED.name, phone = COALESCE(EXCLUDED.phone, part_timers.phone), active = EXCLUDED.active`,
      [name, norm, phone, active],
    );
    console.log(`[part-timers] ${name}: phone=${phone ? 'set' : '—'} active=${active}`);
  }
}
