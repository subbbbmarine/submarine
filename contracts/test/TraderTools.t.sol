// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Base} from "./Base.t.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {LimitOrders} from "../src/periphery/LimitOrders.sol";
import {Referrals} from "../src/periphery/Referrals.sol";
import {CopyVault} from "../src/periphery/CopyVault.sol";

/// @notice Stops, trailing stops, event orders, DCA and sale groups.
contract OrderKindsTest is Base {
    address internal token;
    uint8 internal LIMIT;
    uint8 internal STOP;
    uint8 internal TRAILING;
    uint8 internal ON_GRADUATION;
    uint8 internal ON_DEV_SELL;
    uint8 internal DCA;

    function setUp() public override {
        super.setUp();
        (LIMIT, STOP, TRAILING, ON_GRADUATION, ON_DEV_SELL, DCA) = (limits.LIMIT(), limits.STOP(), limits.TRAILING(), limits.ON_GRADUATION(), limits.ON_DEV_SELL(), limits.DCA());
        token = _launch();
        vm.prank(bob);
        router.buy{value: 1_600 ether}(token, 0, bob, _deadline());
        vm.prank(alice);
        router.buy{value: 400 ether}(token, 0, alice, _deadline());
    }

    function _held(address who) internal view returns (uint256) {
        return IERC20(token).balanceOf(who);
    }

    function _legs(uint8 kind, uint256 share, uint256 minOut, uint256 trigger, uint16 trail) internal pure returns (LimitOrders.Leg[] memory legs) {
        legs = new LimitOrders.Leg[](1);
        legs[0] = LimitOrders.Leg(kind, uint128(share), uint128(minOut), uint128(trigger), trail);
    }

    function _placeLegs(LimitOrders.Leg[] memory legs, uint256 amount) internal returns (uint256 head) {
        vm.startPrank(alice);
        IERC20(token).approve(address(limits), amount);
        vm.roll(vm.getBlockNumber() + 1);
        head = limits.placeSellLegs(token, amount, 0, legs);
        vm.stopPrank();
    }

    function _bobSells(uint256 share) internal {
        uint256 amount = (_held(bob) * share) / 100;
        vm.startPrank(bob);
        IERC20(token).approve(address(router), amount);
        vm.roll(vm.getBlockNumber() + 1);
        router.sell(token, amount, 0, bob, _deadline());
        vm.stopPrank();
    }

    /// Audit round 2: a leg asking for more than was escrowed used to be cut down quietly; now it's refused.
    function test_aLegAskingForMoreThanWasEscrowedIsRefused() public {
        uint256 amount = _held(alice) / 2;
        LimitOrders.Leg[] memory legs = _legs(LIMIT, amount + 1, 1, 0, 0);
        vm.startPrank(alice);
        IERC20(token).approve(address(limits), amount);
        vm.roll(vm.getBlockNumber() + 1);
        vm.expectRevert(LimitOrders.BadOrder.selector);
        limits.placeSellLegs(token, amount, 0, legs);
        vm.stopPrank();
    }

    /// Audit round 2: after a partial fill, a trailing stop's high is priced on what's left, in whole-order terms, the same
    /// way the check that fires it compares, rather than on the whole order's bigger price impact.
    function test_aTrailingHighAfterAPartialFillIsPricedOnWhatsLeft() public {
        uint256 amount = _held(alice);
        uint256 head = _placeLegs(_legs(TRAILING, amount, 1, 0, 2_000), amount);
        _bobSells(60); // a fall past the trail
        vm.prank(keeper);
        limits.fill(head, amount / 2);
        LimitOrders.Order memory o = limits.getOrder(head);
        assertEq(o.left, amount - amount / 2);

        vm.prank(bob);
        router.buy{value: 3_200 ether}(token, 0, bob, _deadline()); // and a run up far past the old high
        uint256[] memory ids = new uint256[](1);
        ids[0] = head;
        limits.poke(ids);
        uint256 expected = (router.quoteSell(token, o.left) * o.total) / o.left;
        assertEq(limits.getOrder(head).trigger, expected);
    }

    function test_stopWaitsForTheFallThenSells() public {
        uint256 amount = _held(alice);
        uint256 now_ = router.quoteSell(token, amount);
        uint256 head = _placeLegs(_legs(STOP, amount, 1, (now_ * 80) / 100, 0), amount);

        vm.roll(vm.getBlockNumber() + 1);
        vm.expectRevert(LimitOrders.NotYet.selector);
        vm.prank(keeper);
        limits.fill(head, amount);

        _bobSells(90);
        uint256 before = alice.balance;
        vm.roll(vm.getBlockNumber() + 1);
        vm.prank(keeper);
        limits.fill(head, amount);
        assertFalse(limits.getOrder(head).open);
        assertGt(alice.balance, before, "paid out after the fall");
    }

    function test_stopNeverSellsBelowItsFloor() public {
        uint256 amount = _held(alice);
        uint256 now_ = router.quoteSell(token, amount);
        uint256 head = _placeLegs(_legs(STOP, amount, (now_ * 70) / 100, (now_ * 80) / 100, 0), amount);
        _bobSells(100); // far below both
        vm.expectRevert(LimitOrders.BadOrder.selector);
        vm.prank(keeper);
        limits.fill(head, amount);
    }

    function test_trailingFollowsTheHighAndFiresOnTheDrop() public {
        uint256 amount = _held(alice);
        uint256 head = _placeLegs(_legs(TRAILING, amount, 1, 0, 2_000), amount);
        uint256 start = limits.getOrder(head).trigger;

        vm.prank(bob);
        router.buy{value: 1_200 ether}(token, 0, bob, _deadline()); // the price runs up
        uint256[] memory ids = new uint256[](1);
        ids[0] = head;
        limits.poke(ids);
        uint256 high = limits.getOrder(head).trigger;
        assertGt(high, start, "the high moved up");

        vm.roll(vm.getBlockNumber() + 1);
        vm.expectRevert(LimitOrders.NotYet.selector); // at the high, nothing to do
        vm.prank(keeper);
        limits.fill(head, amount);

        _bobSells(60);
        vm.roll(vm.getBlockNumber() + 1);
        vm.prank(keeper);
        limits.fill(head, amount);
        assertFalse(limits.getOrder(head).open);
    }

    function test_saleOnGraduation() public {
        uint256 amount = _held(alice);
        uint256 head = _placeLegs(_legs(ON_GRADUATION, amount, 1, 0, 0), amount);
        vm.roll(vm.getBlockNumber() + 1);
        vm.expectRevert(LimitOrders.NotYet.selector);
        vm.prank(keeper);
        limits.fill(head, amount);

        _graduate(token);
        vm.roll(vm.getBlockNumber() + 1);
        vm.prank(keeper);
        limits.fill(head, amount);
        assertFalse(limits.getOrder(head).open);
    }

    function test_buyOnGraduation() public {
        vm.prank(alice);
        uint256 id = limits.placeBuyIf{value: 200 ether}(token, 1, 0, ON_GRADUATION, 0, 0);
        vm.roll(vm.getBlockNumber() + 1);
        vm.expectRevert(LimitOrders.NotYet.selector);
        vm.prank(keeper);
        limits.fill(id, 200 ether);

        _graduate(token);
        uint256 before = _held(alice);
        vm.roll(vm.getBlockNumber() + 1);
        vm.prank(keeper);
        limits.fill(id, 200 ether);
        assertGt(_held(alice), before, "bought on the pool");
    }

    function test_saleWhenTheCreatorSells() public {
        vm.prank(creator);
        address devToken = pad.launch{value: 400 ether}("Dev", "DEV", "", 0);
        vm.prank(alice);
        router.buy{value: 400 ether}(devToken, 0, alice, _deadline());
        uint256 amount = IERC20(devToken).balanceOf(alice);

        LimitOrders.Leg[] memory legs = new LimitOrders.Leg[](1);
        legs[0] = LimitOrders.Leg(ON_DEV_SELL, uint128(amount), 1, 0, 5_000); // once the creator has sold half
        vm.startPrank(alice);
        IERC20(devToken).approve(address(limits), amount);
        vm.roll(vm.getBlockNumber() + 1);
        uint256 head = limits.placeSellLegs(devToken, amount, 0, legs);
        vm.stopPrank();

        vm.roll(vm.getBlockNumber() + 1);
        vm.expectRevert(LimitOrders.NotYet.selector);
        vm.prank(keeper);
        limits.fill(head, amount);

        uint256 devHolds = IERC20(devToken).balanceOf(creator);
        vm.startPrank(creator);
        IERC20(devToken).approve(address(pad), devHolds);
        vm.roll(vm.getBlockNumber() + 1);
        pad.sell(devToken, (devHolds * 6) / 10, 0, creator, _deadline());
        vm.stopPrank();

        vm.roll(vm.getBlockNumber() + 1);
        vm.prank(keeper);
        limits.fill(head, amount);
        assertFalse(limits.getOrder(head).open);
    }

    function test_dcaBuysInSlicesAtTheirPace() public {
        vm.prank(alice);
        uint256 id = limits.placeBuyIf{value: 160 ether}(token, 1, 0, DCA, 60, 4);

        vm.roll(vm.getBlockNumber() + 1);
        vm.expectRevert(LimitOrders.BadOrder.selector); // more than a slice
        vm.prank(keeper);
        limits.fill(id, 80 ether);

        vm.roll(vm.getBlockNumber() + 1);
        vm.prank(keeper);
        limits.fill(id, 40 ether);
        vm.roll(vm.getBlockNumber() + 1);
        vm.expectRevert(LimitOrders.NotYet.selector); // too soon
        vm.prank(keeper);
        limits.fill(id, 40 ether);

        uint256 at = block.timestamp;
        for (uint256 i; i < 3; ++i) {
            at += 60;
            vm.warp(at);
            vm.roll(vm.getBlockNumber() + 1);
            vm.prank(keeper);
            limits.fill(id, 40 ether);
        }
        assertFalse(limits.getOrder(id).open, "all four slices bought");
    }

    function test_aGroupSharesItsTokensBetweenTakeProfitAndStopLoss() public {
        uint256 amount = _held(alice);
        uint256 value = router.quoteSell(token, amount);
        LimitOrders.Leg[] memory legs = new LimitOrders.Leg[](2);
        legs[0] = LimitOrders.Leg(LIMIT, uint128(amount / 2), uint128(value / 4), 0, 0); // half at a level already met
        legs[1] = LimitOrders.Leg(STOP, uint128(amount), 1, uint128((value * 70) / 100), 0); // all of it on a fall
        uint256 head = _placeLegs(legs, amount);
        assertEq(limits.groupLeft(head), amount);

        vm.roll(vm.getBlockNumber() + 1);
        vm.prank(keeper);
        limits.fill(head, amount / 2);
        assertEq(limits.groupLeft(head), amount - amount / 2, "the take profit took half");
        assertEq(limits.available(head + 1), amount - amount / 2, "the stop now covers only what's left");

        _bobSells(90);
        uint256 rest = limits.available(head + 1);
        vm.roll(vm.getBlockNumber() + 1);
        vm.prank(keeper);
        limits.fill(head + 1, rest);
        assertEq(limits.groupLeft(head), 0);
        assertFalse(limits.getOrder(head + 1).open);
        assertEq(IERC20(token).balanceOf(address(limits)), 0, "nothing left behind");
    }

    function test_cancellingALegEndsTheGroupAndRefunds() public {
        uint256 amount = _held(alice);
        LimitOrders.Leg[] memory legs = new LimitOrders.Leg[](2);
        legs[0] = LimitOrders.Leg(LIMIT, uint128(amount / 2), type(uint120).max, 0, 0);
        legs[1] = LimitOrders.Leg(STOP, uint128(amount), 1, 1, 0);
        uint256 head = _placeLegs(legs, amount);

        vm.prank(alice);
        limits.cancel(head + 1);
        assertFalse(limits.getOrder(head).open);
        assertFalse(limits.getOrder(head + 1).open);
        assertEq(_held(alice), amount, "all tokens back");
    }

    function test_whenEveryLegExpiresTheTokensComeBack() public {
        uint256 amount = _held(alice);
        LimitOrders.Leg[] memory legs = new LimitOrders.Leg[](2);
        legs[0] = LimitOrders.Leg(LIMIT, uint128(amount), type(uint120).max, 0, 0);
        legs[1] = LimitOrders.Leg(STOP, uint128(amount), 1, 1, 0);
        vm.startPrank(alice);
        IERC20(token).approve(address(limits), amount);
        vm.roll(vm.getBlockNumber() + 1);
        uint256 head = limits.placeSellLegs(token, amount, uint40(block.timestamp + 1 hours), legs);
        vm.stopPrank();

        vm.warp(block.timestamp + 2 hours);
        vm.roll(vm.getBlockNumber() + 1);
        vm.prank(keeper);
        limits.fill(head, 1);
        assertEq(_held(alice), 0, "one leg is still open");
        vm.roll(vm.getBlockNumber() + 1);
        vm.prank(keeper);
        limits.fill(head + 1, 1);
        assertEq(_held(alice), amount, "the last leg closing hands them back");
    }

    function test_eventKindsNeedALaunchpadToken() public {
        vm.expectRevert(LimitOrders.BadOrder.selector);
        vm.prank(alice);
        limits.placeBuyIf{value: 200 ether}(address(0xBEEF), 1, 0, ON_GRADUATION, 0, 0);
    }

    function test_aSellOnlyKindCannotBeABuy() public {
        uint8 stop = STOP;
        vm.expectRevert(LimitOrders.BadOrder.selector);
        vm.prank(alice);
        limits.placeBuyIf{value: 200 ether}(token, 1, 0, stop, 0, 0);
    }
}

/// @notice Referrals on the curve and on the router's fee.
contract ReferralsTest is Base {
    address internal token;
    address internal friend = makeAddr("friend");

    function setUp() public override {
        super.setUp();
        token = _launch();
    }

    function test_aReferredBuySendsPartOfTheTreasuryCutToReferrals() public {
        vm.prank(alice);
        referrals.link(friend);

        uint256 before = pad.protocolFees();
        vm.prank(alice);
        router.buy{value: 400 ether}(token, 0, alice, _deadline());
        uint256 toTreasury = pad.protocolFees() - before;

        // 0.4% of the trade is the cut; 40% of it goes back.
        assertEq(toTreasury, 0.96 ether);
        assertEq(referrals.earned(friend), 0.48 ether);
        assertEq(referrals.earned(alice), 0.16 ether);

        uint256 b0 = friend.balance;
        vm.prank(friend);
        referrals.claim();
        assertEq(friend.balance - b0, 0.48 ether);
    }

    function test_aSaleThroughTheRouterIsCreditedToTheRealSeller() public {
        vm.prank(alice);
        router.buy{value: 400 ether}(token, 0, alice, _deadline());
        vm.prank(alice);
        referrals.link(friend);

        uint256 held = IERC20(token).balanceOf(alice);
        vm.startPrank(alice);
        IERC20(token).approve(address(router), held);
        vm.roll(vm.getBlockNumber() + 1);
        router.sell(token, held, 0, alice, _deadline());
        vm.stopPrank();
        assertGt(referrals.earned(friend), 0, "the launchpad saw alice behind the router");
        assertEq(router.currentTrader(), address(0), "cleared after the trade");
    }

    function test_aPoolTradeSharesTheRoutersFee() public {
        _graduate(token);
        vm.prank(alice);
        referrals.link(friend);
        uint256 t0 = pad.protocolFees();
        vm.prank(alice);
        router.buy{value: 400 ether}(token, 0, alice, _deadline());
        uint256 fee = 1.6 ether; // the pool's 0.4%
        assertEq(pad.protocolFees() - t0, fee - (fee * 4_000) / 10_000);
        assertGt(referrals.earned(friend), 0);
    }

    function test_noSelfOrCircularOrSecondLink() public {
        vm.expectRevert(Referrals.BadReferrer.selector);
        vm.prank(alice);
        referrals.link(alice);

        vm.prank(alice);
        referrals.link(bob);
        vm.expectRevert(Referrals.BadReferrer.selector);
        vm.prank(bob);
        referrals.link(alice);
        vm.expectRevert(Referrals.AlreadyLinked.selector);
        vm.prank(alice);
        referrals.link(friend);
    }

    function test_anUnreferredTradePaysTheTreasuryInFull() public {
        uint256 before = pad.protocolFees();
        vm.prank(alice);
        router.buy{value: 400 ether}(token, 0, alice, _deadline());
        assertEq(pad.protocolFees() - before, 1.6 ether);
    }
}

/// @notice Copy trading that runs without the follower's browser.
contract CopyVaultTest is Base {
    address internal token;
    address internal leader = makeAddr("leader");
    address internal follower = makeAddr("follower");
    address internal runner = makeAddr("runner");

    function setUp() public override {
        super.setUp();
        token = _launch();
        vm.deal(leader, 40_000 ether);
        vm.deal(follower, 40_000 ether);
        vm.prank(follower);
        copyVault.deposit{value: 2_000 ether}();
        vm.prank(follower);
        copyVault.follow(leader, _rules(400 ether, 1_200 ether, 2_000 ether, 10_000, 500, 5_000, false, true, 0));
    }

    /// Chasing up to double the leader's price, since on a young curve the leader's own buy moves it a long way.
    function _rules(uint128 perTrade, uint128 perToken, uint128 perDay, uint16 size, uint16 slip, uint16 minSell, bool once, bool sells, uint32 age)
        internal
        pure
        returns (CopyVault.Rules memory)
    {
        return CopyVault.Rules(perTrade, perToken, perDay, size, slip, 10_000, minSell, once, sells, age);
    }

    /// This test contract runs copies itself, so it takes the run fee.
    receive() external payable {}

    function _leaderBuys(uint256 zro) internal {
        vm.prank(leader);
        router.buy{value: zro}(token, 0, leader, _deadline());
    }

    function test_anyoneCanRunACopyOfARealBuyWithinTheLimits() public {
        _leaderBuys(800 ether);
        uint256 r0 = runner.balance;
        vm.prank(runner);
        uint256 got = copyVault.copyBuy(follower, leader, token);

        (uint128 tokens, uint128 cost) = copyVault.positions(follower, token);
        assertEq(tokens, got);
        assertEq(cost, 400 ether, "capped at the per-trade limit");
        assertEq(runner.balance - r0, copyVault.RUN_FEE(), "the runner was paid");
        assertEq(copyVault.balanceOf(follower), 2_000 ether - 400 ether - copyVault.RUN_FEE());
    }

    function test_theSameBuyCantBeCopiedTwiceOrLate() public {
        _leaderBuys(200 ether);
        copyVault.copyBuy(follower, leader, token);
        vm.expectRevert(CopyVault.NothingToCopy.selector);
        copyVault.copyBuy(follower, leader, token);

        _leaderBuys(200 ether);
        vm.roll(vm.getBlockNumber() + copyVault.WINDOW() + 1);
        vm.expectRevert(CopyVault.NothingToCopy.selector);
        copyVault.copyBuy(follower, leader, token);
    }

    /// Buying tokens for the leader's address doesn't count as the leader buying.
    function test_nobodyCanFakeALeadersBuy() public {
        vm.prank(bob);
        router.buy{value: 800 ether}(token, 0, leader, _deadline());
        vm.expectRevert(CopyVault.NothingToCopy.selector);
        copyVault.copyBuy(follower, leader, token);
    }

    function test_aCopyWontFillFarWorseThanTheLeader() public {
        _leaderBuys(200 ether);
        vm.prank(bob);
        router.buy{value: 2_000 ether}(token, 0, bob, _deadline()); // the price runs away before the copy
        vm.expectRevert();
        copyVault.copyBuy(follower, leader, token);
    }

    function test_aLeadersSaleSellsTheSameShare() public {
        _leaderBuys(400 ether);
        copyVault.copyBuy(follower, leader, token);
        vm.roll(vm.getBlockNumber() + 1);

        uint256 half = IERC20(token).balanceOf(leader) / 2;
        vm.startPrank(leader);
        IERC20(token).approve(address(router), half);
        vm.roll(vm.getBlockNumber() + 1);
        router.sell(token, half, 0, leader, _deadline());
        vm.stopPrank();

        (uint128 before,) = copyVault.positions(follower, token);
        vm.roll(vm.getBlockNumber() + 1);
        copyVault.copySell(follower, leader, token);
        (uint128 after_,) = copyVault.positions(follower, token);
        assertApproxEqRel(after_, before / 2, 0.01e18, "about half sold");
    }

    function test_buyOnceAndThePerDayLimit() public {
        vm.prank(follower);
        copyVault.follow(leader, _rules(400 ether, 4_000 ether, 600 ether, 10_000, 500, 0, true, false, 0));
        _leaderBuys(400 ether);
        copyVault.copyBuy(follower, leader, token);
        vm.roll(vm.getBlockNumber() + 1);
        _leaderBuys(400 ether);
        vm.expectRevert(CopyVault.NothingToCopy.selector);
        copyVault.copyBuy(follower, leader, token);
    }

    function test_takeProfitSellsTheWholePosition() public {
        vm.prank(follower);
        copyVault.setExit(CopyVault.Exit(5_000, 0, 1_000));
        _leaderBuys(400 ether);
        copyVault.copyBuy(follower, leader, token);

        vm.expectRevert(CopyVault.NotYet.selector);
        copyVault.exit(follower, token);

        vm.prank(bob);
        router.buy{value: 3_200 ether}(token, 0, bob, _deadline());
        uint256 b0 = copyVault.balanceOf(follower);
        vm.roll(vm.getBlockNumber() + 1);
        copyVault.exit(follower, token);
        (uint128 left,) = copyVault.positions(follower, token);
        assertEq(left, 0);
        assertGt(copyVault.balanceOf(follower) - b0, 600 ether, "came out with the profit");
    }

    function test_theFollowerCanTakeEverythingOut() public {
        _leaderBuys(400 ether);
        copyVault.copyBuy(follower, leader, token);
        (uint128 tokens,) = copyVault.positions(follower, token);

        vm.roll(vm.getBlockNumber() + 1);
        vm.startPrank(follower);
        copyVault.withdrawTokens(token, tokens, follower);
        uint256 rest = copyVault.balanceOf(follower);
        vm.roll(vm.getBlockNumber() + 1);
        copyVault.withdraw(rest, follower);
        vm.stopPrank();
        assertEq(IERC20(token).balanceOf(follower), tokens);
        assertEq(copyVault.balanceOf(follower), 0);
        assertEq(address(copyVault).balance, 0);
    }

    function test_unfollowStopsCopies() public {
        vm.prank(follower);
        copyVault.unfollow(leader);
        _leaderBuys(400 ether);
        vm.expectRevert(CopyVault.NotFollowing.selector);
        copyVault.copyBuy(follower, leader, token);
    }

    function test_strayZroIsRefused() public {
        vm.prank(alice);
        (bool ok,) = address(copyVault).call{value: 400 ether}("");
        assertFalse(ok);
    }
}
