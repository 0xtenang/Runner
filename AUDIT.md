# RUNNER — internal security review

**Date:** 23 October 2026 · **Status:** pre-deployment. Nothing has been deployed.
**Reviewer:** Claude (AI assistant), working in this repository.

> **This is an internal review, not an independent audit.** It was done by the same assistant that wrote the code, so it can share the author's blind spots. RUNNER handles real money on mainnet: the NFT sale, a tradable token with a tax, and an 800M reward pool. Before mainnet, an **independent audit by a professional firm** or a public audit contest is strongly recommended. This report, the tests and the design notes are written so an auditor can start quickly.

## Scope

| Contract | File | Creation-code keccak (solc 0.8.24, optimizer 200, EVM paris) |
|---|---|---|
| RUNNER token (ERC-20 + tax + holder rewards + run-reward claims) | `contracts/RunnerToken.sol` | `0x35522dc313137bcbaf3b594d746ad9c60b130ce3b9800af30431ba4c1cddaf62` |
| RUNNER Genesis NFT (ERC-721, ERC-2981, ERC-721C hook) | `contracts/RunnerGenesis.sol` | `0x1c55e9cf65a7def63fa7bc19d49e3b89330b967c964fdba4e63d83a13c00b446` |
| Rewards server (signs run-reward claims) | `api/rewards.js`, `api/_lib/*`, `js/rules.js` | — |

`/admin.html` refuses to deploy any build whose fingerprint differs from the table, so the reviewed code is what gets deployed.

## Method

1. Line-by-line manual review of both contracts and the server: access control, arithmetic, reentrancy, signature handling, accounting invariants, owner powers, and DEX/marketplace interactions.
2. **Slither 0.10.4** static analysis (93 detectors). The triage is below.
3. Tests run against the official compiler build in a local EVM (`tests/`):
   - `token.test.mjs`: 126 checks, including emission-schedule changes (limits, next-day start, fresh halving clock, the server's decoder), the 7-day locks and instant burns, the halving schedule (checked day by day against the JavaScript mirror for 400 days) and a **randomized model test**. It runs 600 random actions (buys, sells, transfers, claims, sweeps, burns, and time jumps) over 45 days. Every 5 steps it compares every balance, every daily eligible balance, the daily totals and the holder-reward bucket against an independent JavaScript model.
   - `nft.test.mjs`: 44 checks, including the rarity and price of all 9,999 tokens against the app, and a malicious re-entering validator.
   - `rewards-server.test.mjs`: 73 checks covering the trust score (realistic vs scripted tracks, copied routes), the 24-hour hold, the review queue (approve / void), bans, rate limits, admin-signed game settings, NFT boosts, the per-runner daily max, on-chain schedule changes, sign-in, run scoring, anti-cheat, spending, claims, halving rates and costs, the energy table, level costs, the global daily budget and partial claims. A server-signed claim was also accepted by the token contract on chain id 4663.
4. **Mutation checks.** Bugs were planted on purpose to make sure the tests catch them:

   | Planted bug | Result |
   |---|---|
   | Skip the daily share update | Caught |
   | Wrong start-of-day balance | Caught |
   | Sweep one day early | Caught |
   | Old NFT transfer ordering | Caught |
   | Let anyone force an instant (burning) claim | Caught |
   | Early release also burns finished locks | Caught |
   | Locked rewards not reserved from the pool | Caught |
   | Emission schedule without the 20M ceiling | Caught |
   | New schedule taking effect the same day | Caught |

## Findings

| # | Severity | Finding | Status |
|---|---|---|---|
| 1 | **High** | Token: a stolen owner key could drain the run-reward pool. `setSigner` plus an unlimited daily cap let the owner mint claims for any amount. | **Fixed.** Daily claims follow an emission schedule that can never exceed `MAX_DAILY_EMISSION` = 20,000,000/day (2.5% of the pool), and schedule changes only start the next UTC day. **Remaining risk:** a stolen owner key could set 20M/day from the next day plus a new signer, taking up to 20M/day until stopped. A stolen server key alone can take up to the day's emission until the owner pauses claims. Put the owner in a multisig (#4). |
| 2 | **Medium** | Token: `addPair` accepted any contract, so the owner could register a user's smart-contract wallet (e.g. a Safe) as a "pool". That wallet would be taxed on every transfer and cut out of holder rewards. | **Fixed.** `addPair` requires the contract to report RUNNER as `token0()` or `token1()`. Pools are add-only. |
| 3 | **Medium** | NFT: the ERC-721C validator was called after the ownership checks. A validator that re-enters `transferFrom` could move the token in between and corrupt the ownership records. A test reproduces this on the old code. | **Fixed.** The validator is called first, and every check reads state after it. |
| 4 | Medium (centralization) | Both contracts have one owner, the dev wallet EOA. Owner powers are listed below. If that key is lost or stolen, the NFT owner could freeze NFT transfers through a blocking validator, and the token owner could pause run claims or redirect the protocol share. | **Open: recommendation.** Make the owner a multisig (e.g. Safe 2-of-3) before launch, or at least keep the dev key on a hardware wallet. |
| 5 | Low | Token: trades through a pool before `addPair` is called are untaxed, so snipers could use the gap after liquidity is added. | **Open: operational.** Register the pool immediately after adding liquidity. The admin page has a button. |
| 6 | Low | Token: unclaimed holder rewards only move to the protocol when someone calls `sweepExpired`. They are already unclaimable after 7 days, but they sit in the contract until swept. | **Open: by design.** Anyone can sweep, and the admin page has a button. Bounded per call by `maxDays`. |
| 7 | Low | Server: the HR +10% bonus trusts heart-rate values sent by the phone. | **Open.** Small and bounded by energy. Could be disabled for real-token runs. |
| 8 | Low | Server: no rate limiting on `/api/rewards`. Spam costs function time but can't credit tokens. | **Fixed.** 120 requests/min per IP, 20 sign-ins (or admin/settings messages) per hour per IP, and 30 run uploads per hour per wallet, with Redis counters. |
| 9 | Medium (game integrity) | No server can fully stop GPS spoofing or tracks generated and uploaded straight to the API by a runner who owns a sneaker. | **Mitigated.** (a) Every run gets a trust score (`api/_lib/trust.js`): perfectly regular fix timing, constant speed, equal segment lengths, perfectly straight routes, unchanging accuracy, and routes identical to an earlier upload. (b) Earnings are usable only 24 h after a run. (c) Runs scoring under 70 are held until the admin approves or voids them (never auto-voided). (d) Admin ban list. (e) Bounded by per-wallet energy (1–10 energy/day, 30 min each), the per-sneaker overlap lock and the daily emission. **Remaining:** a careful forger can imitate GPS noise. Planned: phone-app-only earning with Play Integrity / App Attest and step-cadence checks. |
| 10 | Info | Fee-on-transfer tokens don't work in Uniswap-V3/V4-style pools, and V2 routers need the `…SupportingFeeOnTransferTokens` swap functions. Adding or removing liquidity after `addPair` is taxed 4% on the RUNNER side. | Documented. Use a V2-style pool and expect wallets and DEX UIs to need about 5% slippage. |
| 11 | Info | Holder rewards follow the chosen design: dev and team wallets are eligible, and the protocol wallet's tax income also counts once held for a full day. With 100M + 100M in those wallets, they take a large share of the 2% until tokens are distributed. | Product decision (confirmed by the owner). |
| 12 | Info | `block.timestamp` defines the UTC day. The sequencer can skew it by seconds. | Acceptable at daily granularity. |
| 13 | Info (economics) | The fast schedule front-loads emission: about 38% of the pool can be released in month 1, 66% by month 3 and 75% by month 7. After that it's 100k/day for about 5.5 more years. Heavy early selling pressure is likely. | Product decision (confirmed by the owner). The server's global daily budget and the earn-rate factor follow the same schedule, so actual emission is at most the schedule. |
| 14 | Low | The server credits runs against a daily budget, and the contract limits claims per day separately. Earnings from several days can meet on one claim day. | Handled: the server signs only what still fits in today's on-chain emission (a partial claim), and the rest can be claimed the next day. |
| 15 | Info | Run-reward payout choice. *Instant:* 80% is paid and 20% burned from the pool, and only the runner can choose it (`msg.sender == account`), so a third party submitting a signature can't burn someone's rewards. *Locked:* 100% after 7 days, and anyone may submit it. Locks are stored in unlock order; finished ones form a prefix that is paid automatically on the next claim or by `release(account)`. `releaseEarly` pays finished locks at 100% and unfinished ones at 80% (20% burned). At most 30 active locks per wallet; past that, locking reverts until some finish, but instant claims still work. | By design. Tested, including the cases above. |
| 16 | Medium (centralization) | Emission is adjustable: the owner's `setEmissionSchedule(dailyStart, halvingDays, floor)` takes effect the next UTC day with a fresh halving clock. Limits: ≤ 20M/day, floor ≤ daily amount, halving every 7–3650 days. Setting 0 stops emission from the next day. | Product decision (confirmed by the owner, who wants the ability to correct a schedule that is too fast or too slow). Covered by #1's ceiling; multisig recommended. |
| 17 | Low (centralization) | Server game settings (level-price base and curve, per-runner daily max, NFT boost collections up to +100% in total) are changed by a message signed by the dev wallet or `ADMIN_WALLETS`. A stolen admin key could, for example, add a boost for an NFT the attacker holds. | Off-chain and bounded: boosts are capped at +100%, and all crediting stays within the day's emission and the per-runner cap. Settings messages expire after 10 minutes. Keep the admin key safe; settings are visible on `/api/rewards?action=status`. |

### Slither triage

| Detector | Where | Verdict |
|---|---|---|
| `uninitialized-state` (`_checkpoints`) | token | False positive. The arrays are filled through a storage pointer (`cps.push`). |
| `incorrect-equality` (`== today`, `== day`, `emissionStartDay == 0`) | token | Intended. These compare day numbers or the "not started" sentinel, not balances. |
| `timestamp` | token | Intended. Daily bookkeeping and claim deadlines (#12). |
| `missing-zero-check` (`setSigner`, `setTransferValidator`) | both | Intended. Zero means "off". |
| `uninitialized-local` (`burnAmount` in `releaseEarly`), `uninitialized-state` (`_locks`) | token | False positives. Locals default to 0; the arrays are filled through storage pointers. |
| `cyclomatic-complexity` (`claim`) | token | Informational. `claim` is covered by the tests above. |
| `low-level-calls` (`_poolToken`, `mint`, `withdraw`) | both | Intended. Results and return length are checked; ETH forwarding reverts on failure. |
| `reentrancy-*` (`transferFrom` after validator) | NFT | Safe after fix #3: all checks run after the call, and the malicious-validator test passes. |

## How the token works (for auditors)

- **Supply:** 1,000,000,000 minted once in the constructor. 800M sits in the contract as the run-reward pool, 100M goes to the liquidity wallet (dev) and 100M to the team. There is no mint function.
- **Tax:** fixed forever (constants). 2% goes to `protocolWallet` and 2% to holders. It applies when `from` or `to` is a registered pool, except transfers from or to the contract itself. Wallet-to-wallet transfers are untaxed.
- **Holder rewards:**
  - Day = `block.timestamp / 1 days`. Each wallet keeps checkpoints `{day, minBalance, endBalance}`.
  - A wallet's weight for day *d* is its lowest balance during *d* if that is at least 300,000, otherwise zero.
  - The day's total weight is frozen at the first balance change of the day, as the running `eligibleSupply`, and decreases whenever a wallet's daily low falls.
  - Day *d*'s holder tax can be claimed on days *d+1* … *d+7*. Days with *d+7 < today* can be swept to the protocol.
  - Invariants checked by the randomized test:
    - Σ weights = day total;
    - `holderRewardsHeld` = Σ (rewards − paid out);
    - pool = contract balance − `holderRewardsHeld`;
    - Σ balances = `totalSupply`.
- **Run rewards:** the server signs an EIP-712 `Claim(account, totalEarned, deadline)`. The contract pays `totalEarned − claimed[account]`. Low-s signatures only, with the chain id and contract in the domain, and a deadline.
- **Payout choice and locks:** `claim(…, instant)` sends 80% now and burns 20% (`instant`, runner only), or locks 100% for 7 days. `rewardsRemaining = balance(this) − holderRewardsHeld − totalLocked`, so locked rewards can never be paid out twice. Burned amounts reduce `totalSupply` and are tracked in `totalBurnedInstant`.
- **Emission:** `emissionOn(day)` = max(dailyStart >> ((day − fromDay) / halvingDays), floor) under the schedule in force (a pending one applies from its `fromDay`), or 0 before `startEmission()`, which can only be called once. Launch schedule: 10M/day, halving every 30 days, floor 100k. `setEmissionSchedule` (owner) starts a new one the next day with a fresh clock, ≤ 20M/day. Claims per day ≤ `emissionOn(today)`. `js/rules.js` mirrors this exactly, and the server scales earn rates by `emissionOn / 10M`.

### Owner powers (complete list)

| Contract | Function | Effect | Limits |
|---|---|---|---|
| Token | `addPair` | Taxes trades through a pool and excludes it from holder rewards | Real RUNNER pools only, add-only |
| Token | `setProtocolWallet` | Where the 2% protocol tax and expired holder rewards go | — |
| Token | `setSigner` | The rewards server key (zero disables claims) | Daily cap |
| Token | `setClaimsPaused` | Pause run-reward claims | Doesn't affect transfers or holder rewards |
| Token | `startEmission` | Starts the emission schedule today | Once only |
| Token | `setEmissionSchedule` | New daily amount, halving period and floor, from the next UTC day | ≤ 20M/day, halving 7–3650 days, floor ≤ daily amount |
| Server | review queue and bans (admin session signed by the dev wallet) | Approve or void held runs; ban or unban wallets from earning, spending and claiming | Off-chain; can't touch tokens already claimed |
| Server | game settings (signed message) | Level-price base and curve, per-runner daily max, NFT boost collections | Boosts ≤ +100% in total; always within the day's emission |

`release(account)` and `sweepExpired` can be called by anyone; they only ever pay the rightful wallet or the protocol wallet.
| Token | `transferOwnership` | Hand over ownership | — |
| NFT | `setPaused` | Pause minting | Transfers unaffected |
| NFT | `setTreasury`, `setRoyaltyReceiver` | Where mint payments and the 5% royalty go | — |
| NFT | `setBaseURI`, `setContractURI` | Metadata links | — |
| NFT | `setTransferValidator` | Royalty enforcement (OpenSea). A malicious validator could block transfers. | See #4 |
| NFT | `withdraw` | Sweep stray ETH to the treasury | Mint payments never stay in the contract |

Nobody, including the owner, can change the tax, raise emission above 20M/day, change today's emission, mint tokens, or take tokens out of the run-reward pool or the holder-reward bucket.

## Before mainnet

1. Get an independent audit of `RunnerToken.sol` above all, since it has the most novel logic.
2. Move ownership of both contracts to a multisig, or at minimum a hardware wallet.
3. Choose a Uniswap-V2-style DEX on Robinhood Chain and confirm it supports fee-on-transfer swaps.
4. Launch sequence: deploy → add liquidity → **register the pool right away** → set up the rewards server → `setSigner` → `startEmission` on launch day.
5. Before a public launch, make real-token earning phone-app-only with device attestation (Play Integrity / App Attest) and step-cadence checks (see #9).
6. Get legal advice on a tradable token with a holder-reward mechanism in Indonesia (OJK).

## Re-running

```
cd tests && npm install
node token.test.mjs && node nft.test.mjs && node rewards-server.test.mjs ..
```
