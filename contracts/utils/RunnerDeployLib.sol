// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {TickMath} from "v4-core/src/libraries/TickMath.sol";
import {FullMath} from "v4-core/src/libraries/FullMath.sol";

/// @notice Helpers shared by deploy tooling and tests (from PepesFamily DeployLib).
library RunnerDeployLib {
    uint256 internal constant TOTAL_SUPPLY = 1_000_000_000e18;
    int24 internal constant TICK_SPACING = 200;

    /// @notice Start tick (tick of RUNNER-per-IMD) for a starting market cap of `marketCap` quote wei.
    ///         Rounded down to the tick spacing, so the real start is at most ~2% above the target.
    function startTickForMarketCap(uint256 marketCap) internal pure returns (int24 tick) {
        return startTickForMarketCap(marketCap, TOTAL_SUPPLY);
    }

    /// @notice Same for a token with `supply`.
    function startTickForMarketCap(uint256 marketCap, uint256 supply) internal pure returns (int24 tick) {
        uint256 sqrtPriceX96 = sqrt(FullMath.mulDiv(supply, 1 << 192, marketCap));
        tick = TickMath.getTickAtSqrtPrice(uint160(sqrtPriceX96));
        int24 rem = tick % TICK_SPACING;
        tick -= rem < 0 ? rem + TICK_SPACING : rem;
    }

    /// @notice Finds a CREATE2 salt whose address carries exactly `flags` in its low 14 bits.
    function mineSalt(address deployer, uint160 flags, bytes memory initCode, uint256 start)
        internal
        pure
        returns (bytes32 salt, address hook)
    {
        bytes32 initCodeHash = keccak256(initCode);
        for (uint256 i = start; i < start + 500_000; i++) {
            hook = address(uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), deployer, bytes32(i), initCodeHash)))));
            if (uint160(hook) & 0x3FFF == flags) return (bytes32(i), hook);
        }
        revert("RunnerDeployLib: no salt found");
    }

    function sqrt(uint256 x) internal pure returns (uint256 z) {
        // Uniswap v2's Math.sqrt: x/2 + 1 is an upper bound only for x > 3, so 1..3 are special-cased (fifth audit, #2).
        if (x > 3) {
            z = x;
            uint256 y = (x >> 1) + 1;
            while (y < z) {
                z = y;
                y = (x / y + y) >> 1;
            }
        } else if (x != 0) {
            z = 1;
        }
    }
}
