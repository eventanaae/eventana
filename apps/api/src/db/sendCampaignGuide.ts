/**
 * One-time: email Marsha (CC the owner) a clear guide to the B2B corporate
 * campaign system — what it is, timings, what was set up, how/where/why, and
 * her role handling replies. Guarded by app_kv so it sends once.
 */
import { pool } from './pool.js';
import { config } from '../config.js';

export async function sendCampaignGuideOnce(): Promise<void> {
  const guard = await pool.query(`SELECT 1 FROM app_kv WHERE k = 'campaign_guide_sent_v1'`).catch(() => ({ rowCount: 0 }));
  if (guard.rowCount) return;

  const { sendEmail } = await import('../integrations/email.js');
  const logo = config.emailLogoUrl;
  const html = `<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
  <body style="margin:0;background:#FFF8FB;font-family:'Segoe UI',Tahoma,Arial,sans-serif;color:#3B3641;line-height:1.8">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:26px 14px 40px">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px">
        <tr><td style="text-align:center;padding:0 0 16px">${logo ? `<img src="${logo}" alt="Eventana" width="200" style="width:200px;max-width:66%">` : `<b style="font-size:24px;color:#E94F9C">Eventana</b>`}</td></tr>
        <tr><td style="background:#fff;border:1px solid #F3DEEA;border-radius:20px;padding:24px 22px">
          <div style="height:6px;border-radius:4px;background:linear-gradient(90deg,#7FD8C4,#F7D06B,#F7A98C,#F080A8,#B79BE0);margin-bottom:18px"></div>
          <h1 style="font-size:22px;margin:0 0 6px;color:#3B3641">دليل حملة الشركات (B2B) 📣</h1>
          <p style="margin:0 0 16px;color:#6E6470;font-size:14px">مرحبا مارشا 💛 — هذا شرح كامل لحملة إيميلات الشركات: شو هي، متى تطرش، شو جهّزنا، وشو دورك.</p>

          <h2 style="font-size:16px;margin:18px 0 4px;color:#E94F9C">🎯 شو الفكرة؟</h2>
          <p style="margin:0;font-size:14px">نطرش إيميلات تسويقية <b>تلقائياً</b> للشركات (مدارس، جامعات، مستشفيات، عيادات، بنوك، حكومة، شركات، حضانات، محلات جديدة) عشان نجذب حجوزات فعاليات من ميزانياتهم — بدون شغل يدوي.</p>

          <h2 style="font-size:16px;margin:18px 0 4px;color:#E94F9C">🏢 من وين الشركات؟</h2>
          <p style="margin:0;font-size:14px">النظام يجمع شركات جديدة من Google كل يوم (اللي عندها إيميل)، ويصنّفها حسب النوع تلقائياً.</p>

          <h2 style="font-size:16px;margin:18px 0 4px;color:#E94F9C">✉️ شو ينطرش؟</h2>
          <p style="margin:0;font-size:14px">أول إيميل مخصّص لكل قطاع: تعريف بإيفنتانا + خدماتنا + المناسبات + <b>رابط الملف التعريفي</b> + سؤال عن الشخص المسؤول (المشتريات/الفعاليات). كله بشعارنا وستايلنا.</p>

          <h2 style="font-size:16px;margin:18px 0 4px;color:#E94F9C">🕐 التوقيت</h2>
          <p style="margin:0;font-size:14px">
            • إيميلات <b>الشركات</b>: الإثنين–الجمعة، <b>١٠ص – ٢م</b>.<br>
            • إيميلات <b>العملاء</b>: <b>٤ع – ١٠:٣٠م</b>.<br>
            • نبدأ ١٠٠ شركة/يوم (أول دفعة ٢٠ للمراقبة) ونرفع تدريجياً حتى ٢٠٠ — لحماية سمعة hello@.
          </p>

          <h2 style="font-size:16px;margin:18px 0 4px;color:#E94F9C">🔁 المتابعة</h2>
          <p style="margin:0;font-size:14px">لو الشركة ما ردّت خلال <b>أسبوعين</b> → يطرش لها تذكير واحد تلقائي (يسأل مرة ثانية عن الشخص المسؤول). تذكير واحد فقط.</p>

          <h2 style="font-size:16px;margin:18px 0 4px;color:#E94F9C">💬 الردود — دورك يا مارشا</h2>
          <p style="margin:0;font-size:14px">
            • لو شركة ردّت وهي <b>مهتمة</b> (أو عطتنا إيميل القسم المعني) → يوصلكم <b>إشعار</b> "شركة كذا مهتمة" + <b>رد مقترح جاهز</b>.<br>
            • راجعي الرد المقترح، عدّليه لو تبين، واطرشيه من hello@.<br>
            • الردود التلقائية (out of office) والردود الترحيبية <b>ما تُحتسب</b> — النظام ينبّهكم بس على الاهتمام الحقيقي.
          </p>

          <h2 style="font-size:16px;margin:18px 0 4px;color:#E94F9C">📍 وين تشوفين كل شي؟</h2>
          <p style="margin:0;font-size:14px">الداشبورد → <b>Marketing → Companies</b>: كل شركة لها حالة (جديدة / تواصلنا / مهتمة / حجزت) + فلتر + تواريخ الإرسال والرد.</p>

          <h2 style="font-size:16px;margin:18px 0 4px;color:#E94F9C">📄 الملف التعريفي</h2>
          <p style="margin:0;font-size:14px">صفحة كاملة عن إيفنتانا (من نحن، خدماتنا، عملاؤنا، +٥٠٠ ايفينت):<br>
          <a href="https://eventanauae.com/company-profile.html" style="color:#E94F9C;font-weight:700">eventanauae.com/company-profile.html</a> — تقدرين ترسلينها لأي شركة.</p>

          <h2 style="font-size:16px;margin:18px 0 4px;color:#E94F9C">⭐ ليش؟</h2>
          <p style="margin:0 0 4px;font-size:14px">نكبّر قاعدة عملاء الشركات (B2B) — عملاء يدفعون من ميزانية ويكرّرون — بشكل تلقائي ومنظّم، وكل شي review قبل أي رد يطرش لعميل.</p>

          <p style="margin:20px 0 0;font-size:13px;color:#8a7f88">أي استفسار، احكيني 💕<br>— فريق إيفنتانا</p>
        </td></tr>
      </table>
    </td></tr></table>
  </body></html>`;

  const res = await sendEmail({
    to: 'marsha@eventanauae.com',
    cc: ['sheem@eventanauae.com', 'shaima-ak@hotmail.com'],
    subject: 'دليل حملة الشركات (B2B) — كيف تشتغل ودورك',
    html,
    skipMonitorBcc: true,
  });
  if (res.ok) {
    await pool.query(`INSERT INTO app_kv (k, v) VALUES ('campaign_guide_sent_v1', now()) ON CONFLICT (k) DO UPDATE SET v = now()`).catch(() => {});
    console.log('[campaign-guide] sent to Marsha (CC owner)');
  } else {
    console.error('[campaign-guide] send failed:', res.error);
  }
}
