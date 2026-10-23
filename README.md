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
- Build: Solidity 0.8.24, optimizer 200 runs, EVM `paris` — creation-code keccak `0xe399c46155224fdfa7b6df6c0b53b2e7e1e17068171417f57b2187b72a31dc18`.
- Deploy: open `/admin.html`, sign in with any wallet that has test ETH, compile (the page checks the fingerprint) and deploy. Then set `NFT_CONTRACT` in `js/config.js`.

## RUNNER token contract

`contracts/RunnerToken.sol` — ERC-20 on Robinhood Chain mainnet, fixed supply of **1,000,000,000 RUNNER**, all created at deployment. There is no mint function, and burning is the only way the supply changes.

| Share | Amount | Goes to |
|---|---|---|
| Run rewards | 800,000,000 (80%) | Locked in the contract, paid out only by `claim()` |
| Liquidity | 100,000,000 (10%) | Dev wallet `0x0f397E46e4e810313dBC782CDb0236347157f1B4` |
| Team | 100,000,000 (10%) | `0x0f4FE718eb8492533E600b30F3287E2f04087332` |

- **Claims**: the RUNNER server checks a runner's runs and signs an EIP-712 message saying "this account has earned X in total". `claim()` pays X minus what was already claimed. Anyone can submit it, but the tokens always go to the runner. Signatures expire, can't be replayed and can't be reused for another account.
- **Safety**: a daily cap on total claims (1,000,000 RUNNER by default) limits the damage if the server key leaks. The dev wallet (owner) can rotate the server key (`setSigner`), pause claims and change the cap. The owner can **never** take tokens out of the reward pool.
- Claims stay off until the dev wallet sets the server's signing address.
- Build: Solidity 0.8.24, optimizer 200 runs, EVM `paris` — creation-code keccak `0x02f9af3bd2c5da6178afe5912a49543b78a4f962274f1a0297e45a59ae64cbab`.
- Deploy: `/admin.html?c=token`, sign in with any wallet holding a little mainnet ETH, compile, deploy. Then set `TOKEN_CONTRACT` in `js/config.js`.
