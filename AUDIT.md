# RUNNER — internal security review

**Date:** 23 October 2026, updated 24 October 2026 after the IMD audit · **Status:** pre-deployment. Nothing has been deployed.
**Reviewer:** Claude (AI assistant), working in this repository.

> **This is an internal review, not an independent audit.** It was done by the same assistant that wrote the code, so it can share the author's blind spots. RUNNER handles real money on mainnet: the NFT sale, a tradable token with a tax, and an 800M reward pool. Before mainnet, an **independent audit by a professional firm** or a public audit contest is strongly recommended. This report, the tests and the design notes are written so an auditor can start quickly.

## Design change after the IMD audit — RUNNER/IMD on Uniswap v4 (24 October 2026)

After the IMD audit (commit `938a178`), RUNNER moved to the same market design as PepesFamily (`0xtenang/PepesFamily`, audited separately): RUNNER is paired with **IMD** (`0x5F7Bb59365ce557C26dbcAa4EE9d39A4b95B7127`) in a **Uniswap v4** pool on Robinhood Chain, and **all trading-fee rewards are paid in IMD**. A re-audit should cover this change.

| What | Before (audited at `938a178`) | Now |
|---|---|---|
| Trading fee | 4% transfer tax inside `RunnerToken` on registered V2-style pairs, paid in RUNNER | **No transfer tax in the token.** `RunnerHook` (a Uniswap v4 hook, adapted from PepesFamily's audited `PepesEarnIMD`) takes 4% of the IMD side of every swap: 2% to the protocol (`feeRecipient`), 2% to holders — **all in IMD** |
| Holder rewards | RUNNER, from the tax | **IMD**, delivered by the hook and booked by `syncHolderRewards()`; same rules (300k held all day, lowest balance, 7-day window, sweep to the protocol wallet) |
| Liquidity | 100M to the dev wallet, added by hand | 100M minted to the hook, added single-sided by `openPool` at ~642 IMD market cap, **locked forever** (the hook can't remove it; nobody else can add liquidity to the pool) |
| Pools | `addPair` (tax + exclusion) | `excludePool` (exclusion only, same `token0`/`token1` check, keeps the finding-2 fix); the v4 PoolManager and the hook are excluded at deployment |
| Trading | any V2 router | `RunnerRouter` (IMD) and `RunnerEthRouter` (ETH via the IMD/ETH v4 pool), both from PepesFamily; any v4 router also works and pays the fee |

Unchanged: the run-reward pool, signed claims (with the payout choice signed), locks, instant burn, emission schedule, two-step ownership and the NFT contract. Holder accounting is unchanged except that rewards are counted in IMD (`holderRewardsHeld` is IMD; `rewardsRemaining` no longer subtracts it).

**Where to look hardest:** the hook's fee maths for the four swap directions (exact-in/out × buy/sell) and the claim mint/burn settlement; `openPool`'s wiring checks; `syncHolderRewards` (balance-difference booking, any IMD sent to the token becomes that day's holder rewards); flushing mid-unlock (only our routers may); that RUNNER being a plain ERC-20 makes it safe in the PoolManager (no callbacks, no fee-on-transfer); excluding the PoolManager/hook from holder rewards.

**Known and accepted:** trades through any other RUNNER pool someone creates pay no fee (the owner can exclude such a pool from holder rewards); fees from non-RunnerRouter swaps wait in the hook until someone calls `flush` (anyone can), and are booked on that day; the 300k threshold is per address (IMD #4).

## Sixth IMD audit (25 October 2026)

IMD audited commit `556c920` — [report](https://explorer.imd.fun/jobs/b58971f0-f89e-49cb-9d55-16b30b3f1237). Result: **2 low, 2 informational, no medium or higher.**

| # | Severity | Finding | Status |
|---|---|---|---|
| 1 | Low | The hook's constructor accepted the PoolManager or the hook itself as `feeRecipient` (which `setFeeRecipient` refuses); protocol IMD collected before a fix would be lost. The token's constructor had the same gap for the owner, who is also the first protocol wallet. | **Fixed:** the hook constructor refuses both (`ZeroAddress`, as the setter); the token constructor refuses the token itself, the PoolManager and the hook as owner (`BadAddress`, as `setProtocolWallet`). Tests: deploying the hook with the PoolManager or its own address as fee recipient reverts; deploying the token with the PoolManager or hook as owner reverts. |
| 2 | Low | `claimable()` promised "what claim() would pay" but ignored the 20% instant burn and the 30-lock limit. | **Fixed:** `claimable(account, totalEarned, instant)` returns 80% for an instant claim and 0 for a locked claim that would exceed `MAX_ACTIVE_LOCKS` (counting only unfinished locks, since `claim()` releases finished ones first). The app computes its figure server-side, so nothing else changes. Tests: at the lock limit the locked view is 0 and the instant view equals what the claim pays; after locks finish the view is the full amount again. |
| 3 | Info | A 1-wei fee goes entirely to holders (the protocol half rounds down). | **Documented, by design:** the protocol half of the fee rounds down, so the odd wei of any fee goes to holders; at most 1 wei per swap, and the total is always exact. |
| 4 | Info | `buyWithEth` refunded the router's whole ETH balance, not only the buyer's unspent ETH. | **Fixed:** the callback returns the ETH the IMD/ETH pool took, and only `msg.value - ethIn` is refunded. Test: with 1 stray wei in the router, a 1 ETH buy costs exactly 1 ETH and the stray wei stays. |

## Fifth IMD audit (25 October 2026)

IMD audited commit `3ffb33f` — [report](https://explorer.imd.fun/jobs/ed4b93f2-c26d-4072-8f64-d2da5c0978aa). Result: **2 low, 8 informational, no medium or higher.**

| # | Severity | Finding | Status |
|---|---|---|---|
| 1 | Low | Donations to the RUNNER/IMD pool were accepted: `beforeDonate` reverted, but its flag wasn't in the hook address, so the PoolManager never called it; donated tokens were lost to the locked position. | **Fixed:** `BEFORE_DONATE_FLAG` added (hook flags now `0x28ec`; the deploy salt is mined for them) and `beforeDonate: true`, so every donation reverts. The comment now lists which hooks are actually called. Test: a v4 `PoolDonateTest` donation reverts and the PoolManager's IMD is unchanged. |
| 2 | Low | `RunnerDeployLib.sqrt(2)` returned 2. | **Fixed:** uses Uniswap v2's `Math.sqrt` (1..3 special-cased). The deployed start tick is unchanged (142,600). Test: floor property for every x below 200, plus `sqrt(max)`. |
| 3 | Info | `collectProtocolFees` could run inside a stranger's unlock, unlike `flush`. | **Fixed:** same rule as `flush`: mid-unlock only our routers can collect; anyone can still collect outside an unlock. Test: a stranger's unlock collects nothing. |
| 4 | Info | `excludePool` accepted any contract exposing `token0() = RUNNER`, stronger NatSpec than code. | **Fixed (check strengthened, rule documented):** now `token0()` and `token1()` must be two different contracts, one of them RUNNER, and `factory()` must be a contract (the Uniswap v2/v3 pool shape). The NatSpec says plainly that no on-chain check can tell a pool from a contract built to look like one, and that exclusion is an irreversible owner power (no `includePool`, so the owner gains no way to re-weight holders). Tests: a token0-only wallet, a pool whose other token isn't a contract, and a pool without a factory are all refused. |
| 5 | Info | `Trade` named `tx.origin` for swaps through other routers. | **Fixed:** names the router (the swap's `sender`); our own routers still name the user. Tests for both. |
| 6 | Info | `emissionSchedule()` kept showing the superseded schedule as current after the pending one took effect. | **Fixed:** the view returns the pending schedule as current (and nothing pending) once its day has come. Test: on day 25 the view shows the 2M schedule in force and nothing pending. |
| 7 | Info | RUNNER or IMD sent directly to the hook after launch can't be recovered. | **Documented, by design:** the hook has no function that moves its own ERC-20 balance after `openPool`, and we keep it that way (no owner withdrawal path on the contract that owns the locked liquidity). Don't send tokens to the hook address. |
| 8 | Info | At extreme accepted start ticks (up to 887,000) the burned launch dust is ~0.87 RUNNER, not ~1e9 wei. | **Documented:** at the production tick 142,600 the burn is 1,000,000,170 wei (within the buffer, tested). If a different launch price is ever chosen, re-check the burned amount before deploying. |
| 9 | Info | The run-reward cap is per UTC day, so two days' worth can be claimed seconds apart across midnight. | **Documented:** the contract comment now says "per UTC day" and states the worst case (2 × 20M = 5% of the pool within 24 hours under a stolen owner key). |
| 10 | Info | Privileged-role trust assumptions. | **NFT validator fixed:** `setTransferValidator` refuses an address without code (it would freeze every transfer); `address(0)` still turns it off. Test added. **The rest is documented, by design:** token owner (signer, schedule ≤ 20M/UTC day, pause, protocol wallet, irreversible `excludePool`), hook owner (`openPool` once, fee recipient; setting it to the token would turn protocol fees into holder rewards), NFT owner (treasury: a reverting treasury halts minting). The owner moves to a multisig before launch. |

## Fourth IMD audit (25 October 2026)

IMD audited commit `15a66e9` — [report](https://imd-explorer.up.railway.app/jobs/8d4586f5-6af3-4ebb-a492-75f941aa0e4f). Result: **4 low, 5 informational, no medium or higher.**

| # | Severity | Finding | Status |
|---|---|---|---|
| 1 | Low | A swap that moved nothing (a sell when the pool holds no IMD, e.g. right after launch) succeeded and parked the price at the tick limit: `marketCap()` read 0 and `Trade` showed an extreme price. | **Fixed:** `afterSwap` reverts `EmptySwap` when no IMD or no RUNNER moved; `marketCap`, `getTokenInfo` and `Trade` report the launch price whenever the pool price is past the launch position (the pool holds no IMD). Tests: an empty sell is refused with the price untouched; after a sell drains the pool, the views show the launch price. |
| 2 | Low | `setProtocolWallet` accepted the PoolManager (swept IMD skimmable by anyone) or the hook (stuck). | **Fixed:** both revert `BadAddress`. |
| 3 | Low | `setFeeRecipient` accepted the PoolManager (protocol fees vanish). | **Fixed:** reverts `ZeroAddress`. |
| 4 | Low | A run-reward backlog larger than one day's emission can't be claimed with its full total. | **Documented, by design:** claims are all-or-nothing on-chain; the rewards server signs staged totals that fit today's remaining emission (`api/rewards.js`: `min(total, claimed + leftToday)`, returned as `partial`), so a backlog is paid over consecutive days. `claimable()` returns 0 for a total that doesn't fit, matching `claim()`. |
| 5 | Info | If IMD's issuer blocks the token contract (or the PoolManager), our routers' trades reverted inside the holder-fee flush. | **Fixed:** `RunnerRouter` and `RunnerEthRouter` flush in `try/catch`, so trading never depends on IMD's transfer policy; the holder share waits in the hook until `flush` succeeds. Holder claims still need IMD transfers to work (documented trust assumption on IMD). Test: with the token blocked, buys, sells and ETH buys work and the share is delivered after unblocking. |
| 6 | Info | `marketCap()` used the fixed 1B supply. | **Fixed:** uses the live `totalSupply()`. |
| 7 | Info | Fees under 25 wei of IMD rounded to 0. | **Fixed:** the fee rounds up (the `PartialFill` check reuses the same value). |
| 8 | Info | `sweepExpired(type(uint256).max)` overflowed. | **Fixed:** the range end is capped, so max means "all". |
| 9 | Info | `burnFrom(address(0), 0)` emitted a zero-address event. | **Fixed:** burns from the zero address revert. |

## Third IMD audit (25 October 2026)

IMD audited commit `f66eb5d` (including the v4 hook) — [report](https://imd-explorer.up.railway.app/jobs/d4297b4d-7c6d-4a0f-815f-2b0840ead21e). Result: **2 medium, 3 low, 1 informational**; no earlier finding reappeared.

| # | Severity | Finding | Status |
|---|---|---|---|
| 1 | **Medium** | The hook fixed the fee from the *requested* IMD before the swap and never checked the fill: partial fills (a price limit, or an exact-out sell beyond the pool's IMD) were charged 4% of the whole request, and large exact-out sells reverted with an opaque underflow. | **Fixed:** in `afterSwap`, for the two directions where IMD is specified, the hook checks the pool moved exactly the expected IMD (exact-in buy: amount − fee; exact-out sell: amount + fee) and otherwise reverts `PartialFill`. The fee is always exactly 4% of what traded. Tests: both partial-fill cases refused with nothing charged; full fills still pay exactly 4%. |
| 2 | **Medium** | `openPool` required exactly 100M in the hook and exactly 1B supply, so 1 wei sent to the hook or burned before launch bricked the launch. | **Fixed:** requires at least 100M (any extra is burned with the rounding buffer); the supply check is dropped (the token mints exactly 100M to its immutable hook). Tests: dust sent to the hook, and a pre-launch burn, no longer stop the pool. |
| 3 | Low | The constructor accepted start ticks whose launch liquidity can't fit in a v4 tick. | **Fixed:** the constructor computes the launch liquidity for both pair orderings and reverts `BadTick` above `Pool.tickSpacingToMaxLiquidityPerTick`. Test: −400,000 is rejected; large positive ticks (low prices) stay valid. |
| 4 | Low | `claimable()` clamped to what's left today while `claim()` is all-or-nothing. | **Fixed:** returns 0 when the full difference doesn't fit in today's emission or the pool. |
| 5 | Low | `transferFrom(address(0), to, 0)` emitted a fake mint event. | **Fixed:** transfers from the zero address revert `ZeroAddress`. |
| 6 | Info | Owner trust (signer + emission up to the daily cap). | Acknowledged — multisig owner before launch. |

## Second IMD audit (24 October 2026)

IMD audited commit `cca0b03` (before the v4 change) — [report](https://imd-explorer.up.railway.app/jobs/66b2e980-5b17-4b7f-bdf7-5a74b69fc3c5). Result: **1 medium, 4 low, 2 informational.** All five code findings still applied after the v4 change and are fixed; the same ownership and self-address fixes are also applied to the new RunnerHook.

| # | Severity | Finding | Status |
|---|---|---|---|
| 1 | **Medium** | Excluding a pool (`addPair`, now `excludePool`) shrank past days' share totals even after payouts from those days: a pool that had claimed could make later claims underflow, a day could pay out more than it received (bricking `sweepExpired` past it), and identical holders were paid differently before/after the exclusion. | **Fixed** with the stronger option: `_exclude` skips any day already paid from (`past.paidOut > 0`), so a day's denominator is frozen once anyone is paid; the excluded account's slice of such a day goes to the protocol in the sweep. Days nobody was paid from still drop the pool's weight (IMD #2). Tests: the report's three cases (claim after a claiming pool is excluded, sweep keeps working past that day, identical holders paid identically around an exclusion); the randomized model now tracks frozen days. |
| 2 | Low | `claimable()` ignored the pause, emission start, signer, daily cap and pool balance. | **Fixed.** Returns 0 while paused, before emission or with no signer, and caps the amount at what's left of today's emission and of the pool. Tests for each. |
| 3 | Low | A pending ownership proposal couldn't be cancelled (token and NFT). | **Fixed** in the token, the NFT and the RunnerHook: `transferOwnership(address(0))` cancels. Tests in all three suites. |
| 4 | Low | `setProtocolWallet` accepted the token's own address. | **Fixed:** reverts `BadAddress` (the hook's `setFeeRecipient` likewise rejects the hook). |
| 5 | Low | `setTreasury`/`setRoyaltyReceiver` accepted the NFT contract's own address. | **Fixed:** both revert `NotAuthorized`. |
| 6 | Info | Owner trust (signer + emission schedule up to 20M/day). | Acknowledged — multisig owner before launch (see *Before mainnet*). |
| 7 | Info | NFT owner can freeze transfers (validator) or halt minting (treasury). | Acknowledged — same. |

## Independent audit — IMD (24 October 2026)

IMD audited both contracts at commit `9f1a689` ([report](https://imd-explorer.up.railway.app/jobs/28c0a5e2-0f75-404e-a9d9-37a528840d88?hired=audit); four specialist agents plus a judge that reproduced and ranked every finding with Foundry tests). Result: **7 low, 1 informational, no critical/high/medium.** Each finding was re-checked against the code here before fixing.

| IMD # | Severity | Finding | Status |
|---|---|---|---|
| 1 | Low | Self-transfer (`transfer`/`transferFrom` with from = to) recorded a dip that never happened, zeroing the wallet's holder-reward weight for the day; a spender with a 1 wei allowance could do it to anyone. | **Fixed.** `_move` returns early when from = to (balance and checkpoints untouched; allowance still spent, `Transfer` still emitted). Tests: self-transfer and `transferFrom(self, self)` keep the day minimum and share total; the randomized model now includes self-transfers. |
| 2 | Low | `addPair` (now `excludePool`) excluded a pool for every day, but the share totals of still-claimable past days kept its weight, diluting holders and stranding its slice for the sweep. | **Fixed.** `_exclude` also subtracts the pool's weight from each of the last 7 days' share totals (bounded loop). Claims already paid can never exceed a day's tax (a smaller denominator only applies to unpaid shares). Tests: explicit reproduction of IMD's scenario, and the randomized model registers a pool that held 5M for days mid-run, checking Σ weights = day total for every day afterwards. |
| 3 | Low | The claim signature didn't cover `instant`, so anyone holding a runner's signed claim could submit it as a 7-day lock first, making the runner's instant claim revert. | **Fixed.** EIP-712 struct is now `Claim(address account,uint256 totalEarned,uint256 deadline,bool instant)`; the server (`api/_lib/eth.js`, `api/rewards.js`) signs the choice the runner made in the app (`js/rewards.js`). Instant still requires `msg.sender == account`. Tests: a third party can't switch an instant signature to a lock (`BadSignature`) or use it themselves; a lock signature can't pay instantly; a signed lock can still be submitted by anyone; the server signs `instant` true/false as asked. |
| 4 | Low (design) | Tax and the 300k threshold are per address: a vault or wrapper can pool small holders past 300k or move volume to an untaxed wrapped token, and singleton DEXes (Uniswap V4, intent settlers) can't be registered. | **Acknowledged, documented.** Since the v4 change, the fee is charged by the RunnerHook pool only (so singleton DEXes are no longer a problem for our own pool), but trades through any other pool or a wrapper pay no fee, and the threshold is per address by design. Adding an owner-controlled tax list for arbitrary contracts was rejected because it reintroduces the centralization risk fixed in #2. |
| 5 | Low | The deploy day's share total was frozen at 0 before the initial mints, so all launch-day holder tax went to the protocol wallet. | **Fixed.** Opening balances are credited as held since the day began (`_mintAtStart`), then the day is started, so the deploy day's share total is the liquidity + team balances. Tests: deploy-day share total = 200M, launch-day tax claimable by holders with nothing stranded. |
| 6 | Low | `RunnerGenesis.mint()` didn't run the ERC-721 receiver check, so a contract that can't handle NFTs could pay and get a token it can never move. | **Fixed.** `mint` calls the same receiver check as `safeTransferFrom` (EOAs and Safes unchanged). Tests: a minting contract without `onERC721Received` is refused with nothing charged; one that accepts ERC-721s mints and the treasury is paid. |
| 7 | Low | `transferOwnership` was single-step in both contracts; a typo'd or undeployed multisig address would lose every owner function. | **Fixed.** Two-step handover in both: `transferOwnership` sets `pendingOwner`, the new owner calls `acceptOwnership`. Tests: a proposal changes nothing, nobody else can accept, a replaced proposal can't be accepted, the old owner is locked out only after acceptance. |
| 8 | Info | Trust assumptions: through `setSigner` + `setEmissionSchedule` the owner key could claim up to 20M RUNNER/day for itself; it can also redirect the protocol share, pause claims, register any V2-style pool, and on the NFT freeze transfers (validator) or halt minting (treasury). | **Acknowledged, documented.** The contract header and README no longer say the owner "can never take tokens out of the run-reward pool": it is bounded by the daily emission only. Mitigation is key custody: move both contracts to a multisig (now safe to do with the two-step handover) — see *Before mainnet*. |

## Scope

| Contract | File | Creation-code keccak (solc 0.8.24, optimizer 200, EVM paris) |
|---|---|---|
| RUNNER token (ERC-20, no transfer tax + daily holder rewards in IMD + run-reward claims) | `contracts/RunnerToken.sol` | `0x75d8d27c4c1220ebabaf525493933771ca45bab43110bb52f09fa74ce0d226d5` |
| RUNNER Genesis NFT (ERC-721, ERC-2981, ERC-721C hook) | `contracts/RunnerGenesis.sol` | `0x270c71d725f5555873c1391b02799879056d7d4923759ab75fe6cd3d9c32ed9e` |
| RunnerHook (Uniswap v4 hook + pool owner; deploys RunnerRouter and RunnerEthRouter) | `contracts/RunnerHook.sol`, `RunnerRouter.sol`, `RunnerEthRouter.sol`, `utils/SafeTransfer.sol` | `0xddf207aa61c7b1007ccd63352897f2233604cb48ca3cdbeace1e26d6e5eb4c2c` (creation code in `contracts/build/RunnerHook.json`: solc 0.8.26, via-IR, optimizer 200, EVM cancun, no metadata hash; v4-core `46c6834`) |
| Rewards server (signs run-reward claims) | `api/rewards.js`, `api/_lib/*`, `js/rules.js` | — |

`/admin.html` refuses to deploy any build whose fingerprint differs from the table, so the reviewed code is what gets deployed.

## Method

1. Line-by-line manual review of both contracts and the server: access control, arithmetic, reentrancy, signature handling, accounting invariants, owner powers, and DEX/marketplace interactions.
2. **Slither 0.10.4** static analysis (93 detectors). The triage is below.
3. Tests run against the official compiler build in a local EVM (`tests/`):
   - `token.test.mjs`: 177 checks (token in isolation; the hook is an address and IMD a mock), including the IMD audit reproductions, including emission-schedule changes (limits, next-day start, fresh halving clock, the server's decoder), the 7-day locks and instant burns, the halving schedule (checked day by day against the JavaScript mirror for 400 days) and a **randomized model test**. It runs 600 random actions (buys, sells, transfers, claims, sweeps, burns, and time jumps) over 45 days. Every 5 steps it compares every balance, every daily eligible balance, the daily totals and the holder-reward bucket against an independent JavaScript model.
   - `nft.test.mjs`: 56 checks, including safe minting into contracts and two-step ownership, including the rarity and price of all 9,999 tokens against the app, and a malicious re-entering validator.
   - `rewards-server.test.mjs`: 110 checks covering device attestation and step cadence, the trust score (realistic vs scripted tracks, copied routes), the automatic fair-play rules (full, half and no pay, strikes, automatic suspensions and their expiry, forfeiting held earnings), the 24-hour hold, manual bans, rate limits, admin-signed game settings, NFT boosts, the per-runner daily max, on-chain schedule changes, sign-in, run scoring, anti-cheat, spending, claims, halving rates and costs, the energy table, level costs, the global daily budget and partial claims. A server-signed claim was also accepted by the token contract on chain id 4663.
   - **Foundry (`forge test`)**: `contracts/test/RunnerHook.t.sol`, 37 tests including a 256-run fuzz test, against a real Uniswap v4 PoolManager: liquidity locked (pool + burned dust = exactly 100M, ~642 IMD start), nobody else can add liquidity or reuse the hook, 4% fee in IMD in all four swap directions through an external router, the 2%/2% split, holder IMD booked and claimed in IMD then swept, flash-borrowed pool tokens can't trigger a mid-unlock flush, the ETH router, slippage/deadline, two-step hook ownership. `contracts/test/RunnerHook.fork.t.sol` (3 tests, `FORK_RPC=https://robinhood.drpc.org`) runs on a Robinhood Chain mainnet fork with the real PoolManager, real IMD and real IMD/ETH pool: buy and sell with ETH, fees arrive in real IMD, a holder claims real IMD.
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
   | *IMD fixes undone, one at a time (24 Oct):* | |
   | Self-transfer short-circuit removed (IMD 1) | Caught |
   | Past days not adjusted on `addPair` (IMD 2) | Caught |
   | Payout choice left out of the signature (IMD 3) | Caught |
   | Opening balances not counted on the deploy day (IMD 5) | Caught |
   | `mint` skips the receiver check (IMD 6) | Caught |
   | Single-step ownership, token / NFT (IMD 7) | Caught (both) |
   | *v4/IMD design (24 Oct), token:* sync double-counts IMD, claim doesn't reduce the held bucket, sweep pays the caller, hook not excluded, pool manager not excluded | All caught |
   | *v4/IMD design (24 Oct), hook (Foundry):* fee 4%→3%, protocol share 2%→3%, holder IMD flushed but never booked, anyone can flush mid-unlock, protocol fees sent to the caller, `openPool` skips the reward-token check, single-step hook ownership, exact-in sells not charged | All caught |
   | *Second IMD audit fixes undone (24 Oct):* paid days not frozen on exclusion, `claimable` ignores pause/start/signer, `claimable` ignores today's emission, proposal can't be cancelled (token, NFT, hook), protocol wallet may be the token, treasury / royalty receiver may be the NFT, fee recipient may be the hook | All caught |
   | *Third IMD audit fixes undone (25 Oct):* partial fills accepted, `openPool` needs exactly 100M again, unsafe start ticks accepted, `claimable` clamps instead of matching `claim()`, transfers from address(0) allowed | All caught |
   | *Fourth IMD audit fixes undone (25 Oct):* empty swaps accepted, price views not clamped, fee recipient may be the PoolManager, router reward delivery blocks trades, market cap uses the fixed supply, fee rounds down, protocol wallet may be the PoolManager/hook, sweep range overflows, burns from address(0) allowed | All caught |
   | *Fifth IMD audit fixes undone (25 Oct):* donations accepted (beforeDonate not wired), old `sqrt`, stranger collects protocol fees mid-unlock, `excludePool` without the other-token / factory checks or with `token0` alone, `Trade` names `tx.origin`, `emissionSchedule` shows the superseded schedule, NFT accepts a validator without code | All caught |
   | *Sixth IMD audit fixes undone (25 Oct):* hook constructor accepts the PoolManager or the hook as fee recipient, token constructor accepts the PoolManager or hook as owner, `claimable` ignores the instant burn / the lock limit / counts finished locks, ETH buy refunds the router's whole balance | All caught (71 of 71 planted bugs across all rows) |
   | *Classic bugs (24 Oct):* holder tax 2%→3%, threshold `>=`→`>`, daily cap not enforced, claim replay, signer check removed, instant claim burns nothing, locks release early, sweep window off by one, 20M ceiling unchecked, anyone sets the signer, excluded wallets earn, NFT price unchecked, NFT double mint | All caught (the threshold one after adding an exact-300,000 test) |

## Findings

| # | Severity | Finding | Status |
|---|---|---|---|
| 1 | **High** | Token: a stolen owner key could drain the run-reward pool. `setSigner` plus an unlimited daily cap let the owner mint claims for any amount. | **Fixed.** Daily claims follow an emission schedule that can never exceed `MAX_DAILY_EMISSION` = 20,000,000/day (2.5% of the pool), and schedule changes only start the next UTC day. **Remaining risk:** a stolen owner key could set 20M/day from the next day plus a new signer, taking up to 20M/day until stopped. A stolen server key alone can take up to the day's emission until the owner pauses claims. Put the owner in a multisig (#4). |
| 2 | **Medium** | Token: `addPair` (now `excludePool`, exclusion only) accepted any contract, so the owner could register a user's smart-contract wallet (e.g. a Safe) as a "pool". That wallet would be taxed on every transfer and cut out of holder rewards. | **Fixed.** `addPair` requires the contract to report RUNNER as `token0()` or `token1()`. Pools are add-only. |
| 3 | **Medium** | NFT: the ERC-721C validator was called after the ownership checks. A validator that re-enters `transferFrom` could move the token in between and corrupt the ownership records. A test reproduces this on the old code. | **Fixed.** The validator is called first, and every check reads state after it. |
| 4 | Medium (centralization) | Both contracts have one owner, the dev wallet EOA. Owner powers are listed below. If that key is lost or stolen, the NFT owner could freeze NFT transfers through a blocking validator, and the token owner could pause run claims or redirect the protocol share. | **Open: recommendation.** Make the owner a multisig (e.g. Safe 2-of-3) before launch, or at least keep the dev key on a hardware wallet. |
| 5 | Low | Token: trades through a pool before `addPair` is called are untaxed, so snipers could use the gap after liquidity is added. | **No longer applies.** The hook initializes the pool and adds its liquidity in one `openPool` call; the fee applies from the first swap. |
| 6 | Low | Token: unclaimed holder rewards only move to the protocol when someone calls `sweepExpired`. They are already unclaimable after 7 days, but they sit in the contract until swept. | **Open: by design.** Anyone can sweep, and the admin page has a button. Bounded per call by `maxDays`. |
| 7 | Low | Server: the HR +10% bonus trusts heart-rate values sent by the phone. | **Open.** Small and bounded by energy. Could be disabled for real-token runs. |
| 8 | Low | Server: no rate limiting on `/api/rewards`. Spam costs function time but can't credit tokens. | **Fixed.** 120 requests/min per IP, 20 sign-ins (or admin/settings messages) per hour per IP, and 30 run uploads per hour per wallet, with Redis counters. |
| 9 | Medium (game integrity) | No server can fully stop GPS spoofing or tracks generated and uploaded straight to the API by a runner who owns a sneaker. | **Mitigated.** (a) Every run gets a trust score (`api/_lib/trust.js`): perfectly regular fix timing, constant speed, equal segment lengths, perfectly straight routes, unchanging accuracy, and routes identical to an earlier upload. (b) Earnings are usable only 24 h after a run. (c) **Automatic rules, no human review:** trust ≥ 70 is paid in full; 40–69 is paid 50% with no penalty; under 40, a fake-GPS app or a copied route is not paid and adds a strike. 3 strikes within 30 days suspend the wallet automatically (7 days, then 30, then permanently) and forfeit its earnings still on hold. All thresholds are admin game settings. (d) Optional manual ban (with duration) and a read-only log of automatic decisions. (e) Bounded by per-wallet energy (1–10 energy/day, 30 min each), the per-sneaker overlap lock and the daily emission. (f) **Step cadence:** the phone app records the step counter (Android step sensor / iPhone CMPedometer) and the server compares it with the GPS pace minute by minute. Moving with almost no steps (bike, scooter, car), a walking cadence at running pace, or strides over 2.6 m cost up to 45 points, which sends the run to review. Missing step data from the app costs 10–15 points. (g) **Mock locations:** the recorder drops fake-GPS fixes (Android `isFromMockProvider`, iOS 15+ simulated locations) and reports how many it saw (−50 trust). (h) **Device attestation** (`api/_lib/attest.js`): each upload from the app carries a Google Play Integrity token or Apple App Attest attestation/assertion whose nonce is the SHA-256 of the run (`runPayload` in `js/rules.js`), so it can't be moved to another run. The server requires `PLAY_RECOGNIZED` + `MEETS_DEVICE_INTEGRITY` and a token under 15 min old on Android; on iPhone it checks Apple's certificate chain to the pinned App Attestation Root CA, the nonce, team/bundle ID, production environment, and an increasing signature counter. With the `requireAttestation` game setting on, runs without a valid proof (including all website runs) earn nothing and use no energy. **Remaining:** attestation proves the app and phone are genuine, not that the phone is on a runner; a person carrying a genuine phone on a bike while shaking it is left to the cadence/stride check and human review. `requireAttestation` must be switched on at launch, after the Google/Apple setup (README). The iOS plugin has not been built yet (no Xcode on the dev machine). |
| 10 | Info | Fee-on-transfer tokens don't work in Uniswap-V3/V4-style pools. | **No longer applies.** RUNNER has no transfer tax; the fee is taken by the v4 hook in IMD. |
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
- **No transfer tax.** Every transfer moves exactly the amount sent. The 4% trading fee (2% protocol, 2% holders) is charged in IMD by `RunnerHook` on swaps in its RUNNER/IMD v4 pool (constants `FEE_BPS = 400`, `PROTOCOL_FEE_BPS = 200`). Holder IMD reaches the token through `flush` → `syncHolderRewards`.
- **Holder rewards:**
  - Day = `block.timestamp / 1 days`. Each wallet keeps checkpoints `{day, minBalance, endBalance}`.
  - A wallet's weight for day *d* is its lowest balance during *d* if that is at least 300,000, otherwise zero.
  - The day's total weight is frozen at the first balance change of the day, as the running `eligibleSupply`, and decreases whenever a wallet's daily low falls. Opening balances count for the deploy day. A self-transfer changes nothing. Registering a pool removes its weight from today and the 7 still-claimable days.
  - Day *d*'s holder tax can be claimed on days *d+1* … *d+7*. Days with *d+7 < today* can be swept to the protocol.
  - Invariants checked by the randomized test:
    - Σ weights = day total;
    - `holderRewardsHeld` = Σ (rewards − paid out);
    - pool = contract balance − `holderRewardsHeld`;
    - Σ balances = `totalSupply`.
- **Run rewards:** the server signs an EIP-712 `Claim(account, totalEarned, deadline, instant)`. The contract pays `totalEarned − claimed[account]`. Low-s signatures only, with the chain id and contract in the domain, and a deadline.
- **Payout choice and locks:** `claim(…, instant)` sends 80% now and burns 20% (`instant`, runner only), or locks 100% for 7 days. `rewardsRemaining = balance(this) − holderRewardsHeld − totalLocked`, so locked rewards can never be paid out twice. Burned amounts reduce `totalSupply` and are tracked in `totalBurnedInstant`.
- **Emission:** `emissionOn(day)` = max(dailyStart >> ((day − fromDay) / halvingDays), floor) under the schedule in force (a pending one applies from its `fromDay`), or 0 before `startEmission()`, which can only be called once. Launch schedule: 10M/day, halving every 30 days, floor 100k. `setEmissionSchedule` (owner) starts a new one the next day with a fresh clock, ≤ 20M/day. Claims per day ≤ `emissionOn(today)`. `js/rules.js` mirrors this exactly, and the server scales earn rates by `emissionOn / 10M`.

### Owner powers (complete list)

| Contract | Function | Effect | Limits |
|---|---|---|---|
| Token | `excludePool` | Excludes another RUNNER pool from holder rewards (no effect on transfers) | Contracts with the v2/v3 pool shape only (`token0`/`token1` two contracts, one RUNNER, plus a `factory`); add-only, irreversible |
| Hook | `openPool` | Opens the RUNNER/IMD pool and locks the 100M liquidity | Once; checks the token's wiring |
| Hook | `setFeeRecipient` | Where the protocol's 2% (IMD) goes | Can't change the fee or touch liquidity |
| Hook | `transferOwnership` → `acceptOwnership` | Hand over the hook | Two steps |
| Token | `setProtocolWallet` | Where the 2% protocol tax and expired holder rewards go | — |
| Token | `setSigner` | The rewards server key (zero disables claims) | Daily cap |
| Token | `setClaimsPaused` | Pause run-reward claims | Doesn't affect transfers or holder rewards |
| Token | `startEmission` | Starts the emission schedule today | Once only |
| Token | `setEmissionSchedule` | New daily amount, halving period and floor, from the next UTC day | ≤ 20M/day, halving 7–3650 days, floor ≤ daily amount |
| Server | fair-play rules, log and manual bans (admin session signed by the dev wallet) | Change rule thresholds; read the log of automatic decisions; ban (for N days or permanently) or unban a wallet | Off-chain; can't touch tokens already claimed |
| Server | game settings (signed message) | Level-price base and curve, per-runner daily max, NFT boost collections | Boosts ≤ +100% in total; always within the day's emission |

`release(account)` and `sweepExpired` can be called by anyone; they only ever pay the rightful wallet or the protocol wallet.
| Both | `transferOwnership` → `acceptOwnership` | Hand over ownership | Two steps: the new owner must accept |
| NFT | `setPaused` | Pause minting | Transfers unaffected |
| NFT | `setTreasury`, `setRoyaltyReceiver` | Where mint payments and the 5% royalty go | — |
| NFT | `setBaseURI`, `setContractURI` | Metadata links | — |
| NFT | `setTransferValidator` | Royalty enforcement (OpenSea). A malicious validator could block transfers. | See #4 |
| NFT | `withdraw` | Sweep stray ETH to the treasury | Mint payments never stay in the contract |

Nobody, including the owner, can change the tax, raise emission above 20M/day, change today's emission, mint tokens, or take tokens out of the holder-reward bucket. Run rewards leave the pool only through signed claims within the day's emission; since the owner picks the signer, a compromised owner key could claim up to that cap (IMD #8).

## Before mainnet

1. ~~Get an independent audit.~~ Done: IMD, 24 October 2026 (see top). All code findings fixed; consider a re-check of the fixes.
2. ~~Move ownership of both contracts to a multisig.~~ **Decision, 26 October 2026: ownership stays with the dev wallet** (no multisig). The "multisig before launch" notes in the findings above are superseded by this. The risk is bounded by the limits listed above (≤ 20M RUNNER/day, no minting, fee and liquidity fixed); keep the dev key safe, ideally on a hardware wallet. Moving later is still possible with `transferOwnership` + `acceptOwnership`.
3. Launch sequence (admin page): deploy the **RunnerHook** (CREATE2, flagged address) → deploy the **token** with the hook's address → **`openPool`** (dev wallet) → set up the rewards server → `setSigner` → `startEmission` on launch day.
5. Before a public launch: finish the Google Play Integrity and Apple App Attest setup (README → *Device attestation setup*), ship the apps through Google Play and TestFlight/App Store, and switch on **Phone app only** (`requireAttestation`) in the admin page (see #9).
6. Get legal advice on a tradable token with a holder-reward mechanism in Indonesia (OJK).

## Re-running

```
cd tests && npm install
node token.test.mjs && node nft.test.mjs && node rewards-server.test.mjs ..
cd .. && scripts/setup-contracts.sh && forge test   # FORK_RPC=https://robinhood.drpc.org forge test adds the mainnet-fork tests
```
