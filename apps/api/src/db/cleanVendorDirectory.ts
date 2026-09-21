/**
 * Tidy the suppliers/vendors directory:
 *  1. MERGE duplicate rows that are the same vendor in a different case/format
 *     (e.g. "AL BATINA DEPARTMENT STORE" ×3) → keep one best row, moving any
 *     contact fields it's missing over from its duplicates first.
 *  2. CLEAN the "what they supply" field — the old OCR product lists
 *     ("Consumables — 1*40 Party fun Balloons, …") become a short label
 *     ("Consumables"). Clean short values are left alone.
 *
 * Expenses reference a vendor by NAME (matched case-insensitively), not by a
 * supplier row id, so removing duplicate directory rows is safe. One-shot guarded.
 */
import { pool } from './pool.js';

interface Row { id: string; name: string; phone: string | null; email: string | null; location: string | null; supplies: string | null; }

/** Turn a long OCR supply string into a short 2-3 word label. */
export function cleanSupplies(s: string | null): string | null {
  if (!s) return null;
  let t = s.replace(/\s+/g, ' ').trim();
  if (!t) return null;
  const messy = /\d/.test(t) || t.length > 40 || /\s[—–-]\s/.test(t);
  if (!messy) return t; // already short & clean (e.g. "Décor & gifts")
  t = t.split(/\s*[—–]\s*/)[0].split(/\s+-\s+/)[0].split(',')[0].trim();
  t = t.replace(/\s*\d.*$/, '').trim().split(/\s+/).slice(0, 3).join(' ');
  return t || null;
}

const rich = (r: Row) => (r.phone ? 1 : 0) + (r.email ? 1 : 0) + (r.location ? 1 : 0) + (r.supplies ? 1 : 0);
const nn = (v: string | null) => (v && v.trim() ? v.trim() : null);

export async function cleanVendorDirectoryFromEnv(): Promise<void> {
  if (String(process.env.RUN_MIGRATIONS_ON_BOOT ?? '').toLowerCase() !== 'true') return;
  const tag = process.env.CLEAN_VENDORS_TAG ?? 'v1';
  const guard = await pool.query(`SELECT 1 FROM app_kv WHERE k = $1`, [`clean_vendors_${tag}`]).catch(() => ({ rowCount: 0 }));
  if (guard.rowCount) return;

  const { rows } = await pool.query<Row>(`SELECT id, name, phone, email, location, supplies FROM suppliers`);

  // 1) De-duplicate by case-insensitive name.
  const groups = new Map<string, Row[]>();
  for (const r of rows) {
    const k = (r.name ?? '').trim().toLowerCase();
    if (!k) continue;
    (groups.get(k) ?? groups.set(k, []).get(k)!).push(r);
  }
  let removed = 0;
  for (const [, grp] of groups) {
    if (grp.length < 2) continue;
    // Keeper: prefer a NOT-all-caps name, then the richest, then the oldest id.
    const keeper = [...grp].sort((a, b) => {
      const aCaps = a.name === a.name.toUpperCase() ? 1 : 0;
      const bCaps = b.name === b.name.toUpperCase() ? 1 : 0;
      if (aCaps !== bCaps) return aCaps - bCaps;
      if (rich(a) !== rich(b)) return rich(b) - rich(a);
      return String(a.id).localeCompare(String(b.id));
    })[0];
    // Fill keeper's blanks from any duplicate.
    const merged = {
      phone: nn(keeper.phone) ?? grp.map((r) => nn(r.phone)).find(Boolean) ?? null,
      email: nn(keeper.email) ?? grp.map((r) => nn(r.email)).find(Boolean) ?? null,
      location: nn(keeper.location) ?? grp.map((r) => nn(r.location)).find(Boolean) ?? null,
      supplies: nn(keeper.supplies) ?? grp.map((r) => nn(r.supplies)).find(Boolean) ?? null,
    };
    await pool.query(
      `UPDATE suppliers SET phone=$2, email=$3, location=$4, supplies=$5 WHERE id=$1`,
      [keeper.id, merged.phone, merged.email, merged.location, merged.supplies],
    );
    const dupIds = grp.filter((r) => r.id !== keeper.id).map((r) => r.id);
    if (dupIds.length) {
      await pool.query(`DELETE FROM suppliers WHERE id::text = ANY($1::text[])`, [dupIds.map(String)]);
      removed += dupIds.length;
    }
  }
  console.log(`[clean-vendors] removed ${removed} duplicate vendor rows`);

  // 2) Clean messy supplies text on the remaining rows.
  const after = await pool.query<Row>(`SELECT id, name, phone, email, location, supplies FROM suppliers WHERE COALESCE(btrim(supplies),'') <> ''`);
  let cleaned = 0;
  for (const r of after.rows) {
    const nice = cleanSupplies(r.supplies);
    if (nice !== null && nice !== (r.supplies ?? '').trim()) {
      await pool.query(`UPDATE suppliers SET supplies = $2 WHERE id = $1`, [r.id, nice]);
      cleaned++;
    }
  }
  console.log(`[clean-vendors] cleaned ${cleaned} long supply descriptions`);
  await pool.query(`INSERT INTO app_kv (k, v) VALUES ($1, now()) ON CONFLICT (k) DO NOTHING`, [`clean_vendors_${tag}`]).catch(() => {});
}
