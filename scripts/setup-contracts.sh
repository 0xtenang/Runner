#!/bin/sh
# Fetches the Solidity libraries the RunnerHook build and Foundry tests use, at the exact
# commits PepesFamily (the audited reference) builds against. Run from the repo root.
set -e
mkdir -p lib && cd lib
fetch() { [ -d "$1" ] || git clone -q --filter=blob:none "$2" "$1"; git -C "$1" checkout -q "$3"; }
fetch v4-core   https://github.com/Uniswap/v4-core              46c6834698c48bc4a463a86d8420f4eb1d7f3b75
fetch forge-std https://github.com/foundry-rs/forge-std          f3dae6e6ee381f25eb6a246f7da9b85c91a68219
fetch solmate   https://github.com/transmissions11/solmate       4b47a19038b798b4a33d9749d25e570443520647
echo "lib ready"
