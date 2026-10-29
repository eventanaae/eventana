# جلسة Eventana — توحيد أسماء الباقات، Eventana Exclusive، شاشة الإيفينت للموظفين، وإصلاح خطأ الهوم

- **التاريخ:** 2026-10-07 (تقريباً 06:45 → 10:55 UTC)
- **Session ID:** `session_01WpAcmQH6ZzeZW2Bt4cepA1`
- **البيئة:** Remote Control من iOS على النسخة المحلية `C:\Users\SHAIM\Downloads\eventanav3`، كل تعديل ينرفع `git push` على `main` وينشر على Render تلقائياً. الموديل: `claude-opus-4-8`.

## طلبات المستخدم
بدأت الجلسة برسالة طويلة فيها ~٢٨ بند (انحفظت في ملف الذاكرة المحلي `memory/eventana-task-queue-2026-10-07.md`)، أهمها:
- **سلامة**: "حفلتها 4/9 اكدت حجزها تاريخ 28/8/2026 عن طريق الموقع ... مب قادر تكبجر معلومات صح من حجوزات الكستمر في الموقع روح راجع الموضوع".
- شيل "الثلاث خطوات" في موقع الكستمر.
- مارشا تقول أغراض (مثل Welcoming Stand) "مب موجودة" — لازم تنعكس من الإيصالات القديمة.
- باقة جديدة الاسم **"Eventana Exclusive Package"** (كانت "Carnival Offer" / "3499 Offer" ≈ ٣٥٠٠) مع أغراضها، وتنعرض في الإيصال وللموظفين.
- البرودكت مافيها بحث (search) — ضيفه.
- تعديل أسماء الباقات بكل الإيصالات القديمة والجديدة والبرودكت: Golden/Silver/Bronze/Spa Birthday Package + Movie Night Package.
- Summer Splash Package بأغراضها.
- الإيفنتات الجاية: شيل "pick crew" التلقائي — "انا بروحي بضيف واحد واحد ... فقط الايفنتات القادمه لاتضيع داتا الايفنتات اللي طافت".
- الهوم: قائمة الإيفنتات اللي تحتاج ستافنق وما انعمل لها assign.
- حجوزات جديدة ما وصلها لها notification.
- مراجعة كل ريفند آخر أسبوعين (منو/شو/ليش).
- صفحة الإيفنتات: فقاعة الخدمة/الباقة يمين كل بطاقة مثل الهوم.
- إيفينت TBD: متى تاريخ الحجز؟ "من اليوم ورايح تكبجر تواريخ الحجز".
- الإيصال اليدوي: خطوات (wizard) ديناميك مثل الكستمر.
- نوت اختياري للمصاريف اللي توافق عليها.
- مراجعة الكاش أون هاند (اختلاف فلوس الإيصال عن الإيفينت).
- مراجعة رواتب الشهر اللي طاف.
- إجازة دندو + ٣ أيام اشتغلها كبارت تايم بالون أرتست ٣٥٠.
- خلال الجلسة: "اشتغل لا تتفلسف وايد"، "كم حجز خذنا لاكسكلوسف يديد" هالشهر، "مايهصك في الرواتب"، "شيل بوكنق كونفيرمد وبيد"، "بدل الفلوس حط الاماره"، "ماقلت لك لاتحط لهم بكم!"، "كل حجز في باقه لازم تحط الاغراض ... في الايصالات او هني للموظفين"، وفي الآخر: مارشا لما تعدّل انفويس ترجع للصفحة الرئيسية، ونفس الشي لما تضيف موظف لإيفينت.

## اللي انسوّى فعلياً
- **سلامة**: تاريخ الحجز ٢٨ أغسطس عبر one-shot `SET_BOOKED` (setter عام ref=date) → أغسطس خلص.
- **دندو**: إجازة ٤–٣٠ سبتمبر + ٢–٦ أكتوبر، وبارت تايم balloon artist @ AED 350 لأيام ٤/١٢/٢٦ سبتمبر (= 1,050). ملفات: `apps/api/src/domain/staffPayReport.ts` (إضافة balloon_artist/twisting @350). المساعد فسّر "٤ سبتمبر لين ٣١ ثمانية" كـ ٤–٣٠ سبتمبر.
- **ريفند آخر أسبوعين** (one-shot `REVIEW_REFUND_SALARY`): وحدة بس — Ghaya Al Muhairy AED 550 (طاولات وكراسي ناقصة) سوّتها المالكة ١ أكتوبر. **رواتب سبتمبر: ما فيه ولا سجل** (category=salaries فاضي).
- **أسماء الباقات**: Golden/Silver/Bronze/Spa/Movie Night → "... Birthday Package"/"Movie Night Package" (`packages/shared/src/catalogue.ts` + one-shot `RENAME_PACKAGES`). Summer Party → **Summer Birthday Package**.
- **Eventana Exclusive**: أول محاولة أضافت باقة جديدة بالغلط → انعكست (revert). بعدها: `EXCLUSIVE_RENAME`/`SCAN_EXCL`/`UNIFY_EXCL` تعيد تسمية "Carnival Offer" + "3499 Offer" + "24 Hour Offer" + "3500 Offer" + "Marwa Rateb Package" → **Eventana Exclusive Package** في services، receipt line-items (المفتاح `name`)، event_services، historical_orders. ملاحظة تقنية: أسماء أغراض الإيصال مخزّنة بمفتاح `name` مب `label`.
- **التوحيد النهائي (`UNIFY_EXCL=MAP`)**: New/Kids Golden → Golden Birthday Package، New/Kids Silver → Silver، New/Kids Bronze (+ "New Bronze Pakage") → Bronze، Summer Package → Summer Birthday Package. الأعداد: Silver 127، Bronze 108، Golden 91، Summer 42، Exclusive 20. **بدون أي تغيير بالأسعار.**
- **Exclusive أكتوبر**: ٧ حجوزات جديدة = AED 24,499.
- **Marketing**: شيل legend "EMAIL TYPES" (`apps/dashboard/src/views/Marketing.tsx`).
- **صفحة الإيفنتات** (`apps/dashboard/src/views/Events.tsx`): فقاعة الباقة/الخدمة على كل بطاقة (API يرجّع `package_name` + `ordered_services`)؛ شيل شارات "Booking Confirmed"/"paid" (تطلع بس لو ملغي/غير مدفوع)؛ المبلغ استبدل بفقاعة **الإمارة**.
- **نوت المصروف**: عمود `expenses.note` في `apps/api/src/db/schema.sql` + `domain/bankInbox.ts` + `views/BankInbox.tsx`.
- **شاشة الإيفينت للموظفين**: "Booked services" بدون أي فلوس/Total paid، وتعرض أغراض الباقة (nested) بما فيها Exclusive.
- **الإيصالات**: أغراض الباقة تحت سطر الباقة في معاينة الداشبورد والإيصال المطبوع/المرسل (helper مشترك `packageItemNames`).
- **كروت الهوم** (`views/Today.tsx`): نفس ستايل الإيفنتات (إمارة يمين، الطلب تحت، padding/border/shadow).
- **Staffing يدوي** (`apps/api/src/domain/staffing.ts`): ما يولّد crew slots تلقائياً للإيفنتات الجاية (٢٣ حفلة انمسحت خاناتها)، المالكة تضيف "Add a role".
- **أغراض Exclusive** النهائية: Bouncy Castle 4x4m، Main Balloon Stand، Welcoming Stand، 2 Clowns، Popcorn (40 kids)، Cotton Candy (40 kids)، Tables & Chairs (20 kids)، 10 Giveaways، Music Speaker.
- **Entertainers → Clowns** بكل الباقات (Bronze/Silver/Golden/Summer)؛ صفحة **Products** (`views/Products.tsx`) صارت تعرض أغراض كل باقة.
- **Summer Splash**: تعريف أغراضه في catalogue (مفتاح على "Summer Splash Package" و"Splash Summer Package"): Large Water Slide (Blue)، Slush & Popcorn Combo Station، Main Balloon Backdrop، 1 Cake Stand، طاولات وكراسي، 2 Clowns، Music Speaker.
- **جملة الطاولات النهائية**: "Themed Tables & Chairs for 20 Kids" بكل مكان (بعد "Tables & Chairs Theme Setup" ثم "... for 20 Kids Theme Setup").
- **إصلاح خطأ الهوم**: query صرف الإعلانات في morning-brief استخدم `month` كـ alias → Postgres `syntax error at or near "month"` → 500 وبانر خطأ بكل التطبيق. انصلح (alias جديد) وانرفع commit "Fix Home crash: morning-brief ads query used bare "month"...".

## القرارات وقواعد العمل
- **Summer Splash باقة مستقلة** — "خله مثل ما هو لاتدق ابدا"، سعره ٢٢٠٠ (أحياناً أقل للعميل)، فيه blue water slide وbackdrop small. (بعدين المالكة نفسها طلبت تعريف أغراضه.)
- Eventana Exclusive = Carnival Offer = 3499 Offer = 24 Hour Offer = 3500 Offer = Marwa Rateb. **"عدّل لا تضيف"** — الباقة موجودة، ممنوع تكرار.
- **ما تغيّر أي شي قيمته ٣٥٠٠ عشوائياً** — بس الأسماء اللي تأكدها المالكة. Cake Offer، Teddy Bear، Classic White، 2900 AED Offer، Graduation offers = كل واحد مختلف، تبقى.
- التوحيد يطبق **بكل مكان** (برودكت، إيصالات قديمة وجديدة، إيفنتات، داشبورد) **بدون تغيير الأسعار**.
- الأكل (Popcorn/Cotton Candy/...) = **٤٠ طفل**، الطاولات = **٢٠ طفل** في كل الباقات.
- **"Clowns" بدل "Entertainers"** دوم. **"Station" مب "Kiosk"**.
- جملة الطاولات: **"Themed Tables & Chairs for 20 Kids"**، ودوم تحتها: (أوراق صحون كوستمايز، صحون، ملاعق وشوك مع ثيم، ماي مع ثيم، بالون في الوسط).
- **الموظفين ما يشوفون أي فلوس** في شاشة الإيفينت.
- بطاقات الإيفنتات: الإمارة بدل المبلغ، بدون Booking Confirmed/paid.
- اختيار الكرو **يدوي** للإيفنتات الجاية، وما تنمسح بيانات الإيفنتات اللي طافت.
- الرواتب: "مايهصك في الرواتب" — لا تبني نظام رواتب.
- أسلوب: اشتغل على طول وبإيجاز ("لا تتفلسف"، "اشتغل على طول اول باول لاتقعد تسجل شي")؛ المالكة كانت منزعجة من الأخطاء والخلط.

## أشياء باقية / مشاكل مفتوحة
- **سطر التفاصيل تحت "Themed Tables & Chairs for 20 Kids"** — انطلب وبدأ المساعد يدوّر وين ينعرض، بس انقطع بسبب الخطأ؛ غالباً ما خلص.
- **خطأ الهوم/الانفويس/إضافة موظف**: الإصلاح انرفع، بس آخر رسالة كانت "API Error ... ENOTFOUND" ثم "Try again" والمساعد بدأ يتحقق من الديبلوي — **ما تأكد إن الإصلاح حل مشكلة مارشا (تعديل الانفويس) ومشكلة إضافة الموظف**.
- حجوزات الموقع ما تكبجر تاريخ الحجز صح (حجز سلامة جا كيدوي) — مسجّل للمراجعة.
- بنود من القائمة ما خلصت: إشعارات الحجوزات الناقصة، مراجعة الكاش أون هاند، شيل الـ٣ خطوات بموقع الكستمر، قائمة الهوم للإيفنتات اللي تحتاج ستافنق، ويزارد الإيصال اليدوي، بحث في البرودكت/إضافة سيرفس، تاريخ حجز إيفنتات TBD، جوجل ريفيو، صرف إنستقرام (يحتاج توكن)، الأغراض "المفقودة" عند مارشا (Welcoming Stand).
- الباقات المكررة كخدمات (Golden/Silver/Bronze Kids Package، New Bronze Pakage) — المساعد سأل أوحّد/ألغي؛ انضمت للتوحيد في الإيصالات لكن ما واضح إن صفوف الخدمات المكررة انحذفت.
- محتويات "24 Hour Offer" القديمة غير موثّقة.
- متغيرات البيئة في Render وصلت الحد الأقصى (٣٠٠) من كثرة مهام one-shot — المساعد اقترح تنظيف القديمة.
