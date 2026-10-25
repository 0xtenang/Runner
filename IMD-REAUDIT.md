# Re-audit request — RUNNER contracts

Hi IMD — thank you for all six audits (`28c0a5e2` at `9f1a689`, `66b2e980` at `cca0b03`, `d4297b4d` at `f66eb5d`, `8d4586f5` at `15a66e9`, `ed4b93f2` at `3ffb33f`, and `b58971f0` at `556c920`). Every code finding from both is fixed, and since the second one RUNNER moved to a new market design: it is now paired with **IMD** in a **Uniswap v4** pool, with all trading-fee rewards paid in IMD — the same design as PepesFamily, which you have reviewed. Please audit the final code:

- **Repository:** `0xtenang/Runner`, commit **`6fb64f4`** ([link](https://github.com/0xtenang/Runner/commit/6fb64f4))
- **In scope:** `contracts/RunnerToken.sol` (solc 0.8.24), `contracts/RunnerGenesis.sol` (0.8.24), `contracts/RunnerHook.sol`, `contracts/RunnerRouter.sol`, `contracts/RunnerEthRouter.sol`, `contracts/utils/SafeTransfer.sol` (0.8.26). The run-claim server (`api/rewards.js`, `api/_lib/eth.js`) only as far as it signs claims.
- **Build:** `scripts/setup-contracts.sh && forge build` (libraries pinned to PepesFamily's commits: v4-core `46c6834`, forge-std `f3dae6e`, solmate `4b47a19`).

## At a glance (the intended design)

- **Pair:** RUNNER / **IMD** (`0x5F7Bb59365ce557C26dbcAa4EE9d39A4b95B7127`) on Robinhood Chain.
- **Pool:** one **Uniswap v4** pool with our own hook (`RunnerHook`) on the v4 PoolManager `0x8366a39CC670B4001A1121B8F6A443A643e40951`.
- **Fee:** **4% on every buy and sell** in that pool (any v4 router), taken from the IMD side: **2% protocol, 2% holders — both in IMD**. Fixed constants.
- **Liquidity:** the 100M allocation, locked forever by the hook.
- **Owner controls kept on purpose:** the emission schedule (from the next UTC day, ≤20M RUNNER/day), the claim signer and pause, excluding other pools. NFT earning boosts are an off-chain server setting (not in these contracts).

## 1. The new design (please review closely)

| | Before (audited at `9f1a689` / `cca0b03`) | Now |
|---|---|---|
| Trading fee | 4% transfer tax inside `RunnerToken` on registered V2-style pairs, paid in RUNNER | **No transfer tax in the token.** `RunnerHook` (adapted from PepesFamily's `PepesEarnIMD`) takes 4% of the IMD side of every swap: 2% protocol, 2% holders — **in IMD** |
| Holder rewards | RUNNER | **IMD**, sent by the hook and booked by `syncHolderRewards()`; same rules (≥300,000 held all day, lowest balance, 7-day window, sweep to protocol) |
| Liquidity | 100M to the dev wallet | 100M minted to the hook, added single-sided by `openPool` at ~642 IMD market cap, **locked forever** (no removal path; nobody else can add liquidity) |
| Pools | `addPair` (tax + exclusion) | `excludePool` (exclusion only); the PoolManager and hook are excluded at deployment |
| Trading | V2 routers | `RunnerRouter` (IMD) and `RunnerEthRouter` (ETH via the IMD/ETH v4 pool), from PepesFamily |

**Where we'd most value your eyes:**
1. The hook's fee in all four swap directions (exact-in/out × buy/sell) and the ERC-6909 claim mint/burn settlement.
2. `openPool`'s wiring checks and the locked single-sided liquidity (100M − 1e9 buffer; dust burned).
3. `syncHolderRewards()` books any IMD above `holderRewardsHeld` as today's rewards (so donations become rewards); claims and sweeps pay IMD with checks-effects-interactions and a reentrancy guard.
4. `flush` mid-unlock is limited to our routers (flash-borrowed pool RUNNER can't trigger distribution; our day-minimum accounting doesn't count it anyway).
5. RUNNER is a plain ERC-20 (no hooks, no fee-on-transfer), so it is safe inside the PoolManager.

**Known and accepted:** holder claims and sweeps need IMD transfers to work (IMD's issuer controls a blocklist); trading through our routers does not. Trades through any other RUNNER pool pay no fee (the owner can exclude such a pool from holder rewards); fees from non-RunnerRouter swaps wait in the hook until anyone calls `flush`, and are booked on that day; the 300k threshold is per address.

## 2. Fixes since your audits

**First audit (`28c0a5e2`):** #1 self-transfer, #2 retroactive exclusion, #3 signed payout choice, #5 deploy-day shares, #6 safe mint, #7 two-step ownership — fixed at `938a178` (details in `AUDIT.md`). #4 and #8 acknowledged.

**Sixth audit (`b58971f0`):**

| # | Severity | Finding | What changed |
|---|---|---|---|
| 1 | Low | The hook's constructor accepted the PoolManager or the hook itself as `feeRecipient` (which `setFeeRecipient` refuses); protocol IMD collected before a fix would be lost. The token's constructor had the same gap for the owner, who is also the first protocol wallet. | **Fixed:** the hook constructor refuses both (`ZeroAddress`, as the setter); the token constructor refuses the token itself, the PoolManager and the hook as owner (`BadAddress`, as `setProtocolWallet`). Tests: deploying the hook with the PoolManager or its own address as fee recipient reverts; deploying the token with the PoolManager or hook as owner reverts. |
| 2 | Low | `claimable()` promised "what claim() would pay" but ignored the 20% instant burn and the 30-lock limit. | **Fixed:** `claimable(account, totalEarned, instant)` returns 80% for an instant claim and 0 for a locked claim that would exceed `MAX_ACTIVE_LOCKS` (counting only unfinished locks, since `claim()` releases finished ones first). The app computes its figure server-side, so nothing else changes. Tests: at the lock limit the locked view is 0 and the instant view equals what the claim pays; after locks finish the view is the full amount again. |
| 3 | Info | A 1-wei fee goes entirely to holders (the protocol half rounds down). | **Documented, by design:** the protocol half of the fee rounds down, so the odd wei of any fee goes to holders; at most 1 wei per swap, and the total is always exact. |
| 4 | Info | `buyWithEth` refunded the router's whole ETH balance, not only the buyer's unspent ETH. | **Fixed:** the callback returns the ETH the IMD/ETH pool took, and only `msg.value - ethIn` is refunded. Test: with 1 stray wei in the router, a 1 ETH buy costs exactly 1 ETH and the stray wei stays. |

**Fifth audit (`ed4b93f2`):**

| # | Severity | Finding | What changed |
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

**Fourth audit (`8d4586f5`):**

| # | Severity | Finding | What changed |
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

**Third audit (`d4297b4d`, which covered the v4 hook):**

| # | Severity | Finding | What changed |
|---|---|---|---|
| 1 | **Medium** | The hook fixed the fee from the *requested* IMD before the swap and never checked the fill: partial fills (a price limit, or an exact-out sell beyond the pool's IMD) were charged 4% of the whole request, and large exact-out sells reverted with an opaque underflow. | **Fixed:** in `afterSwap`, for the two directions where IMD is specified, the hook checks the pool moved exactly the expected IMD (exact-in buy: amount − fee; exact-out sell: amount + fee) and otherwise reverts `PartialFill`. The fee is always exactly 4% of what traded. Tests: both partial-fill cases refused with nothing charged; full fills still pay exactly 4%. |
| 2 | **Medium** | `openPool` required exactly 100M in the hook and exactly 1B supply, so 1 wei sent to the hook or burned before launch bricked the launch. | **Fixed:** requires at least 100M (any extra is burned with the rounding buffer); the supply check is dropped (the token mints exactly 100M to its immutable hook). Tests: dust sent to the hook, and a pre-launch burn, no longer stop the pool. |
| 3 | Low | The constructor accepted start ticks whose launch liquidity can't fit in a v4 tick. | **Fixed:** the constructor computes the launch liquidity for both pair orderings and reverts `BadTick` above `Pool.tickSpacingToMaxLiquidityPerTick`. Test: −400,000 is rejected; large positive ticks (low prices) stay valid. |
| 4 | Low | `claimable()` clamped to what's left today while `claim()` is all-or-nothing. | **Fixed:** returns 0 when the full difference doesn't fit in today's emission or the pool. |
| 5 | Low | `transferFrom(address(0), to, 0)` emitted a fake mint event. | **Fixed:** transfers from the zero address revert `ZeroAddress`. |
| 6 | Info | Owner trust (signer + emission up to the daily cap). | Acknowledged — multisig owner before launch. |

**Second audit (`66b2e980`):**

| # | Finding | What changed |
|---|---|---|
| 1 (Medium) | Exclusion shrank past days' totals after payouts | `_exclude` skips any day already paid from (`past.paidOut > 0`): a day's denominator freezes once anyone is paid, so claims can't underflow, `paidOut` can't exceed `rewards`, the sweep can't brick, and identical holders are paid the same. The excluded account's slice of such a day goes to the protocol in the sweep. Days nobody was paid from still drop the pool's weight. |
| 2 | `claimable()` over-promised | Returns 0 while paused, before emission or with no signer; capped at today's remaining emission and the pool. |
| 3 | Ownership proposal not cancellable | `transferOwnership(address(0))` cancels — in the token, the NFT and the hook. |
| 4 | Protocol wallet could be the token | Reverts `BadAddress`; the hook's `setFeeRecipient` likewise rejects the hook. |
| 5 | NFT treasury / royalty receiver could be the NFT | Both revert `NotAuthorized`. |
| 6, 7 | Owner trust | Acknowledged; ownership moves to a multisig before launch. |

## 3. Token scanner checklist (GoPlus — it lists Robinhood Chain 4663; Quick Intel once it supports the chain)

Please confirm nothing in `RunnerToken.sol` should make scanners show the results below, and flag any likely false-flag pattern.

| Check | Expected | Reasoning |
|---|---|---|
| Honeypot | **NO** | Plain ERC-20 transfers; no blacklist, whitelist, cooldown, max-tx, trading switch or transfer pause (`claimsPaused` only stops run-reward claims). The fee lives in the v4 hook, not the token. |
| Buy/sell tax | Token **0%**; the pool fee is 4%, fixed | Constants in the hook (`FEE_BPS`, `PROTOCOL_FEE_BPS`); nothing can change them. |
| Mintable | **NO** | No mint function; supply created once in the constructor. |
| Open source | **YES** | Verified on Robinhood Chain Blockscout right after deployment (section 4). |
| Suspicious functions | **NO** | No fee setters, balance edits, self-destruct, proxy or delegatecall; transfers make no external calls. Possible false-flag triggers: `excludePool` (owner, exclusion only, needs the v2/v3 pool shape with RUNNER as `token0` or `token1`), `claim()` / `claimHolderRewards()` / `sweepExpired()` moving the contract's own RUNNER or IMD. |
| Ownership renounced | **NO (intended)** | The owner rotates the claim signer, pauses claims, adjusts emission (≤20M/day) and excludes pools; it moves to a multisig. Please also check `owner_change_balance`, `hidden_owner`, `can_take_back_ownership` (`pendingOwner`, now cancellable), `slippage_modifiable` and `transfer_pausable`. |
| Liquidity locked | **YES** | The hook owns the only position in its pool and has no removal path. |

## 4. Blockscout verification (our deployment step)

Right after deployment we verify every contract on `robinhoodchain.blockscout.com` with the standard-JSON input:
- `RunnerToken`, `RunnerGenesis`: solc 0.8.24, optimizer 200, EVM `paris`.
- `RunnerHook` (+ `RunnerRouter`, `RunnerEthRouter` deployed by its constructor): solc 0.8.26, via-IR, optimizer 200, EVM `cancun`, no metadata hash.

The hook is deployed through the standard CREATE2 deployer (`0x4e59…956C`) at an address carrying its hook flags (`0x28ec`).

## 5. Tests and build fingerprints

- Foundry: 37 tests (incl. a 256-run fuzz) against a real v4 PoolManager, plus 3 on a Robinhood Chain mainnet fork (real PoolManager, IMD and IMD/ETH pool): `FORK_RPC=https://robinhood.drpc.org forge test`.
- `tests/`: token 177 checks (incl. all six audits' reproductions and a randomized model), NFT 56, server 110.
- Mutation checks: 71 of 71 planted bugs caught, including every fix above undone.

| Contract | Creation-code keccak |
|---|---|
| RunnerToken | `0x75d8d27c4c1220ebabaf525493933771ca45bab43110bb52f09fa74ce0d226d5` |
| RunnerGenesis | `0x270c71d725f5555873c1391b02799879056d7d4923759ab75fe6cd3d9c32ed9e` |
| RunnerHook | `0xddf207aa61c7b1007ccd63352897f2233604cb48ca3cdbeace1e26d6e5eb4c2c` (`contracts/build/RunnerHook.json`) |

Thank you!
