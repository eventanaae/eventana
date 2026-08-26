import { C, fredoka } from '../ui';

/**
 * Privacy Policy, shown as a full-screen sheet from ?privacy=1 and linked
 * wherever a policy URL is required — Meta's app publishing check among them.
 *
 * Every claim here is written against what this platform actually does: the
 * fields checkout collects, the processors it calls, and the retention the
 * business genuinely needs. Bilingual, and a professional starting draft for
 * the owner to review — nothing is generated at runtime.
 */

type Section = { title: string; body: string[] };

const EN: Section[] = [
  {
    title: '1. Who we are',
    body: [
      'Eventana Events (“Eventana”, “we”, “us”) plans and delivers children’s parties and event setups across the United Arab Emirates. This policy explains what personal information we collect when you book with us, why we hold it, and the choices you have.',
      'For any question about your information, or to make any of the requests described below, contact us on WhatsApp or by email at info@eventanauae.com.',
    ],
  },
  {
    title: '2. What we collect',
    body: [
      'Booking details you give us: your name, mobile number, email address, the event date and time, the delivery address and emirate, the number of guests, the guest of honour’s name and age, your chosen theme and any notes or special requests you add.',
      'Payment information: we do not see or store your full card number. Card details are entered directly with our payment providers, and we keep only the outcome — whether a payment succeeded, the amount, and a reference we can use to match it to your booking.',
      'Images you choose to upload, such as a reference photo or a child’s drawing for a printed item.',
      'Messages you send us on WhatsApp, and — where you started the conversation from one of our ads — an identifier from Meta that tells us which ad it was.',
      'Technical information collected automatically when you use the booking app: your device and browser type, approximate location derived from your IP address, and the pages you visit.',
    ],
  },
  {
    title: '3. Why we hold it',
    body: [
      'To take and deliver your booking — confirming the date, preparing the setup, routing our team to your address on the day, and contacting you if anything about the event needs to change.',
      'To take payment and issue receipts, and to handle refunds or disputes.',
      'To answer your messages and provide support before and after the event.',
      'To meet our legal and tax obligations in the UAE, including keeping records of transactions.',
      'To understand which of our advertising works. We share a limited, encrypted record of completed bookings with Meta so we can measure which adverts led to real bookings rather than only to enquiries. This is explained in section 5.',
      'To send you offers about our own services — only where you have asked to hear from us, and you can stop this at any time.',
    ],
  },
  {
    title: '4. Children’s information',
    body: [
      'Our parties are for children, but our service is sold to adults. We do not knowingly collect information directly from a child.',
      'A booking normally includes a child’s first name and age, given to us by the adult booking the party so that we can personalise the setup. We use those details only to prepare and deliver the event.',
      'Where you upload a child’s drawing or photograph for a printed item, we use it only to produce that item, and we delete it once the order has been delivered.',
    ],
  },
  {
    title: '5. Who we share it with',
    body: [
      'We do not sell your personal information, and we do not share it for anyone else’s marketing.',
      'Payment providers (including Stripe, Tabby, Tamara and Ziina) process your payment and receive the information they need to do so.',
      'Meta Platforms receives a record of completed bookings so that we can measure our advertising. Identifying details such as your email address and phone number are irreversibly scrambled (hashed) on our own servers before they are sent — Meta receives the scrambled values, not your actual contact details. Meta also receives messages you send us when you contact us on WhatsApp, as the operator of that service.',
      'Service providers who run parts of our platform on our behalf: our hosting and database provider, our email provider, our image storage provider, and mapping and calendar services used to plan deliveries. Each may only use the information to provide that service to us.',
      'Authorities or professional advisers, where the law requires it or to establish or defend a legal claim.',
      'Some of these providers operate outside the UAE. Where information is transferred abroad, we rely on providers who commit contractually to protect it to a comparable standard.',
    ],
  },
  {
    title: '6. How long we keep it',
    body: [
      'Booking and payment records: seven years, to satisfy UAE tax and accounting requirements.',
      'Uploaded reference images and drawings: deleted once the order they relate to has been delivered.',
      'WhatsApp enquiries that never became a booking: up to two years, after which they are deleted.',
      'Marketing consent records: for as long as you remain subscribed, and for two years afterwards so we can show that you had asked to hear from us.',
    ],
  },
  {
    title: '7. Your choices',
    body: [
      'You can ask us for a copy of the information we hold about you, ask us to correct anything that is wrong, or ask us to delete it. We will respond within thirty days.',
      'Where deletion would conflict with a legal duty — for example, an invoice we must keep for tax — we will tell you what we have to retain and why.',
      'You can stop marketing messages at any time by replying STOP on WhatsApp, using the unsubscribe link in any email, or simply telling us. This does not stop messages about a booking you have already made.',
      'You can refuse or clear advertising cookies through your browser settings. Doing so does not affect your ability to book.',
    ],
  },
  {
    title: '8. How we protect it',
    body: [
      'Information is transmitted over encrypted connections and held on access-controlled servers. Access within Eventana is limited to the team members who need it to do their job, and the most sensitive information — full customer lists and payment records — is restricted to the owner and managers.',
      'No system can be guaranteed completely secure. If a breach ever affected your information in a way likely to cause you harm, we would tell you and the relevant authority without undue delay.',
    ],
  },
  {
    title: '9. Changes to this policy',
    body: [
      'If we change how we handle your information we will update this page and change the date below. Where a change is significant, we will tell you directly.',
      'Last updated: 26 August 2026.',
    ],
  },
];

const AR: Section[] = [
  {
    title: '١. من نحن',
    body: [
      'إيفنتانا للفعاليات («إيفنتانا»، «نحن») تخطّط وتنفّذ حفلات الأطفال وتجهيزات المناسبات في دولة الإمارات العربية المتحدة. توضّح هذه السياسة ما نجمعه من معلوماتك عند الحجز معنا، ولماذا نحتفظ به، وما هي خياراتك.',
      'لأي استفسار عن معلوماتك، أو لتقديم أي من الطلبات الموضّحة أدناه، تواصلي معنا عبر واتساب أو على info@eventanauae.com.',
    ],
  },
  {
    title: '٢. ما الذي نجمعه',
    body: [
      'تفاصيل الحجز التي تعطينها لنا: الاسم، رقم الجوال، البريد الإلكتروني، تاريخ الحفلة ووقتها، عنوان التوصيل والإمارة، عدد الضيوف، اسم صاحب المناسبة وعمره، الثيم الذي تختارونه، وأي ملاحظات أو طلبات خاصة.',
      'معلومات الدفع: لا نرى رقم بطاقتك الكامل ولا نخزّنه. تُدخل بيانات البطاقة مباشرةً لدى مزوّدي الدفع، ولا نحتفظ إلا بالنتيجة — هل نجحت العملية، والمبلغ، ورقم مرجعي لربطها بحجزك.',
      'الصور التي تختارين رفعها، مثل صورة مرجعية أو رسمة طفل لطباعتها على منتج.',
      'الرسائل التي ترسلينها لنا على واتساب، ومعرّفاً من ميتا يخبرنا بأي إعلان جاءت منه المحادثة إن كانت بدأت من أحد إعلاناتنا.',
      'معلومات تقنية تُجمع تلقائياً عند استخدام تطبيق الحجز: نوع الجهاز والمتصفح، وموقع تقريبي مستنتج من عنوان الإنترنت، والصفحات التي تزورينها.',
    ],
  },
  {
    title: '٣. لماذا نحتفظ به',
    body: [
      'لتنفيذ حجزك — تأكيد التاريخ، تجهيز التنسيق، توجيه فريقنا إلى عنوانك في يوم الحفلة، والتواصل معك إذا احتاج أي شيء إلى تعديل.',
      'لتحصيل الدفع وإصدار الإيصالات، ومعالجة أي استرداد أو نزاع.',
      'للرد على رسائلك وتقديم الدعم قبل الحفلة وبعدها.',
      'للوفاء بالتزاماتنا القانونية والضريبية في الإمارات، بما فيها حفظ سجلات المعاملات.',
      'لمعرفة أي من إعلاناتنا يعمل فعلاً. نشارك ميتا سجلاً محدوداً ومشفّراً بالحجوزات المكتملة حتى نقيس أي إعلان أدّى إلى حجز حقيقي لا إلى مجرد استفسار. موضّح في البند ٥.',
      'لإرسال عروضنا الخاصة — فقط إذا طلبتِ ذلك، ويمكنك إيقافه في أي وقت.',
    ],
  },
  {
    title: '٤. معلومات الأطفال',
    body: [
      'حفلاتنا للأطفال، لكن خدمتنا تُباع للبالغين. ولا نجمع معلومات من طفل مباشرةً عن قصد.',
      'يتضمّن الحجز عادةً الاسم الأول للطفل وعمره، يعطينا إياهما الشخص البالغ الذي يحجز، لتخصيص التجهيز. ولا نستخدمهما إلا لتحضير الحفلة وتنفيذها.',
      'وإذا رفعتِ رسمة طفل أو صورته لطباعتها، نستخدمها لإنتاج ذلك المنتج فقط، ونحذفها بعد تسليم الطلب.',
    ],
  },
  {
    title: '٥. مع من نشاركه',
    body: [
      'لا نبيع معلوماتك الشخصية، ولا نشاركها لأغراض تسويق أي جهة أخرى.',
      'مزوّدو الدفع (منهم Stripe و Tabby و Tamara و Ziina) يعالجون الدفع ويستلمون ما يلزمهم لذلك.',
      'ميتا تستلم سجلاً بالحجوزات المكتملة لقياس إعلاناتنا. البيانات المعرِّفة مثل بريدك ورقمك تُشفَّر تشفيراً غير قابل للعكس على خوادمنا قبل الإرسال — فتستلم ميتا القيم المشفّرة لا بياناتك الفعلية. كما تستلم ميتا رسائلك على واتساب بصفتها مشغّلة تلك الخدمة.',
      'مزوّدو خدمات يشغّلون أجزاءً من منصّتنا نيابةً عنّا: الاستضافة وقاعدة البيانات، والبريد الإلكتروني، وتخزين الصور، وخدمات الخرائط والتقويم المستخدمة لتخطيط التوصيل. ولا يجوز لأيٍّ منهم استخدام المعلومات إلا لتقديم تلك الخدمة لنا.',
      'الجهات الرسمية أو المستشارون المهنيون، حين يوجب القانون ذلك أو للدفاع عن حق قانوني.',
      'بعض هؤلاء المزوّدين يعملون خارج الإمارات. وعند نقل المعلومات للخارج نعتمد على مزوّدين يلتزمون تعاقدياً بحمايتها بمستوى مماثل.',
    ],
  },
  {
    title: '٦. مدة الاحتفاظ',
    body: [
      'سجلات الحجز والدفع: سبع سنوات، استيفاءً للمتطلبات الضريبية والمحاسبية في الإمارات.',
      'الصور المرجعية والرسمات المرفوعة: تُحذف بعد تسليم الطلب المرتبط بها.',
      'استفسارات واتساب التي لم تتحوّل إلى حجز: حتى سنتين، ثم تُحذف.',
      'سجلات الموافقة على التسويق: طوال اشتراكك، ولسنتين بعده لإثبات أنك طلبتِ التواصل.',
    ],
  },
  {
    title: '٧. خياراتك',
    body: [
      'يمكنك طلب نسخة من معلوماتك لدينا، أو تصحيح ما هو خاطئ، أو حذفها. ونرد خلال ثلاثين يوماً.',
      'وإذا كان الحذف يتعارض مع واجب قانوني — كفاتورة يجب حفظها ضريبياً — نخبرك بما يلزمنا الاحتفاظ به وسببه.',
      'يمكنك إيقاف الرسائل التسويقية في أي وقت بالرد STOP على واتساب، أو رابط إلغاء الاشتراك في أي بريد، أو بإخبارنا مباشرةً. وهذا لا يوقف رسائل حجز قائم بالفعل.',
      'ويمكنك رفض ملفات تعريف الارتباط الإعلانية أو مسحها من إعدادات متصفحك، دون أن يؤثر ذلك على قدرتك على الحجز.',
    ],
  },
  {
    title: '٨. كيف نحميه',
    body: [
      'تُنقل المعلومات عبر اتصالات مشفّرة وتُحفظ على خوادم محكومة الوصول. والوصول داخل إيفنتانا مقصور على أعضاء الفريق الذين يحتاجونه لعملهم، وأكثر المعلومات حساسية — قوائم العملاء الكاملة وسجلات الدفع — مقصورة على المالك والمديرين.',
      'ولا يمكن ضمان أمان أي نظام ضماناً مطلقاً. وإذا وقع اختراق يمسّ معلوماتك على نحو يُرجَّح أن يضرّك، نُبلغك وتُبلَّغ الجهة المختصة دون تأخير.',
    ],
  },
  {
    title: '٩. تعديلات هذه السياسة',
    body: [
      'إذا غيّرنا طريقة تعاملنا مع معلوماتك، نحدّث هذه الصفحة ونغيّر التاريخ أدناه. وإن كان التغيير جوهرياً، نخبرك مباشرةً.',
      'آخر تحديث: ٢٦ أغسطس ٢٠٢٦.',
    ],
  },
];

export function PrivacySheet({ lang, onClose }: { lang: 'en' | 'ar'; onClose: () => void }) {
  const ar = lang === 'ar';
  const sections = ar ? AR : EN;
  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 60, background: 'rgba(40,20,35,.5)',
        display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
      }}
      onClick={onClose}
    >
      <div
        dir={ar ? 'rtl' : 'ltr'}
        onClick={(e) => e.stopPropagation()}
        style={{
          background: '#fff', width: '100%', maxWidth: 460, maxHeight: '92vh', overflowY: 'auto',
          borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: '20px 20px 34px',
          animation: 'rise .3s ease',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <div style={{ ...fredoka(20, 800), color: C.pinkDeep }}>
            {ar ? 'سياسة الخصوصية' : 'Privacy Policy'}
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              border: 'none', background: C.pinkSoft, color: C.pinkDeep, width: 34, height: 34,
              borderRadius: 999, fontSize: 18, fontWeight: 800, cursor: 'pointer',
            }}
            aria-label={ar ? 'إغلاق' : 'Close'}
          >
            ×
          </button>
        </div>
        {sections.map((s) => (
          <div key={s.title} style={{ marginBottom: 16 }}>
            <div style={{ fontWeight: 800, fontSize: 14, color: C.ink, marginBottom: 6 }}>{s.title}</div>
            {s.body.map((p, i) => (
              <p key={i} style={{ margin: '0 0 7px', fontSize: 12.5, lineHeight: 1.6, color: '#5c5560', fontWeight: 500 }}>
                {p}
              </p>
            ))}
          </div>
        ))}
        <button
          type="button"
          onClick={onClose}
          style={{
            width: '100%', border: 'none', background: C.pink, color: '#fff', borderRadius: 14,
            padding: '13px', fontWeight: 800, fontSize: 14, cursor: 'pointer', marginTop: 6,
          }}
        >
          {ar ? 'تمام' : 'Done'}
        </button>
      </div>
    </div>
  );
}
