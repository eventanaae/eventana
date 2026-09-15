/**
 * Apply the owner-approved supplier cleanup:
 *   • MERGE duplicate names → one canonical name. supplier_items rows are
 *     re-pointed to the canonical name and re-aggregated (times_bought summed,
 *     avg re-computed as a weighted mean, min/max/last carried). receipt_ocr
 *     rows keep their raw supplier_name (audit trail) but a supplier_alias map
 *     records canonical names for the future Supplier Dashboard.
 *   • DROP rows that aren't real suppliers (our own name on a transfer, the card
 *     terminal, the bank) — those receipts are transfers/payment-method slips.
 *   • Strip a phone that is actually the owner's own number.
 *
 * SUPPLIER_CLEANUP = 'dry'   → log what it WOULD do, change nothing.
 *                  = 'apply' → do it.
 */
import { pool } from './pool.js';

// variant (any case/spacing) → canonical official name. Left side is compared
// lower(btrim). Every name we saw for one real shop points to one canonical.
const CANON: Record<string, string> = {};
const map = (canonical: string, ...variants: string[]) => {
  CANON[canonical.toLowerCase()] = canonical;
  for (const v of variants) CANON[v.toLowerCase()] = canonical;
};

// ── 1) Safe merges (owner: "ادمج") ──────────────────────────────────────────
map('Day to Day',
  'day to day', 'day to day - international trading llc', 'day to day international trading llc',
  'day to day - international trading llc branch', 'day to day international trading llc branch',
  'international trading llc branch al barsha shop 1', 'international trading llc branch - al barsha shop 1',
  'day to day international trading llc branch al barsha shop 1',
  'day to day - international trading llc branch al barsha shop 1');
map('Lulu Hypermarket', 'lulu hypermarket llc', 'lulu hypermarket');
map("Women's World Textile Trading LLC",
  'womens world textile', 'womens world textile trading llc', "women's world textile trading llc",
  "women's world textile trading (llc)", 'botim money - womens world textile trading',
  'botim money - womens world textile trading llc');
map('Hotpack Packaging LLC',
  'hotpack packaging llc', 'hotpack packaging llc dubai branch', 'hotpack packaging llc - dubai branch',
  'pack packaging llc dubai branch');
map('Al Kabayel', 'al kabayel', 'al kabayel trading', 'al kabayet', 'alkabayel');
map('Al Jessour Building Materials Trading LLC',
  'al jessour building materials trading l.l.c', 'al jessour building materials trading (l.l.c)',
  'al jessour building materials trading (llc)', 'al jessour building materials trading llc');
map('New Qamar Trading LLC',
  'new qamar trading l.l.c', 'new qamar trading l.l.c.', 'new qamar trading llc');
map('Al Qadah Trading Co. LLC', 'al qadah trading co llc', 'al qadah trading co. llc');
map('Al Juddur Furniture Trading FZCO', 'al juddur furniture trading fzco', 'al juddur furniture trading');
map('Al Yafi Style General Trading LLC', 'al yafi style', 'al yafi style general trading llc');
map('Alter Ego by Mystique Gen. Trading LLC',
  'alter ego by mystique gen. trading llc', 'alter ego by mystique', 'aber ego by mystique gen. trading llc');
map('Cars Taxi Services Co. LLC', 'cars taxi services co', 'cars taxi services co llc');
map('Union Coop - Al Barsha', 'union coop - al barsha', 'union coop al barsha');
map('Vases Flower Trading FZCO', 'vases flower trading fzco', 'vases flower trading fz');
map('Petzone - Umm Suqeim', 'petzone ummsuqeim', 'petzone umm suqeim');
// ── 2) Confirm group (owner: "اللي تشوفه مناسب"; strip her phone) ────────────
map('Blue Rhine General Trading LLC',
  'blue rhine general trading l.l.c', 'blue rhine general trading l.l.c.');
map('Dubai World Trade Centre LLC', 'world trade centre', 'dubai world trade centre llc');
// Taxis / ride-hailing → one Transportation vendor (not a shop).
map('Transportation - Taxi / Ride',
  'uber', 'careem', 'uber (careem)', 'uber/careem', 'uber/careem ride service',
  'hala taxi', 'hala taxi dubai', 'hala taxi kabi', 'kabi taxi', 'taxi',
  'dubai taxi corporation', 'rta metro', 'cars taxi services co', 'cars taxi services co llc',
  '2 wheeler', '2 wheeler · a-92198 shahrukh khan rakesh');

// Owner's own phone that leaked onto a supplier from a transfer/contact field.
const OWNER_PHONES = ['0566069616', '+971 56 606 9616', '+971566069616', '971566069616', '566069616'];

// ── 3) Not real suppliers → deactivate (owner: transfers/us/card-machine) ────
// Bank = transfers (money we sent a person/supplier — the real counterparty is
// on the expense's vendor/recipient, handled in re-categorisation, not here).
// "Network" = the card-machine slip; its true merchant is recovered when we
// re-categorise. "Eventana"/"Sheem" = us (owner is the transfer beneficiary).
const NOT_SUPPLIERS = [
  // us (owner is the payer/beneficiary on the receipt, not a shop we buy from):
  'eventana', 'eventana events', 'eventana card', 'sheem',
  // the bank on transfer confirmations — real counterparty is the recipient:
  'adib', 'adib (abu dhabi islamic bank)', 'abu dhabi islamic bank (adib)',
  // the card-payment terminal — real merchant is in the slip's address/vendor,
  // recovered during re-categorisation (e.g. Ajman Grocery, Abdulla Kutait):
  'network',
  // the consolidated taxi row (from the merge below) — transport, not a shop.
  'transportation - taxi / ride',
  // NB: "Included Events" (#795) is a REAL decor supplier (AED 8k cake/decor) — kept.
];

export async function applySupplierCleanupFromEnv(): Promise<void> {
  const mode = String(process.env.SUPPLIER_CLEANUP ?? '').toLowerCase();
  if (mode !== 'dry' && mode !== 'apply') return;
  const dry = mode === 'dry';
  console.log(`[sup-clean] mode=${mode} · ${Object.keys(CANON).length} name mappings`);

  // Load current suppliers to plan the work.
  const sup = await pool.query<{ id: string; name: string; phone: string | null }>(
    `SELECT id, name, phone FROM suppliers`,
  );
  const canonOf = (n: string) => CANON[n.trim().toLowerCase()] ?? null;

  // Plan merges: group supplier rows by canonical target.
  const groups = new Map<string, { id: string; name: string; phone: string | null }[]>();
  for (const s of sup.rows) {
    const c = canonOf(s.name);
    if (!c) continue;
    (groups.get(c) ?? groups.set(c, []).get(c)!).push(s);
  }

  let merged = 0, removedRows = 0, phoneStripped = 0, deactivated = 0, itemsMoved = 0;

  for (const [canonical, members] of groups) {
    // Keep the row whose name already equals canonical, else the lowest id.
    const keep = members.find((m) => m.name === canonical) ?? members.slice().sort((a, b) => Number(a.id) - Number(b.id))[0];
    const drop = members.filter((m) => m.id !== keep.id);
    console.log(`[sup-clean] MERGE "${canonical}" ← ${members.map((m) => `"${m.name}"#${m.id}`).join(', ')} (keep #${keep.id}${drop.length ? ', drop ' + drop.map((d) => '#' + d.id).length : ''})`);
    if (dry) { merged += drop.length; continue; }

    // Rename the kept row to the canonical name; clear owner-phone if present.
    const keepPhoneBad = keep.phone && OWNER_PHONES.some((p) => (keep.phone ?? '').replace(/\s/g, '').includes(p.replace(/\s/g, '')));
    await pool.query(`UPDATE suppliers SET name=$2, phone = CASE WHEN $3 THEN NULL ELSE phone END WHERE id=$1`,
      [keep.id, canonical, keepPhoneBad]);
    // Pull a phone/location from a dropped row if the kept one lacks it (and it's not the owner's number).
    for (const d of drop) {
      await pool.query(
        `UPDATE suppliers k SET
           phone = COALESCE(NULLIF(btrim(k.phone),''), (SELECT phone FROM suppliers WHERE id=$2 AND phone IS NOT NULL)),
           location = COALESCE(NULLIF(btrim(k.location),''), (SELECT location FROM suppliers WHERE id=$2)),
           supplies = COALESCE(NULLIF(btrim(k.supplies),''), (SELECT supplies FROM suppliers WHERE id=$2))
         WHERE k.id=$1`, [keep.id, d.id]);
      await pool.query(`DELETE FROM suppliers WHERE id=$1`, [d.id]);
      removedRows++;
    }
    // Strip owner phone again after possible copy-in.
    const stripped = await pool.query(
      `UPDATE suppliers SET phone=NULL WHERE id=$1 AND phone IS NOT NULL AND (${OWNER_PHONES.map((_, i) => `replace(phone,' ','') LIKE '%'||$${i + 2}||'%'`).join(' OR ')})`,
      [keep.id, ...OWNER_PHONES.map((p) => p.replace(/\s/g, ''))],
    );
    phoneStripped += stripped.rowCount ?? 0;
    merged += drop.length;
  }

  // Re-point + re-aggregate supplier_items onto canonical names, rebuilt from
  // receipt_ocr (the source of truth) so counts/averages are exact — no
  // double-counting. Delete the variant rows first (separate statement), then
  // insert the canonical aggregate.
  if (!dry) {
    for (const [canonical] of groups) {
      const variants = Object.entries(CANON).filter(([, c]) => c === canonical).map(([v]) => v);
      await pool.query(`DELETE FROM supplier_items WHERE lower(supplier_name) = ANY($1)`, [variants]);
      const agg = await pool.query(
        `INSERT INTO supplier_items (supplier_name, item_name, times_bought, avg_price_fils, last_price_fils, min_price_fils, max_price_fils)
         SELECT $1, s.item_name, s.n,
                round(s.avg_price*100)::bigint, round(s.last_price*100)::bigint,
                round(s.min_price*100)::bigint, round(s.max_price*100)::bigint
           FROM (
             SELECT max(btrim(it->>'name')) AS item_name, count(*)::int AS n,
                    avg((it->>'unit_price')::numeric) AS avg_price,
                    min((it->>'unit_price')::numeric) AS min_price,
                    max((it->>'unit_price')::numeric) AS max_price,
                    (array_agg((it->>'unit_price')::numeric ORDER BY ro.created_at DESC))[1] AS last_price
               FROM receipt_ocr ro CROSS JOIN LATERAL jsonb_array_elements(COALESCE(ro.items,'[]'::jsonb)) it
              WHERE ro.status='ok' AND lower(btrim(ro.supplier_name)) = ANY($2)
                AND COALESCE(btrim(it->>'name'),'') <> ''
                AND (it->>'unit_price') ~ '^[0-9]+(\\.[0-9]+)?$'
              GROUP BY lower(btrim(it->>'name'))
           ) s
         ON CONFLICT (lower(supplier_name), lower(item_name)) DO UPDATE SET
           times_bought=EXCLUDED.times_bought, avg_price_fils=EXCLUDED.avg_price_fils,
           last_price_fils=EXCLUDED.last_price_fils, min_price_fils=EXCLUDED.min_price_fils,
           max_price_fils=EXCLUDED.max_price_fils, updated_at=now()`,
        [canonical, variants],
      );
      itemsMoved += agg.rowCount ?? 0;
    }
  }

  // Deactivate non-suppliers (keep the row for audit; active=false hides it).
  const deact = await pool.query(
    `UPDATE suppliers SET active=false WHERE lower(btrim(name)) = ANY($1) ${dry ? 'AND false' : ''} RETURNING name`,
    [NOT_SUPPLIERS],
  );
  if (dry) {
    const would = await pool.query(`SELECT name FROM suppliers WHERE lower(btrim(name)) = ANY($1)`, [NOT_SUPPLIERS]);
    console.log(`[sup-clean] WOULD deactivate non-suppliers: ${would.rows.map((r) => r.name).join(', ') || '(none)'}`);
  } else {
    deactivated = deact.rowCount ?? 0;
    console.log(`[sup-clean] deactivated non-suppliers: ${deact.rows.map((r) => r.name).join(', ') || '(none)'}`);
  }

  console.log(`[sup-clean] DONE (${mode}) — merged ${merged} dup rows, deleted ${removedRows}, items re-agg ${itemsMoved}, phones stripped ${phoneStripped}, deactivated ${deactivated}`);
}
