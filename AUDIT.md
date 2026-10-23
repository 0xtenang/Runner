# RUNNER — internal security review

**Date:** 23 October 2026 · **Status:** pre-deployment. Nothing has been deployed.
**Reviewer:** Claude (AI assistant), working in this repository.

> **This is an internal review, not an independent audit.** It was done by the same assistant that wrote the code, so it can share the author's blind spots. RUNNER handles real money on mainnet: the NFT sale, a tradable token with a tax, and an 800M reward pool. Before mainnet, an **independent audit by a professional firm** or a public audit contest is strongly recommended. This report, the tests and the design notes are written so an auditor can start quickly.

## Scope

| Contract | File | Creation-code keccak (solc 0.8.24, optimizer 200, EVM paris) |
|---|---|---|
| RUNNER token (ERC-20 + tax + holder rewards + run-reward claims) | `contracts/RunnerToken.sol` | `0x56b86374daef492b5034060bd22303acd9474669b2686c54cf5166a38f3c973a` |
| RUNNER Genesis NFT (ERC-721, ERC-2981, ERC-721C hook) | `contracts/RunnerGenesis.sol` | `0x1c55e9cf65a7def63fa7bc19d49e3b89330b967c964fdba4e63d83a13c00b446` |
| Rewards server (signs run-reward claims) | `api/rewards.js`, `api/_lib/*`, `js/rules.js` | — |

`/admin.html` refuses to deploy any build whose fingerprint differs from the table, so the reviewed code is what gets deployed.

## Method

1. Line-by-line manual review of both contracts and the server: access control, arithmetic, reentrancy, signature handling, accounting invariants, owner powers, and DEX/marketplace interactions.
2. **Slither 0.10.4** static analysis (93 detectors). The triage is below.
3. Tests run against the official compiler build in a local EVM (`tests/`):
   - `token.test.mjs`: 81 checks, including a **randomized model test**. It runs 600 random actions (buys, sells, transfers, claims, sweeps, burns, and time jumps) over 45 days. Every 5 steps it compares every balance, every daily eligible balance, the daily totals and the holder-reward bucket against an independent JavaScript model.
   - `nft.test.mjs`: 44 checks, including the rarity and price of all 9,999 tokens against the app, and a malicious re-entering validator.
   - `rewards-server.test.mjs`: 27 checks covering sign-in, run scoring, anti-cheat, spending and claims. A server-signed claim was also accepted by the token contract on chain id 4663.
4. **Mutation checks.** Bugs were planted on purpose to make sure the tests catch them:

   | Planted bug | Result |
   |---|---|
   | Skip the daily share update | Caught |
   | Wrong start-of-day balance | Caught |
   | Sweep one day early | Caught |
   | Old NFT transfer ordering | Caught |

## Findings

| # | Severity | Finding | Status |
|---|---|---|---|
| 1 | **High** | Token: a stolen owner key could drain the run-reward pool. `setSigner` plus `setDailyClaimCap(any)` let the owner mint claims for any amount. | **Fixed.** Hard ceiling `MAX_DAILY_CLAIM_CAP` = 2,000,000 RUNNER/day. Even a stolen key can move at most 0.25% of the pool per day, giving time to react. |
| 2 | **Medium** | Token: `addPair` accepted any contract, so the owner could register a user's smart-contract wallet (e.g. a Safe) as a "pool". That wallet would be taxed on every transfer and cut out of holder rewards. | **Fixed.** `addPair` requires the contract to report RUNNER as `token0()` or `token1()`. Pools are add-only. |
| 3 | **Medium** | NFT: the ERC-721C validator was called after the ownership checks. A validator that re-enters `transferFrom` could move the token in between and corrupt the ownership records. A test reproduces this on the old code. | **Fixed.** The validator is called first, and every check reads state after it. |
| 4 | Medium (centralization) | Both contracts have one owner, the dev wallet EOA. Owner powers are listed below. If that key is lost or stolen, the NFT owner could freeze NFT transfers through a blocking validator, and the token owner could pause run claims or redirect the protocol share. | **Open: recommendation.** Make the owner a multisig (e.g. Safe 2-of-3) before launch, or at least keep the dev key on a hardware wallet. |
| 5 | Low | Token: trades through a pool before `addPair` is called are untaxed, so snipers could use the gap after liquidity is added. | **Open: operational.** Register the pool immediately after adding liquidity. The admin page has a button. |
| 6 | Low | Token: unclaimed holder rewards only move to the protocol when someone calls `sweepExpired`. They are already unclaimable after 7 days, but they sit in the contract until swept. | **Open: by design.** Anyone can sweep, and the admin page has a button. Bounded per call by `maxDays`. |
| 7 | Low | Server: the HR +10% bonus trusts heart-rate values sent by the phone. | **Open.** Small and bounded by energy. Could be disabled for real-token runs. |
| 8 | Low | Server: no rate limiting on `/api/rewards`. Spam costs function time but can't credit tokens. | **Open.** Add Vercel rate limiting or Upstash's rate-limit helper before a public launch. |
| 9 | Info | No server can fully stop GPS-spoofing apps. | Bounded by per-wallet energy (2–20 energy/day, 5 min each), the per-sneaker overlap lock and the token's daily claim cap. |
| 10 | Info | Fee-on-transfer tokens don't work in Uniswap-V3/V4-style pools, and V2 routers need the `…SupportingFeeOnTransferTokens` swap functions. Adding or removing liquidity after `addPair` is taxed 4% on the RUNNER side. | Documented. Use a V2-style pool and expect wallets and DEX UIs to need about 5% slippage. |
| 11 | Info | Holder rewards follow the chosen design: dev and team wallets are eligible, and the protocol wallet's tax income also counts once held for a full day. With 100M + 100M in those wallets, they take a large share of the 2% until tokens are distributed. | Product decision (confirmed by the owner). |
| 12 | Info | `block.timestamp` defines the UTC day. The sequencer can skew it by seconds. | Acceptable at daily granularity. |

### Slither triage

| Detector | Where | Verdict |
|---|---|---|
| `uninitialized-state` (`_checkpoints`) | token | False positive. The arrays are filled through a storage pointer (`cps.push`). |
| `incorrect-equality` (`== today`, `== day`) | token | Intended. These compare day numbers, not balances. |
| `timestamp` | token | Intended. Daily bookkeeping and claim deadlines (#12). |
| `missing-zero-check` (`setSigner`, `setTransferValidator`) | both | Intended. Zero means "off". |
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
- **Run rewards:** the server signs an EIP-712 `Claim(account, totalEarned, deadline)`. The contract pays `totalEarned − claimed[account]`. Low-s signatures only, with the chain id and contract in the domain, a deadline, and a daily cap with a hard ceiling.

### Owner powers (complete list)

| Contract | Function | Effect | Limits |
|---|---|---|---|
| Token | `addPair` | Taxes trades through a pool and excludes it from holder rewards | Real RUNNER pools only, add-only |
| Token | `setProtocolWallet` | Where the 2% protocol tax and expired holder rewards go | — |
| Token | `setSigner` | The rewards server key (zero disables claims) | Daily cap |
| Token | `setClaimsPaused` | Pause run-reward claims | Doesn't affect transfers or holder rewards |
| Token | `setDailyClaimCap` | Run-reward claims per day | ≤ 2,000,000 |
| Token | `transferOwnership` | Hand over ownership | — |
| NFT | `setPaused` | Pause minting | Transfers unaffected |
| NFT | `setTreasury`, `setRoyaltyReceiver` | Where mint payments and the 5% royalty go | — |
| NFT | `setBaseURI`, `setContractURI` | Metadata links | — |
| NFT | `setTransferValidator` | Royalty enforcement (OpenSea). A malicious validator could block transfers. | See #4 |
| NFT | `withdraw` | Sweep stray ETH to the treasury | Mint payments never stay in the contract |

Nobody, including the owner, can change the tax, mint tokens, or take tokens out of the run-reward pool or the holder-reward bucket.

## Before mainnet

1. Get an independent audit of `RunnerToken.sol` above all, since it has the most novel logic.
2. Move ownership of both contracts to a multisig, or at minimum a hardware wallet.
3. Choose a Uniswap-V2-style DEX on Robinhood Chain and confirm it supports fee-on-transfer swaps.
4. Launch sequence: deploy → add liquidity → **register the pool right away** → set up the rewards server → `setSigner`.
5. Add rate limiting to `/api/rewards`.
6. Get legal advice on a tradable token with a holder-reward mechanism in Indonesia (OJK).

## Re-running

```
cd tests && npm install
node token.test.mjs && node nft.test.mjs && node rewards-server.test.mjs ..
```
