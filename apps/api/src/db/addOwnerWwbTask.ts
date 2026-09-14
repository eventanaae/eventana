/**
 * One-shot: assign the "Where We Buy" list to the owner (Sheem) + Marsha, with
 * today's deadline, and notify them. Distinct title from the (now-cancelled)
 * staff version so nothing else touches it. Gated ADD_OWNER_WWB=true. Idempotent
 * by title. Turn the flag off after it runs.
 */
import { pool } from './pool.js';
import { createManualTask } from '../domain/prep.js';

const NAMES = ['sheem', 'marsha'];
const LINK = 'https://claude.ai/code/artifact/1157f6ca-adf5-4460-815f-0a546e04c1c0';
const TITLE = "Fill the 'Where We Buy' shopping list";
const NOTE =
  "Fill our shopping catalogue: for every item we regularly buy, add the item, the supplier (full company name), the supplier's PHONE, the emirate, and WHERE the shop is (area or a Google Maps link). Once complete, the system auto-suggests the right supplier whenever someone reports a missing item. Link (no login): " +
  LINK;

export async function addOwnerWwbTaskFromEnv(): Promise<void> {
  if (String(process.env.ADD_OWNER_WWB ?? '').toLowerCase() !== 'true') return;

  const { rows } = await pool.query<{ id: string; name: string }>(
    `SELECT id, name FROM team_members WHERE lower(name) = ANY($1)`,
    [NAMES],
  );
  if (!rows.length) { console.log('[owner-wwb] no matching members found — aborted'); return; }
  const ids = rows.map((r) => r.id);
  console.log(`[owner-wwb] resolved: ${rows.map((r) => `${r.name}=${r.id}`).join(', ')}`);

  const dup = await pool.query(`SELECT 1 FROM prep_tasks WHERE category = 'manual' AND title = $1 LIMIT 1`, [TITLE]);
  if (dup.rows[0]) { console.log('[owner-wwb] task already exists — skipped'); return; }

  const today = new Date(Date.now() + 4 * 3_600_000).toISOString().slice(0, 10); // Dubai
  const r = await createManualTask({ title: TITLE, memberIds: ids, dueDate: today, note: NOTE, actor: 'Sheem', notify: true });
  console.log(`[owner-wwb] ${r ? `task ${r.id} created for ${ids.length} (${rows.map((x) => x.name).join(', ')}), deadline ${today}, notified` : 'task FAILED'}`);
}
