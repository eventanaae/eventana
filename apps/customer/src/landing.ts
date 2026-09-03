/**
 * Landing routes — the organic-search half of the customer app.
 *
 * Every visitor who finds Eventana on Google has to arrive somewhere that
 * repeats the words they typed. Until now the app had no URLs at all: one
 * screen, one address, so someone searching "ديكور بالونات" and someone
 * searching "corporate family day" both landed on the same home screen and had
 * to start over.
 *
 * This module is the route table. Each entry is one landing page: the slug is
 * the URL, the copy is the promise, and `celebrationType` is where the booking
 * journey opens when they tap the button.
 *
 * The content itself lives in `seo.json`, not here. That file is the single
 * source of truth shared with `scripts/prerender.mjs`, which bakes the same
 * words into static HTML at build time — because the crawlers that matter most
 * for AI answers (GPTBot, ClaudeBot, PerplexityBot) do not execute JavaScript,
 * so anything only React knows about is invisible to them. Change a price or a
 * headline in `seo.json` and both the app and the static HTML follow.
 */
import type { Lang } from './i18n';
import seo from './seo.json';

export interface LandingFaq {
  q: string;
  a: string;
}

export interface LandingCopy {
  /** <h1>. Must contain the search term almost verbatim. */
  headline: string;
  /** One line under the headline — the offer, not a slogan. */
  subhead: string;
  /** What is included. Six or fewer; these are scanned, not read. */
  includes: string[];
  /** The button. */
  cta: string;
  /** <title> and meta description. */
  title: string;
  description: string;
  /**
   * A plain paragraph stating what Eventana does, for whom, where and from
   * what price. This is the passage an AI assistant can quote back when
   * someone asks it to recommend a party organiser, so it carries real
   * numbers rather than adjectives.
   */
  intro: string;
  /** Questions customers actually ask, answered with real prices. */
  faq: LandingFaq[];
}

export interface LandingRoute {
  /** URL path, without the leading slash. */
  slug: string;
  /** Which journey the CTA opens — a value of Draft['celebrationType']. */
  celebrationType: string;
  /** The emirate this page is about, when it is a place page rather than a
   *  service page. Absent on service pages. */
  areaName?: string;
  en: LandingCopy;
  ar: LandingCopy;
}

/**
 * Every landing page, in sitemap order.
 *
 * The cast goes through `unknown` on purpose: TypeScript infers the JSON as a
 * union of object literals — the emirate pages carry `areaName` and the
 * service pages do not — and a direct assertion between a union and an
 * interface with an optional field is rejected as possibly mistaken. The
 * shape is guaranteed by seo.json itself.
 */
export const LANDING_ROUTES: LandingRoute[] = (seo.pages as unknown as LandingRoute[]).map((p) => ({
  slug: p.slug,
  celebrationType: p.celebrationType,
  areaName: p.areaName,
  en: p.en,
  ar: p.ar,
}));

/** The landing page for the current URL, or null for the app's own routes. */
export function landingFromPath(pathname = window.location.pathname): LandingRoute | null {
  const slug = pathname.replace(/^\/+|\/+$/g, '').toLowerCase();
  if (!slug) return null;
  return LANDING_ROUTES.find((r) => r.slug === slug) ?? null;
}

/** The copy for the visitor's language. */
export function landingCopy(route: LandingRoute, lang: Lang): LandingCopy {
  return lang === 'ar' ? route.ar : route.en;
}
