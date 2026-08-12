# Eventana — mobile apps (App Store + Google Play)

This wraps the existing React/Vite web apps into native apps with
[Capacitor](https://capacitorjs.com/). No rewrite: the same web build runs
inside a native shell.

Two apps are scaffolded:

| App | Capacitor `appId` | Store name | Notes |
|-----|-------------------|------------|-------|
| `apps/customer`  | `ae.eventana.customer`  | Eventana     | Ship this one publicly. |
| `apps/dashboard` | `ae.eventana.dashboard` | Eventana Ops | **Internal only — see security note.** |

The scaffold in this repo is: `capacitor.config.json` + `.env.production` per
app. Everything else below runs on your own machine (it needs Node, and — for
iOS — a Mac). The dependency install updates `package-lock.json`; commit that
change.

---

## What only you (the account owner) can provide

None of this exists in the repo and none of it can be automated from a Windows
CI without the accounts below:

- **Apple Developer Program** — US$99/year. Required to build, sign, TestFlight,
  and submit to the App Store. https://developer.apple.com/programs/
- **A Mac with Xcode 15+** — iOS apps can only be built/archived on macOS. No
  Mac? Use a cloud-Mac CI (Codemagic, Ionic Appflow, GitHub Actions `macos`
  runners, or an EAS-style service).
- **Google Play Console** — US$25 one-time. Android can be built on
  Windows/Linux. https://play.google.com/console
- **Signing identities** — an iOS Distribution certificate + provisioning
  profile (managed by Xcode), and an Android upload keystore (`.jks`) you
  generate and keep safe.
- **Store listing assets** — 1024×1024 icon, screenshots per device class,
  description, support URL, and a **privacy policy URL** (both stores require
  it).

---

## One-time setup (per app)

Run inside the app directory, e.g. `apps/customer`:

```bash
# 1. Add Capacitor (updates package-lock.json — commit it afterwards)
npm install @capacitor/core@^6 @capacitor/ios@^6 @capacitor/android@^6
npm install -D @capacitor/cli@^6

# 2. Build the web assets, then create the native projects.
#    capacitor.config.json already sets appId/appName/webDir — no `cap init`.
npm run build
npx cap add ios        # macOS only
npx cap add android

# 3. App icons + splash from a single 1024x1024 source image
npm install -D @capacitor/assets
npx capacitor-assets generate --iconBackgroundColor '#efe9e4'
```

Commit the generated `ios/` and `android/` folders and the updated lockfile.

## Every build after a code change

```bash
npm run build && npx cap sync
```

`VITE_API_HOST` is already set to `eventana-api.onrender.com` via
`.env.production`, so release builds point at the live API automatically.

---

## iOS → App Store

```bash
npx cap open ios          # opens Xcode
```

In Xcode:
1. Select the project → **Signing & Capabilities** → pick your Team; confirm
   bundle id `ae.eventana.customer`.
2. Set version/build number.
3. **Product → Archive** → **Distribute App → App Store Connect → Upload**.
4. In [App Store Connect](https://appstoreconnect.apple.com): create the app
   record, fill metadata + screenshots + privacy policy, attach the build,
   test via **TestFlight**, then **Submit for Review**.

## Android → Google Play

```bash
npx cap open android      # opens Android Studio
```

In Android Studio:
1. Set `applicationId` `ae.eventana.customer` and version in
   `android/app/build.gradle`.
2. **Build → Generate Signed Bundle / APK → Android App Bundle (.aab)**, signed
   with your upload keystore.
3. In [Play Console](https://play.google.com/console): create the app, complete
   the content/data-safety forms + privacy policy, upload the `.aab` to
   **Internal testing** first, then promote to Production.

---

## Security: the dashboard app (read before shipping `apps/dashboard`)

The dashboard authenticates to `/api/admin` with a **single shared staff
token** (`VITE_STAFF_TOKEN`), and `src/api.ts` still notes *"Replace with real
staff SSO before go-live."* A mobile build **bakes that token into the
downloadable binary** — anyone who installs the app (or unzips the `.aab`) can
extract it and gain full admin access to bookings, inventory, and settings.

**Do not publish the dashboard on the public App Store / Play Store as-is.**
Choose one:

- **Preferred:** implement real per-user staff auth (SSO / login issuing
  short-lived tokens) before any mobile distribution, **or**
- Distribute internally only — **TestFlight** (internal testers) and Play
  **Internal testing / closed track**, ideally behind MDM — and rotate
  `STAFF_TOKEN` regularly.

The customer app has no such secret and is safe to distribute publicly.

---

## Store-review caveats

- **Apple Guideline 4.2 (minimum functionality).** A thin "website in a
  wrapper" is rejected. Eventana's booking + checkout flow clears the bar, but
  make the mobile UX feel native (safe-area insets, no dead web chrome).
- **Payments are still simulated.** Submitting a store app that "takes orders"
  while checkout can't charge risks a rejection and a poor first impression.
  Finish real payments (see the go-live steps) before public release, or submit
  to a closed test track first.
- **In-app purchase.** Eventana sells **physical event services**, so Apple/
  Google IAP is **not** required — external processors (Tabby/Tamara/Ziina) are
  allowed. Keep the listing clear that purchases are physical services.
