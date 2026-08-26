**To:** Marsha@eventanauae.com
**From:** hello@eventanauae.com
**Subject:** Three setup tasks for the ad account — about 20 minutes

---

Hi Marsha,

Three things, in order. The first makes the other two much easier.

---

## 1. Switch Ads Manager to English

Ads Manager doesn't have its own language switch — it follows whatever language your Facebook account is set to. Change it once and every Meta tool follows.

1. Open **facebook.com** and click your profile picture, top right
2. **Settings & privacy → Settings**
3. In the left menu: **Language and region**
4. Next to **Facebook language**, click **Edit**
5. Choose **English (UK)** and click **Save changes**
6. Reload Ads Manager — it comes back in English

Business Manager keeps a separate setting. If it's still Arabic: **business.facebook.com → the gear icon (Business settings) → your name at the top → Language**.

---

## 2. Generate the Conversions API access token

**Why this matters:** right now Meta can only tell us how many people started a WhatsApp chat. It cannot tell us how many of those actually booked and paid. This token closes that gap — the booking system starts reporting every paid booking straight back to the ad account, so Ads Manager finally shows real revenue instead of just conversations.

Until it's set, that reporting is switched off silently. Nothing errors, nothing warns — it just doesn't happen.

**Steps:**

1. Open **business.facebook.com/events_manager2**
2. In the left menu, click **Data sources**
3. Select the dataset **Eventana | ايفينتانا** — the ID is `1218177689847042`
4. Open the **Settings** tab
5. Scroll down to the **Conversions API** section
6. Click **Generate access token**
7. Copy the token — Meta shows it only once. If you lose it, generate a new one; that's fine, no harm done.

---

## 3. Where the token goes — please do NOT email it

**This is the important part.**

That token never expires and it lets whoever holds it write events into our ad dataset. If someone else got hold of it, they could flood the account with fake conversions and quietly destroy how Meta optimises our ads — and we'd be paying for it the whole time.

An email copy lives forever, in your Sent folder and in the recipient's inbox. So please don't email it to me, to Shaima, or to anyone else. Paste it straight where it belongs instead:

1. Open **dashboard.render.com** and sign in
2. Open the service **eventana-api**
3. Left menu → **Environment**
4. **Add environment variable**
   - Key: `META_CAPI_ACCESS_TOKEN`
   - Value: paste the token
5. **Save changes** — the service restarts itself, about two minutes

Then just reply to this email with the word **done**. That's all I need. I'll verify from my side that bookings are reaching the ad account, without ever seeing the token itself.

If you don't have a Render login, stop after step 6 above and tell Shaima — she'll do this part. Don't send the token over WhatsApp or email to bridge the gap.

---

## What else would genuinely help

**a) Bookings by emirate, last 60 days.** This is the most valuable thing on the list. For each booking: the emirate, the package, and roughly where the customer came from. Meta counts chats, not bookings — and we already know those two things disagree. Gender Reveal had the cheapest conversations in the whole account and almost never produced a booking, which is exactly why it's paused. Without your booking list I'm optimising toward a number that doesn't pay us.

**b) Please don't pause, edit or change any ad until Friday 29 August.** The account was restructured on the 25th and Meta is in its learning phase. Every edit restarts that phase and re-spends the warm-up budget. Day one already came in at AED 11.01 per conversation against a lifetime average of 12.15, so it's working — it just needs to be left alone.

**c) A clean photo of a water-slide setup.** Two rules: no licensed cartoon characters anywhere in frame (Disney and similar will have the ad rejected, and they do pursue commercial use), and no child's name visible on the backdrop. If you have one with water actually in the pool, that's the one — it converts far better than an empty setup.

**d) Which packages are currently valid, with today's prices.** I have Golden at 5,999 and Summer at 3,999, plus the 2,200 summer offer running to 30 September. If any of those has changed, tell me before it goes into an ad.

---

Thanks Marsha — item 2 and 3 together are about ten minutes, and they unlock the single biggest blind spot we have.

Eventana
