# RUNNER — run to earn (beta)

**[Whitepaper](https://www.runearn.fun/whitepaper)** (draft for public review).

A simple GPS running app with a run-to-earn layer: own a **RUNNER Genesis** sneaker NFT, run inside its pace zone, and earn the **RUNNER** token.

**Try it:** https://runearn.fun

> Beta: sneaker NFTs are on **Robinhood Chain Testnet** (free test ETH, not real money). RUNNER is an in-app token with no cash value yet.

## Install on your phone

1. Open the link above on your phone.
2. Add it to your home screen:
   - **iPhone (Safari):** Share → *Add to Home Screen*
   - **Android (Chrome):** ⋮ menu → *Install app* / *Add to Home screen*
3. Open RUNNER from the home screen and go through the short setup.

## What to test

1. **Onboarding** — sign in (or continue as a guest) and enter your name.
2. **Record a real outdoor run** — tap Record → Start. Check the GPS line, distance and pace look right (compare with your watch if you have one).
3. **Earning** — with a sneaker NFT equipped, the bar says *Earning*, *Too fast* or *Too slow* for its pace zone. RUNNER appears when you finish.
4. **Heart rate** — You → Settings → *Heart-rate sensor* → pair a Bluetooth chest strap or a watch that broadcasts heart rate (+10% while earning).
5. **Get a sneaker** (once the NFT is live) — sign in, open Earn → *Browse sneakers*, pick one and buy it with ETH on Robinhood Chain (Common 0.005 · Uncommon 0.015 · Rare 0.04 · Epic 0.1).
6. **Earn tab** — level up, assign attribute points (Efficiency / Resilience) and repair with RUNNER.

## Known limitations

- **iPhone:** Safari pauses GPS when the screen locks — keep the screen on while running (the app asks it to stay awake).
- **Bluetooth heart-rate sensors** work in Chrome on Android / desktop, not on iPhone.
- Data lives on each device — no accounts, friends or leaderboards yet.
- Only runs recorded live with GPS in the app earn RUNNER.
- You need at least one RUNNER Genesis sneaker NFT to earn.

## Send feedback

Found a bug or have an idea? [Open an issue](https://github.com/0xtenang/Runner/issues/new) — include your phone model, browser and what happened. You can also reach it from **Settings → Send feedback** in the app.

## Run locally

It's a static web app — no build step:

```bash
python3 -m http.server 5190
```

Then open http://localhost:5190.

## RUNNER Genesis NFT contract

`contracts/RunnerGenesis.sol` — 9,999 sneaker NFTs (ERC-721) on Robinhood Chain. Open sale, no reveal: buyers pick any token id and pay its price (Common 0.005 / Uncommon 0.015 / Rare 0.04 / Epic 0.1 ETH). Rarity and price come from the token id with the same formula the app uses, so app and chain always agree.

- **Dev wallet** `0x0f397E46e4e810313dBC782CDb0236347157f1B4` is set at deployment as owner, treasury (mint payments) and royalty receiver. Whoever sends the deployment gets no control.
- **5% royalty**: ERC-2981 plus ERC-721C transfer-validator support (`setTransferValidator`), which marketplaces use to enforce creator earnings.
- **OpenSea**: `contractURI()` → `/nft/collection.json` (name, images, website, fee). OpenSea gives the contract `owner()` edit rights, so the dev wallet can sign in to OpenSea and add socials, website and banner. After a mainnet launch, turn on enforced creator earnings in OpenSea Studio → Creator earnings. The required OpenSea contracts only exist on mainnet, not on testnet.
- **Metadata**: `/nft/:id` (JSON) and `/nft/image/:id` (SVG) are served by `api/nft.js` and `api/nft-image.js` from the same trait and art code as the app. The owner can change them with `setBaseURI` and `setContractURI`.
- Build: Solidity 0.8.24, optimizer 200 runs, EVM `paris` — creation-code keccak `0xbb23f94439cb6717558d87b83cb1e9d922d54210975a2e75b2aa9405e3ca08fa`.
- Deploy (mainnet): open `/admin.html`, sign in with any wallet holding a little ETH, compile (the page checks the fingerprint) and deploy. Then set `NFT_CONTRACT` in `js/config.js`.

## RUNNER token contract

`contracts/RunnerToken.sol` — ERC-20 on Robinhood Chain mainnet, fixed supply of **1,000,000,000 RUNNER**, all created at deployment. There is no mint function, and burning is the only way the supply changes. **Not deployed yet. Read [AUDIT.md](AUDIT.md) first.**

| Share | Amount | Goes to |
|---|---|---|
| Run rewards | 800,000,000 (80%) | Locked in the contract, paid out only by `claim()` |
| Liquidity | 100,000,000 (10%) | Locked forever in the RUNNER/IMD Uniswap v4 pool by the RunnerHook |
| Team | 100,000,000 (10%) | `0x0f4FE718eb8492533E600b30F3287E2f04087332` |

- **No transfer tax; a 4% trading fee paid in IMD.** RUNNER itself is a plain ERC-20: every transfer moves exactly the amount sent. It trades against IMD in one Uniswap v4 pool owned by the RunnerHook (`contracts/RunnerHook.sol`, adapted from PepesFamily's audited `PepesEarnIMD`). The hook takes 4% of the IMD side of every swap: **2% to the protocol wallet and 2% to RUNNER holders, both in IMD**. The fee is fixed in the hook, and a swap that wouldn't fill completely (a price limit, or selling for more IMD than the pool holds) is refused rather than charged on the unfilled part. The hook adds the 100M liquidity allocation as single-sided liquidity at a starting market cap of about 635 IMD and has no way to remove it (locked forever); nobody else can add liquidity to that pool. `RunnerRouter` (IMD) and `RunnerEthRouter` (ETH, routed through the IMD/ETH pool) buy and sell in one transaction. Trades through other pools someone may create are not charged; the owner can exclude such pools from holder rewards (`excludePool`).
- **Holder rewards, in IMD.** The hook delivers the holders' IMD to the token (`syncHolderRewards` books it as that day's rewards). Each UTC day's IMD is shared by every wallet that held at least **300,000 RUNNER for that whole day**, in proportion to its lowest balance that day. It can be claimed (`claimHolderRewards`, also on the Earn tab) for **7 days**. After that, `sweepExpired` sends what's left to the protocol wallet; anyone can call it. The pool (PoolManager), the hook, other excluded pools and the contract get no share; the team wallet does. The threshold is per address: a vault or wrapper holding 300,000+ on behalf of many smaller wallets counts as one holder and could pass rewards on to them. Opening balances count for the deploy day. A pool excluded later stops counting for the days still claimable that nobody has been paid from yet; a day someone was already paid from keeps its total, so every holder of it is paid at the same rate.
- **Run-reward emission (halving).** The launch schedule is 10,000,000 RUNNER a day from launch day (`startEmission`, once), halving every 30 days (10M → 5M → 2.5M …) and never dropping below 100,000 a day. The dev wallet can set a new schedule (`setEmissionSchedule`: daily amount, halving period, floor). It starts the next UTC day and can never exceed 20,000,000 a day. With the launch schedule:

  | Period | Emission |
  |---|---|
  | Month 1 | ≈38% of the pool |
  | First 3 months | ≈66% |
  | Month 8 onward | 100k/day for about 5.5 more years |

  Runners' earn rates halve on the same dates, the server never credits more than the day's emission, and claims beyond today's emission become partial claims finished the next day.
- **Run-reward claims.** The RUNNER server signs "this account has earned X in total", and `claim()` pays X minus what was already claimed. The runner chooses: **lock 7 days and get 100%**, or **take it now: 80% to the wallet, 20% burned**. Locked rewards can be released after 7 days (anyone may trigger it; it always pays the runner), or taken early at 80%. The server signs the payout choice too, so nobody else can switch a runner's claim into a lock. The owner can rotate the server key, pause claims and change the emission schedule from the next UTC day (never above 20M/day). It can never change the fee or take IMD from the holder rewards. Because the owner picks the server key, a stolen owner key could claim up to the daily emission for itself, so the owner should be a multisig. Ownership moves in two steps: `transferOwnership` proposes, and the new owner must call `acceptOwnership`; `transferOwnership(address(0))` cancels a pending proposal (same for the NFT and the hook).
- Build: Solidity 0.8.24, optimizer 200 runs, EVM `paris` — creation-code keccak `0x5a4b422b7a37b9e422a1ca914a41bfbd31f48f7b5d52ddc833a0a9ef6f6796e5`.
- Contracts and tests: `contracts/RunnerHook.sol`, `RunnerRouter.sol`, `RunnerEthRouter.sol` build with Foundry (`scripts/setup-contracts.sh` fetches the pinned Uniswap v4 libraries, then `forge test`; `FORK_RPC=https://robinhood.drpc.org forge test` also runs them against the live chain). The token is also tested in `tests/token.test.mjs`.
- Deploy, in order (`/admin.html`): **1 · Pool hook** (checks `contracts/build/RunnerHook.json` against its fingerprint, then deploys through the CREATE2 deployer at an address carrying the hook flags) → set `HOOK_CONTRACT` → **2 · RUNNER token** → set `TOKEN_CONTRACT` → **Open the pool** (step 5, dev wallet).

## Rewards server (claims)

`api/rewards.js` (Vercel function) is the source of truth for anything worth real RUNNER. The app uploads every finished run's GPS track. The server re-scores it with the same rules the app uses (`js/rules.js`) and checks the following before crediting it:

- the wallet owns the sneaker on-chain;
- energy is available (1 energy = 30 minutes of earning; 1–2 sneakers give 1 energy, 3–8 give 2, 9–14 give 4, 15–29 give 6, 30+ give 10, refilling over 24 h);
- the run doesn't overlap an earlier one, for this wallet or for this sneaker;
- it's under 72 hours old;
- its speeds are possible on foot.

Level-ups and repairs are paid from the server balance. Levels run 0–30. By default a level-up costs 1,100 × (next level)^1.5 RUNNER (about a month to level 30 for a Common) and gives 1 point (Common, Uncommon) or 2 points (Rare, Epic). Level-up and repair costs follow emission.

**Game settings** (dev wallet, `/admin.html?c=token` → *Controls after launch*, applied immediately): the level-price base and curve, an optional per-runner daily max, and **NFT boosts**. Any future NFT collection can be listed with a boost %, e.g. Season 2 holders earn +10%, up to +100% in total. **Claim** asks the server to sign, then the wallet sends `claim()` to the token, paying a tiny ETH gas fee.

Setup, once both contracts are deployed:

1. `/admin.html?c=token` → *Claim server* → **Generate key** (in your browser). Add it in Vercel → Settings → Environment Variables as `SIGNER_PRIVATE_KEY`.
2. Vercel → Storage → connect **Upstash for Redis** to the project, which adds the `KV_REST_API_URL` and `KV_REST_API_TOKEN` variables. Redeploy.
3. Back on the admin page, the dev wallet presses **Set server address on the token** (or calls `setSigner` on Blockscout).
4. On launch day, the dev wallet presses **Start emission**. The halving clock starts then.

Until all three are done, the app keeps working in local mode.

**Fair play.**
- **Trust score:** every run gets a 0–100 score (`api/_lib/trust.js`). Scripted or spoofed tracks tend to be too clean: perfectly regular timing, constant speed, straight lines, unchanging GPS accuracy, or a copy of someone else's route.
- **24-hour hold:** earnings become usable 24 hours after a run.
- **Automatic rules (no human review):**

  | Trust score | Outcome |
  |---|---|
  | 70+ | Paid in full |
  | 40–69 | Paid 50% (no penalty) |
  | Under 40, a fake-GPS app, or a copied route | Not paid + 1 strike |

  3 strikes in 30 days suspend the wallet automatically: 7 days, then 30 days, then permanently. A suspension also forfeits earnings still on hold. Strikes expire after 30 days. All thresholds are game settings on the admin page, which also shows a log of every automatic decision and keeps an optional manual ban.
- **Bans:** banned wallets can't earn, spend or claim.
- **Rate limits:** requests are capped per IP and per wallet.
- **Step cadence (phone app):** the app records the phone's step counter during a run. Running is about 140–190 steps a minute; on a bike, scooter or in a car the counter barely moves. Steps that don't match the GPS pace lower the trust score, so the run goes to review.
- **Fake GPS:** the app ignores mock-location positions and the server lowers the score of runs where it saw any.
- **Phone app only (device attestation):** every upload from the app carries a Google Play Integrity token (Android) or an Apple App Attest proof (iPhone), tied to that exact run. With **Phone app only** switched on in the admin page (setting `requireAttestation`), only runs from the genuine app on an unmodified phone earn real RUNNER. Website runs still track and count for stats, but earn nothing. Switch it on at launch, after the setup below.
- **Limits:** attestation proves the app and phone are real, not who carries the phone. Per-wallet energy, the daily emission and the strike rules bound the damage.

Tests (`tests/`, see [AUDIT.md](AUDIT.md)): `node rewards-server.test.mjs ..` covers sessions, scoring, anti-cheat, spending, claims, halving rates, halving costs, the energy table, level costs, game settings, NFT boosts, the per-runner cap, schedule changes, the daily budget, partial claims, the trust score, the 24-hour hold, the automatic fair-play rules (strikes and suspensions), manual bans, rate limits, step cadence, mock locations and device attestation (108 checks). Google's verdicts are faked in the tests; App Attest runs with real signatures and a test certificate chain. A server-signed claim was also verified against `RunnerToken` in a local EVM.

### Device attestation setup (Google + Apple)

You do these steps yourself: they need your Google and Apple accounts, and the keys must never be pasted into a chat. The step counter needs no setup.

**Android: Google Play Integrity**
1. Create a Google Play developer account (play.google.com/console, $25 once) and an app named RUNNER with package name `fun.runearn.app`.
2. Play Console → your app → **Test and release → App integrity → Play Integrity API → Link a Cloud project**. Choose **Create a new project**. Write down the **project number** (digits).
3. console.cloud.google.com → that project → **APIs & Services → Library** → check **Google Play Integrity API** is enabled.
4. **IAM & Admin → Service accounts → Create service account** (name: `runner-integrity`). No role is needed. Open it → **Keys → Add key → Create new key → JSON**. A file downloads.
5. Vercel → RUNNER project → Settings → Environment Variables: add `PLAY_INTEGRITY_SA` (Production) and paste the **whole contents** of that JSON file. Redeploy. Then delete the file from your Downloads.
6. Put the project number from step 2 in `js/config.js` → `PLAY_CLOUD_PROJECT_NUMBER` (it isn't secret, so Claude can do this for you), then rebuild the app.
7. Upload a release build to Play (**Internal testing** is enough) and install RUNNER from the Play Store. Sideloaded APKs and emulators fail the check on purpose.

**iPhone: Apple App Attest**
1. Use the Apple Developer account from NATIVE.md (needed for TestFlight anyway).
2. developer.apple.com → **Account → Membership details** → copy the **Team ID** (10 characters).
3. Xcode → **App** target → **Signing & Capabilities → + Capability → App Attest**. In the new `App.entitlements`, set **App Attest Environment** to `production`.
4. Vercel → Environment Variables: add `APPLE_TEAM_ID` = your Team ID. Redeploy.
5. Ship through TestFlight. App Attest doesn't work in the iOS Simulator.

**Switch it on (launch day):** open `/admin.html?c=token` → *Controls after launch*. The line under **Phone app only** should show ✓ for Android and iPhone. Tick **Phone app only** and press **Save game settings**.

