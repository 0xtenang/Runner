# RUNNER — run to earn (beta)

A simple, Strava-style running app with a run-to-earn layer: own a **RUNNER Genesis** sneaker NFT, run inside its pace zone, and earn the **RUNNER** token.

**Try it:** https://runearn.fun

> Beta: sneaker NFTs are on **Robinhood Chain Testnet** (free test ETH, not real money). RUNNER is an in-app token with no cash value yet.

## Install on your phone

1. Open the link above on your phone.
2. Add it to your home screen:
   - **iPhone (Safari):** Share → *Add to Home Screen*
   - **Android (Chrome):** ⋮ menu → *Install app* / *Add to Home screen*
3. Open RUNNER from the home screen and go through the short setup.

## What to test

1. **Onboarding** — pick a starter sneaker and enter your name.
2. **Record a real outdoor run** — tap Record → Start. Check the GPS line, distance and pace look right (compare with your watch if you have one).
3. **Earning** — with a sneaker NFT equipped, the bar says *Earning*, *Too fast* or *Too slow* for its pace zone. RUNNER appears when you finish.
4. **Import from your watch** — You → Devices → choose files:
   - **Garmin:** Garmin Connect (web) → open a run → ⚙ → *Export Original* (.zip)
   - **COROS / Suunto:** export the run as .fit
   - **Polar:** Polar Flow → *Export session* (.tcx / .gpx)
   - **Apple Watch:** export with HealthFit or RunGap (.fit / .gpx)
5. **Get a sneaker** — sign in, open Earn → *Browse sneakers*, pick one and buy it with test ETH (Common 0.005 · Uncommon 0.015 · Rare 0.04 · Epic 0.1).
6. **Earn tab** — level up, assign attribute points (Efficiency / Resilience) and repair with RUNNER.

## Known limitations

- **iPhone:** Safari pauses GPS when the screen locks — keep the screen on while running (the app asks it to stay awake).
- **Bluetooth heart-rate sensors** work in Chrome on Android / desktop, not on iPhone.
- Data lives on each device — no accounts, friends or leaderboards yet.
- Only runs recorded live with GPS earn RUNNER; imported runs count for stats and streaks.
- You need at least one RUNNER Genesis sneaker NFT to earn.

## Send feedback

Found a bug or have an idea? [Open an issue](https://github.com/0xtenang/Runner/issues/new) — include your phone model, browser and what happened. You can also reach it from **Settings → Send feedback** in the app.

## Run locally

It's a static web app — no build step:

```bash
python3 -m http.server 5190
```

Then open http://localhost:5190. `samples/` contains example FIT / GPX / TCX / ZIP files for testing imports.

## RUNNER Genesis NFT contract

`contracts/RunnerGenesis.sol` — 9,999 sneaker NFTs (ERC-721) on Robinhood Chain. Open sale, no reveal: buyers pick any token id and pay its price (Common 0.005 / Uncommon 0.015 / Rare 0.04 / Epic 0.1 ETH). Rarity and price come from the token id with the same formula the app uses, so app and chain always agree.

- **Dev wallet** `0x0f397E46e4e810313dBC782CDb0236347157f1B4` is set at deployment as owner, treasury (mint payments) and royalty receiver. Whoever sends the deployment gets no control.
- **5% royalty**: ERC-2981 plus ERC-721C transfer-validator support (`setTransferValidator`), which marketplaces use to enforce creator earnings.
- **OpenSea**: `contractURI()` → `/nft/collection.json` (name, images, website, fee). OpenSea gives the contract `owner()` edit rights, so the dev wallet can sign in to OpenSea and add socials, website and banner. After a mainnet launch, turn on enforced creator earnings in OpenSea Studio → Creator earnings. The required OpenSea contracts only exist on mainnet, not on testnet.
- **Metadata**: `/nft/:id` (JSON) and `/nft/image/:id` (SVG) are served by `api/nft.js` and `api/nft-image.js` from the same trait and art code as the app. The owner can change them with `setBaseURI` and `setContractURI`.
- Build: Solidity 0.8.24, optimizer 200 runs, EVM `paris` — creation-code keccak `0x1c55e9cf65a7def63fa7bc19d49e3b89330b967c964fdba4e63d83a13c00b446`.
- Deploy (mainnet): open `/admin.html`, sign in with any wallet holding a little ETH, compile (the page checks the fingerprint) and deploy. Then set `NFT_CONTRACT` in `js/config.js`.

## RUNNER token contract

`contracts/RunnerToken.sol` — ERC-20 on Robinhood Chain mainnet, fixed supply of **1,000,000,000 RUNNER**, all created at deployment. There is no mint function, and burning is the only way the supply changes. **Not deployed yet. Read [AUDIT.md](AUDIT.md) first.**

| Share | Amount | Goes to |
|---|---|---|
| Run rewards | 800,000,000 (80%) | Locked in the contract, paid out only by `claim()` |
| Liquidity | 100,000,000 (10%) | Dev wallet `0x0f397E46e4e810313dBC782CDb0236347157f1B4` |
| Team | 100,000,000 (10%) | `0x0f4FE718eb8492533E600b30F3287E2f04087332` |

- **4% trading tax, fixed forever.** It applies to buys and sells through registered exchange pools: 2% goes to the protocol wallet and 2% to holders. Wallet-to-wallet transfers and run-reward claims are untaxed. Pools are registered with `addPair` after liquidity is added; only real RUNNER pools are accepted, and they can't be removed.
- **Holder rewards.** Each UTC day's 2% is shared by every wallet that held at least **300,000 RUNNER for that whole day**, in proportion to its lowest balance that day. It can be claimed (`claimHolderRewards`, also on the Earn tab) for **7 days**. After that, `sweepExpired` sends what's left to the protocol wallet; anyone can call it. Exchange pools and the contract get no share; dev and team wallets do.
- **Run-reward claims.** The RUNNER server signs "this account has earned X in total", and `claim()` pays X minus what was already claimed. A daily cap applies: 1,000,000 by default, and it can never go above 2,000,000. The owner can rotate the server key or pause claims, but can **never** take tokens from the reward pool or the holder rewards.
- Build: Solidity 0.8.24, optimizer 200 runs, EVM `paris` — creation-code keccak `0x56b86374daef492b5034060bd22303acd9474669b2686c54cf5166a38f3c973a`.
- Deploy: `/admin.html?c=token` → compile → deploy. Then set `TOKEN_CONTRACT` in `js/config.js`, add liquidity, and register the pool immediately (admin page, step 5).

## Rewards server (claims)

`api/rewards.js` (Vercel function) is the source of truth for anything worth real RUNNER. The app uploads every finished run's GPS track. The server re-scores it with the same rules the app uses (`js/rules.js`) and checks the following before crediting it:

- the wallet owns the sneaker on-chain;
- energy is available;
- the run doesn't overlap an earlier one, for this wallet or for this sneaker;
- it's under 72 hours old;
- its speeds are possible on foot.

Level-ups and repairs are paid from the server balance. **Claim** asks the server to sign, then the wallet sends `claim()` to the token, paying a tiny ETH gas fee.

Setup, once both contracts are deployed:

1. `/admin.html?c=token` → *Claim server* → **Generate key** (in your browser). Add it in Vercel → Settings → Environment Variables as `SIGNER_PRIVATE_KEY`.
2. Vercel → Storage → connect **Upstash for Redis** to the project, which adds the `KV_REST_API_URL` and `KV_REST_API_TOKEN` variables. Redeploy.
3. Back on the admin page, the dev wallet presses **Set server address on the token** (or calls `setSigner` on Blockscout).

Until all three are done, the app keeps working in local mode. What the server can't fully stop is GPS-spoofing apps on a phone. Per-wallet energy limits each sneaker to a few minutes of earning a day, and the token's daily claim cap bounds the total.

Tests (`tests/`, see [AUDIT.md](AUDIT.md)): `node rewards-server.test.mjs ..` covers sessions, scoring, anti-cheat, spending and claims (27 checks). A server-signed claim was also verified against `RunnerToken` in a local EVM.
