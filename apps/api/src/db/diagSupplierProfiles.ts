/**
 * Diagnostic: review the supplier catalogue after the receipt OCR + supplier
 * memory build. Read-only. Three sections, printed to the Render logs:
 *   1) DUPLICATES — supplier names that collapse to the same normalized key
 *      (e.g. "Al Noor Trading LLC" vs "al noor trading") so the owner can pick
 *      the ONE official name to keep. We never auto-merge.
 *   2) THIN PROFILES — suppliers still missing phone / location / description,
 *      so the owner knows what's left to fill.
 *   3) PROFILES — the finished profile per supplier (name · phone · location ·
 *      items · description), most-bought first.
 * Gated DIAG_SUPPLIER_PROFILES=true.
 */
import { pool } from './pool.js';

// Normalize a supplier name to a comparison key: lowercase, drop the generic
// company words and punctuation, collapse spaces. Two names with the same key
// are very likely the same supplier written differently.
const NOISE = /\b(llc|l\.l\.c|fz|fze|fzco|fzc|est|establishment|trading|trad|general|gen|store|stores|shop|co|company|the|and|&|group|supplies|supply|uae|dubai|sharjah|ajman|abu|dhabi|international|intl|enterprise|enterprises|dmcc)\b/g;

export async function diagSupplierProfilesFromEnv(): Promise<void> {
  if (String(process.env.DIAG_SUPPLIER_PROFILES ?? '').toLowerCase() !== 'true') return;

  const { rows } = await pool.query<{
    id: string; name: string; phone: string | null; location: string | null;
    supplies: string | null; items: number; seen: number;
  }>(
    `SELECT s.id, s.name, s.phone, s.location, s.supplies,
            COALESCE(si.items,0)::int items, COALESCE(ro.seen,0)::int seen
       FROM suppliers s
       LEFT JOIN (
         SELECT lower(btrim(supplier_name)) k, count(*) items
           FROM supplier_items GROUP BY 1
       ) si ON si.k = lower(btrim(s.name))
       LEFT JOIN (
         SELECT lower(btrim(supplier_name)) k, count(*) seen
           FROM receipt_ocr WHERE COALESCE(payment_type,'purchase')<>'transfer'
           GROUP BY 1
       ) ro ON ro.k = lower(btrim(s.name))
      ORDER BY items DESC, seen DESC, s.name`,
  );

  const norm = (n: string) =>
    n.toLowerCase().replace(/[^a-z0-9؀-ۿ ]/g, ' ').replace(NOISE, ' ').replace(/\s+/g, ' ').trim();

  // 1) Duplicates: group by normalized key, report groups with >1 distinct name.
  const groups = new Map<string, typeof rows>();
  for (const r of rows) {
    const k = norm(r.name);
    if (!k) continue;
    (groups.get(k) ?? groups.set(k, []).get(k)!).push(r);
  }
  const dupes = [...groups.values()].filter((g) => new Set(g.map((x) => x.name.toLowerCase())).size > 1);
  console.log(`\n[sup-profiles] ═══ 1) POSSIBLE DUPLICATES (${dupes.length} groups) — pick one official name each ═══`);
  for (const g of dupes.sort((a, b) => b.reduce((s, x) => s + x.seen, 0) - a.reduce((s, x) => s + x.seen, 0))) {
    const variants = g.map((x) => `"${x.name}" (#${x.id}, ${x.seen}× seen, ${x.items} items${x.phone ? ', ph ' + x.phone : ''})`).join('  |  ');
    console.log(`[sup-profiles] DUP: ${variants}`);
  }

  // 2) Thin profiles among suppliers that actually appear on receipts.
  const thin = rows.filter((r) => r.seen > 0 && (!r.phone || !r.location || !r.supplies));
  console.log(`\n[sup-profiles] ═══ 2) THIN PROFILES (${thin.length} suppliers on receipts still missing phone/location/desc) ═══`);
  for (const r of thin.slice(0, 120)) {
    const miss = [!r.phone && 'phone', !r.location && 'location', !r.supplies && 'description'].filter(Boolean).join('+');
    console.log(`[sup-profiles] THIN: "${r.name}" (#${r.id}, ${r.seen}× seen) missing: ${miss}`);
  }
  if (thin.length > 120) console.log(`[sup-profiles] …and ${thin.length - 120} more thin profiles`);

  // 3) Finished profiles (only those we've actually bought from), richest first.
  const active = rows.filter((r) => r.items > 0 || r.seen > 0);
  console.log(`\n[sup-profiles] ═══ 3) PROFILES (${active.length} suppliers we've bought from) ═══`);
  for (const r of active) {
    console.log(`[sup-profiles] "${r.name}" · ${r.items} items · ${r.seen}× · ph=${r.phone ?? '-'} · loc=${r.location ?? '-'} · ${(r.supplies ?? '').slice(0, 90)}`);
  }
  console.log(`\n[sup-profiles] DONE — ${rows.length} suppliers total, ${active.length} bought-from, ${dupes.length} dup-groups, ${thin.length} thin`);
}
