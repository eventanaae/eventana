/**
 * Arabic DISPLAY text for the 6 fixed packages (ids are stable). English copy,
 * prices, inclusions and quantities are unchanged — this only swaps the shown
 * name / capacity / badge when the UI language is Arabic. Falls back to the
 * English value for anything not listed here.
 */
export const PKG_AR: Record<string, { name: string; capacity: string; tag: string }> = {
  bronze: { name: 'باقة عيد الميلاد البرونزية', capacity: 'حتى 40 طفل', tag: 'سعر مميز' },
  silver: { name: 'باقة عيد الميلاد الفضية', capacity: 'حتى 40 طفل', tag: 'يلا نحتفل!' },
  golden: { name: 'باقة عيد الميلاد الذهبية', capacity: 'حتى 40 طفل', tag: 'الأكثر طلباً' },
  summer: { name: 'باقة عيد الميلاد الصيفية', capacity: 'حتى 40 طفل', tag: 'أجواء صيفية' },
  spa: { name: 'باقة سبا للأطفال', capacity: 'حتى 20 طفل', tag: 'للبنات' },
  movie: { name: 'باقة ليلة السينما', capacity: 'حتى 40 طفل', tag: 'ليلة مميزة' },
  'gender-reveal': { name: 'باقة الجندر ريفيل', capacity: 'الترتيب الأساسي', tag: 'وردي ولا أزرق' },
  'gender-disney': { name: 'باقة توينكل', capacity: 'ترتيب فاخر', tag: 'الأكثر طلباً' },
  'gender-teddy': { name: 'باقة تيدي بير', capacity: 'حتى 20 ضيف', tag: 'المفضّلة للعائلات' },
};

/**
 * Per-celebration "coming soon" copy in Arabic (Explore, non-kids). Any
 * celebration not listed falls back to the generic explore.coming* strings.
 * English is never affected (only used when the UI language is Arabic).
 */
export const COMING_AR: Record<string, { title: string; body: string; cta: string }> = {
  graduation: {
    title: 'حفلة تخرجك تستاهل أحلى ترتيب! 🎓',
    body: 'من الديكور والتنسيقات لأحلى التفاصيل، صمّمي حفلة تخرجك على ذوقك وخلّ الباقي علينا!',
    cta: 'صمّمي حفلة تخرجك',
  },
  bride: {
    title: 'حفلة برايد تو بي على ذوقج! 💕',
    body: 'من الديكور والتنسيقات لأحلى التفاصيل، صمّمي حفلة برايد تو بي مثل ما تتخيلينها وخلّي الباقي علينا!',
    cta: 'صمّمي حفلة برايد تو بي',
  },
  baby: {
    title: 'حفلة بيبي شور تستاهل أحلى ترتيب! 💕',
    body: 'من الديكور والبالونات لأحلى التفاصيل، صمّموا حفلة البيبي شور على ذوقكم وخلّوا الباقي علينا!',
    cta: 'صمّمي حفلة بيبي شور',
  },
  gender: {
    title: 'وردي ولا أزرق؟ خلّوا المفاجأة علينا! 🩷🩵',
    body: 'صمّموا حفلة الجندر ريفيل على ذوقكم، من الديكور والبالونات لأحلى التفاصيل.',
    cta: 'صمّمي حفلة جندر ريفيل',
  },
  adult: {
    title: 'كل عمر يستاهل احتفال مميز! 🎉',
    body: 'من الديكور والتنسيقات لأحلى التفاصيل، صمّموا حفلة عيد الميلاد على ذوقكم.',
    cta: 'صمّمي حفلة عيد ميلاد',
  },
  corporate: {
    title: 'فعاليات شركتكم بترتيب يليق فيها! ✨',
    body: 'من الديكور والفعاليات لأدق التفاصيل، نجهّز لكم مناسبات وفعاليات الشركات حسب احتياجاتكم.',
    cta: 'صمّمي فعالية شركتك',
  },
};

/** Arabic names for the Gender Reveal themes (keyed by stable theme id). */
export const THEME_AR: Record<string, string> = {
  g0: 'الوزة',
  g1: 'تيدي بير',
  g2: 'اللولو',
  g3: 'التنس',
  g4: 'الأرنب',
  g5: 'الورود',
  g6: 'البيكنك',
  g7: 'الليمون',
  g8: 'القصص الخيالية',
  g9: 'وايلد ون',
};
export const thName = (id: string, en: string, ar: boolean): string => (ar ? (THEME_AR[id] ?? en) : en);

/** Arabic for package "what's included" item names (gender packages). Keyed by
 *  the English item name (lowercased). Falls back to English when unmapped. */
export const PKG_ITEM_AR: Record<string, string> = {
  'main backdrop': 'الستاند الرئيسي',
  'premium main backdrop': 'الستاند الرئيسي الفاخر',
  'voting stand': 'ستاند التصويت',
  'entrance stand': 'ستاند المدخل',
  'gender reveal spray': 'سبراي كشف جنس البيبي',
  '3 cake stands': '٣ ستاندات كيك',
  'large gender reveal box with 20 helium balloons': 'بوكس جندر ريفيل كبير + ٢٠ بالون هيليوم',
  'tables & chairs for 20 guests': 'طاولات وكراسي لـ٢٠ ضيف',
  'baby onesie painting activity': 'فقرة رسم أوفارول البيبي',
  'interactive games & activities': 'ألعاب وأنشطة تفاعلية',
};
export const itemNameAr = (en: string, ar: boolean): string =>
  (ar ? (PKG_ITEM_AR[String(en ?? '').trim().toLowerCase()] ?? en) : en);

export const pkgName = (id: string, en: string, ar: boolean): string => (ar ? (PKG_AR[id]?.name ?? en) : en);
export const pkgCapacity = (id: string, en: string, ar: boolean): string => (ar ? (PKG_AR[id]?.capacity ?? en) : en);
export const pkgTag = (id: string, en: string, ar: boolean): string => (ar ? (PKG_AR[id]?.tag ?? en) : en);
