// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";

import {RunnerHook} from "../RunnerHook.sol";
import {RunnerRouter} from "../RunnerRouter.sol";
import {RunnerEthRouter} from "../RunnerEthRouter.sol";
import {RunnerDeployLib} from "../utils/RunnerDeployLib.sol";
import {IRunner} from "./RunnerHook.t.sol";

interface IERC20Min {
    function balanceOf(address) external view returns (uint256);
    function approve(address, uint256) external returns (bool);
}

/// @notice RUNNER on a Robinhood Chain mainnet fork: the real Uniswap v4 PoolManager, the real IMD token
///         and the real IMD/ETH pool (the same ones PepesFamily uses).
///   FORK_RPC=https://robinhood.drpc.org forge test --mc RunnerHookForkTest -vv
contract RunnerHookForkTest is Test {
    IPoolManager constant PM = IPoolManager(0x8366a39CC670B4001A1121B8F6A443A643e40951);
    address constant IMD = 0x5F7Bb59365ce557C26dbcAa4EE9d39A4b95B7127;
    uint256 constant DAY = 1 days;

    RunnerHook hook;
    IRunner runner;
    RunnerRouter router;
    RunnerEthRouter ethRouter;
    address owner = makeAddr("owner");
    address feeRecipient = makeAddr("feeRecipient");
    address team = makeAddr("team");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");

    function setUp() public {
        string memory rpc = vm.envOr("FORK_RPC", string(""));
        if (bytes(rpc).length == 0) {
            vm.skip(true);
            return;
        }
        vm.createSelectFork(rpc);
        bytes memory initCode = abi.encodePacked(
            type(RunnerHook).creationCode,
            abi.encode(
                PM,
                IMD,
                owner,
                feeRecipient,
                RunnerDeployLib.startTickForMarketCap(635e18),
                RunnerHook.ImdEthPool(10_000, 100, address(0))
            )
        );
        (bytes32 salt,) = RunnerDeployLib.mineSalt(address(this), uint160(0x28EC), initCode, 0);
        address deployed;
        assembly {
            deployed := create2(0, add(initCode, 0x20), mload(initCode), salt)
        }
        hook = RunnerHook(deployed);
        router = RunnerRouter(hook.router());
        ethRouter = RunnerEthRouter(payable(hook.ethRouter()));
        runner = IRunner(deployCode("RunnerToken.sol:RunnerToken", abi.encode(owner, address(hook), team, IMD, address(PM))));
        vm.prank(owner);
        hook.openPool(address(runner));
        vm.deal(alice, 10 ether);
        vm.deal(bob, 10 ether);
    }

    function test_fork_openPoolAt635ImdMarketCap() public view {
        assertApproxEqRel(hook.marketCap(address(runner)), 635e18, 0.03e18);
        assertEq(runner.balanceOf(address(hook)), 0);
    }

    function test_fork_buyAndSellWithEth_feesPaidInRealImd() public {
        vm.prank(alice);
        uint256 got = ethRouter.buyWithEth{value: 0.01 ether}(address(runner), 0, block.timestamp);
        assertGt(got, 0, "bought RUNNER with ETH through the real IMD/ETH pool");
        uint256 holderImd = IERC20Min(IMD).balanceOf(address(runner));
        assertGt(holderImd, 0, "holders received real IMD");
        assertApproxEqAbs(hook.pendingProtocolFees(IMD), holderImd, 1, "protocol got the same 2%");
        assertEq(runner.holderRewardsHeld(), holderImd);

        vm.startPrank(alice);
        runner.approve(address(ethRouter), got);
        uint256 ethOut = ethRouter.sellForEth(address(runner), got / 2, 0, block.timestamp);
        vm.stopPrank();
        assertGt(ethOut, 0, "sold back to ETH");
        assertGt(IERC20Min(IMD).balanceOf(address(runner)), holderImd, "the sell paid holders too");

        hook.collectProtocolFees(IMD);
        assertGt(IERC20Min(IMD).balanceOf(feeRecipient), 0, "protocol fee delivered in IMD");
    }

    function test_fork_holderClaimsRealImd() public {
        uint256 d0 = block.timestamp / DAY;
        vm.prank(bob);
        ethRouter.buyWithEth{value: 0.05 ether}(address(runner), 0, block.timestamp);
        vm.warp((d0 + 1) * DAY + 60);
        vm.prank(alice);
        ethRouter.buyWithEth{value: 0.05 ether}(address(runner), 0, block.timestamp);
        vm.warp((d0 + 2) * DAY + 60);
        uint256 claimable = runner.holderClaimable(team);
        assertGt(claimable, 0, "team (held all day) has IMD to claim");
        vm.prank(team);
        runner.claimHolderRewards();
        assertEq(IERC20Min(IMD).balanceOf(team), claimable);
    }
}
