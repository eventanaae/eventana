# استبيان QuickBooks Production، ونظام الإجازات السنوية، والإنذارات (Consequence Management)، وملف الموظف
- **التاريخ:** 2026-09-02 (تقريباً من 16:57 لين 22:44 UTC)
- **Session ID:** `session_019uRNBLEQZica5YALc7Cq9q`
- **ملاحظة:** تكملة مباشرة لجلسة `session_01KTEn48iz6AhdMhwu89x6zf` (أولها يعيد عرض رسائل خطابات الإنذار وطلب QuickBooks). نفس الريبو المحلي `C:\Users\SHAIM\Downloads\eventanav3`، والنشر بـ git push إلى Render، و Claude in Chrome على متصفح المالكة.

## 1. طلبات المستخدم
- **QuickBooks Production:** "افتحلي الصفحه وطرش اذن يالله"، و"روح افتح صفحه وافتح كل شي وسوي انت"، و"كمل انت" (يعني تعبئة متطلبات Intuit واستبيان الـCompliance).
- **نظام Annual Leave:** 30 يوم في السنة بنظام Pro-rata، يعني 2.5 يوم لكل شهر مكتمل من تاريخ بداية العمل.
  - البروفايل فيه: Entitlement، Accrued، Used، Pending، Remaining، History.
  - الطلب فيه تاريخ البداية والنهاية والسبب، والنظام يتحقق من الرصيد ومن عدم التعارض.
  - الموافقة أو الرفض من المالكة أو مارشا، والخصم ما يصير إلا بعد الموافقة.
  - الإجازة المعتمدة تنعكس على الكالندر، والموظف يصير Unavailable.
  - القيم تتعدّل من Owner Settings.
  - يتعامل صح مع بداية أو نهاية العقد، والتجديد، والإجازات اللي تمتد بين سنتين، وما يخصم نفس الطلب مرتين.
- "استثني رزان ونون". "المسميات الوظيفية اعتمد على اللي عطيتك قبل".
- تواريخ بداية العمل، وبعدها تصحيحات:
  - Dindo بدأ **8/9/2021** وأخذ كل إجازاته من 2021 لين 2025، و2026 في سبتمبر. و"ضيف في سجل دندو ان شهر ٢ 2026 مااشتغل… قرر مايجدد".
  - "Jane بدت تاريخ 1 sep 2024 خذت ٣٠ يوم كاش اوت، باقيلها ٣٠".
- مراجعة سجل Dindo في موقع MOHRE المفتوح (قراءة فقط، "لا تعدل أو تلغي أو تقدم أي طلب"). وبعدها قالت "خلاص حصلت المعلومات".
- نص التارقت: "اكتب لهم التارقيت، وعقب تحصلون انسنتف، اكتب اهم ليش التارقت مهم… لانه مرتبط باداء الشركه".
- Personal details تكون **للقراءة فقط** ("مب لازم يعدلون عليه")، مع Joining date. وتواريخ الميلاد ("عطيتك قبل").
- الإنذارات: "الوورنينق مالهم لاتخليه ياثر على نقاط شهر ٩… اكسبشن".
  - سكشن **Consequence Management** بالشكل: Final Warning Letter / Reasons / Date / Valid till / Salary Deduction.
  - السلّم: 1st بدون خصم ومدته 6 شهور، 2nd خصم 10% ومدته 6 شهور، Final خصم 16% ومدته سنة.
  - السبب يكون "gross misconduct" بس، وانشال البانر الطويل.
- جدول **Day off**: Monday Gloria، Tuesday Jane و Marsha، Wednesday Dindo، Thursday Diana. ويكون "سكشن بروحه… لانه ممكن يتغير".
- ترتيب البروفايل dropdowns: Personal details، Annual leave، Day off، Performance feedback، Moments، Consequence، Salary increment. ودندو وجين "حصلوا سلاري انكريمينت" (التفاصيل بعدين).
- واجهة: ارتفاع الخانة الرصاصية مثل المستطيل اللي تحتها، والإيفينتات المنتهية تنزل في "Past"، و Next event يعرض كل إيفينتات نفس اليوم.

## 2. اللي انسوّى فعلياً
- **Intuit Production:**
  - "App details" اكتملت 100%:
    - EULA و Privacy على `app.eventanauae.com/?terms=1` و `?privacy=1`.
    - Host `eventanauae.com`، والـURLs على `ops.eventanauae.com`.
    - الفئات: Invoicing & payments، Business Insights، Expenses. القطاع غير منظّم.
  - **الاستبيان الأمني: 4 من 7 أقسام محفوظة** (General، App Information، Authorization & Authentication، API Usage). والإجابات: قراءة فقط، تطبيق داخلي، بدون Gen-AI، TLS وتشفير at rest.
  - الصفحة كانت تتجمّد مع الأتمتة، والإضافة تفقد الوصول بعد التحديث (`help.developer.intuit.com`).
- **نظام الإجازات** انتشر (push `690cb7c..3dcaccf`):
  - تبويب "🌴 Leave" للمالكة والمدير، و"Leave policy" تتعدّل.
  - كرت في البروفايل، والتوزيع التلقائي يتجنّب الموظف وهو في إجازة.
  - Boot task `apps/api/src/db/setEmploymentDates.ts` مع env `STAFF_EMPLOYMENT` (commit `365ec35`).
  - حقل "Prior leave used" و "HR note" (commits `06914b9` و `96958ad`).
  - Dindo: بدأ 2021-09-08، والمستخدم سابقاً 122.5 (الرصيد تقريباً 25). Jane: بدأت 2024-09-01، وتنتهي 2027-09-08، والمستخدم 30 (الرصيد 30).
  - انصلح خطأ `null` في Accrued و Remaining.
- **MOHRE (قراءة فقط):** تصريح Dindo تحت Eventana نوعه **NEW، صادر 10/01/2024**، وما فيه سجل أقدم تحت Eventana. المالكة اعتمدت 2021-09-08 داخلياً.
- **الإنذارات و Consequence Management** (commit `8801857` وغيره):
  - Diana و Gloria عندهم Final Warning Letter، بتاريخ 01/08/2026، وصالح حتى 01/08/2027، والخصم 16%، والسبب "Gross misconduct"، **بدون خصم نقاط**.
  - في شاشة Team: زر Warning بخيار "On record (no penalty)" أو "Warn · clear points".
- Day off: سكشن مستقل، ولوحة "Day-off schedule" في Team (commit `463d941`). وتواريخ الميلاد انعبّت عن طريق boot env.
- ترتيب البروفايل dropdowns مع Salary increment، و Dindo و Jane عندهم "Received – details to be added" (commit `10214b7`).
- Events فيها "Past events" تنطوي (commit `e309f8b`)، و Next event يعرض "Also that day · N more".

## 3. القرارات وقواعد العمل
- الإجازات: Remaining = Accrued − Used − Pending، وتنحسب مباشرة. لا خصم قبل الموافقة، ولا خصم مرتين. رزان ونون مستثنون.
- البيانات الشخصية للموظف للقراءة فقط، والتعديل من Team بس (للمالكة أو المدير).
- سلّم العقوبات: 1st (0%، 6 شهور)، 2nd (10%، 6 شهور)، Final (16%، 12 شهر). إنذار ديانا وقلوريا استثناء: ما يأثر على نقاط سبتمبر.
- البيانات الشخصية للموظفين (الإيميلات، الأرقام) ما تنحط في git، تنحط في env vars وتنطبق بـ boot tasks.
- Claude ما يسجّل دخول في حسابات المالكة، وما يرسل خطابات HR بنفسه، ويقرأ من MOHRE بدون أي إجراء.
- المالكة انزعجت إن بيانات عطتها قبل ما انطبقت ("روح راجع كل البيانات"). **ارجع لسجل الجلسات قبل لا تسأل عن بيانات انعطت قبل.**

## 4. أشياء باقية ومشاكل مفتوحة
- **استبيان Intuit Compliance:** باقي 3 أقسام (Accounting API، Error Handling، Security) و Submit. بعدها Production keys، و `QUICKBOOKS_ENV=production`، و Connect، و Sync.
- تفاصيل الـSalary increment لدندو وجين: "بنحطها بعدين".
- تأكيد نسبة خصم ديانا وقلوريا: في النظام 16%، والخطاب الأصلي فيه AED 200 أو خمسة أيام.
- سؤال طريقة الفلوس فوق 600 (نطرح 600 أول ولا لا) من الجلسة السابقة، ما ظهر إنه انحسم.
