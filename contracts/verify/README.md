# Verifying RUNNER's contracts on Blockscout

Everything needed to publish the source of the five live contracts on
[robinhoodchain.blockscout.com](https://robinhoodchain.blockscout.com). Each
`*.standard-input.json` was compiled with the compiler below and matches the
deployed code byte for byte (immutables aside).

| Contract | Address | Compiler | Standard-JSON input | Contract name | Constructor args |
|---|---|---|---|---|---|
| RUNNER token | `0x52cE7fC26a4Bb4B8aFef02C1b00486FDF4Bb804e` | v0.8.24+commit.e11b9ed9 | `RunnerToken.standard-input.json` | `RunnerToken` | `RunnerToken.constructor-args.txt` |
| RUNNER Genesis NFT | `0x7ded256c6646630dFcf15317aeB7cF40027932CC` | v0.8.24+commit.e11b9ed9 | `RunnerGenesis.standard-input.json` | `RunnerGenesis` | `RunnerGenesis.constructor-args.txt` |
| RunnerHook | `0x962c745D5feC4BC0Fd6dE15D47fc17C40C4c68EC` | v0.8.26+commit.8a97fa7a | `RunnerHook.standard-input.json` | `RunnerHook` | `RunnerHook.constructor-args.txt` |
| RunnerRouter | `0x55866De8BD1e5Fbf79433Ee2526D3405F64692Ba` | v0.8.26+commit.8a97fa7a | `RunnerHook.standard-input.json` (same file) | `RunnerRouter` | `RunnerRouter.constructor-args.txt` |
| RunnerEthRouter | `0xcAc6938E8309Dc9687C82DFb745B21950Fe0F6A1` | v0.8.26+commit.8a97fa7a | `RunnerHook.standard-input.json` (same file) | `RunnerEthRouter` | `RunnerEthRouter.constructor-args.txt` |

## Steps (for each contract)

1. Open `https://robinhoodchain.blockscout.com/address/<address>` → **Contract** tab → **Verify & publish**.
2. Verification method: **Solidity (Standard JSON input)**.
3. Compiler: pick the exact version from the table (include nightly builds off).
4. Upload the standard-JSON file from this folder.
5. If asked for the contract name, use the one in the table. If asked for constructor arguments,
   paste the contents of the matching `*.constructor-args.txt` (hex, no `0x`).
6. License: **MIT**. Submit and wait for "verified".

The two routers were created by the hook's constructor, so Blockscout may not detect their
constructor arguments by itself — paste them from the files.

## Settings, for reference

- Token and NFT: optimizer on, 200 runs, EVM `paris`, single source file (compiled in the browser
  by `admin.html`).
- Hook and routers: optimizer on, 200 runs, `viaIR`, EVM `cancun`, `bytecodeHash: none`
  (Foundry, v4-core `46c6834`). Regenerate with
  `forge verify-contract <hook> contracts/RunnerHook.sol:RunnerHook --show-standard-json-input --chain 4663 --compiler-version 0.8.26`.
