// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "v4-core/src/interfaces/IHooks.sol";
import {IUnlockCallback} from "v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {Hooks} from "v4-core/src/libraries/Hooks.sol";
import {TickMath} from "v4-core/src/libraries/TickMath.sol";
import {FullMath} from "v4-core/src/libraries/FullMath.sol";
import {Pool} from "v4-core/src/libraries/Pool.sol";
import {SafeCast} from "v4-core/src/libraries/SafeCast.sol";
import {StateLibrary} from "v4-core/src/libraries/StateLibrary.sol";
import {TransientStateLibrary} from "v4-core/src/libraries/TransientStateLibrary.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {PoolId} from "v4-core/src/types/PoolId.sol";
import {Currency} from "v4-core/src/types/Currency.sol";
import {BalanceDelta} from "v4-core/src/types/BalanceDelta.sol";
import {BeforeSwapDelta, BeforeSwapDeltaLibrary, toBeforeSwapDelta} from "v4-core/src/types/BeforeSwapDelta.sol";
import {SwapParams, ModifyLiquidityParams} from "v4-core/src/types/PoolOperation.sol";

import {RunnerRouter} from "./RunnerRouter.sol";
import {RunnerEthRouter} from "./RunnerEthRouter.sol";
import {SafeTransfer} from "./utils/SafeTransfer.sol";

/// @dev The parts of RunnerToken (contracts/RunnerToken.sol, solc 0.8.24) this hook reads and calls.
interface IRunnerToken {
    function hook() external view returns (address);
    function poolManager() external view returns (address);
    function rewardToken() external view returns (address);
    function balanceOf(address) external view returns (uint256);
    function totalSupply() external view returns (uint256);
    function name() external view returns (string memory);
    function symbol() external view returns (string memory);
    function totalHolderRewards() external view returns (uint256);
    function syncHolderRewards() external returns (uint256);
}

/// @title RunnerHook
/// @notice Pool owner and Uniswap v4 hook for RUNNER. It opens one RUNNER/IMD pool, once, and adds the
///         100,000,000 RUNNER liquidity allocation as single-sided liquidity that it has no way to remove
///         (locked forever; nobody else can add liquidity to this pool either). Every swap pays 4% of its
///         IMD side, so the whole trading fee is paid in IMD:
///           - 2% protocol fee -> `feeRecipient`
///           - 2% holder fee   -> RunnerToken, which shares each day's IMD among wallets that held at
///                                least 300,000 RUNNER all day (see RunnerToken)
///         Exposes the PepesFamily launchpad interface (`launches`, `poolKey`, `flush`) used by the routers.
///         Adapted from PepesFamily's audited PepesEarnIMD.
/// @dev Must be deployed at an address whose low 14 bits equal `HOOK_FLAGS` (mine a CREATE2 salt).
contract RunnerHook is IHooks, IUnlockCallback {
    using StateLibrary for IPoolManager;
    using TransientStateLibrary for IPoolManager;
    using SafeTransfer for address;
    using SafeCast for uint256;

    error NotPoolManager();
    error NotOwner();
    error UnknownToken();
    error AlreadyLaunched();
    error BadToken();
    error BadTick();
    error ZeroAddress();
    error HookNotAllowed();
    error PartialFill();
    error EmptySwap();

    event PoolOpened(address indexed token, PoolId poolId, int24 startTick);
    /// @param quoteAmount IMD paid by the buyer / received by the seller, fee included
    event Trade(
        address indexed token,
        address indexed trader,
        bool isBuy,
        uint256 quoteAmount,
        uint256 tokenAmount,
        uint256 fee,
        uint160 sqrtPriceX96
    );
    event HolderFeesFlushed(address indexed token, uint256 amount);
    event ProtocolFeesCollected(address indexed quote, address indexed to, uint256 amount);
    event FeeRecipientUpdated(address feeRecipient);
    event OwnershipTransferStarted(address indexed previousOwner, address indexed newOwner);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    uint256 public constant BPS = 10_000;
    uint256 public constant FEE_BPS = 400; // 4% of the IMD side of every swap
    uint256 public constant PROTOCOL_FEE_BPS = 200; // 2% of the trade; the other 2% goes to holders
    uint256 public constant TOTAL_SUPPLY = 1_000_000_000e18;
    uint256 public constant LIQUIDITY_ALLOCATION = 100_000_000e18;
    int24 public constant TICK_SPACING = 200;
    uint24 public constant LP_FEE = 0; // all fees are taken by the hook
    uint160 public constant HOOK_FLAGS = Hooks.BEFORE_INITIALIZE_FLAG | Hooks.BEFORE_ADD_LIQUIDITY_FLAG
        | Hooks.BEFORE_SWAP_FLAG | Hooks.AFTER_SWAP_FLAG | Hooks.BEFORE_SWAP_RETURNS_DELTA_FLAG
        | Hooks.AFTER_SWAP_RETURNS_DELTA_FLAG;

    address internal constant DEAD = 0x000000000000000000000000000000000000dEaD;
    /// @dev Kept out of the liquidity calculation so rounding can never ask for more than the allocation; burned.
    uint256 internal constant LIQUIDITY_BUFFER = 1e9;
    uint256 internal constant Q96 = 2 ** 96;
    /// @dev keccak256("RunnerHook.beforeSwapFee") - transient slot passing the fee from beforeSwap to afterSwap.
    bytes32 internal constant FEE_SLOT = 0x28baa35100d667bab0bee4bc31d18554fb1064b3cf83d98a387acfd32e23f9d4;

    uint8 internal constant ACTION_ADD_LIQUIDITY = 0;
    uint8 internal constant ACTION_FLUSH = 1;
    uint8 internal constant ACTION_COLLECT = 2;

    IPoolManager public immutable poolManager;
    address public immutable IMD;
    address public immutable router;
    address public immutable ethRouter;
    /// @notice Launch tick, expressed as the tick of (RUNNER per IMD). Sets the starting price.
    int24 public immutable startTick;

    address public owner;
    address public pendingOwner;
    address public feeRecipient;
    /// @notice The RUNNER token, once the pool is open.
    address public token;

    struct ImdEthPool {
        uint24 fee;
        int24 tickSpacing;
        address hooks;
    }

    struct Launch {
        address quote;
        address creator;
        uint64 createdAt;
        uint64 createdBlock;
        bool quoteIsCurrency0;
    }

    /// @dev Same layout as PepesFamily.TokenInfo, so tools that read PepesFamily read this the same way.
    struct TokenInfo {
        address token;
        string name;
        string symbol;
        string metadata;
        address quote;
        address creator;
        uint64 createdAt;
        uint64 createdBlock;
        bool quoteIsCurrency0;
        PoolId poolId;
        uint160 sqrtPriceX96;
        uint256 marketCap;
        uint256 pendingHolderFees;
        uint256 totalDividendsDistributed;
    }

    mapping(address token => Launch) public launches;
    mapping(PoolId => address) public tokenOfPool;

    mapping(address token => uint256) public pendingHolderFees;
    mapping(address quote => uint256) public pendingProtocolFees;

    modifier onlyPoolManager() {
        if (msg.sender != address(poolManager)) revert NotPoolManager();
        _;
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(
        IPoolManager poolManager_,
        address imd,
        address owner_,
        address feeRecipient_,
        int24 startTick_,
        ImdEthPool memory imdEthPool
    ) {
        if (address(poolManager_) == address(0) || imd == address(0) || owner_ == address(0) || feeRecipient_ == address(0)) {
            revert ZeroAddress();
        }
        int24 limit = TickMath.maxUsableTick(TICK_SPACING) - TICK_SPACING;
        if (startTick_ % TICK_SPACING != 0 || startTick_ > limit || startTick_ < -limit) revert BadTick();
        // The launch liquidity must fit in a v4 tick whichever way the pair sorts (RUNNER's address isn't known
        // yet); otherwise openPool would always revert after the allocation is minted here (third audit, #3).
        uint256 maxL = Pool.tickSpacingToMaxLiquidityPerTick(TICK_SPACING);
        (,, uint256 l1) = _launchRange(startTick_, true);
        (,, uint256 l0) = _launchRange(-startTick_, false);
        if (l1 > maxL || l0 > maxL) revert BadTick();
        Hooks.validateHookPermissions(
            IHooks(address(this)),
            Hooks.Permissions({
                beforeInitialize: true,
                afterInitialize: false,
                beforeAddLiquidity: true,
                afterAddLiquidity: false,
                beforeRemoveLiquidity: false,
                afterRemoveLiquidity: false,
                beforeSwap: true,
                afterSwap: true,
                beforeDonate: false,
                afterDonate: false,
                beforeSwapReturnDelta: true,
                afterSwapReturnDelta: true,
                afterAddLiquidityReturnDelta: false,
                afterRemoveLiquidityReturnDelta: false
            })
        );
        poolManager = poolManager_;
        IMD = imd;
        owner = owner_;
        feeRecipient = feeRecipient_;
        startTick = startTick_;
        router = address(new RunnerRouter(poolManager_, address(this)));
        ethRouter = address(
            new RunnerEthRouter(poolManager_, address(this), imd, imdEthPool.fee, imdEthPool.tickSpacing, imdEthPool.hooks)
        );
        emit OwnershipTransferred(address(0), owner_);
        emit FeeRecipientUpdated(feeRecipient_);
    }

    // --------------------------------------------------------------- Launch

    /// @notice One-time: opens the RUNNER/IMD pool and locks the 100M RUNNER liquidity allocation in it.
    function openPool(address token_) external onlyOwner {
        if (token != address(0)) revert AlreadyLaunched();
        IRunnerToken t = IRunnerToken(token_);
        if (
            t.hook() != address(this) || t.poolManager() != address(poolManager) || t.rewardToken() != IMD
                || t.balanceOf(address(this)) < LIQUIDITY_ALLOCATION
        ) revert BadToken(); // at least 100M: dust sent here is burned with the rounding buffer (third audit, #2)

        token = token_;
        bool quoteIs0 = uint160(IMD) < uint160(token_);
        launches[token_] = Launch({
            quote: IMD,
            creator: msg.sender,
            createdAt: uint64(block.timestamp),
            createdBlock: _l2BlockNumber(),
            quoteIsCurrency0: quoteIs0
        });

        PoolKey memory key = poolKey(token_);
        PoolId id = key.toId();
        tokenOfPool[id] = token_;

        // Price is currency1 per currency0: with RUNNER as currency1 that is tokens-per-IMD (= startTick).
        int24 tick = quoteIs0 ? startTick : -startTick;
        poolManager.initialize(key, TickMath.getSqrtPriceAtTick(tick));
        poolManager.unlock(abi.encode(ACTION_ADD_LIQUIDITY, abi.encode(key, token_, tick, quoteIs0)));

        emit PoolOpened(token_, id, tick);
    }

    /// @dev Single-sided range and liquidity for the launch allocation at `tick` (RUNNER as currency1 or 0).
    function _launchRange(int24 tick, bool tokenIs1) internal pure returns (int24 lower, int24 upper, uint256 liquidity) {
        (lower, upper) = tokenIs1
            ? (TickMath.minUsableTick(TICK_SPACING), tick)
            : (tick, TickMath.maxUsableTick(TICK_SPACING));
        uint256 sqrtL = TickMath.getSqrtPriceAtTick(lower);
        uint256 sqrtU = TickMath.getSqrtPriceAtTick(upper);
        uint256 amount = LIQUIDITY_ALLOCATION - LIQUIDITY_BUFFER;
        liquidity = tokenIs1
            ? FullMath.mulDiv(amount, Q96, sqrtU - sqrtL)
            : FullMath.mulDiv(amount, FullMath.mulDiv(sqrtL, sqrtU, Q96), sqrtU - sqrtL);
    }

    function _addLaunchLiquidity(PoolKey memory key, address token_, int24 tick, bool tokenIs1) internal {
        (int24 lower, int24 upper, uint256 liquidity) = _launchRange(tick, tokenIs1);

        (BalanceDelta delta,) = poolManager.modifyLiquidity(
            key,
            ModifyLiquidityParams({tickLower: lower, tickUpper: upper, liquidityDelta: int256(liquidity), salt: 0}),
            ""
        );
        uint256 owed = uint256(-int256(tokenIs1 ? delta.amount1() : delta.amount0()));
        poolManager.sync(Currency.wrap(token_));
        token_.transferOut(address(poolManager), owed);
        poolManager.settle();
        token_.transferOut(DEAD, IRunnerToken(token_).balanceOf(address(this)));
    }

    // ------------------------------------------------------------ Hook

    function beforeSwap(address, PoolKey calldata key, SwapParams calldata params, bytes calldata)
        external
        onlyPoolManager
        returns (bytes4, BeforeSwapDelta, uint24)
    {
        address t = tokenOfPool[key.toId()];
        bool exactIn = params.amountSpecified < 0;
        // Fee is taken here only when IMD is the swap's specified currency.
        if ((exactIn == params.zeroForOne) != launches[t].quoteIsCurrency0) {
            return (IHooks.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, 0);
        }
        uint256 amount = exactIn ? uint256(-params.amountSpecified) : uint256(params.amountSpecified);
        // exact-in buy: 4% of what the buyer pays. exact-out sell: 4% of the gross the pool pays out.
        uint256 fee = _feeOf(amount, exactIn);
        _chargeFee(t, fee);
        assembly ("memory-safe") {
            tstore(FEE_SLOT, fee)
        }
        return (IHooks.beforeSwap.selector, toBeforeSwapDelta(fee.toInt128(), 0), 0);
    }

    function afterSwap(
        address sender,
        PoolKey calldata key,
        SwapParams calldata params,
        BalanceDelta delta,
        bytes calldata hookData
    ) external onlyPoolManager returns (bytes4, int128 hookDelta) {
        address t = tokenOfPool[key.toId()];
        bool quoteIs0 = launches[t].quoteIsCurrency0;
        bool exactIn = params.amountSpecified < 0;
        int128 q = quoteIs0 ? delta.amount0() : delta.amount1();
        int128 tk = quoteIs0 ? delta.amount1() : delta.amount0();
        uint256 poolQuote = uint256(int256(q < 0 ? -q : q));
        uint256 tokenAmount = uint256(int256(tk < 0 ? -tk : tk));

        // A swap that moved nothing (e.g. a sell when the pool holds no IMD) would only push the price to the
        // tick limit for free; refuse it (fourth audit, #1).
        if (poolQuote == 0 || tokenAmount == 0) revert EmptySwap();
        uint256 fee;
        if ((exactIn == params.zeroForOne) == quoteIs0) {
            assembly ("memory-safe") {
                fee := tload(FEE_SLOT)
                tstore(FEE_SLOT, 0)
            }
            // The fee was fixed from the requested IMD before the swap. Refuse a partial fill (price limit,
            // or an exact-out sell beyond the pool's IMD), so the fee is always exactly 4% of what traded
            // (third audit, #1): exact-in buy -> the pool took amount - fee; exact-out sell -> it paid amount + fee.
            uint256 amount = exactIn ? uint256(-params.amountSpecified) : uint256(params.amountSpecified);
            if (poolQuote != (exactIn ? amount - fee : amount + fee)) revert PartialFill();
        } else {
            // IMD is the unspecified side. exact-in sell: 4% of the pool's output.
            // exact-out buy: 4% of what the buyer pays in total.
            fee = _feeOf(poolQuote, exactIn);
            _chargeFee(t, fee);
            hookDelta = fee.toInt128();
        }

        bool isBuy = params.zeroForOne == quoteIs0;
        address trader =
            (sender == router || sender == ethRouter) && hookData.length == 32 ? abi.decode(hookData, (address)) : tx.origin;
        emit Trade(t, trader, isBuy, isBuy ? poolQuote + fee : poolQuote - fee, tokenAmount, fee, _price(t));
        return (IHooks.afterSwap.selector, hookDelta);
    }

    /// @dev 4% of the IMD side, rounded up so even the smallest trade pays (fourth audit, #7). Exact-in: 4% of
    ///      the amount; exact-out: 4% of the gross, i.e. amount * 4 / 96.
    function _feeOf(uint256 amount, bool exactIn) internal pure returns (uint256) {
        uint256 den = exactIn ? BPS : BPS - FEE_BPS;
        return (amount * FEE_BPS + den - 1) / den;
    }

    /// @dev The hook is credited `fee` by the swap; minting claims of the same size settles that credit.
    function _chargeFee(address t, uint256 fee) internal {
        if (fee == 0) return;
        uint256 protocolFee = (fee * PROTOCOL_FEE_BPS) / FEE_BPS;
        pendingProtocolFees[IMD] += protocolFee;
        pendingHolderFees[t] += fee - protocolFee;
        poolManager.mint(address(this), Currency.wrap(IMD).toId(), fee);
    }

    // ------------------------------------------------------------ Fee flows

    /// @notice Sends pending holder fees (IMD) to RunnerToken, which books them as today's holder rewards.
    function flush(address t) external {
        if (pendingHolderFees[t] == 0) return;
        if (poolManager.isUnlocked()) {
            // Mid-unlock, only our routers (which control their whole unlock) may distribute.
            if (msg.sender == router || msg.sender == ethRouter) _flush(t);
        } else {
            poolManager.unlock(abi.encode(ACTION_FLUSH, abi.encode(t)));
        }
    }

    /// @notice Sends pending protocol fees (IMD) to `feeRecipient`. Callable by anyone.
    function collectProtocolFees(address quote) external {
        if (pendingProtocolFees[quote] == 0) return;
        if (poolManager.isUnlocked()) _collect(quote);
        else poolManager.unlock(abi.encode(ACTION_COLLECT, abi.encode(quote)));
    }

    function _flush(address t) internal {
        uint256 amount = pendingHolderFees[t];
        if (amount == 0) return;
        pendingHolderFees[t] = 0;
        poolManager.burn(address(this), Currency.wrap(IMD).toId(), amount);
        poolManager.take(Currency.wrap(IMD), t, amount);
        IRunnerToken(t).syncHolderRewards();
        emit HolderFeesFlushed(t, amount);
    }

    function _collect(address quote) internal {
        uint256 amount = pendingProtocolFees[quote];
        if (amount == 0) return;
        pendingProtocolFees[quote] = 0;
        poolManager.burn(address(this), Currency.wrap(quote).toId(), amount);
        poolManager.take(Currency.wrap(quote), feeRecipient, amount);
        emit ProtocolFeesCollected(quote, feeRecipient, amount);
    }

    function unlockCallback(bytes calldata data) external onlyPoolManager returns (bytes memory) {
        (uint8 action, bytes memory payload) = abi.decode(data, (uint8, bytes));
        if (action == ACTION_ADD_LIQUIDITY) {
            (PoolKey memory key, address t, int24 tick, bool tokenIs1) =
                abi.decode(payload, (PoolKey, address, int24, bool));
            _addLaunchLiquidity(key, t, tick, tokenIs1);
        } else if (action == ACTION_FLUSH) {
            _flush(abi.decode(payload, (address)));
        } else {
            _collect(abi.decode(payload, (address)));
        }
        return "";
    }

    /// @dev On Arbitrum chains (Robinhood Chain) `block.number` is the L1 block; ArbSys gives the L2 block.
    function _l2BlockNumber() internal view returns (uint64) {
        (bool ok, bytes memory data) = address(100).staticcall(abi.encodeWithSignature("arbBlockNumber()"));
        return ok && data.length == 32 ? uint64(abi.decode(data, (uint256))) : uint64(block.number);
    }

    // ---------------------------------------------------------------- Admin

    function setFeeRecipient(address feeRecipient_) external onlyOwner {
        // IMD sent to the hook would be stuck, and sent to the PoolManager it would vanish (fourth audit, #3).
        if (feeRecipient_ == address(0) || feeRecipient_ == address(this) || feeRecipient_ == address(poolManager)) revert ZeroAddress();
        feeRecipient = feeRecipient_;
        emit FeeRecipientUpdated(feeRecipient_);
    }

    /// @notice Two-step transfer: `newOwner` must call `acceptOwnership`, so a typo can't lose the admin role.
    ///         address(0) cancels a pending proposal.
    function transferOwnership(address newOwner) external onlyOwner {
        pendingOwner = newOwner;
        emit OwnershipTransferStarted(owner, newOwner);
    }

    function acceptOwnership() external {
        if (msg.sender != pendingOwner) revert NotOwner();
        emit OwnershipTransferred(owner, msg.sender);
        owner = msg.sender;
        pendingOwner = address(0);
    }

    // ---------------------------------------------------------------- Views

    function metadata() public pure returns (string memory) {
        return
        '{"description":"RUNNER: the run-to-earn token of the RUNNER app. Every trade pays 4% in IMD: 2% to RUNNER holders (300,000+ held all day) and 2% to the protocol. Liquidity is locked forever.","website":"https://runearn.fun"}';
    }

    function poolKey(address t) public view returns (PoolKey memory key) {
        Launch storage l = launches[t];
        if (l.createdAt == 0) revert UnknownToken();
        (address c0, address c1) = l.quoteIsCurrency0 ? (l.quote, t) : (t, l.quote);
        key = PoolKey({
            currency0: Currency.wrap(c0),
            currency1: Currency.wrap(c1),
            fee: LP_FEE,
            tickSpacing: TICK_SPACING,
            hooks: IHooks(address(this))
        });
    }

    /// @notice Pool price (sqrtPriceX96). When sells have pushed the price past the launch position (the pool
    ///         holds no IMD), the real price is the launch price, so that is reported (fourth audit, #1).
    function _price(address t) internal view returns (uint160 sqrtP) {
        int24 tick;
        (sqrtP, tick,,) = poolManager.getSlot0(poolKey(t).toId());
        bool quoteIs0 = launches[t].quoteIsCurrency0;
        int24 launchTick = quoteIs0 ? startTick : -startTick;
        if (quoteIs0 ? tick > launchTick : tick < launchTick) sqrtP = TickMath.getSqrtPriceAtTick(launchTick);
    }

    /// @notice Fully diluted market cap in IMD wei at the current pool price, using the live supply (burns count).
    function marketCap(address t) public view returns (uint256) {
        uint160 sqrtP = _price(t);
        uint256 supply = IRunnerToken(t).totalSupply();
        return launches[t].quoteIsCurrency0
            ? FullMath.mulDiv(FullMath.mulDiv(supply, Q96, sqrtP), Q96, sqrtP)
            : FullMath.mulDiv(FullMath.mulDiv(supply, sqrtP, Q96), sqrtP, Q96);
    }

    function getTokenInfo(address t) public view returns (TokenInfo memory info) {
        Launch storage l = launches[t];
        PoolId id = poolKey(t).toId();
        uint160 sqrtP = _price(t);
        IRunnerToken r = IRunnerToken(t);
        info = TokenInfo({
            token: t,
            name: r.name(),
            symbol: r.symbol(),
            metadata: metadata(),
            quote: l.quote,
            creator: l.creator,
            createdAt: l.createdAt,
            createdBlock: l.createdBlock,
            quoteIsCurrency0: l.quoteIsCurrency0,
            poolId: id,
            sqrtPriceX96: sqrtP,
            marketCap: marketCap(t),
            pendingHolderFees: pendingHolderFees[t],
            totalDividendsDistributed: r.totalHolderRewards()
        });
    }

    // ------------------------------------------------- Disabled hook paths
    // The PoolManager skips hook calls made by the hook itself, so only this contract can initialize the
    // pool and add (never remove) its liquidity; everyone else is refused.

    function beforeInitialize(address, PoolKey calldata, uint160) external pure returns (bytes4) {
        revert HookNotAllowed();
    }

    function beforeAddLiquidity(address, PoolKey calldata, ModifyLiquidityParams calldata, bytes calldata)
        external
        pure
        returns (bytes4)
    {
        revert HookNotAllowed();
    }

    function afterInitialize(address, PoolKey calldata, uint160, int24) external pure returns (bytes4) {
        revert HookNotAllowed();
    }

    function afterAddLiquidity(
        address,
        PoolKey calldata,
        ModifyLiquidityParams calldata,
        BalanceDelta,
        BalanceDelta,
        bytes calldata
    ) external pure returns (bytes4, BalanceDelta) {
        revert HookNotAllowed();
    }

    function beforeRemoveLiquidity(address, PoolKey calldata, ModifyLiquidityParams calldata, bytes calldata)
        external
        pure
        returns (bytes4)
    {
        revert HookNotAllowed();
    }

    function afterRemoveLiquidity(
        address,
        PoolKey calldata,
        ModifyLiquidityParams calldata,
        BalanceDelta,
        BalanceDelta,
        bytes calldata
    ) external pure returns (bytes4, BalanceDelta) {
        revert HookNotAllowed();
    }

    function beforeDonate(address, PoolKey calldata, uint256, uint256, bytes calldata)
        external
        pure
        returns (bytes4)
    {
        revert HookNotAllowed();
    }

    function afterDonate(address, PoolKey calldata, uint256, uint256, bytes calldata)
        external
        pure
        returns (bytes4)
    {
        revert HookNotAllowed();
    }
}
