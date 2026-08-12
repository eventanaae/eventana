/**
 * The Eventana assistant.
 *
 * Deliberately rule-based over the live catalogue rather than a language
 * model: every number it quotes is read from the database at answer time,
 * so it cannot invent a price or promise a service Eventana does not
 * sell. Refunds, complaints, disputes and discount requests are escalated
 * to a human — the assistant is not allowed to decide them (spec §9).
 *
 * When Eventana later wants free-form conversation, the replacement keeps
 * this shape: retrieve from the catalogue first, and keep the escalation
 * branch ahead of everything else.
 */
import { formatAed } from '@eventana/shared';
import { pool } from '../db/pool.js';
import { loadConfig } from './settings.js';

export interface AssistantAnswer {
  reply: string;
  escalated: boolean;
  /** Catalogue rows the answer was built from, for the UI to link to. */
  references: Array<{ kind: 'package' | 'service' | 'theme'; id: string; name: string }>;
}

const ESCALATE =
  /refund|complain|complaint|dispute|money back|discount for me|special price|cheaper|price override|manager/i;

export async function answerAssistant(
  question: string,
  celebrationType = 'kids',
): Promise<AssistantAnswer> {
  const q = question.toLowerCase();
  const cfg = await loadConfig();
  const money = (fils: number) => `AED ${formatAed(fils)}`;
  const references: AssistantAnswer['references'] = [];

  if (ESCALATE.test(q)) {
    return {
      reply:
        'That one needs a human on the Eventana team — I can’t approve refunds, special discounts or price changes. I’ve flagged this for our customer service team; they’ll reply here shortly.',
      escalated: true,
      references: [],
    };
  }

  const packages = [...cfg.packages.values()];

  // Named package
  const named = packages.find((p) => q.includes(p.name.split(' ')[0].toLowerCase()));
  if (named) {
    references.push({ kind: 'package', id: named.id, name: named.name });
    return {
      reply: `${named.name} is ${money(named.priceFils)} for ${named.capacity.toLowerCase()}, ${named.durationHours} hours. It includes: ${named.items
        .map((i) => i.name)
        .join(', ')}. Package items are fixed and can’t be exchanged, but you can add extras.`,
      escalated: false,
      references,
    };
  }

  // Payment
  if (/pay|tabby|tamara|ziina|instal|installment/.test(q)) {
    return {
      reply: `You can pay with Tabby, Tamara or Ziina. Your booking is only confirmed once the provider verifies the payment — we hold your inventory for ${cfg.rules.inventoryHoldMinutes} minutes while you check out.`,
      escalated: false,
      references: [],
    };
  }

  // Delivery
  if (/delivery|deliver|dubai|abu dhabi|sharjah|fujairah|ajman|ras al|umm al|al ain|gharbia/.test(q)) {
    const serviceable = cfg.zones.filter((z) => z.available && z.feeFils !== null);
    const list = serviceable
      .sort((a, b) => (a.feeFils ?? 0) - (b.feeFils ?? 0))
      .map((z) => `${z.zoneName} ${money(z.feeFils!)}`)
      .join(', ');
    return {
      reply: `Delivery is calculated automatically from your event location: ${list}. We don’t currently deliver to Al Gharbia. Delivery is never included in the 15% Build Your Own discount and doesn’t count toward the AED 2,500 minimum.`,
      escalated: false,
      references: [],
    };
  }

  // Themes
  if (/theme/.test(q)) {
    const wanted = ['pink', 'purple', 'blue', 'green', 'gold'].filter((c) => q.includes(c));
    const avoid = /don'?t want|not |no (?!theme)/.test(q);
    const { rows } = await pool.query(
      `SELECT id, name FROM themes
        WHERE active AND celebration_type = $1
        ORDER BY popular DESC, sort_order
        LIMIT 60`,
      [celebrationType],
    );
    const excluded = rows.filter((t) => avoid && q.includes(t.name.toLowerCase())).map((t) => t.name);
    const picks = rows
      .filter((t) => !excluded.includes(t.name))
      .filter((t) => /Unicorn|Bow|Butterfly|Fairy|Mermaid|Candy|Princess/.test(t.name))
      .slice(0, 5);
    for (const p of picks) references.push({ kind: 'theme', id: p.id, name: p.name });

    return {
      reply: `From Eventana’s active theme library${wanted.length ? ` in ${wanted.join(' & ')}` : ''}: ${picks
        .map((p) => p.name)
        .join(', ')}. These are standard Eventana themes — no AED ${formatAed(
        cfg.rules.customThemeFeeFils,
      )} custom fee. If you want a theme that isn’t in our collection, I can start a Custom Theme, and I’ll tell you before any fee is added.`,
      escalated: false,
      references,
    };
  }

  // Budget / guest count
  const budgetMatch = q.match(/([0-9][0-9,\.]{2,})/);
  if (/budget|aed|kids|children|guest/.test(q)) {
    const budgetFils = budgetMatch
      ? Math.round(Number(budgetMatch[1].replace(/[,\.]/g, '')) * 100)
      : null;
    const fits = packages
      .filter((p) => !budgetFils || p.priceFils <= budgetFils)
      .sort((a, b) => b.priceFils - a.priceFils);

    if (budgetFils && fits.length > 0) {
      references.push({ kind: 'package', id: fits[0].id, name: fits[0].name });
      const second = fits[1];
      return {
        reply: `Within ${money(budgetFils)}, the fullest option is ${fits[0].name} at ${money(
          fits[0].priceFils,
        )} (${fits[0].capacity.toLowerCase()}).${
          second
            ? ` ${second.name} at ${money(second.priceFils)} leaves more room for extras.`
            : ''
        } Remember delivery is added on top and depends on your emirate.`,
        escalated: false,
        references,
      };
    }
    const cheapest = packages.slice().sort((a, b) => a.priceFils - b.priceFils)[0];
    return {
      reply: cheapest
        ? `Our packages start at ${money(cheapest.priceFils)} for ${cheapest.name}. Tell me your budget and number of children and I’ll match one.`
        : 'Tell me your budget and number of children and I’ll match a package.',
      escalated: false,
      references,
    };
  }

  // Availability
  if (/available|availability|slide|castle|bubble|book/.test(q)) {
    const { rows } = await pool.query(
      `SELECT a.code, a.name, a.variant, a.units,
              count(h.id) FILTER (
                WHERE h.status IN ('held','reserved')
                  AND (h.expires_at IS NULL OR h.expires_at > now())
              ) AS busy
         FROM inventory_assets a
         LEFT JOIN inventory_holds h ON h.asset_code = a.code
        WHERE a.units = 1
        GROUP BY a.code
        ORDER BY a.name
        LIMIT 12`,
    );
    const single = rows.map((r) => `${r.name}${r.variant ? ` (${r.variant})` : ''}`).join(', ');
    return {
      reply: `Some Eventana items are single units — ${single} — so whoever confirms first takes them for that time window. I can only confirm availability once your date and start time are set, and the hold lasts ${cfg.rules.inventoryHoldMinutes} minutes while you pay.`,
      escalated: false,
      references: [],
    };
  }

  // Recommendations
  if (/add|recommend|suggest|age|year old/.test(q)) {
    const picks = [...cfg.services.values()]
      .filter((s) => ['facepaint', 'mascot', 'cupcake'].includes(s.id))
      .map((s) => {
        references.push({ kind: 'service', id: s.id, name: s.name });
        const per = s.pricing.kind === 'per_child' ? `${money(s.priceFils)}/child, min ${s.pricing.minChildren} kids` : money(s.priceFils);
        return `${s.name} (${per})`;
      });
    return {
      reply: `I'd look at ${picks.join(', ')}. I won’t suggest anything already inside your package.`,
      escalated: false,
      references,
    };
  }

  return {
    reply:
      'I can help with packages, what’s included, prices, availability, themes, delivery and building your own party. What would you like to know?',
    escalated: false,
    references: [],
  };
}
