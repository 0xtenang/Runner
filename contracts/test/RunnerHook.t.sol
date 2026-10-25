// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test, Vm} from "forge-std/Test.sol";
import {PoolManager} from "v4-core/src/PoolManager.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "v4-core/src/interfaces/IHooks.sol";
import {IUnlockCallback} from "v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {PoolSwapTest} from "v4-core/src/test/PoolSwapTest.sol";
import {PoolModifyLiquidityTest} from "v4-core/src/test/PoolModifyLiquidityTest.sol";
import {PoolDonateTest} from "v4-core/src/test/PoolDonateTest.sol";
import {TickMath} from "v4-core/src/libraries/TickMath.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {Currency} from "v4-core/src/types/Currency.sol";
import {StateLibrary} from "v4-core/src/libraries/StateLibrary.sol";
import {SwapParams, ModifyLiquidityParams} from "v4-core/src/types/PoolOperation.sol";

import {RunnerHook} from "../RunnerHook.sol";
import {RunnerRouter} from "../RunnerRouter.sol";
import {RunnerEthRouter} from "../RunnerEthRouter.sol";
import {RunnerDeployLib} from "../utils/RunnerDeployLib.sol";
import {MockIMD} from "./Mocks.sol";

/// @dev RunnerToken is compiled with solc 0.8.24 (contracts/RunnerToken.sol); tests reach it through this interface.
interface IRunner {
    function balanceOf(address) external view returns (uint256);
    function totalSupply() external view returns (uint256);
    function transfer(address, uint256) external returns (bool);
    function approve(address, uint256) external returns (bool);
    function hook() external view returns (address);
    function rewardToken() external view returns (address);
    function eligibleBalanceOn(address, uint256) external view returns (uint256);
    function dayInfo(uint256) external view returns (uint256 shares, uint256 rewards, uint256 paidOut);
    function holderClaimable(address) external view returns (uint256);
    function claimHolderRewards() external returns (uint256);
    function sweepExpired(uint256) external returns (uint256);
    function holderRewardsHeld() external view returns (uint256);
    function totalHolderRewards() external view returns (uint256);
    function syncHolderRewards() external returns (uint256);
    function rewardsRemaining() external view returns (uint256);
    function excludedFromHolderRewards(address) external view returns (bool);
    function protocolWallet() external view returns (address);
    function currentDay() external view returns (uint256);
}

/// @notice Borrows the pool's RUNNER inside an unlock and tries to flush holder fees mid-unlock.
contract FlashFlusher is IUnlockCallback {
    IPoolManager immutable pm;
    RunnerHook immutable hook;
    address immutable token;

    constructor(IPoolManager pm_, RunnerHook hook_, address token_) {
        pm = pm_;
        hook = hook_;
        token = token_;
    }

    function run() external {
        pm.unlock("");
    }

    function unlockCallback(bytes calldata) external returns (bytes memory) {
        uint256 borrowed = IRunner(token).balanceOf(address(pm)) / 2;
        pm.take(Currency.wrap(token), address(this), borrowed);
        hook.flush(token); // must do nothing: only the hook's own routers may distribute mid-unlock
        pm.sync(Currency.wrap(token));
        IRunner(token).transfer(address(pm), borrowed);
        pm.settle();
        return "";
    }
}

/// @notice An unrelated contract that tries to collect protocol fees inside its own unlock (fifth audit, #3).
contract MidUnlockCollector is IUnlockCallback {
    IPoolManager immutable pm;
    RunnerHook immutable hook;
    address immutable quote;

    constructor(IPoolManager pm_, RunnerHook hook_, address quote_) {
        pm = pm_;
        hook = hook_;
        quote = quote_;
    }

    function run() external {
        pm.unlock("");
    }

    function unlockCallback(bytes calldata) external returns (bytes memory) {
        hook.collectProtocolFees(quote); // must do nothing mid-unlock for anyone but our routers
        return "";
    }
}

/// @dev Exposes RunnerDeployLib.sqrt (internal) to tests.
contract SqrtHarness {
    function sqrt(uint256 x) external pure returns (uint256) {
        return RunnerDeployLib.sqrt(x);
    }
}

contract RunnerHookTest is Test {
    using StateLibrary for IPoolManager;
    uint256 constant DAY = 1 days;
    uint256 constant SUPPLY = 1_000_000_000e18;
    uint256 constant LIQUIDITY = 100_000_000e18;
    uint256 constant START_MCAP = 635e18; // 635 IMD
    address constant DEAD = 0x000000000000000000000000000000000000dEaD;

    PoolManager pm;
    MockIMD imd;
    PoolKey imdEthKey;
    RunnerHook hook;
    IRunner runner;
    RunnerRouter router;
    RunnerEthRouter ethRouter;
    PoolSwapTest extRouter;
    PoolModifyLiquidityTest lp;
    PoolSwapTest.TestSettings settings = PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false});

    address owner = makeAddr("owner");
    address feeRecipient = makeAddr("feeRecipient");
    address team = makeAddr("team");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address carol = makeAddr("carol");

    function setUp() public {
        vm.warp(20_500 * DAY + 3600);
        pm = new PoolManager(address(this));
        imd = new MockIMD();
        extRouter = new PoolSwapTest(pm);
        lp = new PoolModifyLiquidityTest(pm);

        // IMD/ETH pool for the ETH router: 1 ETH = 1 IMD, deep full-range liquidity.
        imdEthKey = PoolKey(Currency.wrap(address(0)), Currency.wrap(address(imd)), 10_000, 100, IHooks(address(0)));
        pm.initialize(imdEthKey, TickMath.getSqrtPriceAtTick(0));
        vm.deal(address(this), 100_000 ether);
        imd.mint(address(this), 100_000e18);
        imd.approve(address(lp), type(uint256).max);
        lp.modifyLiquidity{value: 20_000 ether}(imdEthKey, ModifyLiquidityParams(-887200, 887200, 10_000e18, 0), "");

        bytes memory initCode = abi.encodePacked(
            type(RunnerHook).creationCode,
            abi.encode(
                pm,
                address(imd),
                owner,
                feeRecipient,
                RunnerDeployLib.startTickForMarketCap(START_MCAP, SUPPLY),
                RunnerHook.ImdEthPool(10_000, 100, address(0))
            )
        );
        (bytes32 salt, address expected) = RunnerDeployLib.mineSalt(address(this), _flags(), initCode, 0);
        address deployed;
        assembly {
            deployed := create2(0, add(initCode, 0x20), mload(initCode), salt)
        }
        require(deployed == expected, "hook address");
        hook = RunnerHook(deployed);
        router = RunnerRouter(hook.router());
        ethRouter = RunnerEthRouter(payable(hook.ethRouter()));

        runner = IRunner(deployCode("RunnerToken.sol:RunnerToken", abi.encode(owner, address(hook), team, address(imd), address(pm))));
        vm.prank(owner);
        hook.openPool(address(runner));

        address[4] memory users = [alice, bob, carol, address(this)];
        for (uint256 i; i < users.length; i++) {
            vm.deal(users[i], 1_000 ether);
            imd.mint(users[i], 1_000_000e18);
            vm.startPrank(users[i]);
            imd.approve(address(router), type(uint256).max);
            imd.approve(address(extRouter), type(uint256).max);
            runner.approve(address(router), type(uint256).max);
            runner.approve(address(ethRouter), type(uint256).max);
            runner.approve(address(extRouter), type(uint256).max);
            vm.stopPrank();
        }
    }

    receive() external payable {}

    function _flags() internal pure returns (uint160) {
        return uint160((1 << 13) | (1 << 11) | (1 << 7) | (1 << 6) | (1 << 5) | (1 << 3) | (1 << 2));
    }

    function _buy(address who, uint256 imdIn) internal returns (uint256) {
        vm.prank(who);
        return router.buy(address(runner), imdIn, 0, block.timestamp);
    }

    function _sell(address who, uint256 amount) internal returns (uint256) {
        vm.prank(who);
        return router.sell(address(runner), amount, 0, block.timestamp);
    }

    function _key() internal view returns (PoolKey memory) {
        return hook.poolKey(address(runner));
    }

    function _today() internal view returns (uint256) {
        return block.timestamp / DAY;
    }

    // ------------------------------------------------------------ opening the pool

    /// @dev js/config.js HOOK_START_TICK must equal what the deploy helper computes for 635 IMD.
    function test_startTick_matchesAppConfig() public pure {
        assertEq(RunnerDeployLib.startTickForMarketCap(START_MCAP, SUPPLY), int24(142_600));
    }

    function test_hookAddressCarriesFlags() public view {
        assertEq(uint160(address(hook)) & 0x3FFF, hook.HOOK_FLAGS());
    }

    function test_openPool_locksLiquidityAllocation() public view {
        assertEq(runner.totalSupply(), SUPPLY);
        assertEq(runner.balanceOf(address(pm)) + runner.balanceOf(DEAD), LIQUIDITY, "all 100M is in the pool or burned");
        assertLe(runner.balanceOf(DEAD), 2e9, "only rounding dust burned");
        assertEq(runner.balanceOf(address(hook)), 0, "hook keeps nothing");
        assertEq(runner.balanceOf(team), 100_000_000e18);
        assertEq(runner.rewardsRemaining(), 800_000_000e18);
        assertEq(hook.token(), address(runner));
        // starting market cap ~635 IMD (start tick rounded to the tick spacing: within ~2%)
        assertApproxEqRel(hook.marketCap(address(runner)), START_MCAP, 0.03e18);
    }

    function test_openPool_onlyOnceAndOnlyOwner() public {
        vm.prank(owner);
        vm.expectRevert(RunnerHook.AlreadyLaunched.selector);
        hook.openPool(address(runner));
        vm.prank(bob);
        vm.expectRevert(RunnerHook.NotOwner.selector);
        hook.openPool(address(runner));
    }

    function test_openPool_rejectsWrongToken() public {
        bytes memory initCode = abi.encodePacked(
            type(RunnerHook).creationCode,
            abi.encode(pm, address(imd), owner, feeRecipient, int24(0), RunnerHook.ImdEthPool(10_000, 100, address(0)))
        );
        (bytes32 salt,) = RunnerDeployLib.mineSalt(address(this), _flags(), initCode, 1_000_000);
        address h2;
        assembly {
            h2 := create2(0, add(initCode, 0x20), mload(initCode), salt)
        }
        // a token wired to a different hook (the first one) can't be opened by this hook
        vm.prank(owner);
        vm.expectRevert(RunnerHook.BadToken.selector);
        RunnerHook(h2).openPool(address(runner));
        // a token whose reward token isn't IMD is refused
        IRunner wrongReward =
            IRunner(deployCode("RunnerToken.sol:RunnerToken", abi.encode(owner, h2, team, address(0xBEEF), address(pm))));
        vm.prank(owner);
        vm.expectRevert(RunnerHook.BadToken.selector);
        RunnerHook(h2).openPool(address(wrongReward));
    }

    function test_nobodyElseCanAddLiquidityOrReusePool() public {
        PoolKey memory key = _key();
        imd.approve(address(lp), type(uint256).max);
        vm.expectRevert();
        lp.modifyLiquidity(key, ModifyLiquidityParams(-887200, 887200, 1e18, 0), "");
        // a second pool with this hook can't be initialized by anyone else
        PoolKey memory other = PoolKey(Currency.wrap(address(0)), Currency.wrap(address(imd)), 0, 200, IHooks(address(hook)));
        vm.expectRevert();
        pm.initialize(other, TickMath.getSqrtPriceAtTick(0));
    }

    // ------------------------------------------------------------ fees in IMD

    function test_buy_charges4PercentInImd_splitProtocolAndHolders() public {
        uint256 tokBefore = runner.balanceOf(alice);
        uint256 got = _buy(alice, 1_000e18);
        assertGt(got, 0);
        assertEq(runner.balanceOf(alice) - tokBefore, got, "token itself takes no tax");
        assertEq(hook.pendingProtocolFees(address(imd)), 20e18, "2% protocol");
        assertEq(imd.balanceOf(address(runner)), 20e18, "2% holders, delivered in IMD by the router");
        assertEq(hook.pendingHolderFees(address(runner)), 0);
        (, uint256 rewards,) = runner.dayInfo(_today());
        assertEq(rewards, 20e18, "booked as today's holder rewards");
        assertEq(runner.holderRewardsHeld(), 20e18);
    }

    function test_sell_chargesFeeOnImdOutput() public {
        uint256 got = _buy(alice, 10_000e18);
        uint256 imdBefore = imd.balanceOf(alice);
        uint256 holderBefore = imd.balanceOf(address(runner));
        uint256 protoBefore = hook.pendingProtocolFees(address(imd));
        uint256 out = _sell(alice, got / 2);
        assertEq(imd.balanceOf(alice) - imdBefore, out);
        uint256 fee = (imd.balanceOf(address(runner)) - holderBefore) + (hook.pendingProtocolFees(address(imd)) - protoBefore);
        // fee = 4% of the gross the pool paid out = out * 4 / 96
        assertApproxEqAbs(fee, (out * 400) / 9_600, 2);
    }

    function test_externalRouter_allFourDirections_pay4Percent() public {
        PoolKey memory key = _key();
        bool imdIs0 = Currency.unwrap(key.currency0) == address(imd);
        uint256 beforeTotal = _pendingTotal();
        // exact-in buy (IMD specified)
        extRouter.swap(key, SwapParams(imdIs0, -1_000e18, _limit(imdIs0)), settings, "");
        assertApproxEqAbs(_pendingTotal() - beforeTotal, 40e18, 1, "exact-in buy");
        // exact-in sell (RUNNER specified, IMD out)
        beforeTotal = _pendingTotal();
        uint256 imdBefore = imd.balanceOf(address(this));
        extRouter.swap(key, SwapParams(!imdIs0, -1_000_000e18, _limit(!imdIs0)), settings, "");
        uint256 imdOut = imd.balanceOf(address(this)) - imdBefore;
        assertApproxEqAbs(_pendingTotal() - beforeTotal, (imdOut * 400) / 9_600, 2, "exact-in sell");
        // exact-out buy (RUNNER specified out, IMD in)
        beforeTotal = _pendingTotal();
        imdBefore = imd.balanceOf(address(this));
        extRouter.swap(key, SwapParams(imdIs0, 1_000_000e18, _limit(imdIs0)), settings, "");
        uint256 imdPaid = imdBefore - imd.balanceOf(address(this));
        assertApproxEqAbs(_pendingTotal() - beforeTotal, (imdPaid * 400) / 10_000, 2, "exact-out buy");
        // exact-out sell (IMD specified out)
        beforeTotal = _pendingTotal();
        extRouter.swap(key, SwapParams(!imdIs0, 10e18, _limit(!imdIs0)), settings, "");
        assertApproxEqAbs(_pendingTotal() - beforeTotal, uint256(10e18 * 400) / 9_600, 2, "exact-out sell");
        // fees from other routers wait until someone flushes them
        uint256 pending = hook.pendingHolderFees(address(runner));
        assertGt(pending, 0);
        hook.flush(address(runner));
        assertEq(hook.pendingHolderFees(address(runner)), 0);
        assertEq(imd.balanceOf(address(runner)), pending);
        (, uint256 rewards,) = runner.dayInfo(_today());
        assertEq(rewards, pending);
    }

    function _pendingTotal() internal view returns (uint256) {
        return hook.pendingProtocolFees(address(imd)) + hook.pendingHolderFees(address(runner)) + imd.balanceOf(address(runner));
    }

    function _limit(bool zeroForOne) internal pure returns (uint160) {
        return zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1;
    }

    function test_collectProtocolFees_paysImdToRecipient() public {
        _buy(alice, 5_000e18);
        uint256 p = hook.pendingProtocolFees(address(imd));
        assertEq(p, 100e18);
        vm.prank(carol); // anyone
        hook.collectProtocolFees(address(imd));
        assertEq(imd.balanceOf(feeRecipient), p);
        assertEq(hook.pendingProtocolFees(address(imd)), 0);
    }

    function test_flashBorrowedPoolTokens_cantFlushMidUnlock() public {
        PoolKey memory key = _key();
        bool imdIs0 = Currency.unwrap(key.currency0) == address(imd);
        extRouter.swap(key, SwapParams(imdIs0, -1_000e18, _limit(imdIs0)), settings, "");
        uint256 pending = hook.pendingHolderFees(address(runner));
        FlashFlusher f = new FlashFlusher(pm, hook, address(runner));
        runner.transfer(address(f), 0);
        f.run();
        assertEq(hook.pendingHolderFees(address(runner)), pending, "nothing flushed mid-unlock");
    }

    // ------------------------------------------------------------ holder rewards end to end

    function test_holderRewards_paidInImd_toAllDayHolders_thenSwept() public {
        uint256 d0 = _today();
        // day 0: bob buys RUNNER (holds it from day 1 on)
        uint256 bobTok = _buy(bob, 20_000e18);
        assertGe(bobTok, 300_000e18, "bob holds at least 300k");
        // day 1: trading creates holder IMD; team and bob held all day
        vm.warp((d0 + 1) * DAY + 100);
        _buy(alice, 50_000e18);
        uint256 d1 = d0 + 1;
        (uint256 shares, uint256 rewards,) = runner.dayInfo(d1);
        assertEq(rewards, 1_000e18, "2% of 50,000 IMD");
        assertEq(shares, runner.eligibleBalanceOn(team, d1) + runner.eligibleBalanceOn(bob, d1));
        // day 2: claim in IMD
        vm.warp((d0 + 2) * DAY + 100);
        uint256 expBob = (rewards * runner.eligibleBalanceOn(bob, d1)) / shares;
        assertEq(runner.holderClaimable(bob), expBob + _dayZeroShare(bob));
        uint256 imdBefore = imd.balanceOf(bob);
        vm.prank(bob);
        uint256 paid = runner.claimHolderRewards();
        assertEq(imd.balanceOf(bob) - imdBefore, paid, "paid in IMD");
        assertGe(paid, expBob);
        // alice bought on day 1: not eligible for day 1
        assertEq(runner.eligibleBalanceOn(alice, d1), 0);
        // after the 7-day window the rest is swept to the protocol wallet, in IMD
        vm.warp((d0 + 10) * DAY + 100);
        uint256 protoBefore = imd.balanceOf(runner.protocolWallet());
        uint256 swept = runner.sweepExpired(30);
        assertGt(swept, 0);
        assertEq(imd.balanceOf(runner.protocolWallet()) - protoBefore, swept);
        assertEq(runner.holderRewardsHeld(), imd.balanceOf(address(runner)), "bookkeeping matches IMD held");
    }

    /// @dev Day-0 rewards (from bob's own buy) go to wallets that held all of day 0: only the team.
    function _dayZeroShare(address who) internal view returns (uint256) {
        uint256 d0 = _today() - 2;
        (uint256 shares, uint256 rewards,) = runner.dayInfo(d0);
        if (shares == 0) return 0;
        return (rewards * runner.eligibleBalanceOn(who, d0)) / shares;
    }

    function test_poolAndHook_neverEarnHolderRewards() public view {
        assertTrue(runner.excludedFromHolderRewards(address(pm)));
        assertTrue(runner.excludedFromHolderRewards(address(hook)));
        assertTrue(runner.excludedFromHolderRewards(address(runner)));
        assertEq(runner.eligibleBalanceOn(address(pm), _today()), 0);
    }

    function test_donatedImd_becomesTodaysHolderRewards() public {
        imd.mint(address(runner), 7e18);
        assertEq(runner.syncHolderRewards(), 7e18);
        (, uint256 rewards,) = runner.dayInfo(_today());
        assertEq(rewards, 7e18);
        assertEq(runner.syncHolderRewards(), 0, "nothing new");
    }

    // ------------------------------------------------------------ ETH router

    function test_ethRouter_buyAndSell_feeOnImdLeg() public {
        uint256 holderBefore = imd.balanceOf(address(runner));
        vm.prank(alice);
        uint256 got = ethRouter.buyWithEth{value: 10 ether}(address(runner), 0, block.timestamp);
        assertGt(got, 0);
        uint256 holderFee = imd.balanceOf(address(runner)) - holderBefore;
        assertGt(holderFee, 0, "holders paid in IMD on an ETH buy");
        assertApproxEqAbs(hook.pendingProtocolFees(address(imd)), holderFee, 1);

        uint256 ethBefore = alice.balance;
        vm.prank(alice);
        uint256 ethOut = ethRouter.sellForEth(address(runner), got / 2, 0, block.timestamp);
        assertEq(alice.balance - ethBefore, ethOut);
        assertGt(imd.balanceOf(address(runner)), holderBefore + holderFee, "sell also paid holders");
    }

    function test_slippageProtection() public {
        vm.prank(alice);
        vm.expectRevert(RunnerRouter.Slippage.selector);
        router.buy(address(runner), 1_000e18, type(uint256).max, block.timestamp);
        vm.prank(alice);
        vm.expectRevert(RunnerRouter.Expired.selector);
        router.buy(address(runner), 1_000e18, 0, block.timestamp - 1);
    }

    // ------------------------------------------------------------ admin

    function test_ownership_isTwoStep_andFeeRecipientChangeable() public {
        vm.prank(owner);
        hook.transferOwnership(bob);
        assertEq(hook.owner(), owner, "proposal alone changes nothing");
        vm.prank(carol);
        vm.expectRevert(RunnerHook.NotOwner.selector);
        hook.acceptOwnership();
        vm.prank(bob);
        hook.acceptOwnership();
        assertEq(hook.owner(), bob);
        vm.prank(owner);
        vm.expectRevert(RunnerHook.NotOwner.selector);
        hook.setFeeRecipient(owner);
        vm.prank(bob);
        hook.setFeeRecipient(carol);
        assertEq(hook.feeRecipient(), carol);
        vm.prank(bob);
        vm.expectRevert(RunnerHook.ZeroAddress.selector);
        hook.setFeeRecipient(address(0));
    }

    /// @dev Second IMD audit, finding 3: a pending proposal can be cancelled; the fee recipient can't be the hook.
    function test_ownershipProposalCanBeCancelled_feeRecipientNotSelf() public {
        vm.startPrank(owner);
        hook.transferOwnership(bob);
        hook.transferOwnership(address(0));
        vm.stopPrank();
        assertEq(hook.pendingOwner(), address(0));
        vm.prank(bob);
        vm.expectRevert(RunnerHook.NotOwner.selector);
        hook.acceptOwnership();
        vm.prank(owner);
        vm.expectRevert(RunnerHook.ZeroAddress.selector);
        hook.setFeeRecipient(address(hook));
    }

    // ------------------------------------------------------------ third IMD audit (d4297b4d)

    /// @dev #1: an exact-out sell for more IMD than the pool holds is refused instead of overcharging.
    function test_partialFill_exactOutSell_isRefused() public {
        _buy(alice, 1_000e18); // the pool now holds 960 IMD
        PoolKey memory key = _key();
        bool imdIs0 = Currency.unwrap(key.currency0) == address(imd);
        uint256 fees = _pendingTotal();
        vm.prank(alice);
        vm.expectRevert();
        extRouter.swap(key, SwapParams(!imdIs0, int256(2_000e18), _limit(!imdIs0)), settings, "");
        assertEq(_pendingTotal(), fees, "nothing charged");
    }

    /// @dev #1: an exact-in buy stopped early by a price limit is refused instead of paying 4% of the whole order.
    function test_partialFill_exactInBuy_priceLimit_isRefused() public {
        PoolKey memory key = _key();
        bool imdIs0 = Currency.unwrap(key.currency0) == address(imd);
        (uint160 sqrtP,,,) = IPoolManager(address(pm)).getSlot0(key.toId());
        uint160 limit = imdIs0 ? uint160(uint256(sqrtP) * 9995 / 10000) : uint160(uint256(sqrtP) * 10005 / 10000);
        vm.expectRevert();
        extRouter.swap(key, SwapParams(imdIs0, -10_000e18, limit), settings, "");
    }

    /// @dev #1: full fills in the two "IMD specified" directions still pay exactly 4%.
    function test_fullFills_stillPayExactly4Percent() public {
        PoolKey memory key = _key();
        bool imdIs0 = Currency.unwrap(key.currency0) == address(imd);
        uint256 before = _pendingTotal();
        extRouter.swap(key, SwapParams(imdIs0, -1_000e18, _limit(imdIs0)), settings, ""); // exact-in buy
        assertEq(_pendingTotal() - before, 40e18);
        before = _pendingTotal();
        extRouter.swap(key, SwapParams(!imdIs0, int256(96e18), _limit(!imdIs0)), settings, ""); // exact-out sell, within the reserve
        assertEq(_pendingTotal() - before, 4e18);
    }

    function _freshPair(uint256 saltStart) internal returns (RunnerHook h, IRunner r) {
        bytes memory initCode = abi.encodePacked(
            type(RunnerHook).creationCode,
            abi.encode(pm, address(imd), owner, feeRecipient, int24(142_600), RunnerHook.ImdEthPool(10_000, 100, address(0)))
        );
        (bytes32 salt,) = RunnerDeployLib.mineSalt(address(this), _flags(), initCode, saltStart);
        address d;
        assembly {
            d := create2(0, add(initCode, 0x20), mload(initCode), salt)
        }
        h = RunnerHook(d);
        r = IRunner(deployCode("RunnerToken.sol:RunnerToken", abi.encode(owner, d, team, address(imd), address(pm))));
    }

    /// @dev #2: 1 wei sent to the hook, or burned by a holder, before launch can't stop the pool from opening.
    function test_openPool_survivesDustAndPreLaunchBurn() public {
        (RunnerHook h1, IRunner r1) = _freshPair(3_000_000);
        vm.prank(team);
        r1.transfer(address(h1), 1);
        vm.prank(owner);
        h1.openPool(address(r1));
        assertEq(h1.token(), address(r1));
        assertEq(r1.balanceOf(address(h1)), 0, "the extra wei is burned with the rounding dust");

        (RunnerHook h2, IRunner r2) = _freshPair(6_000_000);
        vm.prank(team);
        (bool ok,) = address(r2).call(abi.encodeWithSignature("burn(uint256)", 1));
        assertTrue(ok);
        vm.prank(owner);
        h2.openPool(address(r2));
        assertEq(h2.token(), address(r2));
    }

    /// @dev #3: a start tick whose launch liquidity can't fit in a v4 tick is rejected at deployment.
    function test_constructor_rejectsUnsafeStartTick() public {
        vm.expectRevert(RunnerHook.BadTick.selector);
        new RunnerHook(pm, address(imd), owner, feeRecipient, int24(-400_000), RunnerHook.ImdEthPool(10_000, 100, address(0)));
        // A large positive tick (a low RUNNER price) fits either way the pair sorts: it passes the tick checks and
        // only fails afterwards because `new` doesn't land on a flagged hook address.
        try new RunnerHook(pm, address(imd), owner, feeRecipient, int24(400_000), RunnerHook.ImdEthPool(10_000, 100, address(0))) {
            revert("unexpected deploy at an unflagged address");
        } catch (bytes memory err) {
            assertTrue(bytes4(err) != RunnerHook.BadTick.selector, "a safe tick isn't rejected as BadTick");
        }
    }

    // ------------------------------------------------------------ fourth IMD audit (8d4586f5)

    /// @dev #1: a sell that moves nothing (the pool holds no IMD right after launch) is refused.
    function test_emptySwap_isRefused() public {
        PoolKey memory key = _key();
        bool imdIs0 = Currency.unwrap(key.currency0) == address(imd);
        uint256 cap = hook.marketCap(address(runner));
        address griefer = makeAddr("griefer");
        vm.prank(griefer);
        vm.expectRevert();
        extRouter.swap(key, SwapParams(!imdIs0, -1, _limit(!imdIs0)), settings, "");
        assertEq(hook.marketCap(address(runner)), cap, "price untouched");
    }

    /// @dev #1: after a sell drains the pool's IMD, the price views report the launch price, not 0.
    function test_oversell_priceViewsReportLaunchPrice() public {
        uint256 launchCap = hook.marketCap(address(runner));
        (,,,,,,,,,, uint160 launchSqrt,,,) = _info();
        uint256 got = _buy(alice, 1_000e18);
        vm.prank(team);
        runner.transfer(alice, 5_000_000e18);
        _sell(alice, got + 5_000_000e18);
        assertEq(hook.marketCap(address(runner)), launchCap, "market cap back at the launch price, not 0");
        (,,,,,,,,,, uint160 sq,,,) = _info();
        assertEq(sq, launchSqrt);
    }

    function _info()
        internal
        view
        returns (address, string memory, string memory, string memory, address, address, uint64, uint64, bool, bytes32, uint160, uint256, uint256, uint256)
    {
        RunnerHook.TokenInfo memory i = hook.getTokenInfo(address(runner));
        return (i.token, i.name, i.symbol, i.metadata, i.quote, i.creator, i.createdAt, i.createdBlock, i.quoteIsCurrency0, bytes32(0), i.sqrtPriceX96, i.marketCap, i.pendingHolderFees, i.totalDividendsDistributed);
    }

    /// @dev #3: the fee recipient can't be the PoolManager.
    function test_feeRecipient_cantBePoolManager() public {
        vm.prank(owner);
        vm.expectRevert(RunnerHook.ZeroAddress.selector);
        hook.setFeeRecipient(address(pm));
    }

    /// @dev #5: if IMD's issuer blocks the token contract, trades through our routers still work; the holder share
    ///      just waits in the hook.
    function test_routerTrades_surviveBlockedRewardDelivery() public {
        imd.setBlocked(address(runner), true);
        uint256 got = _buy(alice, 1_000e18);
        assertGt(got, 0, "buy still works");
        assertEq(hook.pendingHolderFees(address(runner)), 20e18, "holder share waits in the hook");
        assertEq(runner.holderRewardsHeld(), 0);
        _sell(alice, got / 2);
        vm.prank(alice);
        ethRouter.buyWithEth{value: 1 ether}(address(runner), 0, block.timestamp);
        imd.setBlocked(address(runner), false);
        uint256 pending = hook.pendingHolderFees(address(runner));
        hook.flush(address(runner));
        assertEq(runner.holderRewardsHeld(), pending, "delivered once unblocked");
    }

    /// @dev #6: market cap uses the live supply, so burns count.
    function test_marketCap_usesLiveSupply() public {
        uint256 cap = hook.marketCap(address(runner));
        vm.prank(team);
        (bool ok,) = address(runner).call(abi.encodeWithSignature("burn(uint256)", 50_000_000e18));
        assertTrue(ok);
        assertApproxEqRel(hook.marketCap(address(runner)), (cap * 95) / 100, 1e12);
    }

    /// @dev #7: the fee rounds up, so even a 24-wei trade pays.
    function test_tinyTrade_paysRoundedUpFee() public {
        PoolKey memory key = _key();
        bool imdIs0 = Currency.unwrap(key.currency0) == address(imd);
        uint256 before = _pendingTotal();
        extRouter.swap(key, SwapParams(imdIs0, -24, _limit(imdIs0)), settings, "");
        assertEq(_pendingTotal() - before, 1);
    }

    // ------------------------------------------------------------ fifth audit

    /// @dev #1: donations to the pool are refused (they'd be lost to the locked position).
    function test_donations_areRefused() public {
        PoolDonateTest donor = new PoolDonateTest(pm);
        imd.mint(alice, 10e18);
        vm.startPrank(alice);
        imd.approve(address(donor), type(uint256).max);
        PoolKey memory key = _key();
        bool imdIs0 = Currency.unwrap(key.currency0) == address(imd);
        uint256 pmBefore = imd.balanceOf(address(pm));
        vm.expectRevert();
        donor.donate(key, imdIs0 ? 10e18 : 0, imdIs0 ? 0 : 10e18, "");
        vm.stopPrank();
        assertEq(imd.balanceOf(address(pm)), pmBefore);
    }

    /// @dev #2: integer square root is the floor for small inputs too (it returned 2 for 2).
    function test_sqrt_isFloorForSmallInputs() public {
        SqrtHarness s = new SqrtHarness();
        for (uint256 x = 0; x < 200; x++) {
            uint256 z = s.sqrt(x);
            assertLe(z * z, x);
            assertGt((z + 1) * (z + 1), x);
        }
        assertEq(s.sqrt(type(uint256).max), type(uint128).max);
    }

    /// @dev #3: like flush, a stranger can't make the hook collect protocol fees inside its unlock.
    function test_collectProtocolFees_strangerMidUnlock_doesNothing() public {
        _buy(alice, 1_000e18);
        uint256 p = hook.pendingProtocolFees(address(imd));
        assertEq(p, 20e18);
        new MidUnlockCollector(pm, hook, address(imd)).run();
        assertEq(hook.pendingProtocolFees(address(imd)), p, "nothing collected mid-unlock");
        assertEq(imd.balanceOf(feeRecipient), 0);
        hook.collectProtocolFees(address(imd)); // outside an unlock it still works for anyone
        assertEq(imd.balanceOf(feeRecipient), p);
    }

    /// @dev #5: trades through other routers name that router, not tx.origin.
    function test_tradeEvent_otherRouter_namesTheRouter() public {
        PoolKey memory key = _key();
        bool imdIs0 = Currency.unwrap(key.currency0) == address(imd);
        address relayer = makeAddr("relayer");
        vm.recordLogs();
        vm.prank(address(this), relayer);
        extRouter.swap(key, SwapParams(imdIs0, -1_000e18, _limit(imdIs0)), settings, "");
        Vm.Log[] memory logs = vm.getRecordedLogs();
        bytes32 sig = keccak256("Trade(address,address,bool,uint256,uint256,uint256,uint160)");
        bool seen;
        for (uint256 i = 0; i < logs.length; i++) {
            if (logs[i].emitter == address(hook) && logs[i].topics[0] == sig) {
                assertEq(address(uint160(uint256(logs[i].topics[2]))), address(extRouter));
                seen = true;
            }
        }
        assertTrue(seen, "Trade emitted");
    }

    /// @dev Our own router still names the user.
    function test_tradeEvent_ourRouter_namesTheUser() public {
        vm.recordLogs();
        _buy(alice, 1_000e18);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        bytes32 sig = keccak256("Trade(address,address,bool,uint256,uint256,uint256,uint160)");
        bool seen;
        for (uint256 i = 0; i < logs.length; i++) {
            if (logs[i].emitter == address(hook) && logs[i].topics[0] == sig) {
                assertEq(address(uint160(uint256(logs[i].topics[2]))), alice);
                seen = true;
            }
        }
        assertTrue(seen, "Trade emitted");
    }

    // ------------------------------------------------------------ sixth audit

    /// @dev #1: the constructor refuses the fee recipients setFeeRecipient refuses (the PoolManager, the hook).
    function test_constructor_rejectsPoolManagerOrSelfAsFeeRecipient() public {
        vm.expectRevert(RunnerHook.ZeroAddress.selector);
        new RunnerHook(pm, address(imd), owner, address(pm), int24(142_600), RunnerHook.ImdEthPool(10_000, 100, address(0)));
        address next = vm.computeCreateAddress(address(this), vm.getNonce(address(this)));
        vm.expectRevert(RunnerHook.ZeroAddress.selector);
        new RunnerHook(pm, address(imd), owner, next, int24(142_600), RunnerHook.ImdEthPool(10_000, 100, address(0)));
    }

    /// @dev #4: an ETH buy refunds only the buyer's unspent ETH, never ETH the router got some other way.
    function test_ethBuy_refundsOnlyTheBuyersEth() public {
        vm.deal(address(ethRouter), 1 wei); // e.g. a self-destruct beneficiary
        uint256 before = alice.balance;
        vm.prank(alice);
        ethRouter.buyWithEth{value: 1 ether}(address(runner), 0, block.timestamp);
        assertEq(before - alice.balance, 1 ether, "alice paid exactly 1 ETH");
        assertEq(address(ethRouter).balance, 1 wei, "the stray wei is not handed to the buyer");
    }

    // ------------------------------------------------------------ fuzz

    /// @dev Any sequence of buys and sells: the hook's IMD claims always cover what it owes, the fee split is
    ///      exact, and every IMD the token holds is booked for holders.
    function testFuzz_feesAlwaysCovered(uint96 a, uint96 b, uint96 c) public {
        uint256 x = bound(uint256(a), 1e15, 200_000e18);
        uint256 y = bound(uint256(b), 1, 1e4);
        uint256 z = bound(uint256(c), 1e15, 100_000e18);
        uint256 got = _buy(alice, x);
        _sell(alice, (got * y) / 1e4);
        _buy(bob, z);
        uint256 claims = pm.balanceOf(address(hook), uint256(uint160(address(imd))));
        assertEq(claims, hook.pendingProtocolFees(address(imd)) + hook.pendingHolderFees(address(runner)));
        assertEq(runner.holderRewardsHeld(), imd.balanceOf(address(runner)));
    }
}
