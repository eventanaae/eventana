/**
 * Diagnostic: list every TRANSFER counterparty (a person/shop we SENT money to,
 * e.g. via ADIB), with how many transfers, the total AED, the date range, and a
 * best-guess bucket (driver | part-timer | fabrication | supplier | unknown).
 * The owner confirms who is who so re-categorisation routes each transfer right
 * (driver→Transportation, part-timer→Part-Timers, fabrication→Fabrication, …).
 * Read-only. Gated DIAG_TRANSFERS=true.
 */
import { pool } from './pool.js';

// Best-guess buckets from names we've already seen in the data + owner notes.
const DRIVERS = ['zufer', 'arfan', 'abraiz', 'abdul majeed', 'masih', 'muhammad rashid', 'rashid', 'ijaz', 'obaid', 'majid', 'abdulillah', 'shan'];
const PARTTIMERS = ['lady gonzalez', 'dindo', 'joeven', 'norba', 'gonzalez', 'tumbaga', 'ignacio', 'boron'];
const FABRICATION = ['zaki', 'alaa', 'almouie', 'almouje']; // stands/kiosks/woodwork (owner-confirmed Zaki+Alaa)
const SUPPLIERS = ['blue rhine', 'eon print', 'party time', 'al yaqeen', 'click way', 'gravitas', 'sharifco', 'kuwaiti danish', 'balloons co', 'stationery', 'textile', 'trading'];

function guess(name: string): string {
  const n = name.toLowerCase();
  if (FABRICATION.some((k) => n.includes(k))) return 'fabrication';
  if (DRIVERS.some((k) => n.includes(k))) return 'driver';
  if (PARTTIMERS.some((k) => n.includes(k))) return 'part-timer';
  if (SUPPLIERS.some((k) => n.includes(k))) return 'supplier';
  return 'UNKNOWN — ask';
}

export async function diagTransferRecipientsFromEnv(): Promise<void> {
  if (String(process.env.DIAG_TRANSFERS ?? '').toLowerCase() !== 'true') return;

  // A transfer = OCR said payment_type='transfer', OR the "supplier" is the bank
  // (ADIB), OR the item text is a bank "Transfer …". Counterparty = the recipient
  // if we have it, else the expense's own vendor (which is usually the real name).
  const { rows } = await pool.query<{ who: string; n: number; fils: string; first: string; last: string; vendors: string }>(
    `WITH tx AS (
       SELECT ro.expense_id,
              COALESCE(NULLIF(btrim(ro.recipient),''), NULLIF(btrim(e.vendor),''), NULLIF(btrim(ro.supplier_name),'')) AS who,
              COALESCE(ro.total_fils, e.amount_fils, 0) AS fils,
              e.spent_on, e.vendor
         FROM receipt_ocr ro JOIN expenses e ON e.id = ro.expense_id
        WHERE COALESCE(ro.payment_type,'') = 'transfer'
           OR lower(COALESCE(ro.supplier_name,'')) LIKE '%adib%'
           OR lower(COALESCE(ro.supplier_name,'')) LIKE '%islamic bank%'
           OR EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(ro.items,'[]'::jsonb)) it
                       WHERE lower(it->>'name') LIKE 'transfer%')
     )
     SELECT who, count(*)::int n, sum(fils)::bigint fils,
            to_char(min(spent_on),'YYYY-MM') first, to_char(max(spent_on),'YYYY-MM') last,
            string_agg(DISTINCT vendor, ' | ') vendors
       FROM tx WHERE COALESCE(btrim(who),'') <> ''
      GROUP BY who ORDER BY sum(fils) DESC`,
  );

  console.log(`[transfers] ${rows.length} distinct transfer counterparties`);
  const buckets: Record<string, { n: number; fils: number }> = {};
  for (const r of rows) {
    const g = guess(r.who);
    buckets[g] = buckets[g] ?? { n: 0, fils: 0 };
    buckets[g].n += r.n; buckets[g].fils += Number(r.fils);
    console.log(`[transfers] ${g.padEnd(16)} | AED ${(Number(r.fils) / 100).toFixed(0).padStart(7)} | ${String(r.n).padStart(3)}× | ${r.first}→${r.last} | "${r.who}"${r.vendors && r.vendors !== r.who ? ' · vendor: ' + r.vendors.slice(0, 60) : ''}`);
  }
  console.log(`[transfers] ── totals by bucket ──`);
  for (const [g, v] of Object.entries(buckets).sort((a, b) => b[1].fils - a[1].fils)) {
    console.log(`[transfers] ${g.padEnd(16)} AED ${(v.fils / 100).toFixed(0).padStart(8)} across ${v.n} transfers`);
  }
  console.log(`[transfers] DONE`);
}
