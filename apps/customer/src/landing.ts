/**
 * Landing routes — the search-ad half of the customer app.
 *
 * Every Google ad has to arrive somewhere that repeats the words the customer
 * typed. Until now the app had no URLs at all: one screen, one address, so an
 * ad for "ديكور بالونات" and an ad for "corporate family day" both dropped the
 * visitor on the same home screen and asked them to start over. That costs
 * twice — a lower Quality Score (so a dearer click) and a worse conversion.
 *
 * This is the route table. Each entry is one landing page and one ad group:
 * the slug is the ad's final URL, the copy is the promise the ad made, and
 * `celebrationType` is where the booking journey opens when they tap Book.
 *
 * Deliberately data, not components: adding a campaign means adding an object
 * here, and the page, the <title>, and the journey entry all follow.
 */
import type { Lang } from './i18n';

export interface LandingCopy {
  /** <h1>. Must contain the search term almost verbatim. */
  headline: string;
  /** One line under the headline — the offer, not a slogan. */
  subhead: string;
  /** What is included. Six or fewer; these are scanned, not read. */
  includes: string[];
  /** The button. */
  cta: string;
  /** <title> and meta description, for the day these pages are indexed. */
  title: string;
  description: string;
}

export interface LandingRoute {
  /** URL path, without the leading slash. */
  slug: string;
  /** Which journey the CTA opens — a value of Draft['celebrationType']. */
  celebrationType: string;
  en: LandingCopy;
  ar: LandingCopy;
}

/**
 * The six pages, one per planned Search ad group.
 *
 * Copy rule: no number that isn't true. Prices and inclusions here match the
 * live offer; anything unverified is left out rather than guessed, because an
 * ad landing on a page that contradicts it is worse than no page.
 */
export const LANDING_ROUTES: LandingRoute[] = [
  {
    slug: 'kids-birthday',
    celebrationType: 'kids',
    en: {
      headline: 'Kids Birthday Party Organizer in Dubai',
      subhead: 'A full party set up at your home — decor, games, and snack stations. Book and pay online in minutes.',
      includes: [
        'Themed balloon decor and a custom backdrop',
        'Entertainers with games and activities',
        'Popcorn and cotton candy stations',
        'Tables, chairs and full styling',
        'We arrive, set up, and clean up after',
        'Dubai, Sharjah, Ajman, Abu Dhabi and beyond',
      ],
      cta: 'Plan my party',
      title: 'Kids Birthday Party Organizer in Dubai | Eventana',
      description:
        'Full kids birthday party setup at your home in Dubai: balloon decor, entertainers, popcorn and cotton candy. Book and pay online, instant confirmation.',
    },
    ar: {
      headline: 'تنظيم حفلات أعياد ميلاد أطفال في دبي',
      subhead: 'حفلة كاملة في بيتك — ديكور وألعاب ومحطات تسالي. احجزي وادفعي أونلاين خلال دقائق.',
      includes: [
        'ديكور بالونات وخلفية بالثيم اللي تختارينه',
        'مهرجين مع ألعاب وفعاليات تفاعلية',
        'كوشك بوبكورن وكوشك سلاش',
        'طاولات وكراسي وتنسيق كامل',
        'نوصل، نجهّز، ونرتّب بعد الحفلة',
        'دبي والشارقة وعجمان وأبوظبي وباقي الإمارات',
      ],
      cta: 'جهّزي حفلتك',
      title: 'تنظيم حفلات أعياد ميلاد أطفال في دبي | إيفنتانا',
      description:
        'تجهيز كامل لحفلة عيد ميلاد أطفال في بيتك بدبي: ديكور بالونات، مهرجين، بوبكورن وسلاش. احجزي وادفعي أونلاين والتأكيد فوري.',
    },
  },
  {
    slug: 'balloon-decoration',
    celebrationType: 'kids',
    en: {
      headline: 'Balloon Decoration in Dubai',
      subhead: 'Balloon arches, stands and custom backdrops, styled in your colours and installed at your venue.',
      includes: [
        'Balloon arches, stands and garlands',
        'Custom backdrop in your theme colours',
        'Styled dessert and gift tables',
        'Installed on site, taken down after',
        'Indoor, garden or majlis setups',
        'All emirates covered',
      ],
      cta: 'Design my decor',
      title: 'Balloon Decoration Dubai | Eventana',
      description:
        'Balloon arches, stands and custom backdrops for birthdays and celebrations in Dubai. Styled in your colours, installed at your venue.',
    },
    ar: {
      headline: 'ديكور وتزيين بالونات في دبي',
      subhead: 'أقواس وستاندات بالونات وخلفيات مخصصة، بألوانك، ونركّبها في موقعك.',
      includes: [
        'أقواس وستاندات وسلاسل بالونات',
        'خلفية مخصصة بألوان الثيم',
        'تنسيق طاولة الحلويات والهدايا',
        'تركيب في الموقع وفكّ بعد المناسبة',
        'تجهيزات داخلية أو حديقة أو مجلس',
        'نغطي كل الإمارات',
      ],
      cta: 'صمّمي ديكورك',
      title: 'ديكور وتزيين بالونات في دبي | إيفنتانا',
      description:
        'أقواس وستاندات بالونات وخلفيات مخصصة لأعياد الميلاد والمناسبات في دبي. بألوانك، ونركّبها في موقعك.',
    },
  },
  {
    slug: 'baby-shower',
    celebrationType: 'baby',
    en: {
      headline: 'Baby Shower & Gender Reveal Setups in Dubai',
      subhead: 'A styled celebration at home or at your venue, planned end to end and set up before your guests arrive.',
      includes: [
        'Balloon styling in your palette',
        'Custom backdrop and signage',
        'Dessert and gift table styling',
        'Gender reveal moment planned with you',
        'Setup and takedown by our team',
        'All emirates covered',
      ],
      cta: 'Plan my celebration',
      title: 'Baby Shower & Gender Reveal Setup Dubai | Eventana',
      description:
        'Baby shower and gender reveal styling in Dubai: balloons, backdrops and dessert tables, set up at your home or venue before guests arrive.',
    },
    ar: {
      headline: 'تجهيز بيبي شاور وتحديد جنس المولود في دبي',
      subhead: 'احتفال منسّق في بيتك أو في موقعك، نخطّطه من البداية للنهاية ونجهّزه قبل وصول الضيوف.',
      includes: [
        'تنسيق بالونات بألوانك',
        'خلفية مخصصة ولوحات باسمك',
        'تنسيق طاولة الحلويات والهدايا',
        'لحظة تحديد الجنس نخطّطها معك',
        'تركيب وفكّ من فريقنا',
        'نغطي كل الإمارات',
      ],
      cta: 'جهّزي مناسبتك',
      title: 'تجهيز بيبي شاور وتحديد جنس المولود في دبي | إيفنتانا',
      description:
        'تنسيق بيبي شاور وحفلات تحديد جنس المولود في دبي: بالونات وخلفيات وطاولات حلويات، نجهّزها في بيتك قبل وصول الضيوف.',
    },
  },
  {
    slug: 'graduation',
    celebrationType: 'graduation',
    en: {
      headline: 'Graduation Party Setup in Dubai',
      subhead: 'Celebrate the result at home — styled decor, a photo moment, and everything set up before the family arrives.',
      includes: [
        'Balloon decor in the school or university colours',
        'Custom backdrop and photo corner',
        'Congratulations signage with the name',
        'Dessert table styling',
        'Setup and takedown by our team',
        'All emirates covered',
      ],
      cta: 'Plan the celebration',
      title: 'Graduation Party Setup Dubai | Eventana',
      description:
        'Graduation party styling in Dubai: balloons in your colours, a photo backdrop and dessert table, set up at home before the family arrives.',
    },
    ar: {
      headline: 'تجهيز حفلات التخرّج في دبي',
      subhead: 'احتفلوا بالنتيجة في البيت — ديكور منسّق وركن تصوير، وكل شيء جاهز قبل وصول الأهل.',
      includes: [
        'ديكور بالونات بألوان المدرسة أو الجامعة',
        'خلفية مخصصة وركن تصوير',
        'لوحة تهنئة بالاسم',
        'تنسيق طاولة الحلويات',
        'تركيب وفكّ من فريقنا',
        'نغطي كل الإمارات',
      ],
      cta: 'جهّزي الاحتفال',
      title: 'تجهيز حفلات التخرّج في دبي | إيفنتانا',
      description:
        'تنسيق حفلات التخرّج في دبي: بالونات بألوانك، خلفية تصوير وطاولة حلويات، نجهّزها في البيت قبل وصول الأهل.',
    },
  },
  {
    slug: 'corporate-events',
    celebrationType: 'adult',
    en: {
      headline: 'Corporate & School Event Setup in Dubai',
      subhead: 'Family days, staff celebrations and school events — one team for decor, entertainment and snack stations.',
      includes: [
        'Family day and staff celebration setups',
        'School and nursery events',
        'Entertainers, games and activity corners',
        'Popcorn, cotton candy and slush stations',
        'Branded backdrops and signage',
        'Invoicing and scheduling handled with your team',
      ],
      cta: 'Request a plan',
      title: 'Corporate & School Event Organizer Dubai | Eventana',
      description:
        'Corporate family days, staff celebrations and school events in Dubai: decor, entertainment and snack stations from one team.',
    },
    ar: {
      headline: 'تنظيم فعاليات الشركات والمدارس في دبي',
      subhead: 'أيام عائلية وفعاليات موظفين ومناسبات مدرسية — فريق واحد للديكور والتسلية والمحطات.',
      includes: [
        'أيام عائلية وفعاليات الموظفين',
        'مناسبات المدارس والحضانات',
        'مهرجين وألعاب وأركان أنشطة',
        'محطات بوبكورن وغزل بنات وسلاش',
        'خلفيات ولوحات بهوية الجهة',
        'التنسيق والفواتير مع فريقكم',
      ],
      cta: 'اطلبي عرضًا',
      title: 'تنظيم فعاليات الشركات والمدارس في دبي | إيفنتانا',
      description:
        'تنظيم الأيام العائلية وفعاليات الموظفين والمناسبات المدرسية في دبي: ديكور وتسلية ومحطات تسالي من فريق واحد.',
    },
  },
  {
    slug: 'rentals',
    celebrationType: 'kids',
    en: {
      headline: 'Party Rentals in Dubai — Castles, Mascots & Snack Stations',
      subhead: 'Delivered, set up and collected. Rent on their own or add them to a full party package.',
      includes: [
        'Bouncy castles',
        'Costumed mascot characters',
        'Popcorn machines',
        'Cotton candy machines',
        'Slush machines',
        'Tables, chairs and styling',
      ],
      cta: 'See what to rent',
      title: 'Party Rentals Dubai — Bouncy Castle, Mascots | Eventana',
      description:
        'Rent bouncy castles, mascots, popcorn, cotton candy and slush machines in Dubai. Delivered, set up and collected by our team.',
    },
    ar: {
      headline: 'تأجير مستلزمات الحفلات في دبي — قلاع نطاطة وشخصيات ومحطات',
      subhead: 'نوصّل ونركّب ونستلم. تأجير منفرد أو ضمن باقة حفلة كاملة.',
      includes: [
        'قلاع نطاطة',
        'شخصيات كرتونية بأزياء كاملة',
        'مكائن بوبكورن',
        'مكائن غزل بنات',
        'مكائن سلاش',
        'طاولات وكراسي وتنسيق',
      ],
      cta: 'شوفي المتاح للتأجير',
      title: 'تأجير مستلزمات الحفلات في دبي — قلعة نطاطة وشخصيات | إيفنتانا',
      description:
        'تأجير قلاع نطاطة وشخصيات ومكائن بوبكورن وغزل بنات وسلاش في دبي. نوصّل ونركّب ونستلم.',
    },
  },
];

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
