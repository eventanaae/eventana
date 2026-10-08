# Eventana — App Store Readiness Review

_Prepared autonomously, 2026-10-09. For the Eventana **customer booking app** (eventanauae.com / the Vite + React PWA). The ops app is covered briefly at the end._

## TL;DR

- **The app is a web app (React SPA + PWA).** It can be shipped to the App Store, but **not** as a plain "wrap the website in a WebView" build — Apple rejects those under **Guideline 4.2 (Minimum Functionality)**. We need a hybrid build (Capacitor) that adds a few genuinely native capabilities.
- **Good news on payments:** booking physical event services is **exempt from Apple's mandatory In-App Purchase** (Guideline 3.1.1). We can keep Tabby / Tamara / Stripe. Apple does **not** take 30% of event bookings. (Confirm against Apple's current text before submitting.)
- **Two hard blockers that only you can clear:**
  1. **An Apple Developer account** (USD 99/year) under Eventana's name — needs a D-U-N-S number for an Organization account (recommended over Individual, so the seller shows as "Eventana").
  2. **A Mac with Xcode** to build & upload the iOS app. I cannot build iOS from here (no macOS). Options below.

---

## 1. Why a plain wrapper fails (and what passes)

Apple reviewers open the app, use it, and toggle **Airplane Mode**. If it then shows a browser error page or looks like Safari with no address bar, they reject it under **4.2** as "not sufficiently different from a mobile browsing experience." Push notifications, location and sharing **alone are not enough**.

**To pass 4.2, the iOS build should add native capabilities a browser can't match. Realistic, high-value ones for Eventana:**

| Native capability | Why it helps the app | Effort |
|---|---|---|
| **Native push notifications** (booking confirmed, driver on the way, event reminders) | Real native value; we already have web-push (VAPID) logic to mirror | Medium |
| **Offline view of upcoming bookings** (cached) | Passes the Airplane-Mode test; genuinely useful | Medium |
| **Add-to-Calendar + reminders** for the event date | Native, booking-specific | Low |
| **Home-screen / Lock-screen widget** ("your next party in N days") | Strong native signal | Medium-High |
| **Photo upload from camera/library** for inspiration photos & custom-print artwork | Already in the flow; make it use native pickers | Low |
| **App Intents / Shortcuts** ("Hey Siri, open my Eventana booking") | Strong native signal | Medium |

We do **not** need all of these — **2–3 done well** (native push + offline bookings + add-to-calendar) is a credible 4.2 pass. Put them in the **App Review notes**: "list what the app does that the website can't."

Also watch **4.2.2**: the app must not read as a collection of links / web clippings. Ours is a real transactional booking flow, so we're fine as long as the home screen opens into the booking app, not a link list.

---

## 2. Recommended build path (given no in-house Mac)

The app is already a React SPA, so **Capacitor** (wrap the existing web build in a native iOS shell and add native plugins) is the lowest-effort path — we reuse 95% of the current code.

**Options to actually produce the `.ipa` without buying a Mac:**

1. **Capacitor + a cloud Mac CI** (recommended): build iOS on **Ionic Appflow**, **Codemagic**, **Bitrise**, or **GitHub Actions `macos` runners**. Push code, the cloud Mac builds & uploads to App Store Connect. No physical Mac needed. ~USD 0–100/mo depending on tier.
2. **Hire a freelance iOS dev** for the submission (one-off) — they bring the Mac + know the review ropes.
3. **Buy/borrow a Mac Mini** (cheapest Apple Silicon) if you want it in-house long term.
4. **PWABuilder (Apple path)**: Microsoft's tool wraps a PWA for iOS — but it produces a thin wrapper that is **high-risk under 4.2**. Only viable if we first add the native features above. Not recommended as-is.

**My recommendation:** Capacitor + Codemagic/Appflow cloud build, adding native push + offline bookings + add-to-calendar. I can prepare the Capacitor config, the native-feature web code, and the CI pipeline from here; the only things I can't do are run the macOS build and hold the Apple account.

---

## 3. App Store Connect submission checklist

Things Apple requires for the listing (most need your accounts/assets):

- [ ] **Apple Developer Program** enrolment (Organization, with D-U-N-S) — _you_
- [ ] **App Store Connect** app record: name "Eventana", bundle id e.g. `ae.eventanauae.app`
- [ ] **Privacy Policy URL** (required) — we have content at eventanauae.com; needs a dedicated `/privacy` page that covers data collected (name, phone, email, address/location, photos, payment handled by processors)
- [ ] **App Privacy "nutrition label"** in App Store Connect: declare data collected & linked to the user (contact info, location, photos, purchase history). Must match what the app actually collects.
- [ ] **Support URL** + support email (support@ or marsha@eventanauae.com)
- [ ] **Screenshots** for required device sizes (6.7"/6.9" iPhone, and iPad if we ship iPad) — can be generated from the live app
- [ ] **App icon** 1024×1024 (we have brand icons; needs the exact size, no alpha)
- [ ] **Age rating** questionnaire (likely 4+)
- [ ] **Category**: Lifestyle or Shopping
- [ ] **Sign-in**: if we offer account login, Apple may require **Sign in with Apple** _if_ we also offer other third-party logins (Google/Facebook). We currently use email/password only → **Sign in with Apple is NOT required**. (If we ever add Google login, we must add Apple login too.)
- [ ] **Demo account** for the reviewer (a test customer login) in App Review notes
- [ ] **Permission usage strings** (Info.plist): camera ("to attach inspiration & artwork photos"), photo library, notifications, location ("to set your delivery emirate") — each needs a clear purpose string or the app is rejected
- [ ] **Account deletion** inside the app (Apple requires any app with account creation to offer in-app account deletion) — **check we have this; if not, it's a required build item**

---

## 4. Policy risks specific to Eventana — review

| Area | Status | Action |
|---|---|---|
| **4.2 Minimum functionality** | ⚠️ Main risk | Add native push + offline bookings + calendar before submitting |
| **3.1.1 In-App Purchase** | ✅ Exempt (physical services) | Keep Tabby/Tamara/Stripe; do NOT add Apple IAP. Confirm current text. |
| **Sign in with Apple (4.8)** | ✅ Not required | Only email/password today. Re-check if Google/Facebook login is added. |
| **Account deletion (5.1.1(v))** | ❓ Verify | App must let users delete their account in-app — confirm this exists |
| **Privacy nutrition label (5.1)** | ❓ To build | Fill accurately in App Store Connect |
| **Permission purpose strings** | ❓ To build | Add camera/photos/notifications/location strings |
| **"Disney" theme/package names** | ⚠️ Trademark | "Disney Package" and any Disney/character theme names are third-party trademarks. Apple (and the brands) can object. Safer to rename to generic ("Premium Package", "Magic Package") in the app before App Store review. |
| **Data safety / payments** | ✅ via processors | We never store card data (Tabby/Tamara/Stripe handle it) — good |

---

## 5. What I can do from here (no Mac needed)

- Prepare the **Capacitor** integration in the repo (config, iOS project scaffold, native plugins wired to the existing web flow).
- Write the **native-feature web code**: native push registration, offline-cached bookings view, add-to-calendar, native photo picker.
- Build the **CI pipeline** (Codemagic/Appflow/GitHub macOS) so a push produces an uploadable build.
- Draft the **privacy policy page**, the **App Privacy answers**, the **review notes**, and generate **screenshots** from the live app.
- Add **in-app account deletion** if it's missing.

## 6. What only you can do

- Enrol in the **Apple Developer Program** (Organization + D-U-N-S) and share access, or add me/a dev as a team member.
- Decide the **build route** (cloud Mac CI vs. freelance vs. buy a Mac).
- Approve renaming the **"Disney"** package/themes to avoid trademark objections.

---

## Ops app (ops.eventanauae.com)

The staff ops app is also a PWA and is **already installable to the Home Screen** ("Eventana Ops"). It's internal (staff only), so an App Store listing adds little and faces the same 4.2 wrapper risk. **Recommendation:** keep it as an installable PWA; don't spend App Store effort there unless you specifically want it listed.

---

### Bottom line
The customer app is **ready to become an iOS app via Capacitor**, and the economics are good (no Apple 30% on bookings). The path is blocked only by the **Apple Developer account** and a **macOS build environment** — both yours to set up. Once you green-light the route and the account, I can do essentially all of the engineering from here and hand a build to the cloud Mac. The one content decision to make first is **renaming "Disney"**.
