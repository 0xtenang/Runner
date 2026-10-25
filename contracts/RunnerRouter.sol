// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {TickMath} from "v4-core/src/libraries/TickMath.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {Currency} from "v4-core/src/types/Currency.sol";
import {BalanceDelta} from "v4-core/src/types/BalanceDelta.sol";
import {SwapParams} from "v4-core/src/types/PoolOperation.sol";

import {SafeTransfer} from "./utils/SafeTransfer.sol";

/// @dev The part of RunnerHook the routers use (same shape as the PepesFamily launchpad interface).
interface IRunnerPool {
    function poolKey(address token) external view returns (PoolKey memory);
    function launches(address token)
        external
        view
        returns (address quote, address creator, uint64 createdAt, uint64 createdBlock, bool quoteIsCurrency0);
    function flush(address token) external;
}

/// @title RunnerRouter
/// @notice Buy and sell RUNNER with IMD in the RunnerHook's Uniswap v4 pool. Deployed by RunnerHook.
///         The hook charges its 4% exactly as for any other router; this router also forwards the holder
///         share on every trade, so holders are credited straight away. Adapted from PepesFamilyRouter.
contract RunnerRouter is IUnlockCallback {
    using SafeTransfer for address;

    error NotPoolManager();
    error Slippage();
    error Expired();
    error BadAmount();

    IPoolManager public immutable poolManager;
    IRunnerPool public immutable pad;

    struct SwapData {
        address user;
        address token;
        PoolKey key;
        bool zeroForOne;
        uint256 amountIn;
        uint256 minOut;
    }

    constructor(IPoolManager poolManager_, address pad_) {
        poolManager = poolManager_;
        pad = IRunnerPool(pad_);
    }

    modifier checkDeadline(uint256 deadline) {
        if (block.timestamp > deadline) revert Expired();
        _;
    }

    /// @notice Buy RUNNER with IMD (approve this router for `amountIn` IMD first). To pay with ETH use RunnerEthRouter.
    function buy(address token, uint256 amountIn, uint256 minTokensOut, uint256 deadline)
        external
        checkDeadline(deadline)
        returns (uint256 tokensOut)
    {
        return _swap(token, true, amountIn, minTokensOut);
    }

    /// @notice Sell RUNNER for IMD. Approve this router for `tokenAmount` RUNNER first.
    function sell(address token, uint256 tokenAmount, uint256 minQuoteOut, uint256 deadline)
        external
        checkDeadline(deadline)
        returns (uint256 quoteOut)
    {
        return _swap(token, false, tokenAmount, minQuoteOut);
    }

    function _swap(address token, bool isBuy, uint256 amountIn, uint256 minOut) internal returns (uint256 out) {
        if (amountIn == 0 || amountIn > uint256(type(int256).max)) revert BadAmount();
        (,,,, bool quoteIs0) = pad.launches(token);
        SwapData memory data = SwapData({
            user: msg.sender,
            token: token,
            key: pad.poolKey(token),
            zeroForOne: isBuy == quoteIs0, // buying = paying IMD in
            amountIn: amountIn,
            minOut: minOut
        });
        out = abi.decode(poolManager.unlock(abi.encode(data)), (uint256));
    }

    function unlockCallback(bytes calldata raw) external returns (bytes memory) {
        if (msg.sender != address(poolManager)) revert NotPoolManager();
        SwapData memory d = abi.decode(raw, (SwapData));

        BalanceDelta delta = poolManager.swap(
            d.key,
            SwapParams({
                zeroForOne: d.zeroForOne,
                amountSpecified: -int256(d.amountIn),
                sqrtPriceLimitX96: d.zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1
            }),
            abi.encode(d.user)
        );
        (Currency cIn, Currency cOut) = d.zeroForOne ? (d.key.currency0, d.key.currency1) : (d.key.currency1, d.key.currency0);
        (int128 dIn, int128 dOut) = d.zeroForOne ? (delta.amount0(), delta.amount1()) : (delta.amount1(), delta.amount0());
        uint256 owed = uint256(int256(-dIn));
        uint256 out = uint256(int256(dOut));
        if (out < d.minOut || out == 0) revert Slippage();

        poolManager.sync(cIn);
        Currency.unwrap(cIn).transferFrom(d.user, address(poolManager), owed);
        poolManager.settle();

        // Credit holders before the buyer receives tokens (and after the seller's tokens left).
        try pad.flush(d.token) {} catch {} // reward delivery never blocks a trade (fourth audit, #5)

        poolManager.take(cOut, d.user, out);
        return abi.encode(out);
    }
}
