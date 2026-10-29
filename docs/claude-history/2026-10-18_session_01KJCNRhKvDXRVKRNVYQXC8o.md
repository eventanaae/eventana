# جلسة Eventana — تصليح تجربة الحجز، بداية نظام QA، وتقارير مالية (Excel + كشف حساب PDF)

- **التاريخ:** 2026-10-18 (21:05 → 21:53 UTC) ثم رجعت 2026-10-22 (12:13 → 13:45 UTC)
- **Session ID:** `session_01KJCNRhKvDXRVKRNVYQXC8o`
- **البيئة:** نفس النسخة المحلية `C:\Users\SHAIM\Downloads\eventanav3` (ويندوز، أوامر PowerShell، **ما فيه Node محلي**)، `git push origin main` → Render. الموديل `claude-opus-4-8`. الجلسة بدأت مباشرة بعد إرسال رد شكوى EV-1757 (من الجلسة السابقة).

## طلبات المستخدم
1. "ها شصار" → المساعد أكد إن إيميل الرد على شكوى EV-1757 انرسل (law-student@hotmail.com + CC مارشا).
2. تجربة حجز من الموقع وطلعت 4 مشاكل:
   - "ماطلع لي بوب اب كود الخصم ... لازم كل ما العميل يدخل يطلع البوب اب".
   - "اخر شي لازم يطلع ان في كود خصم متوفر حقي فوق الدسكاونت كود".
   - "خطوة الجيك اوت سويت اد ايتم من الكاتالوج ... رجعني خطوات ورا ... اضطريت احط معلوماتي مره ثانيه".
   - "لما ضفت شي وقت الجيك اوت العنصر الرئيسي انمسح اللي هي الباقه".
3. "شو نسوي الحين" → "روح انت سو كل شي وراجع شو فايدتك".
4. رسالتين طويلتين بالإنجليزي (برومبت): "Act as a Senior Full-Stack Software Engineer, QA Automation Architect ..." و "EVENTANA — AUTONOMOUS QA & BUG FIXING SYSTEM" — بناء نظام دائم للاختبار واكتشاف الأخطاء وإصلاحها للتطبيقين (موقع العملاء + Ops) والربط بينهم (Phase 1 Discovery ... إلخ).
5. **22 أكتوبر:** "give me expense report of last three months with all the details in it as an excel sheet" → "give downloadable file".
6. "create a pdf including all the transactions of eventana events from the date we started to register in quickbook to till date like a bank statement ... add a note ... the company was established from the date shown in trade license but we were not recording our finances those days ..."
7. "differenciate the transactions using year i want each year statement seperatelely but in single pdf".

## اللي انسوّى فعلياً
**أ) إصلاح تجربة الحجز (apps/customer):**
- ملفات: `apps/customer/src/screens/Home.tsx`, `Build.tsx`, `BuildIntake.tsx`, `Checkout.tsx`, `Explore.tsx`, `apps/customer/src/App.tsx`.
- Commit "Customer booking flow: fix 4 issues from an owner test run":
  1. بوب اب WELCOME10 صار مربوط بالجلسة (`sessionStorage`) بدل مرة للأبد (`localStorage`) → يطلع كل زيارة جديدة.
  2. بالخطوة الأخيرة يطلع تلميح "🎁 You have code WELCOME10 — save AED X" فوق خانة الكود (متحقق من السيرفر).
  3. الرجوع من الكتالوج يحفظ خطوة الـCheckout وبيانات التواصل (كانت local state تنمسح عند remount).
  4. إضافة عنصر ما تمسح الباقة (كان `Build.toggle` يمسحها)؛ زر "أضف عناصر" يستخدم `startBuild({})`.
- Commit إضافي لإصلاح البناء: "Checkout: type the reg state so setReg updaters aren't implicitly any (fix build)".
- المراجعة الآلية لقت خطأ خامس في الإصلاح نفسه (توقيت تحديث الحالة مع `go('build')` كان بيمسح الباقة) وانصلح.
- تحقق المساعد بنفسه على الموقع اللايف (حجز تجريبي وقف قبل الدفع): Golden Birthday AED 5,999 بقت + Corn Station AED 900 انضافت، التلميح "save AED 717.9" ظهر، الرجوع لنفس الخطوة 5 والبيانات موجودة.

**ب) بنية QA (commit "QA infra: eventana-qa skill + Playwright E2E scaffold (customer booking journey) + GitHub Actions QA workflow"):**
- `.claude/skills/eventana-qa/SKILL.md` (سكِل QA يشرح التطبيقين، أوامر الاختبار، القواعد التجارية، حدود الأمان).
- `tests/e2e/` (Playwright: `package.json`, `playwright.config.ts`, `tests/customer-booking.smoke.spec.ts`, `README.md`, `.gitignore`) — رحلة الحجز كاملة، توقف قبل الدفع، بيانات وهمية.
- `.github/workflows/qa.yml` — typecheck + اختبارات API (vitest) + E2E على كل push/PR + يومي + يدوي، ويرفع تقرير بالصور.
- الاكتشاف: مونوريبو بثلاث خدمات + Postgres على Render، **ما فيه staging**، ما فيه E2E أو CI قبل.

**ج) تقرير مصاريف آخر 3 شهور (22 أكتوبر):**
- one-shot قراءة فقط `apps/api/src/db/dumpExpenses3mo.ts` (يطلع الصفوف للّوقز لأن الوصول المباشر لقاعدة الإنتاج ممنوع/SSL) + سكربت PowerShell لبناء الإكسل.
- الملف: `C:\Users\SHAIM\Downloads\eventanav3\Eventana-Expenses-Aug-Oct-2026.xlsx` (ورقتين Expenses + Summary). 309 مصروف = AED 112,290.72 (أغسطس 39,451.15 / سبتمبر 54,679.64 / أكتوبر لين 22: 18,159.93). أعلى البنود: الشحن 21,015.62، الرواتب 17,500، البارت تايمرز 17,100، المشتريات 15,504.96.

**د) كشف حساب PDF بشكل كشف بنكي:**
- one-shot `apps/api/src/db/dumpAllTxns.ts` (مبيعات `finance_receipts` + مصاريف `expenses`، base64 مقسّم باللوقز) + `build_statement_pdf.ps1` / `build_statement_yearly.ps1`.
- النسخة الأولى: من 01 يناير 2023 لليوم، 3,511 معاملة (653 مبيعة + 2,858 مصروف)، داخل 2,537,095.53، خارج 2,148,502.51، صافي 388,593.02، مع ملاحظة التأسيس 10 أغسطس 2021 (رخصة 973691) وبداية التسجيل 01 يناير 2023.
- النسخة النهائية: `C:\Users\SHAIM\Downloads\eventanav3\Eventana-Statement-Yearly-2023-to-date.pdf` (8.2MB) — صفحة ملخص + كل سنة كشف مستقل برصيد جاري يبدأ من صفر: 2023 صافي −46,081.33؛ 2024 +21,281.57؛ 2025 +106,278.35؛ 2026 +307,114.43.

## القرارات وقواعد العمل
- قاعدة ثابتة: **بعد كل مهمة يسوي المساعد مراجعة** للتغييرات (وكيل مراجعة) قبل ما يعتبرها خلصت.
- مسار الدفع والسلة حساس: الاختبار على اللايف يوقف **قبل الدفع** وببيانات وهمية.
- الوصول لقاعدة الإنتاج يكون عن طريق one-shot boot tasks للقراءة فقط تطبع باللوقز.
- المبيعات بالكشف مؤرخة بتاريخ الحدث (فيها حفلات قادمة مدفوعة مقدماً).
- الملفات للمالكة تنرسل كملف قابل للتنزيل.

## أشياء باقية / مشاكل مفتوحة
- **قرارات QA المطلوبة من المالكة:** (1) الـE2E يشتغل على الموقع اللايف (قراءة فقط) ولا نجهّز staging؟ (2) secrets: Sentry + `ANTHROPIC_API_KEY` وسقف صرف للإصلاح الآلي؛ (3) حساب موظف محدود لاختبار صلاحيات Ops.
- أول تشغيل للـE2E في GitHub Actions لازم يتأكد من الـselectors (ما انجرّب محلياً).
- المراحل الجاية المقترحة: اختبارات Ops (دخول + صلاحيات)، اختبارات الربط (حجز بالموقع ← يظهر بـOps)، Sentry، ورك-فلو إصلاح آلي PR، لوحة تقارير QA.
- عروض معلّقة على كشف الحساب: رصيد افتتاحي مرحّل بين السنين، فصل المبيعات عن المصاريف، ملخص شهري، إيقاف الكشف عند تاريخ اليوم، هيدر عربي/لوقو.
- عرض على تقرير المصاريف: نسخة بدون القيود المستوردة (~AED 99,385) أو فترة مختلفة.
- اقتراحات معلّقة: كوب البوبكورن في Canva، شغل الماركتنق/إعلانات إنستقرام.
