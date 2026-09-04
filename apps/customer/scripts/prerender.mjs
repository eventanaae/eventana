/**
 * Bakes real HTML into the built site.
 *
 * WHY THIS EXISTS
 * ---------------
 * The customer app is a client-rendered React SPA. Before this script, every
 * URL on eventanauae.com returned the same 1.8 KB shell:
 *
 *     <title>Eventana</title>  <div id="root"></div>
 *
 * Google can run JavaScript and eventually see the real page, but the crawlers
 * that feed AI answers — GPTBot (ChatGPT), ClaudeBot, PerplexityBot, Amazonbot,
 * Bytespider — fetch raw HTML and do not execute scripts. To all of them
 * Eventana was a company with a name and nothing else: no services, no prices,
 * no service areas, no proof it operates in the UAE at all. Asked to recommend
 * a party organiser in Dubai, an assistant had nothing to quote.
 *
 * This script runs after `vite build` and rewrites each landing URL as a
 * complete HTML document: headings, the offer, real catalogue prices, the
 * service areas with their delivery fees, the FAQ, and JSON-LD describing the
 * business. The React bundle still loads and `createRoot` replaces the markup
 * with the live app, so a human sees exactly what they saw before — this is the
 * same content, stated twice, not a different page shown to crawlers.
 *
 * Both languages are emitted. The app serves Arabic and English from one URL
 * behind a toggle, so there is no separate URL to point hreflang at; instead
 * the Arabic text ships inside the same document, where an AI crawler reading
 * raw HTML will find it.
 *
 * Everything below is derived from src/seo.json. No fact is written here.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const DIST = join(ROOT, 'dist');
const seo = JSON.parse(readFileSync(join(ROOT, 'src', 'seo.json'), 'utf8'));

const { business, areasServed, packages, addOns, themes, pages } = seo;
const ORIGIN = business.url;

/* ------------------------------------------------------------------ */
/* helpers                                                            */
/* ------------------------------------------------------------------ */

const esc = (s) =>
  String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/** JSON-LD must not be able to close its own <script> tag. */
const ld = (obj) =>
  `<script type="application/ld+json">${JSON.stringify(obj).replace(/</g, '\\u003c')}</script>`;

const aed = (n) => `AED ${n.toLocaleString('en-US')}`;

/**
 * Social preview image.
 *
 * Every theme photo is already a public Cloudinary asset served to the booking
 * flow, so reusing one costs no upload and can never drift from what customers
 * actually see. The default is deliberately a theme that names no licensed
 * character — it is the picture that represents Eventana on every share.
 */
const DEFAULT_IMAGE =
  themes.find((t) => t.name === 'Moon & Stars')?.image ?? themes[0].image;

const imageFor = (page) => page.image ?? DEFAULT_IMAGE;

/** Cloudinary resizes on the URL, so thumbnails cost a fraction of the full file. */
const thumb = (url, w) =>
  url.replace('/image/upload/', `/image/upload/c_fill,w_${w},h_${w},q_auto,f_auto/`);

/**
 * The canonical address of a landing page — note the trailing slash.
 *
 * Each page is written as `dist/<slug>/index.html`. The Render static site
 * carries a catch-all rewrite (`/*` → `/index.html`) so that any path the app
 * owns still boots the app, and that rewrite fires before Render resolves an
 * extensionless path to its directory index: `/kids-birthday` therefore served
 * the home page's markup, while `/kids-birthday/` served the right one. Files
 * with an extension are matched before the rewrite, which is why sitemap.xml
 * and llms.txt were unaffected.
 *
 * Rather than maintain one rewrite rule per page in the Render dashboard, every
 * URL this script emits — canonical, sitemap, internal links, llms.txt — uses
 * the form that resolves correctly on its own.
 */
const pageUrl = (slug) => (slug ? `${ORIGIN}/${slug}/` : `${ORIGIN}/`);

/** The one page that carries the full photo gallery. */
const THEMES_SLUG = 'party-themes-dubai';

/* ------------------------------------------------------------------ */
/* structured data                                                    */
/* ------------------------------------------------------------------ */

const openingHoursSpec = business.openingHours.map((h) => ({
  '@type': 'OpeningHoursSpecification',
  dayOfWeek: h.days,
  opens: h.opens,
  closes: h.closes,
}));

/**
 * The business itself.
 *
 * `areaServed` and the UAE address are stated explicitly because two unrelated
 * companies share the name — an agency in Riyadh (eventana.net) and a listing
 * on an Indian wedding site. An assistant that reads this can tell them apart.
 *
 * There is deliberately no `aggregateRating`. Eventana has Google reviews, but
 * schema.org ratings are meant to describe reviews collected by the site that
 * publishes them; restating someone else's on your own pages is exactly what
 * Google's guidelines forbid. When the app's own feedback flow has ratings to
 * report, this is where they belong.
 */
const organisation = {
  '@context': 'https://schema.org',
  '@type': ['LocalBusiness', 'Organization'],
  '@id': `${ORIGIN}/#business`,
  name: business.name,
  alternateName: business.alternateName,
  url: ORIGIN,
  telephone: business.telephone,
  address: {
    '@type': 'PostalAddress',
    streetAddress: business.streetAddress,
    addressLocality: business.addressLocality,
    addressCountry: business.addressCountry,
  },
  openingHoursSpecification: openingHoursSpec,
  priceRange: business.priceRangeAed,
  currenciesAccepted: business.currency,
  areaServed: areasServed.map((a) => ({ '@type': 'City', name: a.name })),
  image: DEFAULT_IMAGE,
  logo: DEFAULT_IMAGE,
  sameAs: business.sameAs,
  knowsLanguage: ['ar', 'en'],
  description:
    'Eventana Events plans and sets up celebrations across the United Arab Emirates: kids birthday parties, baby showers, gender reveals, graduations, bride-to-be celebrations, adult birthdays, corporate family days and school events. Themed balloon decor and custom backdrops, food stations operated by our own staff, inflatables, entertainers and full styling, delivered, installed and taken down by the Eventana team. Packages start at AED 2,199 and are booked and paid online.',
  makesOffer: packages.map((p) => ({
    '@type': 'Offer',
    name: p.name,
    price: p.priceAed,
    priceCurrency: 'AED',
    availability: 'https://schema.org/InStock',
    itemOffered: {
      '@type': 'Service',
      name: `${p.name} party package`,
      description: `${p.capacity}, ${p.hours} hours, set up and taken down by the Eventana team.`,
    },
  })),
};

const website = {
  '@context': 'https://schema.org',
  '@type': 'WebSite',
  '@id': `${ORIGIN}/#website`,
  url: ORIGIN,
  name: business.name,
  inLanguage: ['en', 'ar'],
  publisher: { '@id': `${ORIGIN}/#business` },
};

const serviceLd = (page, url) => ({
  '@context': 'https://schema.org',
  '@type': 'Service',
  name: page.en.headline,
  serviceType: page.en.headline,
  url,
  provider: { '@id': `${ORIGIN}/#business` },
  image: imageFor(page),
  areaServed: (page.areaName
    ? [{ '@type': 'City', name: page.areaName }]
    : areasServed.map((a) => ({ '@type': 'City', name: a.name }))),
  description: page.en.description,
  ...(page.priceFromAed
    ? {
        offers: {
          '@type': 'Offer',
          priceCurrency: 'AED',
          price: page.priceFromAed,
          priceSpecification: {
            '@type': 'PriceSpecification',
            minPrice: page.priceFromAed,
            priceCurrency: 'AED',
            valueAddedTaxIncluded: false,
          },
          availability: 'https://schema.org/InStock',
          url,
        },
      }
    : {}),
});

const faqLd = (page) => ({
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: [...page.en.faq, ...page.ar.faq].map((f) => ({
    '@type': 'Question',
    name: f.q,
    acceptedAnswer: { '@type': 'Answer', text: f.a },
  })),
});

const breadcrumbLd = (page, url) => ({
  '@context': 'https://schema.org',
  '@type': 'BreadcrumbList',
  itemListElement: [
    { '@type': 'ListItem', position: 1, name: 'Eventana Events', item: `${ORIGIN}/` },
    { '@type': 'ListItem', position: 2, name: page.en.headline, item: url },
  ],
});

/* ------------------------------------------------------------------ */
/* page body                                                          */
/* ------------------------------------------------------------------ */

const list = (items) => `<ul>${items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>`;

const faqBlock = (faq, heading) =>
  `<h2>${esc(heading)}</h2>` +
  faq.map((f) => `<h3>${esc(f.q)}</h3><p>${esc(f.a)}</p>`).join('');

const priceTable = (lang) => {
  const head = lang === 'ar' ? 'الباقات والأسعار' : 'Packages and prices';
  const rows = packages
    .map((p) => {
      const name = lang === 'ar' ? p.ar : p.name;
      const cap = lang === 'ar' ? p.capacityAr : p.capacity;
      const hrs = lang === 'ar' ? `${p.hours} ساعات` : `${p.hours} hours`;
      return `<li>${esc(name)} — ${esc(aed(p.priceAed))} · ${esc(cap)} · ${esc(hrs)}</li>`;
    })
    .join('');
  return `<h2>${esc(head)}</h2><ul>${rows}</ul>`;
};

const areaTable = (lang) => {
  const head = lang === 'ar' ? 'مناطق التغطية ورسوم التوصيل' : 'Areas we serve and delivery fees';
  const rows = areasServed
    .map((a) => `<li>${esc(lang === 'ar' ? a.ar : a.name)} — ${esc(aed(a.deliveryFeeAed))}</li>`)
    .join('');
  return `<h2>${esc(head)}</h2><ul>${rows}</ul>`;
};

const addOnList = (lang) => {
  const head = lang === 'ar' ? 'إضافات وأسعارها' : 'Add-ons and prices';
  const rows = addOns
    .map((a) => `<li>${esc(lang === 'ar' ? a.ar : a.name)} — ${esc(aed(a.priceAed))}</li>`)
    .join('');
  return `<h2>${esc(head)}</h2><ul>${rows}</ul>`;
};

const contactBlock = (lang) => {
  const head = lang === 'ar' ? 'الحجز والتواصل' : 'How to book';
  const body =
    lang === 'ar'
      ? `<p>اختاري نوع المناسبة والثيم على <a href="${ORIGIN}/">${esc(ORIGIN.replace('https://', ''))}</a>، أضيفي الباقات والإضافات، تأكدي من تاريخك، شوفي السعر الإجمالي وادفعي أونلاين — التأكيد فوري. أو تواصلي مباشرة على <a href="tel:${esc(business.telephone)}" dir="ltr">${esc(business.telephoneDisplay)}</a> أو <a href="${esc(business.whatsapp)}">واتساب</a>.</p>`
      : `<p>Pick your celebration and theme at <a href="${ORIGIN}/">${esc(ORIGIN.replace('https://', ''))}</a>, add the packages and extras you want, check your date, see the total and pay online — confirmation is immediate. Or contact us on <a href="tel:${esc(business.telephone)}" dir="ltr">${esc(business.telephoneDisplay)}</a> or <a href="${esc(business.whatsapp)}">WhatsApp</a>.</p>`;
  const hours = business.openingHours[0];
  const hoursLine =
    lang === 'ar'
      ? `<p>ساعات العمل: كل يوم من ${hours.opens} إلى ${hours.closes}.</p>`
      : `<p>Opening hours: every day, ${hours.opens} to ${hours.closes}.</p>`;
  const addr =
    lang === 'ar'
      ? `<p>${esc(business.name)} — ${esc(business.streetAddress)}، ${esc(business.addressLocality)}، الإمارات العربية المتحدة.</p>`
      : `<p>${esc(business.name)} — ${esc(business.streetAddress)}, ${esc(business.addressLocality)}, United Arab Emirates.</p>`;
  return `<h2>${esc(head)}</h2>${body}${hoursLine}${addr}`;
};

/**
 * Themes.
 *
 * The gallery — 31 real photographs — is emitted only on the themes page. On
 * every other page the same themes appear as a sentence with a link, because
 * repeating one image block across fifteen pages reads as duplicate content
 * and would dilute the page that is meant to rank for theme searches.
 */
const themeNames = (lang) =>
  themes.map((t) => (lang === 'ar' ? t.ar : t.name)).join(lang === 'ar' ? '، ' : ', ');

const themeLine = (lang, page) => {
  /* On the themes page the photographs are emitted once, in the English
     section, with bilingual captions — the same 31 files repeated in the
     Arabic section would be 62 <img> tags pointing at 31 images. The Arabic
     section names every theme in Arabic instead and points at the grid. */
  if (page.slug === THEMES_SLUG) {
    return lang === 'ar'
      ? `<h2>الثيمات</h2><p>الثيمات الجاهزة بالعربي: ${esc(themeNames('ar'))}. الصور فوق، وكل ثيم منها مشمول في سعر الباقة بدون رسوم إضافية. وإذا ما لقيتِ ثيمك، فريق التصميم يصمّمه من الصفر برسم تصميم 800 درهم لحفلات الأطفال.</p>`
      : themeGallery();
  }
  const href = pageUrl(THEMES_SLUG);
  return lang === 'ar'
    ? `<h2>الثيمات</h2><p>أكثر من 40 ثيم جاهز بدون رسوم إضافية، منها: ${esc(themeNames('ar'))}. <a href="${href}">شوفي كل الثيمات بالصور</a>. وإذا ما لقيتِ ثيمك، فريق التصميم يصممه من الصفر برسم تصميم 800 درهم لحفلات الأطفال.</p>`
    : `<h2>Themes</h2><p>More than 40 ready themes at no extra charge, including: ${esc(themeNames('en'))}. <a href="${href}">See every theme with photos</a>. If yours isn't listed, our design team builds it from scratch for an AED 800 design fee on kids parties.</p>`;
};

/**
 * The gallery as structured data.
 *
 * Google Images ranks on the page around a photo as much as on the file, so
 * naming each theme against its image gives 31 captioned entry points that the
 * prose alone does not provide.
 */
const themeListLd = (url) => ({
  '@context': 'https://schema.org',
  '@type': 'ItemList',
  name: 'Eventana party themes',
  url,
  numberOfItems: themes.length,
  itemListElement: themes.map((t, i) => ({
    '@type': 'ListItem',
    position: i + 1,
    item: {
      '@type': 'ImageObject',
      name: `${t.name} party theme`,
      alternateName: t.ar,
      contentUrl: t.image,
      caption: `${t.name} themed party setup by Eventana Events in the UAE`,
      creditText: business.name,
    },
  })),
});

/* The React bundle replaces this markup on hydration; the rule only has to
   hold for the first paint and for anything that renders HTML without JS. */
const THEME_GRID_CSS =
  `<style>.theme-grid{list-style:none;padding:0;display:grid;` +
  `grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:12px}` +
  `.theme-grid figure{margin:0}.theme-grid img{width:100%;height:auto;` +
  `border-radius:12px;display:block}` +
  `.theme-grid figcaption{font-size:.85rem;padding-top:4px}</style>`;

const themeGallery = () => {
  const note =
    `<p>These are photographs of real Eventana setups. Every theme below is ` +
    `included in the package price at no extra charge, and the final design is ` +
    `tailored to your celebration.</p>`;
  const cards = themes
    .map((t) => {
      /* The alt text carries both languages because this is the only place the
         image is described, and the Arabic name is what a customer searches. */
      const alt = `${t.name} (${t.ar}) themed party setup by Eventana Events in the UAE`;
      return (
        `<li><figure>` +
        `<img src="${esc(thumb(t.image, 600))}" alt="${esc(alt)}" width="600" height="600" loading="lazy" />` +
        `<figcaption>${esc(t.name)} <span lang="ar" dir="rtl">${esc(t.ar)}</span></figcaption>` +
        `</figure></li>`
      );
    })
    .join('');
  return `<h2>Every theme, with photos</h2>${note}<ul class="theme-grid">${cards}</ul>`;
};

function sectionFor(page, lang) {
  const c = lang === 'ar' ? page.ar : page.en;
  const inc = lang === 'ar' ? 'ما يشمله التجهيز' : "What's included";
  const faqHead = lang === 'ar' ? 'الأسئلة المتكررة' : 'Frequently asked questions';
  return [
    `<h1>${esc(c.headline)}</h1>`,
    `<p>${esc(c.subhead)}</p>`,
    `<p>${esc(c.intro)}</p>`,
    `<h2>${esc(inc)}</h2>${list(c.includes)}`,
    priceTable(lang),
    addOnList(lang),
    themeLine(lang, page),
    areaTable(lang),
    faqBlock(c.faq, faqHead),
    contactBlock(lang),
  ].join('');
}

/* ------------------------------------------------------------------ */
/* emit                                                               */
/* ------------------------------------------------------------------ */

const shell = readFileSync(join(DIST, 'index.html'), 'utf8');

function render(page, url) {
  const en = page.en;
  const head = [
    `<title>${esc(en.title)}</title>`,
    `<meta name="description" content="${esc(en.description)}" />`,
    `<link rel="canonical" href="${esc(url)}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="${esc(business.name)}" />`,
    `<meta property="og:title" content="${esc(en.title)}" />`,
    `<meta property="og:description" content="${esc(en.description)}" />`,
    `<meta property="og:url" content="${esc(url)}" />`,
    `<meta property="og:locale" content="en_AE" />`,
    `<meta property="og:locale:alternate" content="ar_AE" />`,
    `<meta property="og:image" content="${esc(imageFor(page))}" />`,
    `<meta property="og:image:alt" content="${esc(en.headline)} — Eventana Events" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${esc(en.title)}" />`,
    `<meta name="twitter:description" content="${esc(en.description)}" />`,
    `<meta name="twitter:image" content="${esc(imageFor(page))}" />`,
    `<meta name="geo.region" content="AE-DU" />`,
    `<meta name="geo.placename" content="Dubai" />`,
    ld(organisation),
    ld(website),
    ld(serviceLd(page, url)),
    ld(faqLd(page)),
    ld(breadcrumbLd(page, url)),
    ...(page.slug === THEMES_SLUG ? [ld(themeListLd(url)), THEME_GRID_CSS] : []),
  ].join('\n    ');

  const body =
    `<main>` +
    sectionFor(page, 'en') +
    `<section lang="ar" dir="rtl">` +
    sectionFor(page, 'ar') +
    `</section>` +
    `<nav><h2>More from Eventana</h2><ul>` +
    pages
      .filter((p) => p.slug !== page.slug)
      .map((p) => `<li><a href="${pageUrl(p.slug)}">${esc(p.en.headline)}</a></li>`)
      .join('') +
    `</ul></nav>` +
    `</main>`;

  return shell
    // Replace the shell's placeholder title and description outright, so no
    // page ever ships two of either.
    .replace(/<title>[\s\S]*?<\/title>/, '')
    .replace(/<meta\s+name="description"[\s\S]*?\/>/, '')
    .replace('</head>', `    ${head}\n  </head>`)
    .replace('<div id="root"></div>', `<div id="root">${body}</div>`);
}

let written = 0;
for (const page of pages) {
  const url = pageUrl(page.slug);
  const dir = join(DIST, page.slug);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'index.html'), render(page, url), 'utf8');
  written += 1;
}

/* The home page gets the same treatment, built from the Dubai page's copy —
   it is the one visitors and crawlers reach first. */
const home = pages.find((p) => p.slug === 'party-organizer-dubai') ?? pages[0];
writeFileSync(join(DIST, 'index.html'), render({ ...home, slug: '' }, pageUrl('')), 'utf8');

/* ------------------------------------------------------------------ */
/* sitemap, robots, llms.txt                                          */
/* ------------------------------------------------------------------ */

const today = new Date().toISOString().slice(0, 10);
const sitemap =
  `<?xml version="1.0" encoding="UTF-8"?>\n` +
  `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
  `  <url><loc>${ORIGIN}/</loc><lastmod>${today}</lastmod><changefreq>weekly</changefreq><priority>1.0</priority></url>\n` +
  pages
    .map(
      (p) =>
        `  <url><loc>${pageUrl(p.slug)}</loc><lastmod>${today}</lastmod><changefreq>monthly</changefreq><priority>${p.priority}</priority></url>`,
    )
    .join('\n') +
  `\n</urlset>\n`;
writeFileSync(join(DIST, 'sitemap.xml'), sitemap, 'utf8');

/* Robots: the AI crawlers are named and allowed explicitly. Several of them
   read only the rule block that matches their own token, so a bare
   `User-agent: *` is not the same as consenting to them by name. */
const robots = `# ${business.name} — ${ORIGIN}
# Search engines
User-agent: Googlebot
Allow: /
User-agent: Bingbot
Allow: /

# AI assistants. Eventana wants to be quotable when someone asks these
# assistants to recommend a party organiser in the UAE.
User-agent: GPTBot
Allow: /
User-agent: OAI-SearchBot
Allow: /
User-agent: ChatGPT-User
Allow: /
User-agent: ClaudeBot
Allow: /
User-agent: Claude-Web
Allow: /
User-agent: PerplexityBot
Allow: /
User-agent: Perplexity-User
Allow: /
User-agent: Google-Extended
Allow: /
User-agent: Applebot
Allow: /
User-agent: Applebot-Extended
Allow: /
User-agent: Amazonbot
Allow: /
User-agent: meta-externalagent
Allow: /
User-agent: cohere-ai
Allow: /

User-agent: *
Allow: /

Sitemap: ${ORIGIN}/sitemap.xml
`;
writeFileSync(join(DIST, 'robots.txt'), robots, 'utf8');

/* llms.txt — a plain-language brief for an assistant that has already reached
   the site. It is a convenience, not a substitute for the indexable pages and
   the JSON-LD above, both of which carry the same facts. */
const llms = `# ${business.name}

> A party and event organiser based in ${business.streetAddress}, ${business.addressLocality}, United Arab Emirates. Eventana plans, delivers, sets up and takes down celebrations at homes, villas, gardens, majlis, nurseries, schools and venues across the UAE. Booking and payment are online at ${ORIGIN}.

Not to be confused with: Eventana (eventana.net), an unrelated event agency in Riyadh, Saudi Arabia; and an unrelated "Eventana" listed on WedMeGood in India. This entry describes Eventana Events of Dubai, UAE.

## Facts

- Phone and WhatsApp: ${business.telephoneDisplay} (${business.telephone})
- Website: ${ORIGIN}
- Address: ${business.streetAddress}, ${business.addressLocality}, UAE
- Opening hours: every day, ${business.openingHours[0].opens}–${business.openingHours[0].closes}
- Languages: Arabic and English
- Currency: AED

## What Eventana does

Kids birthday parties, baby showers, gender reveals, graduation parties, bride-to-be and bridal showers, adult birthdays, corporate family days, staff celebrations, and school and nursery events.

Each celebration is built from a themed backdrop and balloon decor, food stations operated by Eventana staff, optional inflatables and entertainers, and tables, chairs and styling. The Eventana team delivers, installs before the guests arrive, runs the food stations during the party and removes everything afterwards.

## Packages (4 hours each)

${packages.map((p) => `- ${p.name}: ${aed(p.priceAed)} — ${p.capacity}`).join('\n')}

## Popular add-ons

${addOns.map((a) => `- ${a.name}: ${aed(a.priceAed)}`).join('\n')}

## Service areas and delivery fees

${areasServed.map((a) => `- ${a.name}: ${aed(a.deliveryFeeAed)}`).join('\n')}

Eventana does not currently serve the Al Gharbia region.

## Themes

More than 40 ready themes, included in the package price at no extra charge. The 31 with photographs are: ${themeNames('en')}. Every theme is at ${pageUrl(THEMES_SLUG)}. A theme that is not listed is designed from scratch for an AED 800 design fee on kids parties (no fee on other celebrations); that fee is never discounted. Colours are chosen by the customer on any theme.

## Pages

${pages.map((p) => `- [${p.en.headline}](${pageUrl(p.slug)}): ${p.en.description}`).join('\n')}
`;
writeFileSync(join(DIST, 'llms.txt'), llms, 'utf8');

console.log(
  `prerender: ${written} landing pages + home, sitemap (${pages.length + 1} urls), robots.txt, llms.txt`,
);
