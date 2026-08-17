# Shipping Chess Dungeon to the iOS App Store

A concrete, staged plan for wrapping the existing vanilla-JS PWA as a native iOS app
using **Capacitor** (the web app runs inside a `WKWebView`; no rewrite). Nothing here
touches game code except a thin native-polish layer at the end.

**Status going in:** Tiers 1 (touch) and 2 (PWA — installable/offline, iOS audio &
zoom fixes) are already shipped in this repo. This document is **Tier 3**.

---

## The two hard blockers (read first)

1. **You need a Mac.** Xcode builds and uploads iOS apps and is **macOS-only**. This
   machine is Windows 11. Options, cheapest-effort first:
   - **Cloud Mac by the hour** — [MacinCloud](https://www.macincloud.com/) (~$1/hr or
     ~$30/mo) or [MacStadium](https://www.macstadium.com/). Enough to build, sign, and
     upload. Recommended for a one-off launch.
   - **CI with macOS runners** — [Codemagic](https://codemagic.io/) (free tier, has a
     Capacitor/Ionic template) or a **GitHub Actions `macos-latest` runner**. Best if
     you'll ship updates regularly and want reproducible builds.
   - **Buy/borrow a Mac** (even an old Intel Mac Mini or M-series that runs a current
     Xcode). Simplest long-term.
2. **Apple Developer Program — $99/year.** Required to submit to the App Store. A
   **free** game pays only this (Apple takes 0% of nothing). Enroll at
   [developer.apple.com/programs](https://developer.apple.com/programs/). Enrollment can
   take 24–48h (identity verification), so **start this first** while you set up the rest
   on Windows.

Everything in **Phase 1** can be done now, on Windows, with no Mac and no paid account.

---

## Phase 0 — Decisions to lock

| Decision | Recommendation | Notes |
|---|---|---|
| App name | "Chess Dungeon" | Check availability in App Store Connect; must be globally unique. |
| Bundle ID | `com.<you>.chessdungeon` | Reverse-DNS, permanent once shipped. Pick a real domain-ish prefix. |
| Price | Free | Simplest review, no tax/banking setup, no IAP. |
| Data collection | None | Lets you answer the privacy questionnaire "Data Not Collected". |
| Devices | iPhone only (Phase 1) | iPad support = more screenshot sizes + layout QA. Add later. |
| Orientation | Both (already supported) | The landscape/portrait HUD work is done. |
| Min iOS | iOS 15+ | Capacitor 6 targets iOS 14+; 15 is a safe floor in 2026. |

---

## Phase 1 — Do this now on Windows (no Mac needed)

Goal: scaffold Capacitor, get the iOS project generated and committed, so the Mac
session is *only* "open, sign, archive, upload".

### 1.1 Prepare a Node toolchain
Capacitor's CLI is Node-based and runs fine on Windows.

```bash
# from the repo root
npm install --save-dev @capacitor/cli
npm install @capacitor/core @capacitor/ios
```

> This repo currently has no dependencies and a static bundle — that's ideal. Capacitor
> just needs a **web directory** to copy. Our web root is the repo root (index.html +
> src/ + assets). We'll point Capacitor at a clean copy of the shippable files.

### 1.2 Define the web assets to bundle
Capacitor copies a single `webDir` into the app. Reuse the **itch bundle file list**
(see the `itch-zip-build` note) as the source of truth for "what ships":
index.html, styles.css, manifest.webmanifest, sw.js, the 4 icons, and `src/*.js` +
audio/asset files. Create `scripts/build-webdir.mjs` that copies exactly those into a
`www/` folder (git-ignored), so `webDir: 'www'` always has a clean, complete tree.

- **Use forward slashes** when copying (same rule that bit the itch zip on Linux).
- `www/` is a build artifact — add it to `.gitignore`.

### 1.3 Init Capacitor + add iOS
```bash
npx cap init "Chess Dungeon" com.<you>.chessdungeon --web-dir=www
node scripts/build-webdir.mjs        # populate www/
npx cap add ios                      # generates the ios/ Xcode project
npx cap sync ios
```

Commit the generated `ios/` folder and `capacitor.config.json`. From here, the Mac only
opens what's already in git.

### 1.4 Service worker under the native shell
Inside the WKWebView the app loads over the `capacitor://localhost` scheme, and
`index.html` already guards SW registration to `http(s)` only:

```js
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) { ... }
```

So the SW **won't register** in the native app — which is correct: the native shell
bundles all assets and is already fully offline. **No change needed.** (Leave the SW as
is; it still powers the web/itch/PWA build.) Just verify offline works in the simulator
once (airplane mode → app still runs).

### 1.5 Native config (`capacitor.config.json`)
```jsonc
{
  "appId": "com.<you>.chessdungeon",
  "appName": "Chess Dungeon",
  "webDir": "www",
  "backgroundColor": "0b0b12",         // matches theme-color
  "ios": { "contentInset": "always" }, // respects the notch; we also pad with safe-area
  "server": { "iosScheme": "capacitor" }
}
```

### 1.6 Icons & launch screen (generate on Windows)
- **App icon**: iOS needs a 1024×1024 master (no alpha, no rounded corners — Apple masks
  it). Extend `scratchpad/makeicons.mjs` (the self-contained PNG encoder already used for
  the PWA icons) to emit `icon-1024.png`. On the Mac, drop it into
  `ios/App/App/Assets.xcassets/AppIcon.appiconset` (or use a generator like
  `@capacitor/assets` which slices all sizes from one source).
- **Launch/splash screen**: use `@capacitor/splash-screen` or set a simple centered-king
  storyboard. Background `#0b0b12` so it matches the first frame — no white flash.

### 1.7 Native polish layer (avoids App Store rejection 4.2 "minimum functionality")
A pure web wrapper *can* be rejected as "just a website." A rich, offline **game** is
normally fine, but add cheap native touches so it reads as a real app:
- `@capacitor/status-bar` — dark style, hide in-game for immersion.
- `@capacitor/haptics` — a tap on strike/level-up/death. Small, high-value on iOS.
- `@capacitor/splash-screen` — programmatic hide after boot.
- Keep audio — the iOS `AudioContext` `'interrupted'`/background revival is **already
  handled** in audio.js; verify it still works inside WKWebView (the same web code runs).

Guard all of these behind a `window.Capacitor` check so the web build is untouched.

---

## Phase 2 — On the Mac (cloud or physical)

Everything below is done in one Mac session once Phase 1 is committed.

### 2.1 Environment
- Install **Xcode** (latest stable) + Command Line Tools, and **CocoaPods**
  (`sudo gem install cocoapods`).
- Clone the repo, `npm install`, `node scripts/build-webdir.mjs`, `npx cap sync ios`.
- `npx cap open ios` → Xcode opens `ios/App/App.xcworkspace`.

### 2.2 Signing
- In Xcode → target **App** → **Signing & Capabilities** → sign in with your Apple ID,
  select your **Team**, enable **Automatically manage signing**.
- Set the **Bundle Identifier** to `com.<you>.chessdungeon` (must match App Store Connect).
- Set **Version** (1.0.0) and **Build** (1).

### 2.3 Test on a real device / simulator
- Run in the iOS Simulator first (fastest). Then on a real iPhone if you have one plugged
  into the Mac — sideload via Xcode for on-device feel.
- QA checklist: touch nav (tap/propose-path/confirm), pinch-zoom on board only (page
  doesn't zoom), landscape + portrait HUD corners, notch safe-area, audio resumes after
  backgrounding, offline (airplane mode), no console errors.

### 2.4 Archive & upload
- Xcode → **Product → Archive** (requires a "Any iOS Device" target, not simulator).
- Organizer → **Distribute App → App Store Connect → Upload**.
- The build appears in App Store Connect after processing (~5–30 min).

---

## Phase 3 — App Store Connect (web, any OS)

Do the metadata setup at [appstoreconnect.apple.com](https://appstoreconnect.apple.com/)
in parallel — most of it needs no Mac.

### 3.1 Create the app record
- **My Apps → +** → New App. Pick the bundle ID (registered under Certificates,
  Identifiers & Profiles), primary language, name, SKU.

### 3.2 Required metadata
- **Screenshots** (the fiddly part): required for **6.9" iPhone** (and 6.5" as fallback);
  add **13" iPad** only if you ship iPad. Capture from the Simulator (⌘S) at the exact
  required pixel sizes. 3–10 shots: title screen, mid-fight, ability aim, a boss, victory.
- **Description, keywords, subtitle, promo text.**
- **Support URL** and **Marketing URL** (a simple page — GitHub Pages/itch works).
- **App icon** (1024, filled automatically from the build's asset catalog in newer flows,
  else upload here).
- **Age rating** questionnaire → likely **9+ or 12+** (cartoon/fantasy violence).
- **App Privacy**: answer **"Data Not Collected"** (true — no analytics, no accounts, no
  network). Provide a **Privacy Policy URL** — required even for no-data apps. A one-page
  "this app collects no data, stores progress locally" page suffices.
- **Category**: Games → Strategy (or Role Playing).

### 3.3 Beta via TestFlight (recommended before public release)
- Once a build is uploaded, add it to **TestFlight**, invite yourself + a few testers.
- Internal testing needs no review; external testing needs a light Beta App Review.
- This is where you shake out on-device bugs across iPhone models before the real review.

### 3.4 Submit for review
- Attach the build, fill "Notes for Reviewer" (mention: single-player, fully offline, no
  accounts, no data collection). Submit.
- Review typically 24–72h in 2026. Common rejections to preempt:
  - **4.2 minimum functionality** → mitigated by the native polish layer (Phase 1.7).
  - **Broken links** → make sure Support/Privacy URLs are live.
  - **Crashes on their device** → TestFlight first.

---

## Cost & effort summary

| Item | Cost | When |
|---|---|---|
| Apple Developer Program | $99 / year | Before submission (start now, slow enrollment) |
| Cloud Mac (if no Mac) | ~$1/hr or ~$30/mo | Phase 2 only |
| CI (Codemagic free / GH Actions) | $0 (within limits) | Alternative to cloud Mac |
| App itself | Free to users | — |

**Critical path:** enroll in the Developer Program (slow) → Phase 1 on Windows (scaffold +
commit `ios/`) → one Mac session (sign, archive, upload) → metadata + TestFlight → submit.

---

## Repo-specific gotchas (carry-over from earlier tiers)

- **Bundle with forward-slash paths** — the itch build 404'd on backslashes; the same care
  applies to any copy step feeding `www/`. See `itch-zip-build` memory.
- **`sw.js` `CACHE_VERSION`** — irrelevant inside the native shell (SW doesn't register
  there) but still **bump it on any web asset change** for the itch/PWA build.
- **iOS audio revival** (`'interrupted'` state, dead BufferSources after backgrounding) is
  already fixed in audio.js — re-verify inside WKWebView, don't reimplement.
- **Page-zoom vs board-zoom**: the `gesturestart/change/end` preventDefault + double-tap
  guard already stop iOS page-zoom while keeping canvas pinch. A native WKWebView also lets
  you disable webview zoom, but the web fix already covers it.
- **Keep it additive**: gate every Capacitor/native call behind `window.Capacitor` so the
  web, itch, and PWA builds stay byte-identical to today.

---

## Minimal first-launch scope (if you want to move fast)

iPhone-only, portrait+landscape, free, no IAP, no iPad, no game-center/leaderboards.
Add iPad, Game Center, and haptics richness as post-1.0 updates.
