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

  // explore
  'explore.title': 'Explore Packages',
  'explore.subKids': 'Pick a theme, choose a ready-made package, or build your own.',
  'explore.subFixed': 'Fixed packages — contents can’t be changed, but you can always add more.',
  'explore.comingTitle': '{label} packages are on the way ✨',
  'explore.comingBody': 'Eventana is curating fixed packages for this celebration. Meanwhile, build it your way — backdrops, food stations & more.',
  'explore.buildYour': 'Build Your {label}',
  'explore.browseThemes': 'Browse Themes',
  'explore.themeSelected': 'Theme selected — now pick a package below, or Build Your Own. You can fine-tune it later.',
  'explore.readyMade': 'Ready-Made Packages',
  'explore.easyPay': 'tabby · Easy Payment',
  'explore.itemsIncluded': 'items included',
  'explore.limited': '● Limited — includes a single-unit inflatable',
  'explore.available': '● Available on your date',
  'explore.byoTitle': 'Build Your Own Party',
  'explore.byoSub': 'Prefer to customize? Hand-pick every service and make it yours.',

  // build intake
  'intake.title': 'Let’s build your party ✨',
  'intake.sub': 'Two quick things and we’ll tailor everything to your celebration.',
  'intake.q1': 'What are you celebrating?',
  'intake.q2': 'How old is the guest of honour?',
  'intake.turning': 'Turning {age} — how exciting! 🎉',
  'intake.swipeAge': 'Swipe to pick the exact age.',
  'intake.start': 'Start building',
  'intake.startDisabled': 'Pick a celebration and age to continue',
  'intake.adult': 'Adult',

  // build
  'build.title': 'Build Your Own',
  'build.sub': '{label} · Pick services individually. Reach {aed} in eligible services to unlock 15% off.',
  'build.moreComing': 'More {label} services coming from Eventana:',
  'build.addToUnlock': 'Add {aed} more to unlock 15% off ✨',
  'build.unlocked': '15% OFF UNLOCKED 🎉  You’re saving {aed}',
  'build.perChild': 'per child · min {n}',
  'build.eachMin': 'each · min {n}',
  'build.pricePending': 'PRICE PENDING EVENTANA ADMIN',
  'build.yourParty': 'Your Party · {n} services',
  'build.eligibleSubtotal': 'Eligible subtotal',
  'build.continueTheme': 'Continue — Theme ›',
  'build.appliedAtCheckout': '15% applied at checkout',
  'build.addToParty': 'Add to my party',
  'build.removeFromParty': 'Remove from my party',
  'build.pendingAdmin': 'This price is awaiting confirmation from Eventana admin.',

  // package detail
  'pkg.setupIncluded': 'Setup & breakdown handled by Eventana',
  'pkg.hourEvent': 'hour event',
  'pkg.whatsIncluded': 'What’s included',
  'pkg.tapForDetails': '— tap any item for details',
  'pkg.castleColor': 'Choose Your Bouncy Castle Color',
  'pkg.castleAvail': 'Only colors available for your date are selectable.',
  'pkg.chooseCastle': 'Choose a castle colour to continue',
  'pkg.continueMovie': 'Continue — Pick a Movie',
  'pkg.continueBooking': 'Continue — Booking Details',
  'pkg.continueTheme': 'Continue — Choose Theme',

  // movie
  'movie.title': 'Pick your movie 🍿',
  'movie.sub': 'Choose the film for your cosy cinema night. Final availability is confirmed by the Eventana team.',
  'movie.continue': 'Continue to booking',
  'movie.pick': 'Pick a movie to continue',

  // themes
  'themes.customTitle': 'Custom Theme ✨',
  'themes.customDesign': 'Custom Theme Design',
  'themes.customNote': 'This theme isn’t part of Eventana’s standard collection, so our design team will create it from scratch. The fee is never discounted and doesn’t count toward the 15% minimum.',
  'themes.phTheme': 'Requested theme (e.g. Butterfly Garden)',
  'themes.phConcept': 'Character or concept',
  'themes.phColors': 'Preferred colors',
  'themes.phChild': 'Child’s name',
  'themes.phAge': 'Age',
  'themes.phNotes': 'Special requests',
  'themes.addCustom': 'Add Custom Theme',
  'themes.chooseTheme': 'Choose Your Theme',
  'themes.included': 'Standard Eventana themes are included — no extra charge.',
  'themes.search': 'Search themes…',
  'themes.noMatch': 'No themes match — try a different search, or create a custom theme below.',
  'themes.cantFind': 'Can’t find your theme?',
  'themes.willCreate': 'Our design team will create it from scratch ·',
  'themes.createCustom': 'Create a Custom Theme ✨',
  'themes.reviewPay': 'Continue — Review & Pay',

  // checkout
  'checkout.title': 'Your Celebration',
  'checkout.forWho': 'Who is the celebration for?',
  'checkout.for.kids': 'Child’s name',
  'checkout.for.graduation': 'Graduate’s name',
  'checkout.for.bride': 'Bride’s name',
  'checkout.for.baby': 'Baby’s name',
  'checkout.for.gender': 'Parents / baby name',
  'checkout.for.adult': 'Guest of honour name',
  'checkout.for.default': 'Guest of honour name',
  'checkout.location': 'Event location',
  'checkout.deliveryAuto': 'Delivery is calculated automatically from your emirate.',
  'checkout.deliveryTo': 'Delivery to {zone}: {aed}',
  'checkout.phArea': 'Area (e.g. Jumeirah 1)',
  'checkout.phStreet': 'Street',
  'checkout.phVilla': 'Villa / Building',
  'checkout.phDetails': 'Additional location details (optional)',
  'checkout.pinRequired': '📍 Pin your exact event location — required',
  'checkout.pinUsed': 'Used for delivery, team routes & live ETA',
  'checkout.weatherTitle': 'Weather on your day 🌤️',
  'checkout.weatherChecking': 'Checking the forecast…',
  'checkout.weatherTooFar': 'Forecast opens closer to the date (about a week ahead) — we’ll show it then.',
  'checkout.weatherPast': 'That date has passed.',
  'checkout.weatherUnavailable': 'Forecast isn’t available for this spot right now.',
  'checkout.setupSpotTitle': '📸 Show us your setup spot after booking',
  'checkout.setupSpotBody': 'Once your booking is confirmed, open My Event to snap where you’d like each item placed — your team sees it before they arrive.',
  'checkout.eventTime': 'Event time',
  'checkout.pickStart': 'Pick a start time — your 4-hour party ends automatically.',
  'checkout.numChildren': 'Number of children attending',
  'checkout.total': 'Total',
  'checkout.saved': 'You saved {aed} 🎉',
  'checkout.yourAccount': 'Your account',
  'checkout.signedInAs': '✓ Signed in as {name}',
  'checkout.signOut': 'Sign out',
  'checkout.createOrSignin': 'Create your account (or sign in) to confirm your booking. Your event details are kept.',
  'checkout.phFullName': 'Full name',
  'checkout.phEmail': 'Email',
  'checkout.phMobile': 'Mobile number',
  'checkout.phPassword': 'Password',
  'checkout.createAccount': 'Create account',
  'checkout.signin': 'Sign in',
  'checkout.pleaseWait': 'Please wait…',
  'checkout.haveAccount': 'Already have an account?',
  'checkout.newHere': 'New to Eventana?',
  'checkout.createOne': 'Create one',
  'checkout.payWith': 'Pay with',
  'checkout.mapPinRequired': 'Map pin required to complete your booking',
  'checkout.createToConfirm': 'Create your account above to confirm your booking',
  'checkout.opening': 'Opening secure checkout…',
  'checkout.pay': 'Pay {aed}',
  'checkout.providerUnavailable': '{provider} isn’t available for this booking. Please choose another payment method.',

  // payment return
  'pay.tipThanks': 'Thank you for your tip! 💐',
  'pay.addonAdded': 'Added to your event! ✨',
  'pay.booked': 'Your celebration is booked! 🎉',
  'pay.tipSub': '100% goes straight to your Eventana crew — they’ve been notified. You’re amazing!',
  'pay.addonSub': 'Payment verified. Your extras are now on your event and the team can see them.',
  'pay.bookedSub': 'Payment verified by your provider. Your Eventana team is already preparing everything.',
  'pay.eventId': 'EVENT ID',
  'pay.backToEvent': 'Back to My Event',
  'pay.viewEvent': 'View My Event',
  'pay.failedTitle': 'Payment didn’t go through',
  'pay.failedBody': 'No charge was made and nothing is booked. You can try again with another payment method — your selections are still here.',
  'pay.tryAnother': 'Try another method',
  'pay.reviewTitle': 'We’re checking this one by hand',
  'pay.reviewBody': 'Something about this payment needs a person to look at it. The Eventana team has been notified and will contact you shortly — please don’t pay again in the meantime.',
  'pay.confirming': 'Confirming your payment…',
  'pay.confirmingBody': 'We’re waiting for your payment provider to confirm directly with Eventana. This usually takes a few seconds — keep this screen open.',
  'pay.stillConfirming': 'Still confirming. Your booking is safe — if the provider is slow, our system checks again automatically and we’ll notify you the moment it lands.',
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

  // explore
  'explore.title': 'تصفّح الباقات',
  'explore.subKids': 'اختر ثيماً، أو باقة جاهزة، أو صمّم مناسبتك بنفسك.',
  'explore.subFixed': 'باقات ثابتة — لا يمكن تغيير محتواها، لكن تقدر تضيف عليها دائماً.',
  'explore.comingTitle': 'باقات {label} في الطريق ✨',
  'explore.comingBody': 'Eventana تجهّز باقات ثابتة لهذه المناسبة. في هذه الأثناء، صمّمها على ذوقك — خلفيات، محطات طعام والمزيد.',
  'explore.buildYour': 'صمّم {label}',
  'explore.browseThemes': 'تصفّح الثيمات',
  'explore.themeSelected': 'تم اختيار الثيم — الآن اختر باقة بالأسفل، أو صمّم مناسبتك. تقدر تعدّلها لاحقاً.',
  'explore.readyMade': 'باقات جاهزة',
  'explore.easyPay': 'tabby · دفع مُيسّر',
  'explore.itemsIncluded': 'عنصراً مشمولاً',
  'explore.limited': '● محدود — يشمل نطاطية بوحدة واحدة',
  'explore.available': '● متوفّرة في يومك',
  'explore.byoTitle': 'صمّم مناسبتك',
  'explore.byoSub': 'تفضّل التخصيص؟ اختر كل خدمة بنفسك واجعلها على ذوقك.',

  // build intake
  'intake.title': 'يلا نصمّم مناسبتك ✨',
  'intake.sub': 'سؤالان سريعان ونفصّل لك كل شيء حسب مناسبتك.',
  'intake.q1': 'شو تحتفل فيه؟',
  'intake.q2': 'كم عمر صاحب المناسبة؟',
  'intake.turning': 'يكمل {age} — شو أحلى! 🎉',
  'intake.swipeAge': 'اسحب لاختيار العمر بالضبط.',
  'intake.start': 'ابدأ التصميم',
  'intake.startDisabled': 'اختر المناسبة والعمر للمتابعة',
  'intake.adult': 'بالغ',

  // build
  'build.title': 'صمّم مناسبتك',
  'build.sub': '{label} · اختر الخدمات واحدة واحدة. اجمع {aed} من الخدمات المؤهّلة لتحصل على خصم 15%.',
  'build.moreComing': 'خدمات {label} إضافية قادمة من Eventana:',
  'build.addToUnlock': 'أضف {aed} أخرى لتفعيل خصم 15% ✨',
  'build.unlocked': 'خصم 15% مُفعّل 🎉  توفّر {aed}',
  'build.perChild': 'لكل طفل · الحد الأدنى {n}',
  'build.eachMin': 'للقطعة · الحد الأدنى {n}',
  'build.pricePending': 'السعر بانتظار اعتماد إدارة Eventana',
  'build.yourParty': 'مناسبتك · {n} خدمات',
  'build.eligibleSubtotal': 'الإجمالي المؤهّل',
  'build.continueTheme': 'متابعة — الثيم ›',
  'build.appliedAtCheckout': 'يُطبّق 15% عند الدفع',
  'build.addToParty': 'أضف إلى مناسبتي',
  'build.removeFromParty': 'أزل من مناسبتي',
  'build.pendingAdmin': 'هذا السعر بانتظار تأكيد إدارة Eventana.',

  // package detail
  'pkg.setupIncluded': 'التركيب والفك من Eventana',
  'pkg.hourEvent': 'ساعات',
  'pkg.whatsIncluded': 'ما هو مشمول',
  'pkg.tapForDetails': '— اضغط أي عنصر للتفاصيل',
  'pkg.castleColor': 'اختر لون النطاطية',
  'pkg.castleAvail': 'الألوان المتوفّرة ليومك فقط قابلة للاختيار.',
  'pkg.chooseCastle': 'اختر لون النطاطية للمتابعة',
  'pkg.continueMovie': 'متابعة — اختر فيلماً',
  'pkg.continueBooking': 'متابعة — تفاصيل الحجز',
  'pkg.continueTheme': 'متابعة — اختر الثيم',

  // movie
  'movie.title': 'اختر فيلمك 🍿',
  'movie.sub': 'اختر فيلم ليلة السينما المريحة. يؤكّد فريق Eventana التوفّر النهائي.',
  'movie.continue': 'متابعة للحجز',
  'movie.pick': 'اختر فيلماً للمتابعة',

  // themes
  'themes.customTitle': 'ثيم مخصّص ✨',
  'themes.customDesign': 'تصميم ثيم مخصّص',
  'themes.customNote': 'هذا الثيم ليس ضمن مجموعة Eventana القياسية، لذا يصمّمه فريقنا من الصفر. الرسوم غير قابلة للخصم ولا تُحتسب ضمن حد الـ15%.',
  'themes.phTheme': 'الثيم المطلوب (مثال: حديقة الفراشات)',
  'themes.phConcept': 'الشخصية أو الفكرة',
  'themes.phColors': 'الألوان المفضّلة',
  'themes.phChild': 'اسم الطفل',
  'themes.phAge': 'العمر',
  'themes.phNotes': 'طلبات خاصة',
  'themes.addCustom': 'أضف ثيماً مخصّصاً',
  'themes.chooseTheme': 'اختر ثيمك',
  'themes.included': 'ثيمات Eventana القياسية مشمولة — بدون رسوم إضافية.',
  'themes.search': 'ابحث عن ثيم…',
  'themes.noMatch': 'لا توجد ثيمات مطابقة — جرّب بحثاً آخر، أو أنشئ ثيماً مخصّصاً بالأسفل.',
  'themes.cantFind': 'ما لقيت ثيمك؟',
  'themes.willCreate': 'فريق التصميم لدينا يصمّمه من الصفر ·',
  'themes.createCustom': 'أنشئ ثيماً مخصّصاً ✨',
  'themes.reviewPay': 'متابعة — المراجعة والدفع',

  // checkout
  'checkout.title': 'مناسبتك',
  'checkout.forWho': 'لمن هذه المناسبة؟',
  'checkout.for.kids': 'اسم الطفل',
  'checkout.for.graduation': 'اسم الخرّيج',
  'checkout.for.bride': 'اسم العروس',
  'checkout.for.baby': 'اسم المولود',
  'checkout.for.gender': 'اسم الوالدين / المولود',
  'checkout.for.adult': 'اسم صاحب المناسبة',
  'checkout.for.default': 'اسم صاحب المناسبة',
  'checkout.location': 'موقع المناسبة',
  'checkout.deliveryAuto': 'يُحسب التوصيل تلقائياً حسب إمارتك.',
  'checkout.deliveryTo': 'التوصيل إلى {zone}: {aed}',
  'checkout.phArea': 'المنطقة (مثال: جميرا 1)',
  'checkout.phStreet': 'الشارع',
  'checkout.phVilla': 'الفيلا / المبنى',
  'checkout.phDetails': 'تفاصيل إضافية للموقع (اختياري)',
  'checkout.pinRequired': '📍 حدّد موقع مناسبتك بالضبط — مطلوب',
  'checkout.pinUsed': 'يُستخدم للتوصيل ومسار الفريق والوقت المتوقّع للوصول',
  'checkout.weatherTitle': 'الطقس في يومك 🌤️',
  'checkout.weatherChecking': 'نتحقق من التوقّعات…',
  'checkout.weatherTooFar': 'تظهر التوقّعات مع اقتراب الموعد (قبل أسبوع تقريباً) — نعرضها حينها.',
  'checkout.weatherPast': 'هذا التاريخ مضى.',
  'checkout.weatherUnavailable': 'التوقّعات غير متاحة لهذا الموقع حالياً.',
  'checkout.setupSpotTitle': '📸 أرِنا مكان التركيب بعد الحجز',
  'checkout.setupSpotBody': 'بعد تأكيد حجزك، افتح «مناسبتي» وصوّر المكان اللي تبيه لكل عنصر — يشوفه فريقك قبل وصوله.',
  'checkout.eventTime': 'وقت المناسبة',
  'checkout.pickStart': 'اختر وقت البداية — حفلتك (4 ساعات) تنتهي تلقائياً.',
  'checkout.numChildren': 'عدد الأطفال الحاضرين',
  'checkout.total': 'الإجمالي',
  'checkout.saved': 'وفّرت {aed} 🎉',
  'checkout.yourAccount': 'حسابك',
  'checkout.signedInAs': '✓ مسجّل الدخول باسم {name}',
  'checkout.signOut': 'تسجيل الخروج',
  'checkout.createOrSignin': 'أنشئ حسابك (أو سجّل الدخول) لتأكيد حجزك. تفاصيل مناسبتك محفوظة.',
  'checkout.phFullName': 'الاسم الكامل',
  'checkout.phEmail': 'البريد الإلكتروني',
  'checkout.phMobile': 'رقم الجوال',
  'checkout.phPassword': 'كلمة المرور',
  'checkout.createAccount': 'إنشاء حساب',
  'checkout.signin': 'تسجيل الدخول',
  'checkout.pleaseWait': 'لحظة من فضلك…',
  'checkout.haveAccount': 'عندك حساب؟',
  'checkout.newHere': 'جديد على Eventana؟',
  'checkout.createOne': 'أنشئ حساباً',
  'checkout.payWith': 'الدفع عبر',
  'checkout.mapPinRequired': 'تحديد الموقع على الخريطة مطلوب لإتمام الحجز',
  'checkout.createToConfirm': 'أنشئ حسابك بالأعلى لتأكيد حجزك',
  'checkout.opening': 'جارٍ فتح الدفع الآمن…',
  'checkout.pay': 'ادفع {aed}',
  'checkout.providerUnavailable': '{provider} غير متاح لهذا الحجز. اختر وسيلة دفع أخرى من فضلك.',

  // payment return
  'pay.tipThanks': 'شكراً على بقشيشك! 💐',
  'pay.addonAdded': 'أُضيف إلى مناسبتك! ✨',
  'pay.booked': 'تم حجز مناسبتك! 🎉',
  'pay.tipSub': '100% يذهب مباشرة لفريق Eventana — تم إشعارهم. أنت رائع!',
  'pay.addonSub': 'تم تأكيد الدفع. إضافاتك الآن على مناسبتك ويراها الفريق.',
  'pay.bookedSub': 'تم تأكيد الدفع من مزوّدك. فريق Eventana يجهّز كل شيء الآن.',
  'pay.eventId': 'رقم المناسبة',
  'pay.backToEvent': 'العودة إلى مناسبتي',
  'pay.viewEvent': 'عرض مناسبتي',
  'pay.failedTitle': 'لم يتم الدفع',
  'pay.failedBody': 'لم يُخصم أي مبلغ ولم يُحجز شيء. تقدر تجرّب وسيلة دفع أخرى — اختياراتك ما زالت محفوظة.',
  'pay.tryAnother': 'جرّب وسيلة أخرى',
  'pay.reviewTitle': 'نراجع هذه العملية يدوياً',
  'pay.reviewBody': 'هذه العملية تحتاج مراجعة شخص. تم إشعار فريق Eventana وسيتواصل معك قريباً — لا تدفع مرة أخرى في هذه الأثناء من فضلك.',
  'pay.confirming': 'جارٍ تأكيد دفعك…',
  'pay.confirmingBody': 'ننتظر تأكيد مزوّد الدفع مباشرة مع Eventana. عادة يأخذ ثوانٍ — أبقِ هذه الشاشة مفتوحة.',
  'pay.stillConfirming': 'ما زلنا نؤكّد. حجزك بأمان — إذا تأخّر المزوّد، نظامنا يتحقّق تلقائياً ونشعرك فور وصوله.',
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
