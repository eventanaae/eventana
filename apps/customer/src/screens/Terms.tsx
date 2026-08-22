import { C, fredoka } from '../ui';

/**
 * Terms & Conditions, shown as a full-screen sheet from checkout (and anywhere
 * else that links to it). Bilingual — the copy is a professional starting draft
 * for the owner to review and adjust; nothing here is auto-generated at runtime.
 */

type Section = { title: string; body: string[] };

const EN: Section[] = [
  {
    title: '1. Agreement',
    body: [
      'These Terms & Conditions govern your booking with Eventana Events (“Eventana”, “we”, “us”). By placing a booking you confirm that you have read, understood and agreed to them.',
    ],
  },
  {
    title: '2. Bookings & lead time',
    body: [
      'Bookings should be made at least one (1) week before the event date, subject to availability.',
      'Rush bookings: an event booked less than seven (7) days before its date is accepted where availability allows and carries a rush surcharge of 40% of the party value (shown clearly at checkout before payment).',
      'We cannot accept a booking made less than forty-eight (48) hours before the event — our team needs time to prepare.',
      'A booking is only confirmed once payment is completed and you receive your Event ID.',
    ],
  },
  {
    title: '3. Prices & payment',
    body: [
      'All prices are in UAE Dirhams (AED) and cover the items listed for the selected package or services.',
      'Payment is made securely through the app. Eventana never stores your full card details.',
      'The total shown at checkout — including any delivery fee, surcharge or discount — is the amount payable.',
    ],
  },
  {
    title: '4. Event duration',
    body: [
      'Standard party packages run for four (4) hours. Certain build-your-own setups (large décor, inflatables or machines) run for six (6) hours.',
      'Every event must finish by 12:00 AM. Additional hours may be purchased where the finish time still falls before midnight.',
      'Our team typically arrives about two (2) hours before your start time to set up.',
    ],
  },
  {
    title: '5. Custom themes & made-to-order items',
    body: [
      'A custom theme carries a design fee of AED 800. This fee is non-refundable once design work has begun.',
      'Made-to-order keepsakes (giveaways, prints, hats, t-shirts, bands) require roughly two (2) weeks to produce. Please order these well ahead of your date.',
    ],
  },
  {
    title: '6. Delivery & setup',
    body: [
      'Delivery is calculated automatically from your emirate and is added at checkout. Some regions may not be serviced.',
      'You are responsible for providing safe access, adequate space and a power supply suitable for the booked items.',
    ],
  },
  {
    title: '7. Rescheduling & cancellation',
    body: [
      'You may reschedule your event from the app up to seventy-two (72) hours before it starts, provided your items are available on the new date.',
      'Changes within 72 hours, theme changes and cancellations are handled by our team — please contact us as early as possible.',
      'Refund eligibility depends on how close to the event the cancellation is made; the design fee and any made-to-order items are non-refundable.',
    ],
  },
  {
    title: '8. Safety',
    body: [
      'Inflatables: children must wear socks, and no food or drinks are allowed inside. Adult supervision is required at all times.',
      'Food stations are operated and served by the Eventana team — children never operate the machines.',
      'Please inform us of any allergies or special requirements before the event.',
    ],
  },
  {
    title: '9. Rewards & vouchers',
    body: [
      'After each confirmed booking you receive a 20% discount code for your next booking, valid for one (1) year and for a single use.',
      'Reward codes cannot be combined with the Build-Your-Own discount and have no cash value.',
      'We may remind you about an unused reward by email; you can unsubscribe at any time.',
    ],
  },
  {
    title: '10. Photography',
    body: [
      'We may photograph our setups for our portfolio and social media. If you prefer we do not, simply let your team know before the event.',
    ],
  },
  {
    title: '11. Liability',
    body: [
      'Eventana is not liable for injury or damage arising from misuse of equipment, inadequate supervision or unsuitable venue conditions outside our control.',
      'Our liability for any booking is limited to the amount paid for that booking.',
    ],
  },
  {
    title: '12. Privacy',
    body: [
      'We use your details only to fulfil your bookings and to send you booking and reward updates. We do not sell your data.',
    ],
  },
  {
    title: '13. Contact',
    body: ['These terms are governed by the laws of the United Arab Emirates. For any question, please contact the Eventana team through the app.'],
  },
];

const AR: Section[] = [
  {
    title: '١. الاتفاقية',
    body: [
      'تنظّم هذه الشروط والأحكام حجزك مع إيفنتانا للمناسبات («إيفنتانا»، «نحن»). بإتمامك الحجز فإنك تؤكد أنك قرأت هذه الشروط وفهمتها ووافقت عليها.',
    ],
  },
  {
    title: '٢. الحجز ومدة الإشعار',
    body: [
      'يُفضّل الحجز قبل موعد المناسبة بأسبوع واحد على الأقل، حسب التوفّر.',
      'الحجز المستعجل: المناسبة المحجوزة قبل موعدها بأقل من سبعة (٧) أيام تُقبل حسب التوفّر وتُضاف لها رسوم استعجال بنسبة ٤٠٪ من قيمة الحفلة (تظهر بوضوح عند الدفع قبل الإتمام).',
      'لا يمكننا قبول أي حجز قبل المناسبة بأقل من ثمانٍ وأربعين (٤٨) ساعة — فريقنا يحتاج وقتاً للتجهيز.',
      'لا يُعتبر الحجز مؤكداً إلا بعد إتمام الدفع واستلامك رقم المناسبة.',
    ],
  },
  {
    title: '٣. الأسعار والدفع',
    body: [
      'جميع الأسعار بالدرهم الإماراتي (AED) وتشمل العناصر المذكورة للباقة أو الخدمات المختارة.',
      'يتم الدفع بأمان عبر التطبيق. لا تحتفظ إيفنتانا ببيانات بطاقتك كاملة أبداً.',
      'الإجمالي الظاهر عند الدفع — شاملاً أي رسوم توصيل أو استعجال أو خصم — هو المبلغ المستحق.',
    ],
  },
  {
    title: '٤. مدة المناسبة',
    body: [
      'الباقات القياسية مدتها أربع (٤) ساعات. بعض تصاميم «صمّم بنفسك» (الديكور الكبير أو النطّاطيات أو الماكينات) مدتها ست (٦) ساعات.',
      'يجب أن تنتهي كل مناسبة قبل الساعة ١٢:٠٠ منتصف الليل. يمكن شراء ساعات إضافية طالما أن وقت الانتهاء يبقى قبل منتصف الليل.',
      'يصل فريقنا عادةً قبل وقت البداية بنحو ساعتين (٢) للتجهيز.',
    ],
  },
  {
    title: '٥. الثيمات الخاصة والطلبات المُصنّعة',
    body: [
      'للثيم الخاص رسوم تصميم قدرها ٨٠٠ درهم، وهي غير قابلة للاسترداد بعد البدء بالتصميم.',
      'التذكارات المصنوعة حسب الطلب (توزيعات، طباعة، قبعات، تيشيرتات، أساور) تحتاج نحو أسبوعين (٢) للتجهيز. رجاءً اطلبيها قبل موعدك بوقت كافٍ.',
    ],
  },
  {
    title: '٦. التوصيل والتجهيز',
    body: [
      'يُحتسب التوصيل تلقائياً حسب إمارتك ويُضاف عند الدفع. بعض المناطق قد لا تكون مشمولة بالخدمة.',
      'أنت مسؤول عن توفير وصول آمن ومساحة كافية ومصدر كهرباء مناسب للعناصر المحجوزة.',
    ],
  },
  {
    title: '٧. إعادة الجدولة والإلغاء',
    body: [
      'يمكنك إعادة جدولة مناسبتك من التطبيق حتى اثنتين وسبعين (٧٢) ساعة قبل موعدها، بشرط توفّر عناصرك في التاريخ الجديد.',
      'التعديلات خلال ٧٢ ساعة، وتغيير الثيم، والإلغاء تتم عبر فريقنا — رجاءً تواصلي معنا في أقرب وقت.',
      'تعتمد أحقية الاسترداد على قرب موعد الإلغاء من المناسبة؛ ورسوم التصميم والطلبات المصنّعة غير قابلة للاسترداد.',
    ],
  },
  {
    title: '٨. السلامة',
    body: [
      'النطّاطيات: يجب أن يرتدي الأطفال جوارب، ويُمنع الطعام والشراب داخلها. الإشراف من شخص بالغ مطلوب طوال الوقت.',
      'محطات الطعام يشغّلها ويقدّمها فريق إيفنتانا — الأطفال لا يشغّلون الماكينات إطلاقاً.',
      'رجاءً أبلغينا بأي حساسية أو متطلبات خاصة قبل المناسبة.',
    ],
  },
  {
    title: '٩. المكافآت والقسائم',
    body: [
      'بعد كل حجز مؤكد تحصلين على كود خصم ٢٠٪ لحجزك القادم، صالح لمدة سنة (١) واحدة ولاستخدام واحد.',
      'لا يمكن دمج أكواد المكافآت مع خصم «صمّم بنفسك»، وليس لها قيمة نقدية.',
      'قد نذكّرك بمكافأة غير مستخدمة عبر البريد؛ ويمكنك إلغاء الاشتراك في أي وقت.',
    ],
  },
  {
    title: '١٠. التصوير',
    body: [
      'قد نصوّر تجهيزاتنا لأعمالنا ومنصاتنا. إذا كنت تفضّلين عدم ذلك، فقط أبلغي فريقك قبل المناسبة.',
    ],
  },
  {
    title: '١١. المسؤولية',
    body: [
      'لا تتحمّل إيفنتانا المسؤولية عن أي إصابة أو ضرر ناتج عن سوء استخدام المعدات أو نقص الإشراف أو ظروف الموقع غير المناسبة الخارجة عن سيطرتنا.',
      'تقتصر مسؤوليتنا عن أي حجز على المبلغ المدفوع لذلك الحجز.',
    ],
  },
  {
    title: '١٢. الخصوصية',
    body: [
      'نستخدم بياناتك فقط لتنفيذ حجوزاتك وإرسال تحديثات الحجز والمكافآت. لا نبيع بياناتك.',
    ],
  },
  {
    title: '١٣. التواصل',
    body: ['تخضع هذه الشروط لقوانين دولة الإمارات العربية المتحدة. لأي استفسار، تواصلي مع فريق إيفنتانا عبر التطبيق.'],
  },
];

export function TermsSheet({ lang, onClose }: { lang: 'en' | 'ar'; onClose: () => void }) {
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
            {ar ? 'الشروط والأحكام' : 'Terms & Conditions'}
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
