# جلسة Eventana — مراجعة شاملة للأب، التقرير الشهري، الطاقم والليدر (ليلة 4 سبتمبر)

- **التاريخ:** 2026-09-04 (المسجّل في السجل من ~20:03 لين ~23:04 UTC؛ الجلسة مستأنفة وفيها أجزاء قبل compaction)
- **Session ID:** `session_01Lux2dQc84AEEknxRDHufTi`
- **البيئة:** Claude Code محلي على ويندوز (`C:/Users/SHAIM/Downloads/eventanav3`)، الشغل يندفع مباشرة على `main` في `eventanaae/eventana` → Render auto-deploy.
- **ملاحظة:** هالجلسة كمّلت بعدين في `session_01UhE5aY4h2bD2dDD7k3Xe1N` (5 سبتمبر) بنفس الـ compaction summary.

## 1. طلبات المستخدم
- **التقرير المالي الشهري** بالضبط: عدد الأوردرات (كل المصادر)، المبلغ الإجمالي، أكثر 5 منتجات، أكثر 3 إمارات، أكثر 3 مصاريف **بدون الرواتب**، تارقت **30,000 AED على الـRevenue** (Revenue = الإجمالي − المصاريف)، بدون سطر ربح، وبالتمبلت المعتمد (لوقو + شريط قوس قزح). "طرش لي بي دي اف / استخدم التمبلت المعتمد"، و"ريبورت اباه عربي".
- تصليح تاسك ديانا (تنبيه مشكلة ما ينمسح بعد الإنجاز).
- لوحة "Outstanding / expected-in" (AED 64,025 / 20 أوردر غير مدفوع): "هذي ليش موجود لو تصلح شيله" + "تاكد ماانحسب في الكاش اون هاند".
- "عاشه حجزت معانا؟" — التأكد من حجز وإيصال عميلة.
- طرق دفع إيصالات QuickBooks تطلع Unknown: "كلام مب معقول لان كنا نسجل كل شي في كويك بوك".
- فَنَل الموقع (زوار → مسجّلين → حاجزين) + "اهم شي البيانات تتصدر لميتا بعد عشان الاعلانات".
- صحة أرقام الهواتف: "نظف بدون ماتخرب… القائمه ٢٢ يحتاجون تجييك يدوي طرشهم لايميل مارشا… في المستقبل لاتسمح تسجيل اي رقم بدون مفتاح" + "نفس الشي على ايصالات يدويه". إيميل مارشا مرة وحدة بس.
- "marsha@eventanauae.com — خزن ايميلها لما اقول لك مارشا هذا هو ايميلها".
- باتش الليل (5 تاسكات): إشعارات الموظفين (تيب، نيو أوردر، ريسك، فيدباك، عيد ميلاد موظف، دي أوف اليوم، ريبورت نواقص)؛ إيميل Reconciliation + Audit شهري لـ sheem@eventanauae.com ومارشا "مع كل التفاصيل"؛ رد أوتو على تقييمات قوقل لو ممكن؛ إيميل عيد ميلاد لكل موظف؛ **كل الأسماء أول حرف كابيتال** (كستمر، أطفال، سبلاير، إيصالات، تاسكات، مصاريف… حتى المستورد).
- تنظيف الداشبورد: شيل Profile و Reports & Tools و Financials (P&L)؛ بدل "More" ثلاث خطوط مثل مارشا؛ Morning brief في الهوم؛ أرقام "This year" أكبر من المربعات؛ شيل Recommendations و Year-end forecast و Operational health و Top customers؛ ترتيب فوق فلتر CEO؛ شيل "My events".
- "3 hidden (busy / off) — طلعهم كلهم عشان اختار".
- "ايفنتات دخلناها ماطلعت هني والتاسكات ماتوزعت".
- "اشتغل على كل التاسكات… لاتسوي سكيب… بعد ماتخلص كل شي سو اوديت جيك على كل شي في الابلكيشن كل زر وسو روكونسليشن وعطني ريبورت".
- **مشكلة التيم (الأهم):** "للمره الثانيه اقول لك التيم يطلع خطا"، "حل المشكله من الجذور"، "مابا اواجه المشكله في المستقبل كل مااعدل"، "👥 Team for this event مايستوي ريفلكت"، "ليش تطلع مارشا ليدر؟".
- آخر الليل: "انت ماعدلت اسماء… حتى الاطفال في هوم"، "اي ايفينت اليوم… بطاقه ورديه اكثر من عشر مرات"، "الريبورت اللي طرشته ايميل فاشل ماطبقت ولا حرف من احتياجاتي"، ثم "الليدر فيه خطا… شوف باقي الاشيا اللي ماشتغلت عليها… تصبح على خير".

## 2. اللي انسوّى فعلياً
- **التقرير الشهري:** `apps/api/src/domain/financeReport.ts` (computeSummary: ordersCount، topItems، topEmirates، أعلى 3 مصاريف بدون wage/salary/part-time/payroll، بانر التارقت `MONTHLY_TARGET_FILS`=30000 AED). مثال يوليو: 20 أوردر، AED 62,360، Revenue −5,566.50 (خسارة).
- **تاسك ديانا:** `apps/api/src/domain/prep.ts` — `clearResolvedPrepIssueAlerts()` تنظيف ذاتي (انمسح alert#31).
- **حذف لوحة Outstanding** من الريبورتس (commit "Reports: remove the misleading Outstanding panel")؛ تأكيد إنها ما تنحسب في Cash on hand.
- **Customer lookup** تشخيصي (`CUSTOMER_LOOKUP`): لقى Aisha Ali Alqubaisi حجزت ودفعت (EVT-ORD-000049، AED 2,620، إيصال #1719)، و Aisha ثانية بدأت وما دفعت (EVT-ORD-000008، AED 6,579).
- **QuickBooks payment methods:** `apps/api/src/domain/quickbooks.ts` (`fetchQbDocMethods` بـ `select *`، `labelForQbMethod`، `QB_METHODS=preview|apply`). بعد موافقتها ("ايوه") انطبق على **515 إيصال** (329 Debit + 186 Tabby حسب الريبورت، صفر كاش). 52 إيصال باقين Unknown (11 منهم صفر/سالب، 41 قديمة غالباً 2023 ما لها طريقة في QB نفسه).
- **فَنَل الموقع + Meta:** جدول `site_visits` + `POST /api/track` + `GET /api/admin/web-funnel`؛ إضافة `CompleteRegistration` (pixel + CAPI) في `attribution.ts` / `integrations/metaCapi.ts`.
- **الأرقام:** `toValidCustomerPhone()` في `maintenance.ts`؛ إلزام مفتاح الدولة في التسجيل، الـcheckout، والإيصالات اليدوية (`POST/PATCH /api/admin/finance/customers`)؛ `phoneMaintenance.ts` نظّف وطرش لمارشا قائمة المراجعة (32 رقم) مرة وحدة.
- **باتش الليل (commit `1bb1b3e`):** feed إشعارات الموظفين داخل الأب (الجرس)، `reconReport.ts` (إيميل شهري لـ sheem@ ومارشا)، `staffBirthdays.ts`، `titleCaseName()` + مهمة `NORMALIZE_NAMES` (initcap على customers, historical_customers, team_members, receipts, invoices, expenses, suppliers).
- **رد قوقل الأوتو:** ما انبنى — يحتاج Google Business Profile API.
- **تنظيف الداشبورد** (commit "Dashboard cleanup: prune pages, tidy CEO, morning brief on Home"): `App.tsx`، `Ceo.tsx`، `Today.tsx`، `Schedule.tsx`، و `GET /api/admin/morning-brief`.
- **Prep للإيفنتات المحوّلة من إيصالات:** `finance.ts` `ensureEventForReceipt` يولّد tasks ويوزّع الطاقم بعد الـcommit.
- **Override picker** يعرض كل الطاقم (busy/off باهت لكن قابل للاختيار).
- **الطاقم/التيم:** تذبذب: أول شي منع دورين لنفس الشخص، بعدين رجّع السماح بعد سؤالها، بعدين رجع ثبّت **دور واحد لكل شخص في نفس الإيفنت** (`canTake`: `if (heldSize > 0) return false;`)؛ `StaffingPanel onChange` عشان "Team for this event" يتحدّث؛ `REASSIGN_ALL` (10 إيفنتات، 0 doubled)؛ الليدر يفضّل Jane/Dindo ثم أول طاقم ميداني، ومارشا remote بس لو كلهم part-timers.
- **الكاش القديم:** `cache:'no-store'` على كل نداءات الداشبورد + auto-reload عبر `/health` اللي يرجّع `commit` (`RENDER_GIT_COMMIT`).
- **Home:** `initcap` لـ eventFor و customTheme؛ `EVENTS_AUDIT` أكد **0 إيفنتات مكررة** (البطاقات المكررة كانت من كود قديم بالمتصفح).
- **Recon مفصّل** (commit `c019a94`) وانطرش لـ sheem@ ومارشا عبر `RECON_SEND_NOW`، بعدين انطفى الفلاق. آخر deploy: `dep-dadkr1ad0e5s73dbltv0`.
- خدمات Render: API `srv-d9uesf0n74is73dkdef0`، dashboard `srv-d9ueslon74is73dkdvk0`، customer `srv-d9ueskgn74is73dkds4g`، workspace `tea-d9ud9r0n74is73dg9akg`.

## 3. القرارات وقواعد العمل
- إيميل مارشا: `marsha@eventanauae.com` (كل ما تقول "مارشا")؛ إيميل المالكة: `sheem@eventanauae.com`. مارشا BCC على كل شي.
- Revenue = الإجمالي − المصاريف (مب المبيعات)؛ تارقت 30,000 AED شهرياً؛ ما في سطر ربح؛ أعلى 3 مصاريف بدون الرواتب.
- لا يُقبل أي رقم هاتف بدون مفتاح الدولة في أي مدخل.
- الأسماء Title Case في كل مكان (مب كلها كابيتال).
- طرق دفع QB تُقرأ من QuickBooks نفسه — ما في "كاش" افتراضي.
- **دور واحد لكل شخص في نفس الإيفنت**؛ نفس الشخص يقدر يروح إيفنتين نفس اليوم إذا الأوقات ما تتقاطع.
- الليدر: Jane أو Dindo إذا موجودين؛ مارشا ما تكون ليدر إلا remote لو كل الطاقم part-timers.
- لا ترسل رسائل لعملاء حقيقيين بدون موافقة صريحة على القائمة (وافقت على تذكير السلة لـ Aisha/Salama/Maryam بس).
- تذكير السلة المتروكة: كل 3 أيام لمدة أسبوعين.
- ما تفعّل خدمات مدفوعة بدون عرض التكلفة.
- المالكة ما تبي يُطلب منها "سوّي refresh" — الحل لازم يكون جذري.

## 4. أشياء باقية / مشاكل مفتوحة
- محتوى إيميل الـRecon ما طابق "احتياجاتها" (اشتكت "ايميل فاشل") — طُلب منها توضيح؛ واحتمال مشكلة توصيل على دومين `eventanauae.com`.
- رد قوقل الأوتو موقوف لين تعطي صلاحية Google Business Profile API.
- إشعارات push للجوال للموظفين ما تشتغل غير عبر الجرس داخل الأب.
- 52 إيصال QB بدون طريقة دفع.
- الأوديت: البناء نجح، 167/167 نداء داشبورد يطابق route — بس المالكة ظلت تشتكي إن التيم/الليدر ما يتحدّث (كمّلت في الجلسة اللي بعدها).
