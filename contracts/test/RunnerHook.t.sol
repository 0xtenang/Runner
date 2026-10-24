// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {PoolManager} from "v4-core/src/PoolManager.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "v4-core/src/interfaces/IHooks.sol";
import {IUnlockCallback} from "v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {PoolSwapTest} from "v4-core/src/test/PoolSwapTest.sol";
import {PoolModifyLiquidityTest} from "v4-core/src/test/PoolModifyLiquidityTest.sol";
import {TickMath} from "v4-core/src/libraries/TickMath.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {Currency} from "v4-core/src/types/Currency.sol";
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

contract RunnerHookTest is Test {
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
        return uint160((1 << 13) | (1 << 11) | (1 << 7) | (1 << 6) | (1 << 3) | (1 << 2));
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
