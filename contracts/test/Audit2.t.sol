// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Base} from "./Base.t.sol";
import {CopyVault} from "../src/periphery/CopyVault.sol";
import {Receiver} from "./helpers/Receiver.sol";
import {Router} from "../src/periphery/Router.sol";

interface IERC20Lite {
    function balanceOf(address) external view returns (uint256);
    function approve(address, uint256) external returns (bool);
}

/// @notice What audit round 2 (2026-11-08) found, written by Hermes as proofs and turned round into checks that it's fixed.
contract AuditCopyVaultTest is Base {
    address internal leader = makeAddr("leader");
    address internal carol = makeAddr("carol");

    function setUp() public override {
        super.setUp();
        vm.deal(leader, 400_000 ether);
        vm.deal(alice, 400_000 ether);
    }

    /// A follower contract whose receive() reverts CAN still get its ZRO, because `withdraw` takes any
    /// recipient. Worth pinning: the escape hatch is the recipient argument, not a credit balance.
    function test_aFollowerThatRefusesZroWithdrawsToAnotherAddress() public {
        Receiver follower = new Receiver();
        vm.deal(address(follower), 2_000 ether);
        follower.deposit{value: 2_000 ether}(address(copyVault));

        follower.withdrawFrom(address(copyVault), 2_000 ether, alice);
        assertEq(alice.balance, 402_000 ether, "reached the address they named");
        assertEq(copyVault.balanceOf(address(follower)), 0);
    }

    /// Was: the run fee went out with a bare call, so a runner contract that refuses ZRO couldn't run a copy at all.
    /// Now the copy goes through and the fee waits as a credit the runner collects to any address.
    function test_aRunnerThatRefusesZroStillRunsCopiesAndCollectsItsFeeLater() public {
        Receiver follower = new Receiver();
        Receiver runner = new Receiver();
        vm.deal(address(follower), 2_000 ether);
        follower.deposit{value: 2_000 ether}(address(copyVault));
        follower.follow(address(copyVault), leader, _rules());

        address token = _launch();
        vm.prank(leader);
        router.buy{value: 400 ether}(token, 0, leader, block.timestamp);

        runner.copyCopy(address(copyVault), address(follower), leader, token);
        (uint128 got,) = copyVault.positions(address(follower), token);
        assertGt(got, 0, "the copy happened");
        uint256 owed = copyVault.runnerCredit(address(runner));
        assertEq(owed, copyVault.RUN_FEE(), "the fee waits for the runner");

        uint256 before = carol.balance;
        vm.prank(address(runner));
        copyVault.collectRunnerCredit(carol);
        assertEq(carol.balance - before, owed);
        assertEq(copyVault.runnerCredit(address(runner)), 0);
    }

    /// Was: a copied sale sized itself from the leader's latest share only, so a tiny sale right after a real one hid
    /// the real one and the copy reverted. Now it follows how far the leader's holding fell since the copy: both sales.
    function test_aTinySaleAfterARealOneNoLongerHidesIt() public {
        Receiver follower = new Receiver();
        vm.deal(address(follower), 2_000 ether);
        follower.deposit{value: 2_000 ether}(address(copyVault));
        follower.follow(address(copyVault), leader, _rules());

        address token = _launch();
        vm.prank(leader);
        router.buy{value: 160 ether}(token, 0, leader, block.timestamp);
        vm.prank(bob);
        copyVault.copyBuy(address(follower), leader, token);
        (uint128 position,) = copyVault.positions(address(follower), token);
        assertGt(position, 0);

        // the leader sells 1% of what they hold, then a tenth of that again
        uint256 held = IERC20Lite(token).balanceOf(leader);
        vm.startPrank(leader);
        IERC20Lite(token).approve(address(router), held);
        vm.roll(vm.getBlockNumber() + 1);
        router.sell(token, held / 100, 0, leader, block.timestamp);
        IERC20Lite(token).approve(address(router), held);
        vm.roll(vm.getBlockNumber() + 1);
        router.sell(token, held / 1000, 0, leader, block.timestamp);
        vm.stopPrank();

        // the copy sells the 1.1% the leader let go in all, not the tenth of a percent of the last sale
        vm.roll(vm.getBlockNumber() + 1);
        vm.prank(bob);
        copyVault.copySell(address(follower), leader, token);
        (uint128 left,) = copyVault.positions(address(follower), token);
        uint256 sold = position - left;
        assertApproxEqRel(sold, (uint256(position) * 110) / 10_000, 0.02e18, "both of the leader's sales");
    }

    /// A leader who sold everything leaves the follower with nothing either, however the sales were split.
    function test_aLeaderWhoLeftTakesTheFollowerOut() public {
        Receiver follower = new Receiver();
        vm.deal(address(follower), 2_000 ether);
        follower.deposit{value: 2_000 ether}(address(copyVault));
        follower.follow(address(copyVault), leader, _rules());
        address token = _launch();
        vm.prank(leader);
        router.buy{value: 160 ether}(token, 0, leader, block.timestamp);
        vm.prank(bob);
        copyVault.copyBuy(address(follower), leader, token);

        uint256 held = IERC20Lite(token).balanceOf(leader);
        vm.startPrank(leader);
        IERC20Lite(token).approve(address(router), held);
        vm.roll(vm.getBlockNumber() + 1);
        router.sell(token, held, 0, leader, block.timestamp);
        vm.stopPrank();
        vm.roll(vm.getBlockNumber() + 1);
        vm.prank(bob);
        copyVault.copySell(address(follower), leader, token);
        (uint128 left,) = copyVault.positions(address(follower), token);
        assertEq(left, 0);
    }

    function _rules() private pure returns (CopyVault.Rules memory r) {
        r.perTrade = 400 ether;
        r.perToken = 4_000 ether;
        r.perDay = 4_000 ether;
        r.sizeBps = 1000; // a fifth of the leader, so the price impact stays copyable
        r.slippageBps = 500;
        r.chaseBps = 10_000; // wide, so the tests aren't about the price guard
        r.minSellBps = 1;
        r.copySells = true;
    }
}

/// @notice Audit round 2, 3.4: a buy for the router itself would leave the tokens stuck in it.
contract AuditRouterRecipientTest is Base {
    function test_aBuyForTheRouterItselfIsRefused() public {
        address token = _launch();
        vm.prank(alice);
        vm.expectRevert(Router.BadConfig.selector);
        router.buy{value: 40 ether}(token, 0, address(router), block.timestamp);
    }
}
