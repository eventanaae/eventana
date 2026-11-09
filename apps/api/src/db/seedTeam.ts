/**
 * Optional team seed from the environment.
 *
 * Set TEAM_SEED to a JSON array of members and they are upserted (matched by
 * name) on boot — used to load real staff and their birthdays without ever
 * committing personal data to the repo. Each entry applies ONCE (app_kv
 * marker): existing members keep their id/token and later in-app edits win.
 *
 *   TEAM_SEED='[{"name":"Sheem","birthday":"1995-10-12"}, ...]'
 */
import { claimOneShot, pool } from './pool.js';

interface SeedMember {
  name: string;
  role?: string;
  birthday?: string; // YYYY-MM-DD
  color?: string;
  accessLevel?: 'owner' | 'manager' | 'employee' | 'driver';
  phone?: string;
}

const PALETTE = ['#F06CA8', '#6C7BF0', '#4FBFA0', '#F0A24F', '#B96CF0', '#4F9CF0', '#8FBF4F', '#F06C6C'];

export async function seedTeamFromEnv(): Promise<void> {
  const raw = process.env.TEAM_SEED;
  if (!raw) return;

  let members: SeedMember[];
  try {
    members = JSON.parse(raw);
  } catch {
    console.error('[seed] TEAM_SEED is not valid JSON — skipping');
    return;
  }
  if (!Array.isArray(members) || members.length === 0) return;

  let i = 0;
  for (const m of members) {
    if (!m?.name) continue;
    const id = `tm-${m.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;
    const color = m.color ?? PALETTE[i % PALETTE.length];
    i++;

    // One-time per seed entry (app_kv marker, written first): re-applied on
    // every boot it overwrote phones the owner corrected in the app and
    // re-created members she had deleted. A changed entry applies once.
    const seedKey = `team_seed:${m.name.toLowerCase()}:${m.birthday ?? ''}:${m.phone ?? ''}:${m.accessLevel ?? ''}:${m.role ?? ''}`;
    if (!(await claimOneShot(seedKey))) continue;

    // Create only if no member with this name exists yet.
    await pool.query(
      `INSERT INTO team_members (id, name, role, color, active, access_level, birthday, phone)
       SELECT $1,$2,$3,$4,true,$5,$6::date,$7
        WHERE NOT EXISTS (SELECT 1 FROM team_members WHERE lower(name) = lower($2))`,
      [id, m.name, m.role ?? 'Crew', color, m.accessLevel ?? 'employee', m.birthday ?? null, m.phone ?? null],
    );

    // Keep birthday / phone current for existing members too (by name).
    if (m.birthday || m.phone) {
      await pool.query(
        `UPDATE team_members
            SET birthday = COALESCE($2::date, birthday),
                phone = COALESCE($3, phone)
          WHERE lower(name) = lower($1)`,
        [m.name, m.birthday ?? null, m.phone ?? null],
      );
    }
  }
  console.log(`[seed] TEAM_SEED processed ${members.length} member(s)`);
}
