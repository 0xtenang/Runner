# RUNNER phone apps (iOS + Android)

The website (https://runearn.fun) is plain static files with no build step. The
phone apps wrap the same files with [Capacitor](https://capacitorjs.com) so GPS
keeps recording with the screen locked, like Strava.

| | Website | Phone app |
|---|---|---|
| GPS | `navigator.geolocation` (paused when the screen locks) | Native background GPS ([@capacitor-community/background-geolocation](https://github.com/capacitor-community/background-geolocation)) |
| Screen | Kept awake while recording | Can lock normally |
| Google / Apple sign-in | Privy popup/redirect | Opens Safari/Chrome, returns via `runearn.fun/redirect` → `fun.runearn.app://` |
| Offline cache | Service worker | Files are inside the app |

The switch happens in `js/geo.js` (`isNative`). Everything else is shared.

## Project layout

- `capacitor.config.json`: app ID `fun.runearn.app`, name RUNNER, web files from `www/`.
- `scripts/copy-web.mjs`: copies `index.html`, `styles.css`, `icon.svg`, `manifest.webmanifest` and `js/` into `www/` (git-ignored).
- `ios/`, `android/`: the native projects (committed).
- `redirect.html` (served at `/redirect` via `vercel.json`): hands Google/Apple sign-in back to the app.
- `.vercelignore`: keeps the native project out of the website deployment.

Privy dashboard settings the app needs (already done):
- Allowed origins: `capacitor://localhost` (iOS), `https://localhost` (Android).
- Allowed OAuth redirect URLs: `https://www.runearn.fun/redirect` (plus the website's own URLs).

## Tools on this Mac

Installed in your user folder (no admin password needed):
- Node.js: `~/.local/node` (on PATH via `~/.zprofile`).
- Java 21 for Android builds: `~/.local/jdk21`.
- Android Studio: `~/Applications/Android Studio.app`; Android SDK: `~/Library/Android/sdk`.
- Xcode: from the Mac App Store (iOS only).

## After changing the web app

```bash
npm run sync
```

This copies the web files into both apps. Then rebuild in Xcode / Android Studio.

## App Store and Google Play: risks for the earn + wallet features

Summary: running, EARN points, sneakers and mystery boxes are fine **as long as
EARN stays points with no cash value and nothing is bought with real money or
crypto**. The ETH wallet (deposit/withdraw) is the part reviewers look at hardest.

### Apple (App Store / TestFlight)
- **TestFlight internal testing** (you plus up to 100 people on your team) has no App Review. External TestFlight testers and the App Store do.
- **Crypto wallet (Guideline 3.1.5(i)):** apps that store crypto are only allowed from developers **enrolled as an organization**, not as an individual. An organization account needs a registered company and a free D-U-N-S number. If you enrol as an individual, expect the wallet to be rejected for the App Store. It's fine for internal TestFlight.
- **Earning crypto for activities (3.1.5(iii)):** apps may not give out cryptocurrency for doing tasks. Paying ETH or tokens for runs would break this. EARN as points with no cash value is OK. Never let EARN be swapped or withdrawn for crypto or money.
- **Digital items (3.1.1):** sneakers, boxes and upgrades are fine to earn with points. If you ever **sell** them for real money or ETH, that has to go through Apple's In-App Purchase.
- **Mystery boxes (3.1.1):** show the odds of each prize before the user opens one.
- **Account deletion (5.1.1(v)):** apps with sign-up must let people delete their account inside the app. RUNNER needs a "Delete account" button (Privy can delete the user).
- **Sign in with Apple (4.8):** already offered next to Google. ✓
- **Background location (2.5.4):** allowed for run tracking. The permission text says why. ✓
- **Not just a website (4.2):** background GPS is a real native feature, which helps here.

### Google Play
- **Background location / foreground service:** Play asks you to fill in a "foreground service" declaration (type: location) with a short video showing the run recording notification. The app doesn't use "Allow all the time" background location, which keeps this simpler.
- **Blockchain content and crypto:** Play allows non-custodial wallets (Privy's is). You must fill in the **Financial features** declaration. Some countries need a licence for crypto exchange or wallet services. Don't present EARN as an investment or say it has value.
- **Loot boxes:** show the odds of mystery-box prizes.
- **New personal developer accounts:** before you can publish, Play requires a **closed test with at least 12 testers for 14 days**. Sideloading the APK needs none of this.
- **Account deletion:** Play also requires in-app deletion plus a web link for deleting an account.
- **Target Android version:** new Play apps must target the latest Android (API 36). The project builds for API 35, so raise `compileSdkVersion`/`targetSdkVersion` in `android/variables.gradle` before uploading to Play. Sideloaded APKs are unaffected.
