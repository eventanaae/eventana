/**
 * Bilingual (English / Arabic) strings for the customer app.
 *
 * The UAE market is half Arabic-first, so the app ships both languages with a
 * toggle and full right-to-left layout. Only the app's own chrome and flow
 * copy live here; catalogue content (package, theme and service names) comes
 * from the server and is shown as stored.
 *
 * Keys are namespaced by screen. `makeT(lang)` returns a lookup that falls
 * back to English, then to the key itself, so a missing Arabic string never
 * renders blank — it shows the English until translated.
 */
import { useEffect, useState } from 'react';

export type Lang = 'en' | 'ar';

const KEY = 'eventana.lang';

export function loadLang(): Lang {
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'ar' || v === 'en') return v;
    // First run with no choice: follow the device language if it is Arabic.
    return (navigator.language || '').toLowerCase().startsWith('ar') ? 'ar' : 'en';
  } catch {
    return 'en';
  }
}

export function saveLang(l: Lang): void {
  try { localStorage.setItem(KEY, l); } catch { /* ignore */ }
}

/** A tiny hook that keeps the chosen language and the document direction in sync. */
export function useLang(): { lang: Lang; setLang: (l: Lang) => void } {
  const [lang, setLangState] = useState<Lang>(() => loadLang());
  useEffect(() => {
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
    document.documentElement.lang = lang;
  }, [lang]);
  const setLang = (l: Lang) => { saveLang(l); setLangState(l); };
  return { lang, setLang };
}

export const isRTL = (lang: Lang) => lang === 'ar';

type Dict = Record<string, string>;

const en: Dict = {
  // common
  'common.back': '‹ Back',
  'common.home': '‹ Home',
  'common.continue': 'Continue',
  'common.tryAgain': 'Try again',
  'common.whatsapp': 'Message us on WhatsApp →',
  'common.seeAll': 'See all',
  'common.swipe': 'swipe →',
  'common.aed': 'AED',
  'common.optional': 'optional',
  'common.friend': 'there',

  // nav
  'nav.home': 'Home',
  'nav.explore': 'Explore',
  'nav.myevent': 'My Event',
  'nav.profile': 'Profile',

  // loading / errors
  'load.app': 'Loading Eventana…',
  'error.title': 'We couldn’t reach Eventana',
  'error.body': 'Please check your connection and try again — your celebration plans are safe.',

  // onboarding
  'onboard.welcome': 'Welcome to Eventana',
  'onboard.title': 'Let’s get to know you ✨',
  'onboard.sub': 'Just your name and birthday — so your celebrations feel personal, and we can wish you on your special day 🎂',
  'onboard.name': 'Your name',
  'onboard.namePh': 'e.g. Sara',
  'onboard.birthday': 'Your birthday',
  'onboard.start': 'Start celebrating 🎉',

  // home
  'home.morning': 'Good morning',
  'home.afternoon': 'Good afternoon',
  'home.evening': 'Good evening',
  'home.brand': 'Eventana Parties',
  'home.hero': 'Let’s Create Something Magical ✨',
  'home.heroSub': 'Cheers to love, music, and the magic of every moment.',
  'home.exploreTitle': 'Explore Kids Packages',
  'home.exploreSub': 'Ready-made setups — themed, priced & ready to book',
  'home.buildTitle': 'Build Your Own Party',
  'home.buildSub': 'Hand-pick every detail and make it uniquely yours',
  'home.celebrating': 'What Are You Celebrating? ✨',
  'home.celebratingSub': 'We’ll tailor packages, services & themes to your celebration.',
  'home.popular': 'Popular Packages',
  'home.trending': 'Trending Themes',
  'home.assistant': 'Eventana AI Assistant',
  'home.assistantEg': '“I have 30 kids and AED 5,000 — help me plan.”',
  'home.hours': 'hours',

  // profile
  'profile.guest': 'Guest',
  'profile.completeProfile': 'Complete your profile',
  'profile.rewards': 'Eventana Rewards ✨',
  'profile.points': 'points',
  'profile.loadingRewards': 'Loading your rewards…',
  'profile.topTier': 'You’ve reached our top tier 🎉',
  'profile.pointsToward': 'You earn 1 point per AED on every booking. Redeem on an upcoming celebration.',
  'profile.activity': 'Points activity',
  'profile.myEvents': 'My Events',
  'profile.noBookings': 'No bookings yet.',
  'profile.exploreToStart': 'Explore packages',
  'profile.toGetStarted': 'to get started.',
  'profile.bookAgain': 'Book Again',
  'profile.opening': 'Opening…',
  'profile.language': 'Language',

  // assistant
  'assistant.title': 'Eventana Assistant',
  'assistant.sub': 'Answers from Eventana’s live catalogue',
  'assistant.greeting': 'Hi {name} ✨ I’m your Eventana event assistant. Ask me about packages, prices, availability or themes — I only quote what’s in Eventana’s system.',
  'assistant.checking': 'Checking the catalogue…',
  'assistant.placeholder': 'Ask about packages, themes, availability…',
  'assistant.escalated': 'PASSED TO A HUMAN',
  'assistant.unreachable': 'I couldn’t reach Eventana’s catalogue just now. Please try again.',
};

const ar: Dict = {
  // common
  'common.back': '‹ رجوع',
  'common.home': '‹ الرئيسية',
  'common.continue': 'متابعة',
  'common.tryAgain': 'حاول مرة أخرى',
  'common.whatsapp': 'راسلنا على واتساب →',
  'common.seeAll': 'عرض الكل',
  'common.swipe': 'اسحب →',
  'common.aed': 'د.إ',
  'common.optional': 'اختياري',
  'common.friend': 'صديقي',

  // nav
  'nav.home': 'الرئيسية',
  'nav.explore': 'تصفّح',
  'nav.myevent': 'مناسبتي',
  'nav.profile': 'حسابي',

  // loading / errors
  'load.app': 'جارٍ تحميل Eventana…',
  'error.title': 'تعذّر الوصول إلى Eventana',
  'error.body': 'تأكد من اتصالك وحاول مرة أخرى — خطط مناسبتك محفوظة.',

  // onboarding
  'onboard.welcome': 'أهلاً بك في Eventana',
  'onboard.title': 'خلّينا نتعرّف عليك ✨',
  'onboard.sub': 'بس اسمك وتاريخ ميلادك — عشان تكون مناسباتك أقرب لك، ونهنّيك بيومك الخاص 🎂',
  'onboard.name': 'اسمك',
  'onboard.namePh': 'مثال: سارة',
  'onboard.birthday': 'تاريخ ميلادك',
  'onboard.start': 'يلا نحتفل 🎉',

  // home
  'home.morning': 'صباح الخير',
  'home.afternoon': 'مساء الخير',
  'home.evening': 'مساء الخير',
  'home.brand': 'حفلات Eventana',
  'home.hero': 'خلّينا نصنع شيئاً ساحراً ✨',
  'home.heroSub': 'نخبٌ للحب والموسيقى وسحر كل لحظة.',
  'home.exploreTitle': 'تصفّح باقات الأطفال',
  'home.exploreSub': 'باقات جاهزة — بثيم وسعر وجاهزة للحجز',
  'home.buildTitle': 'صمّم مناسبتك',
  'home.buildSub': 'اختر كل تفصيلة واجعلها على ذوقك',
  'home.celebrating': 'شو تحتفل فيه؟ ✨',
  'home.celebratingSub': 'نفصّل لك الباقات والخدمات والثيمات حسب مناسبتك.',
  'home.popular': 'الباقات الأكثر طلباً',
  'home.trending': 'ثيمات رائجة',
  'home.assistant': 'مساعد Eventana الذكي',
  'home.assistantEg': '«عندي 30 طفل و5,000 درهم — ساعدني أخطّط.»',
  'home.hours': 'ساعات',

  // profile
  'profile.guest': 'زائر',
  'profile.completeProfile': 'أكمل ملفك',
  'profile.rewards': 'مكافآت Eventana ✨',
  'profile.points': 'نقطة',
  'profile.loadingRewards': 'جارٍ تحميل مكافآتك…',
  'profile.topTier': 'وصلت لأعلى مستوى 🎉',
  'profile.pointsToward': 'تكسب نقطة لكل درهم في كل حجز. استبدلها في مناسبتك القادمة.',
  'profile.activity': 'حركة النقاط',
  'profile.myEvents': 'مناسباتي',
  'profile.noBookings': 'لا حجوزات بعد.',
  'profile.exploreToStart': 'تصفّح الباقات',
  'profile.toGetStarted': 'للبدء.',
  'profile.bookAgain': 'احجز مرة أخرى',
  'profile.opening': 'جارٍ الفتح…',
  'profile.language': 'اللغة',

  // assistant
  'assistant.title': 'مساعد Eventana',
  'assistant.sub': 'إجابات من كتالوج Eventana المباشر',
  'assistant.greeting': 'أهلاً {name} ✨ أنا مساعدك لمناسبات Eventana. اسألني عن الباقات أو الأسعار أو التوفّر أو الثيمات — أجاوبك فقط بما هو موجود في نظام Eventana.',
  'assistant.checking': 'أتحقق من الكتالوج…',
  'assistant.placeholder': 'اسأل عن الباقات، الثيمات، التوفّر…',
  'assistant.escalated': 'حُوّلت إلى موظف',
  'assistant.unreachable': 'تعذّر الوصول لكتالوج Eventana الآن. حاول مرة أخرى.',
};

const dict: Record<Lang, Dict> = { en, ar };

/** Returns a translator for the language, falling back to English then the key. */
export function makeT(lang: Lang) {
  return (key: string, vars?: Record<string, string | number>): string => {
    let s = dict[lang][key] ?? dict.en[key] ?? key;
    if (vars) for (const [k, v] of Object.entries(vars)) s = s.replace(`{${k}}`, String(v));
    return s;
  };
}

export type TFn = ReturnType<typeof makeT>;
