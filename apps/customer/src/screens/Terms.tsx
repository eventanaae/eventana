import { C, fredoka } from '../ui';

/**
 * Terms & Conditions, shown as a full-screen sheet from checkout (and anywhere
 * else that links to it). Bilingual — the copy is a professional starting draft
 * for the owner to review and adjust; nothing here is auto-generated at runtime.
 */

type Section = { title: string; body: string[] };

const EN: Section[] = [
  {
    title: '1. Agreement & definitions',
    body: [
      'These Terms & Conditions govern your booking with Eventana Events (“Eventana”, “we”, “us”, “our”). By placing a booking you (the person making the booking and the host of the event, together “you”) confirm that you have read, understood and agreed to them.',
      '“Equipment” means all property Eventana brings to or sets up at the venue — including backdrops, décor, inflatables, machines, kiosks, furniture, props, tableware and any rented or made-to-order items. “Event value” means the total paid for a booking excluding delivery and the custom-theme design fee.',
    ],
  },
  {
    title: '2. Bookings & lead time',
    body: [
      'Bookings should be made a few days before the event date and are subject to availability.',
      'Urgent bookings: an event booked within seventy-two (72) hours of its date is accepted where availability allows and carries a 25% urgent surcharge, shown clearly at checkout before payment.',
      'We cannot accept a booking made less than twenty-four (24) hours before the event — our team needs time to prepare.',
      'A booking is only confirmed once full payment is completed and you receive your Event ID. We do not hold dates without payment.',
      'You are responsible for the accuracy of the details you provide (date, time, address, guest of honour, guest count and any special requirements). Eventana is not responsible for issues caused by incorrect or incomplete information.',
    ],
  },
  {
    title: '3. Prices & payment',
    body: [
      'All prices are in UAE Dirhams (AED) and cover the items listed for the selected package or services.',
      'The total shown at checkout — including any delivery fee, surcharge or discount — is the full amount payable, and is paid in full to confirm the booking. We do not offer part-payment or instalments unless agreed in writing.',
      'Payment is made securely through the app or a secure payment link. Eventana never stores your full card details.',
      'Any additional item or service requested after booking (for example an extra hour) is quoted and paid separately before it is provided.',
    ],
  },
  {
    title: '4. Event duration, timing & overtime',
    body: [
      'Standard party packages run for four (4) hours. Certain build-your-own setups (large décor, inflatables or machines) run for six (6) hours.',
      'Our team typically arrives about two (2) hours before your start time to set up, and requires reasonable time after the event to pack down and collect the Equipment.',
      'Additional hours may be purchased after booking, subject to availability. No event may run past midnight (12:00 AM).',
      'Please have the venue ready and accessible at the agreed setup time. Delays caused by the venue or by late access may shorten your event without a refund.',
    ],
  },
  {
    title: '5. Delivery, access & collection',
    body: [
      'Delivery is calculated automatically from your emirate and is added at checkout. Some regions may not be serviced, and this will be shown before payment.',
      'You must provide safe, clear and lawful access to the venue at the agreed time — including parking for our vehicle, a suitable entrance, and use of stairs or a lift where needed — as well as adequate, level space and a suitable power supply for the booked items.',
      'You are responsible for obtaining any permission required from the venue, building management, community or authorities for the setup to take place.',
      'If we cannot deliver, access or set up because the venue is not ready, access is unavailable or unsafe, required permissions are missing, or the information provided was incorrect, the booking is treated as a no-show and is non-refundable; a re-delivery, where possible, may be charged.',
      'The Equipment remains the property of Eventana. Our team collects it after the event; you agree to keep it safe and available for collection and not to move, dismantle, lend or remove any item without our agreement.',
    ],
  },
  {
    title: '6. Custom themes, films & made-to-order items',
    body: [
      'A custom theme carries a design fee of AED 800. This fee is non-refundable once design work has begun, including if the booking is later cancelled or rescheduled.',
      'Where a film or character name is selected, it is used only as a text reference for your chosen theme. Eventana does not supply official posters, logos or copyrighted artwork, and any resemblance is inspired-by only.',
      'Made-to-order keepsakes (giveaways, prints, hats, t-shirts, bands) require roughly two (2) weeks to produce; digital items (invitations, drawings) are typically ready within three (3) days. Please order well ahead of your date. Made-to-order and personalised items are non-refundable once production has begun.',
    ],
  },
  {
    title: '7. Your responsibilities & damage to Equipment',
    body: [
      'From setup, throughout the event, and until our team collects the Equipment, you are responsible for its care at the venue. You agree to use it only as intended and to ensure responsible adult supervision at all times.',
      'You are liable for any loss, theft or damage to the Equipment beyond normal wear and tear — whether caused by you, your guests, children or pets, or by exposing items to unsuitable conditions such as water, fire, food, smoke or weather at an unsuitable site.',
      'Where such loss or damage occurs, Eventana will assess the reasonable cost of repair or replacement, and you agree to pay that amount. Eventana reserves the right to claim and recover this amount from you, including by charging the payment method used for the booking or by issuing a separate invoice payable within seven (7) days.',
      'Our team may record the condition of the Equipment at setup and at collection. This clause is in addition to, and does not limit, any other right or remedy available to Eventana.',
    ],
  },
  {
    title: '8. Guests, capacity & safety',
    body: [
      'Each package is sized for a guest count shown at booking. Exceeding that count may affect safety, comfort and service; please tell us in advance if numbers change.',
      'Inflatables: children must wear socks, and no food or drinks are allowed inside. Responsible adult supervision is required at all times.',
      'Food stations are operated and served only by the Eventana team — children never operate the machines.',
      'Please inform us of any allergies, medical or special requirements before the event.',
    ],
  },
  {
    title: '9. Weather & circumstances beyond control',
    body: [
      'Outdoor setups depend on safe weather and site conditions. For safety, Eventana may adjust, relocate or postpone a setup affected by rain, high wind, sandstorm, extreme heat or an unsafe site.',
      'Eventana is not liable for failure or delay caused by events beyond our reasonable control — including severe weather, utility or network failure, road or venue access restrictions, or measures imposed by any authority. Where such an event prevents delivery, we will offer to reschedule where reasonably possible.',
    ],
  },
  {
    title: '10. Rescheduling & cancellation',
    body: [
      'You may reschedule your event from the app up to seventy-two (72) hours before it starts, provided your items are available on the new date. The theme cannot be changed once this window has passed.',
      'Changes within 72 hours, theme changes and cancellations are handled by our team — please contact us as early as possible.',
      'Cancellation refunds on the event value: more than 7 days before the event — 80% refunded (a 20% cancellation fee applies); 3 to 7 days before — 50% refunded; less than 72 hours before — no refund.',
      'The custom-theme design fee, delivery, and any made-to-order or personalised items are non-refundable regardless of when you cancel. A no-show, or a cancellation by Eventana due to your breach of these terms, is non-refundable.',
      'Approved refunds are returned to your original payment method and may take up to seven (7) business days to appear, depending on your bank or provider.',
    ],
  },
  {
    title: '11. Rewards, vouchers & referrals',
    body: [
      'You earn loyalty points on confirmed bookings, redeemable as described in the app. Points and rewards have no cash value and are non-transferable.',
      'After a confirmed booking you receive a 20% discount code for your next booking, valid for one (1) year and for a single use. Reward codes cannot be combined with the Build-Your-Own discount.',
      'Referral credit, where offered, applies once a referred new customer completes their first eligible booking; Eventana may vary or withdraw rewards, and may reverse credit obtained through misuse.',
      'We may remind you about an unused reward by email; you can unsubscribe at any time.',
    ],
  },
  {
    title: '12. Media, photography & intellectual property',
    body: [
      'We may photograph or film our setups for our portfolio, website and social media. If you prefer we do not, simply tell your team before the event.',
      'All designs, theme concepts, briefs and artwork created by Eventana remain the intellectual property of Eventana and may not be copied or reused without our written permission.',
    ],
  },
  {
    title: '13. Privacy & marketing',
    body: [
      'We use your details to fulfil your bookings and to send you booking-related updates. We send marketing messages only where permitted, and you can opt out at any time. We do not sell your data.',
    ],
  },
  {
    title: '14. Liability',
    body: [
      'Eventana is not liable for injury, loss or damage arising from misuse of equipment, inadequate supervision, or unsuitable venue conditions outside our control.',
      'To the extent permitted by law, Eventana’s total liability for any booking is limited to the amount paid for that booking. Nothing in these terms excludes any liability that cannot be excluded under the laws of the United Arab Emirates.',
    ],
  },
  {
    title: '15. General & governing law',
    body: [
      'Eventana may update these terms from time to time; the version you accept at checkout applies to your booking. If any part is found unenforceable, the rest continues to apply.',
      'These terms are governed by the laws of the United Arab Emirates, and the courts of the emirate in which Eventana operates have jurisdiction. For any question, please contact the Eventana team through the app.',
    ],
  },
];

const AR: Section[] = [
  {
    title: '١. الاتفاقية والتعريفات',
    body: [
      'تنظّم هذه الشروط والأحكام حجزك مع إيفنتانا للمناسبات («إيفنتانا»، «نحن»). بإتمامك الحجز فإنك (الشخص الذي يقوم بالحجز ومضيف المناسبة، ويُشار إليكما بـ«أنت») تؤكد أنك قرأت هذه الشروط وفهمتها ووافقت عليها.',
      '«المعدات» تعني كل ما تُحضره إيفنتانا أو تُجهّزه في الموقع — من خلفيات وديكورات ونطّاطيات وماكينات وأكشاك وأثاث وإكسسوارات وأدوات تقديم وأي عناصر مؤجّرة أو مصنوعة حسب الطلب. «قيمة الحفلة» تعني إجمالي المدفوع للحجز باستثناء التوصيل ورسوم تصميم الثيم الخاص.',
    ],
  },
  {
    title: '٢. الحجز ومدة الإشعار',
    body: [
      'يُفضّل الحجز قبل موعد المناسبة بأيام، وهو خاضع للتوفّر.',
      'الحجز الأرجنت: المناسبة المحجوزة خلال ٧٢ ساعة من موعدها تُقبل حسب التوفّر وتُضاف لها رسوم استعجال ٢٥٪، تظهر بوضوح عند الدفع قبل الإتمام.',
      'لا يمكننا قبول أي حجز قبل المناسبة بأقل من أربعٍ وعشرين (٢٤) ساعة — فريقنا يحتاج وقتاً للتجهيز.',
      'لا يُعتبر الحجز مؤكداً إلا بعد إتمام كامل الدفع واستلامك رقم المناسبة. لا نحجز التواريخ دون دفع.',
      'أنت مسؤول عن صحّة المعلومات التي تقدّمها (التاريخ، الوقت، العنوان، صاحب المناسبة، عدد الضيوف وأي متطلبات خاصة)، ولا تتحمّل إيفنتانا مسؤولية أي مشكلة ناتجة عن معلومات غير صحيحة أو ناقصة.',
    ],
  },
  {
    title: '٣. الأسعار والدفع',
    body: [
      'جميع الأسعار بالدرهم الإماراتي (AED) وتشمل العناصر المذكورة للباقة أو الخدمات المختارة.',
      'الإجمالي الظاهر عند الدفع — شاملاً أي رسوم توصيل أو استعجال أو خصم — هو كامل المبلغ المستحق، ويُدفع بالكامل لتأكيد الحجز. لا نوفّر دفعاً جزئياً أو تقسيطاً إلا باتفاق مكتوب.',
      'يتم الدفع بأمان عبر التطبيق أو رابط دفع آمن. لا تحتفظ إيفنتانا ببيانات بطاقتك كاملة أبداً.',
      'أي عنصر أو خدمة إضافية تُطلب بعد الحجز (كساعة إضافية) تُسعّر وتُدفع بشكل منفصل قبل تقديمها.',
    ],
  },
  {
    title: '٤. مدة المناسبة والوقت والساعات الإضافية',
    body: [
      'الباقات القياسية مدتها أربع (٤) ساعات. بعض تصاميم «صمّم بنفسك» (الديكور الكبير أو النطّاطيات أو الماكينات) مدتها ست (٦) ساعات.',
      'يصل فريقنا عادةً قبل وقت البداية بنحو ساعتين (٢) للتجهيز، ويحتاج وقتاً معقولاً بعد المناسبة للفكّ وجمع المعدات.',
      'يمكن شراء ساعات إضافية بعد الحجز حسب التوفّر. لا يجوز أن تمتد أي مناسبة بعد منتصف الليل (١٢:٠٠ صباحاً).',
      'رجاءً جهّزي الموقع وأتيحي الوصول إليه في وقت التجهيز المتفق عليه. أي تأخير بسبب الموقع أو تأخّر الوصول قد يُقصّر مدة مناسبتك دون استرداد.',
    ],
  },
  {
    title: '٥. التوصيل والوصول والاستلام',
    body: [
      'يُحتسب التوصيل تلقائياً حسب إمارتك ويُضاف عند الدفع. بعض المناطق قد لا تكون مشمولة، ويظهر ذلك قبل الدفع.',
      'يجب أن توفّري وصولاً آمناً وواضحاً ونظامياً للموقع في الوقت المتفق عليه — بما في ذلك موقف لسيارتنا، ومدخل مناسب، واستخدام الدرج أو المصعد عند الحاجة — إضافةً إلى مساحة كافية ومستوية ومصدر كهرباء مناسب للعناصر المحجوزة.',
      'أنت مسؤولة عن الحصول على أي إذن لازم من الموقع أو إدارة المبنى أو المجمّع أو الجهات المختصة لإتمام التجهيز.',
      'إذا تعذّر علينا التوصيل أو الوصول أو التجهيز بسبب عدم جاهزية الموقع، أو عدم توفّر الوصول أو كونه غير آمن، أو نقص الأذونات المطلوبة، أو عدم صحّة المعلومات المقدّمة، فيُعامَل الحجز كعدم حضور وغير قابل للاسترداد، وقد تُحتسب رسوم إعادة توصيل عند الإمكان.',
      'تبقى المعدات ملكاً لإيفنتانا، ويجمعها فريقنا بعد المناسبة. توافقين على الحفاظ عليها وإتاحتها للاستلام، وعدم نقلها أو فكّها أو إعارتها أو التصرّف بها دون موافقتنا.',
    ],
  },
  {
    title: '٦. الثيمات الخاصة والأفلام والطلبات المُصنّعة',
    body: [
      'للثيم الخاص رسوم تصميم قدرها ٨٠٠ درهم، وهي غير قابلة للاسترداد بعد البدء بالتصميم، حتى لو أُلغي الحجز أو أُعيدت جدولته لاحقاً.',
      'عند اختيار اسم فيلم أو شخصية، يُستخدم كإشارة نصّية للثيم المختار فقط. لا توفّر إيفنتانا ملصقات أو شعارات أو أعمالاً فنية محمية بحقوق، وأي تشابه هو «مستوحى» فقط.',
      'التذكارات المصنوعة حسب الطلب (توزيعات، طباعة، قبعات، تيشيرتات، أساور) تحتاج نحو أسبوعين (٢) للتجهيز؛ والعناصر الرقمية (الدعوات، الرسومات) عادةً خلال ثلاثة (٣) أيام. رجاءً اطلبيها بوقت كافٍ. العناصر المصنوعة أو المخصّصة حسب الطلب غير قابلة للاسترداد بعد بدء التصنيع.',
    ],
  },
  {
    title: '٧. مسؤولياتك والأضرار على المعدات',
    body: [
      'من لحظة التجهيز، وطوال المناسبة، وحتى يجمع فريقنا المعدات، تكونين مسؤولة عن العناية بها في الموقع. وتوافقين على استخدامها بالغرض المخصّص لها فقط وعلى ضمان إشراف بالغ مسؤول طوال الوقت.',
      'تتحمّلين مسؤولية أي فقد أو سرقة أو ضرر للمعدات يتجاوز الاستهلاك الطبيعي — سواء تسبّبتِ به أنتِ أو ضيوفك أو الأطفال أو الحيوانات الأليفة، أو نتيجة تعريض العناصر لظروف غير مناسبة كالماء أو النار أو الطعام أو الدخان أو الطقس في موقع غير مناسب.',
      'عند حدوث أي فقد أو ضرر كهذا، تُقدّر إيفنتانا التكلفة المعقولة للإصلاح أو الاستبدال، وتوافقين على دفع ذلك المبلغ. وتحتفظ إيفنتانا بحقّ المطالبة بهذا المبلغ واستردادِه منك، بما في ذلك عبر خصمه من وسيلة الدفع المستخدمة للحجز أو بإصدار فاتورة منفصلة تُسدَّد خلال سبعة (٧) أيام.',
      'قد يوثّق فريقنا حالة المعدات عند التجهيز وعند الاستلام. هذا البند إضافةٌ إلى أي حقّ أو تعويض آخر متاح لإيفنتانا ولا يحدّ منه.',
    ],
  },
  {
    title: '٨. الضيوف والسعة والسلامة',
    body: [
      'كل باقة مُصمّمة لعدد ضيوف يظهر عند الحجز. تجاوز هذا العدد قد يؤثّر على السلامة والراحة والخدمة؛ رجاءً أبلغينا مسبقاً إذا تغيّرت الأعداد.',
      'النطّاطيات: يجب أن يرتدي الأطفال جوارب، ويُمنع الطعام والشراب داخلها. الإشراف من بالغ مسؤول مطلوب طوال الوقت.',
      'محطات الطعام يشغّلها ويقدّمها فريق إيفنتانا فقط — الأطفال لا يشغّلون الماكينات إطلاقاً.',
      'رجاءً أبلغينا بأي حساسية أو متطلبات طبية أو خاصة قبل المناسبة.',
    ],
  },
  {
    title: '٩. الطقس والظروف الخارجة عن السيطرة',
    body: [
      'تعتمد التجهيزات الخارجية على طقسٍ وظروف موقع آمنة. حرصاً على السلامة، قد تعدّل إيفنتانا التجهيز أو تنقله أو تؤجّله إذا تأثّر بالمطر أو الرياح الشديدة أو العواصف الرملية أو الحرّ الشديد أو كان الموقع غير آمن.',
      'لا تتحمّل إيفنتانا مسؤولية أي إخفاق أو تأخير بسبب ظروف خارجة عن سيطرتنا المعقولة — كالطقس القاسي أو انقطاع الكهرباء أو الشبكة أو قيود الوصول للطرق أو الموقع أو أي إجراءات تفرضها جهة مختصة. وعند تعذّر التوصيل لهذا السبب، نعرض إعادة الجدولة متى أمكن ذلك بشكل معقول.',
    ],
  },
  {
    title: '١٠. إعادة الجدولة والإلغاء',
    body: [
      'يمكنك إعادة جدولة مناسبتك من التطبيق حتى اثنتين وسبعين (٧٢) ساعة قبل موعدها، بشرط توفّر عناصرك في التاريخ الجديد. لا يمكن تغيير الثيم بعد انقضاء هذه المهلة.',
      'التعديلات خلال ٧٢ ساعة، وتغيير الثيم، والإلغاء تتم عبر فريقنا — رجاءً تواصلي معنا في أقرب وقت.',
      'استرداد الإلغاء على قيمة الحفلة: قبل المناسبة بأكثر من ٧ أيام — يُسترد ٨٠٪ (تُطبّق رسوم إلغاء ٢٠٪)؛ قبلها بـ ٣ إلى ٧ أيام — يُسترد ٥٠٪؛ قبلها بأقل من ٧٢ ساعة — لا يوجد استرداد.',
      'رسوم تصميم الثيم الخاص، والتوصيل، وأي عناصر مصنوعة أو مخصّصة حسب الطلب غير قابلة للاسترداد بغضّ النظر عن وقت الإلغاء. وعدم الحضور، أو الإلغاء من إيفنتانا بسبب إخلالك بهذه الشروط، غير قابل للاسترداد.',
      'تُعاد المبالغ المعتمدة إلى وسيلة الدفع الأصلية وقد تستغرق حتى سبعة (٧) أيام عمل للظهور، حسب بنكك أو مزوّد الدفع.',
    ],
  },
  {
    title: '١١. المكافآت والقسائم والإحالات',
    body: [
      'تكسبين نقاط ولاء على الحجوزات المؤكدة، قابلة للاستبدال كما هو موضّح في التطبيق. النقاط والمكافآت ليس لها قيمة نقدية وغير قابلة للتحويل.',
      'بعد كل حجز مؤكد تحصلين على كود خصم ٢٠٪ لحجزك القادم، صالح لمدة سنة (١) واحدة ولاستخدام واحد. لا يمكن دمج أكواد المكافآت مع خصم «صمّم بنفسك».',
      'رصيد الإحالة، عند توفّره، يُطبّق بعد إتمام عميل جديد مُحال أول حجز مؤهّل له؛ ويجوز لإيفنتانا تعديل المكافآت أو سحبها، وإلغاء أي رصيد نتج عن إساءة استخدام.',
      'قد نذكّرك بمكافأة غير مستخدمة عبر البريد؛ ويمكنك إلغاء الاشتراك في أي وقت.',
    ],
  },
  {
    title: '١٢. الوسائط والتصوير والملكية الفكرية',
    body: [
      'قد نصوّر تجهيزاتنا (صوراً أو فيديو) لأعمالنا وموقعنا ومنصاتنا. إذا كنت تفضّلين عدم ذلك، فقط أبلغي فريقك قبل المناسبة.',
      'جميع التصاميم ومفاهيم الثيمات والملخّصات والأعمال الفنية التي تنشئها إيفنتانا تبقى ملكاً فكرياً لإيفنتانا، ولا يجوز نسخها أو إعادة استخدامها دون إذن مكتوب منّا.',
    ],
  },
  {
    title: '١٣. الخصوصية والتسويق',
    body: [
      'نستخدم بياناتك لتنفيذ حجوزاتك وإرسال التحديثات المتعلقة بها. ولا نرسل رسائل تسويقية إلا حيث يُسمح بذلك، ويمكنك إلغاء الاشتراك في أي وقت. لا نبيع بياناتك.',
    ],
  },
  {
    title: '١٤. المسؤولية',
    body: [
      'لا تتحمّل إيفنتانا المسؤولية عن أي إصابة أو فقد أو ضرر ناتج عن سوء استخدام المعدات أو نقص الإشراف أو ظروف الموقع غير المناسبة الخارجة عن سيطرتنا.',
      'وبالقدر الذي يسمح به القانون، تقتصر مسؤولية إيفنتانا الإجمالية عن أي حجز على المبلغ المدفوع لذلك الحجز. ولا يستثني أيٌّ من هذه الشروط أي مسؤولية لا يجوز استثناؤها بموجب قوانين دولة الإمارات العربية المتحدة.',
    ],
  },
  {
    title: '١٥. أحكام عامة والقانون الحاكم',
    body: [
      'قد تُحدّث إيفنتانا هذه الشروط من وقت لآخر؛ وتسري على حجزك النسخة التي توافقين عليها عند الدفع. وإذا تبيّن أن أي جزء غير قابل للتنفيذ، يظلّ الباقي سارياً.',
      'تخضع هذه الشروط لقوانين دولة الإمارات العربية المتحدة، وتختصّ محاكم الإمارة التي تعمل فيها إيفنتانا بالنظر في أي نزاع. لأي استفسار، تواصلي مع فريق إيفنتانا عبر التطبيق.',
    ],
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
