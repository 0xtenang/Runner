# RUNNER on the Apple App Store

The iPhone app is the same web app inside a native shell (Capacitor, `ios/`), with background GPS,
step counting and App Attest. It builds for iPhone (checked: release build, iOS 15+, version 1.0.1).
What's left needs your Apple account, which only you can do.

## 1. Apple Developer account (organization)

Apple only allows crypto wallets from developers enrolled as an **organization** (guideline 3.1.5(i)).

1. Get a free **D-U-N-S number** for your company: [developer.apple.com/enroll/duns-lookup](https://developer.apple.com/enroll/duns-lookup/). It can take up to two weeks.
2. Enroll at [developer.apple.com/programs/enroll](https://developer.apple.com/programs/enroll/) as an **Organization** ($99/year), with the company's legal name and the D-U-N-S number.

## 2. Server settings for in-app account deletion (Vercel)

Apple requires in-app account deletion (5.1.1(v)). The app has it (You → Settings → Delete account);
the server needs two Privy values. In the [Privy dashboard](https://dashboard.privy.io) → your app → Settings:

- **Verification key** (public) → Vercel → Settings → Environment Variables → `PRIVY_VERIFICATION_KEY`
- **App secret** (private — never paste it anywhere else) → `PRIVY_APP_SECRET`

Then redeploy. Until then, Delete account tells the user it isn't set up yet.

## 3. A test account for Apple's reviewer

Reviewers can't receive your email codes. In Privy → **User management → Test accounts**, turn on a test
email with a fixed code, and put it in the review notes (section 7).

## 4. Build and upload

1. Xcode → **Settings → Accounts → +** → sign in with the Apple ID of the developer account.
2. In this repo: `npm run ios` (copies the web app into the iPhone project and opens Xcode).
3. In Xcode: the **App** target → **Signing & Capabilities** → choose your Team (Xcode creates the certificate). Keep bundle ID `fun.runearn.app`.
4. At [appstoreconnect.apple.com](https://appstoreconnect.apple.com): **Apps → + → New App** → iOS, name **RUNNER**, bundle ID `fun.runearn.app`, SKU `runner-ios`.
5. In Xcode: device **Any iOS Device (arm64)** → **Product → Archive** → **Distribute App → App Store Connect → Upload**.
6. After ~15 minutes the build shows in App Store Connect → TestFlight. Try it yourself first (Internal Testing), then submit for review.

For each update: raise **Version** (and **Build**) in Xcode → General, then archive and upload again.

## 5. Store listing (copy-paste)

- **Name:** RUNNER — Run to Earn
- **Subtitle (30):** GPS runs, sneakers, rewards
- **Category:** Health & Fitness (secondary: Sports)
- **Privacy policy URL:** https://www.runearn.fun/privacy
- **Support URL:** https://www.runearn.fun/support
- **Marketing URL:** https://www.runearn.fun
- **Keywords (100):** running,run tracker,gps,pace,jogging,fitness,move to earn,sneakers,nft,rewards,crypto
- **Promotional text:** Track every run with live GPS, pace and splits — and earn RUNNER with your Genesis sneakers.
- **Description:**

  > RUNNER is a GPS running app with a run-to-earn layer.
  >
  > TRACK EVERY RUN
  > Live map, distance, pace, splits and elevation. Recording keeps going with the screen locked. Free, no account needed.
  >
  > EARN WITH YOUR SNEAKERS
  > Own a RUNNER Genesis sneaker NFT and earn RUNNER while you run inside its pace zone — Recovery, Daily, Tempo or Hybrid. Energy refills every day; level up your sneakers and keep them repaired.
  >
  > FAIR BY DESIGN
  > Every run is checked: GPS quality, step count and device checks keep rewards for real runners.
  >
  > YOUR OWN WALLET
  > Sign in with email or Apple and a Robinhood Chain wallet is created for you — no seed phrase. Claim your RUNNER to it, and holders share trading rewards in IMD.
  >
  > Crypto assets are volatile and may lose value. RUNNER is not financial advice.

- **Age rating:** answer the questionnaire honestly. For crypto/financial features, Apple usually sets 17+ — accept it.

## 6. App Privacy answers ("nutrition label")

Data **linked to the user**, used for **App Functionality** (no tracking, no ads):

| Data type | Why |
|---|---|
| Precise location | GPS track of runs that earn, checked on the server |
| Email address | Sign-in (Privy), only if the user signs in with email |
| User ID | Wallet address and Privy user ID |
| Fitness | Step count during runs that earn |
| Other diagnostic data | Device integrity check (App Attest) |

"Do you or your partners use data for tracking?" → **No**.

## 7. Review notes (copy-paste, then fill in the test account)

> RUNNER is a GPS running tracker. Tracking works without an account ("Continue as guest").
> Signing in creates a non-custodial wallet (Privy) on Robinhood Chain. With a RUNNER Genesis sneaker
> NFT, verified outdoor runs earn the RUNNER token; every run is checked on our server (GPS quality,
> steps, App Attest) before anything is credited.
> We are enrolled as an organization (guideline 3.1.5(i)). Background location is used only while a
> run is being recorded, so distance stays accurate with the screen locked. Account deletion: You →
> Settings → Delete account.
> Test account (email sign-in): <test email> / code <test code>.

## Risks to expect in review

- **3.1.1 (digital goods):** the iPhone app sells sneaker NFTs for ETH, outside In-App Purchase. Apple may reject this; the fix would be to hide buying in the iPhone app (a small change — the code paths are known).
- **3.1.5(iii) (crypto for tasks):** Apple may ask why runs earn crypto. Answer: earning comes from verified physical activity with an NFT the user owns, like other move-to-earn apps on the store.
- If rejected, reply in App Store Connect's Resolution Center; small changes can be resubmitted the same day.
