/**
 * One-shot: register suppliers dictated by the owner. Reads SUPPLIERS_SEED as a
 * JSON array [{ name, supplies?, phone?, location?, contact?, email?, note? }]
 * and inserts each into `suppliers` (idempotent by lower(name) — an existing
 * supplier is UPDATED with any newly-provided fields, never duplicated).
 * Gated ADD_SUPPLIERS=true. Turn the flag off after it runs.
 */
import { pool } from './pool.js';

interface Sup { name: string; supplies?: string; phone?: string; location?: string; contact?: string; email?: string; note?: string }

export async function addSuppliersFromEnv(): Promise<void> {
  if (String(process.env.ADD_SUPPLIERS ?? '').toLowerCase() !== 'true') return;
  const raw = process.env.SUPPLIERS_SEED;
  if (!raw) { console.log('[add-suppliers] SUPPLIERS_SEED not set'); return; }
  let rows: Sup[];
  try { rows = JSON.parse(raw); } catch { console.log('[add-suppliers] invalid JSON'); return; }
  if (!Array.isArray(rows) || !rows.length) { console.log('[add-suppliers] no rows'); return; }

  let added = 0, updated = 0;
  for (const s of rows) {
    const name = String(s?.name ?? '').trim();
    if (!name) { console.log(`[add-suppliers] skip (no name): ${JSON.stringify(s)}`); continue; }
    const fields = {
      supplies: (s.supplies ?? '').toString().trim() || null,
      phone: (s.phone ?? '').toString().trim() || null,
      location: (s.location ?? '').toString().trim() || null,
      contact: (s.contact ?? '').toString().trim() || null,
      email: (s.email ?? '').toString().trim() || null,
      note: (s.note ?? '').toString().trim() || null,
    };
    const ex = await pool.query<{ id: string }>(`SELECT id FROM suppliers WHERE lower(btrim(name)) = lower($1) LIMIT 1`, [name]);
    if (ex.rows[0]) {
      // Fill only the fields we were given; keep existing values otherwise.
      await pool.query(
        `UPDATE suppliers SET
           supplies = COALESCE($2, supplies), phone = COALESCE($3, phone),
           location = COALESCE($4, location), contact = COALESCE($5, contact),
           email = COALESCE($6, email), note = COALESCE($7, note), active = true
         WHERE id = $1`,
        [ex.rows[0].id, fields.supplies, fields.phone, fields.location, fields.contact, fields.email, fields.note],
      );
      updated++;
      console.log(`[add-suppliers] UPDATED ${name}`);
    } else {
      await pool.query(
        `INSERT INTO suppliers (name, supplies, phone, location, contact, email, note, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'Owner')`,
        [name, fields.supplies, fields.phone, fields.location, fields.contact, fields.email, fields.note],
      );
      added++;
      console.log(`[add-suppliers] ADDED ${name}${fields.supplies ? ` — ${fields.supplies}` : ''}`);
    }
  }
  console.log(`[add-suppliers] DONE — added ${added}, updated ${updated}, of ${rows.length}`);
}
