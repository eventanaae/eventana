/**
 * One-shot: tidy theme names in sale_themes for clean analysis. An explicit
 * CANON map merges known variants/typos to one canonical name; anything else is
 * lightly cleaned (strip emoji, collapse spaces, drop a trailing "Theme",
 * Title-Case with a VTC whitelist). Never blanks a value. Ambiguous names
 * (a lone emoji, "The 🎀", "Bow theme Graduation") are left untouched.
 * CLEAN_THEMES = 'dry' (report) | 'apply' (write). Idempotent.
 */
import { pool } from './pool.js';

// Exact raw theme string → canonical. (Owner-approved merges incl. Carnaval=
// Carnival and Glam Doll = Glam Doll Show.)
const CANON: Record<string, string> = {
  'Bow': 'Bow', 'Bow 🎀': 'Bow', 'Bow Theme': 'Bow', 'Bow Theme 🎀': 'Bow',
  'Ballerina': 'Ballerina', 'Ballerina theme': 'Ballerina',
  'Carnaval': 'Carnival', 'Carnaval 🎡': 'Carnival', 'Carnaval 🎈': 'Carnival',
  'Carnival 🎡': 'Carnival', 'carnival': 'Carnival', 'Carnival 🎪': 'Carnival',
  'Disney Princess 👸': 'Disney Princess', 'Disney Princess 👑': 'Disney Princess',
  'Fairy 🧚': 'Fairy', 'Fairy': 'Fairy', 'Fairy theme 🧚': 'Fairy',
  'Frozen Theme': 'Frozen', 'Frozen': 'Frozen',
  'Glam Doll Show 💃💃': 'Glam Doll Show', 'Glam doll show 💃': 'Glam Doll Show',
  'Glam doll show💃': 'Glam Doll Show', 'Glam Doll Show 💃': 'Glam Doll Show', 'Glam Doll': 'Glam Doll Show',
  'Hello kitty 🩷': 'Hello Kitty', 'Hello Kitty': 'Hello Kitty',
  'Jungle 🦁': 'Jungle', 'Jungle Theme 🦁': 'Jungle', 'Jungle': 'Jungle', 'Jungle Theme': 'Jungle',
  'Mermaid 🧜‍♀️': 'Mermaid', 'Mermaid': 'Mermaid', 'Mermaid Theme🧜‍♀️': 'Mermaid',
  'Little Mermaid 🧜‍♀️': 'Little Mermaid',
  'Pink Ribbon 🎀': 'Pink Ribbon', 'PINK RIBBON 🎀': 'Pink Ribbon',
  'polo': 'Polo', 'Polo': 'Polo',
  'Stitch': 'Stitch', 'Stitch 🥳': 'Stitch',
  'toy story': 'Toy Story', 'Toy Story 🧸': 'Toy Story',
  'Unicorn 🦄': 'Unicorn', 'Unicorn': 'Unicorn', 'Unicorn🦄': 'Unicorn',
  'VTC': 'VTC', 'VTC 🚙': 'VTC', 'Vtc Car 🚙': 'VTC', 'Vtc main stand': 'VTC',
  'Winni The Poo': 'Winnie the Pooh', 'Winnie & pooh': 'Winnie the Pooh', 'Winnie The Pooh 🎈': 'Winnie the Pooh',
  'Stich and lilo💙': 'Stitch & Lilo', 'Stich & Lilo 🌴': 'Stitch & Lilo', 'Stitch n Lilo🩷💙🌺': 'Stitch & Lilo',
  'Stitch and angel 💙🩷': 'Stitch & Angel',
  'Minni Mouse 🐭': 'Minnie Mouse',
  'Lighting Mqueen': 'Lightning McQueen',
  'Super Mario': 'Super Mario', 'Mario Theme': 'Super Mario',
  'gender reveal': 'Gender Reveal',
  'Spider Man + Mermaid': 'Spiderman & Mermaid',
};

// Leave these exactly as they are (ambiguous — owner to review).
const LEAVE = new Set(['🎀', 'The 🎀', 'Bow theme Graduation 🎀']);

const stripEmoji = (s: string): string =>
  s.replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}\u{FE0F}\u{200D}\u{2640}\u{2642}]/gu, '');

const UP = new Set(['vtc', 'tv', 'enbd']);
function generalClean(s: string): string {
  let t = stripEmoji(s).replace(/\s+/g, ' ').trim();
  t = t.replace(/\s*theme\s*$/i, '').trim();
  if (!t || t.length < 2) return s.trim(); // never blank / too short → keep original
  return t.split(' ').map((w) => {
    if (!w) return w;
    if (UP.has(w.toLowerCase())) return w.toUpperCase();
    if (/[+&]/.test(w)) return w;
    return w[0].toUpperCase() + w.slice(1).toLowerCase();
  }).join(' ');
}

function canonical(raw: string): string {
  if (LEAVE.has(raw)) return raw;
  if (CANON[raw]) return CANON[raw];
  return generalClean(raw);
}

export async function cleanThemeNamesFromEnv(): Promise<void> {
  const mode = String(process.env.CLEAN_THEMES ?? '').toLowerCase();
  if (mode !== 'dry' && mode !== 'apply') return;
  const { rows } = await pool.query<{ theme: string; n: number }>(
    `SELECT theme, count(*)::int n FROM sale_themes WHERE COALESCE(btrim(theme),'') <> '' GROUP BY theme`,
  );
  const changes = rows
    .map((r) => ({ from: r.theme, to: canonical(r.theme), n: r.n }))
    .filter((c) => c.to !== c.from);
  const distinctAfter = new Set(rows.map((r) => canonical(r.theme))).size;
  console.log(`[clean-themes] distinct before=${rows.length} · after=${distinctAfter} · rows to rename=${changes.reduce((s, c) => s + c.n, 0)} (${changes.length} name changes)`);
  for (const c of changes) console.log(`[clean-themes]   ${mode === 'apply' ? 'RENAME' : 'would rename'} "${c.from}" → "${c.to}" (${c.n})`);

  if (mode === 'apply') {
    let done = 0;
    for (const c of changes) {
      const r = await pool.query(`UPDATE sale_themes SET theme = $2, updated_at = now() WHERE theme = $1`, [c.from, c.to]);
      done += r.rowCount ?? 0;
    }
    console.log(`[clean-themes] APPLIED — ${done} rows updated`);
  } else {
    console.log('[clean-themes] DRY RUN — nothing written.');
  }
}
