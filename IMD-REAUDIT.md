# Re-audit request — RUNNER contracts

Hi IMD — thank you for both audits (`28c0a5e2` at `9f1a689`, and `66b2e980` at `cca0b03`). Every code finding from both is fixed, and since the second one RUNNER moved to a new market design: it is now paired with **IMD** in a **Uniswap v4** pool, with all trading-fee rewards paid in IMD — the same design as PepesFamily, which you have reviewed. Please audit the final code:

- **Repository:** `0xtenang/Runner`, commit **`264465c`** ([link](https://github.com/0xtenang/Runner/commit/264465c))
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

**Known and accepted:** trades through any other RUNNER pool pay no fee (the owner can exclude such a pool from holder rewards); fees from non-RunnerRouter swaps wait in the hook until anyone calls `flush`, and are booked on that day; the 300k threshold is per address.

## 2. Fixes since your audits

**First audit (`28c0a5e2`):** #1 self-transfer, #2 retroactive exclusion, #3 signed payout choice, #5 deploy-day shares, #6 safe mint, #7 two-step ownership — fixed at `938a178` (details in `AUDIT.md`). #4 and #8 acknowledged.

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
| Suspicious functions | **NO** | No fee setters, balance edits, self-destruct, proxy or delegatecall; transfers make no external calls. Possible false-flag triggers: `excludePool` (owner, exclusion only, needs `token0/token1 == RUNNER`), `claim()` / `claimHolderRewards()` / `sweepExpired()` moving the contract's own RUNNER or IMD. |
| Ownership renounced | **NO (intended)** | The owner rotates the claim signer, pauses claims, adjusts emission (≤20M/day) and excludes pools; it moves to a multisig. Please also check `owner_change_balance`, `hidden_owner`, `can_take_back_ownership` (`pendingOwner`, now cancellable), `slippage_modifiable` and `transfer_pausable`. |
| Liquidity locked | **YES** | The hook owns the only position in its pool and has no removal path. |

## 4. Blockscout verification (our deployment step)

Right after deployment we verify every contract on `robinhoodchain.blockscout.com` with the standard-JSON input:
- `RunnerToken`, `RunnerGenesis`: solc 0.8.24, optimizer 200, EVM `paris`.
- `RunnerHook` (+ `RunnerRouter`, `RunnerEthRouter` deployed by its constructor): solc 0.8.26, via-IR, optimizer 200, EVM `cancun`, no metadata hash.

The hook is deployed through the standard CREATE2 deployer (`0x4e59…956C`) at an address carrying its hook flags (`0x28cc`).

## 5. Tests and build fingerprints

- Foundry: 19 tests (incl. a 256-run fuzz) against a real v4 PoolManager, plus 3 on a Robinhood Chain mainnet fork (real PoolManager, IMD and IMD/ETH pool): `FORK_RPC=https://robinhood.drpc.org forge test`.
- `tests/`: token 164 checks (incl. both audits' reproductions and a randomized model), NFT 55, server 110.
- Mutation checks: 42 of 42 planted bugs caught, including every fix above undone.

| Contract | Creation-code keccak |
|---|---|
| RunnerToken | `0xf41742bf37a9c80554b062bed6203c838465c6cdc8a93a6339635dab3d946776` |
| RunnerGenesis | `0xbb23f94439cb6717558d87b83cb1e9d922d54210975a2e75b2aa9405e3ca08fa` |
| RunnerHook | `0x0cf2983a039f19ed3bae0315d53edd86550d9b079a95009937f05706656826ca` (`contracts/build/RunnerHook.json`) |

Thank you!
