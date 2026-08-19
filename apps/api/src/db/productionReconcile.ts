/**
 * Production data reconciliation (runs on every boot; fully idempotent).
 *
 * Makes the live operations team exactly the real Eventana roster and removes
 * the placeholder rows shipped by the seed plus any QA test artefacts, so
 * neither the customer nor the operations app ever shows mock data.
 *
 * Deliberately TARGETED: it upserts the six real members and deletes only the
 * KNOWN placeholder ids. It never does a "delete everyone not in this list",
 * so staff the owner adds later from the Team tab are always safe.
 */
import { randomBytes } from 'node:crypto';
import { pool } from './pool.js';

interface CanonMember {
  name: string;
  role: string;
  access: 'owner' | 'manager' | 'employee' | 'driver';
  color: string;
}

/** The real, current Eventana team — the single source of truth. */
const REAL_TEAM: CanonMember[] = [
  { name: 'Sheem', role: 'CEO', access: 'owner', color: '#E94F9C' },
  { name: 'Marsha', role: 'Operations Manager', access: 'manager', color: '#6C7BF0' },
  { name: 'Jane', role: 'Senior Balloon Artist', access: 'employee', color: '#4FBFA0' },
  { name: 'Dindo', role: 'Senior Balloon Artist', access: 'employee', color: '#F0A24F' },
  { name: 'Gloria', role: 'Junior Balloon Artist', access: 'employee', color: '#B96CF0' },
  { name: 'Diana', role: 'Junior Balloon Artist', access: 'employee', color: '#4F9CF0' },
];

/** Placeholder staff shipped by the seed + created during testing. */
const PLACEHOLDER_TEAM_IDS = [
  'stf-ahmed', 'stf-maryam', 'stf-yousef', 'stf-layla', 'stf-omar',
  'tm-test-owner', 'tm-test-manager', 'tm-test-employee',
];

/** Demo customer the seed inserts ("Sara Al Mansoori"). */
const DEMO_CUSTOMER_ID = 'CUST-4471';

export async function productionReconcile(): Promise<void> {
  try {
    // 1) Upsert the real roster (create if missing; refresh role/level/active;
    //    mint a personal login token once so each can sign in as themselves).
    for (const m of REAL_TEAM) {
      const id = `tm-${m.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;
      await pool.query(
        `INSERT INTO team_members (id, name, role, color, active, access_level)
         SELECT $1,$2,$3,$4,true,$5
          WHERE NOT EXISTS (SELECT 1 FROM team_members WHERE lower(name) = lower($2))`,
        [id, m.name, m.role, m.color, m.access],
      );
      await pool.query(
        `UPDATE team_members SET role = $2, access_level = $3, active = true
          WHERE lower(name) = lower($1)`,
        [m.name, m.role, m.access],
      );
      await pool.query(
        `UPDATE team_members SET access_token = $2
          WHERE lower(name) = lower($1) AND (access_token IS NULL OR access_token = '')`,
        [m.name, `stf_${randomBytes(18).toString('hex')}`],
      );
    }

    // 2) Remove the known placeholder staff (clear the few FK references first).
    await pool.query(`UPDATE tips SET member_id = NULL WHERE member_id = ANY($1)`, [PLACEHOLDER_TEAM_IDS]);
    await pool.query(`DELETE FROM event_team WHERE member_id = ANY($1)`, [PLACEHOLDER_TEAM_IDS]);
    await pool.query(`DELETE FROM staff_days_off WHERE member_id = ANY($1)`, [PLACEHOLDER_TEAM_IDS]);
    await pool.query(`DELETE FROM team_members WHERE id = ANY($1)`, [PLACEHOLDER_TEAM_IDS]);

    // 3) Remove the shipped demo customer (the seed inserts it with no orders).
    await pool.query(`DELETE FROM loyalty_transactions WHERE customer_id = $1`, [DEMO_CUSTOMER_ID]);
    await pool.query(`DELETE FROM customers WHERE id = $1`, [DEMO_CUSTOMER_ID]);

    // 4) Remove QA test artefacts. Unpaid test orders would otherwise be chased
    //    by the reconciliation sweep into false "payment unresolved" ops alerts.
    const { rows: qa } = await pool.query<{ id: string }>(
      `SELECT id FROM customers WHERE email LIKE '%@eventana-qa.test'`,
    );
    if (qa.length > 0) {
      const ids = qa.map((r) => r.id);
      const { rows: ords } = await pool.query<{ id: string }>(
        `SELECT id FROM orders WHERE customer_id = ANY($1)`,
        [ids],
      );
      const orderIds = ords.map((r) => r.id);
      if (orderIds.length > 0) {
        await pool.query(`DELETE FROM payment_events WHERE order_id = ANY($1)`, [orderIds]);
      }
      await pool.query(`DELETE FROM loyalty_transactions WHERE customer_id = ANY($1)`, [ids]);
      // Orders cascade-delete their payments and inventory holds.
      await pool.query(`DELETE FROM orders WHERE customer_id = ANY($1)`, [ids]);
      await pool.query(`DELETE FROM customers WHERE id = ANY($1)`, [ids]);
    }

    // Log the resulting roster (names only, never tokens) for verification.
    const { rows: team } = await pool.query<{ name: string; access_level: string }>(
      `SELECT name, access_level FROM team_members WHERE active ORDER BY name`,
    );
    console.log(
      `[reconcile] production roster (${team.length}): ` +
        team.map((t) => `${t.name}/${t.access_level}`).join(', '),
    );
  } catch (err) {
    console.error('[reconcile] production reconcile failed (non-fatal):', err);
  }
}
