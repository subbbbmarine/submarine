// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Base} from "./Base.t.sol";
import {Launchpad, HoldsOneBlock, HolderToken} from "../src/core/Launchpad.sol";
import {Router} from "../src/periphery/Router.sol";
import {CopyVault} from "../src/periphery/CopyVault.sol";

/// The 1% base every token pays, the creator's own fee on top, and what a trader's rank takes off the terminal's cut.
contract BaseAndOwnFeeTest is Base {
    function _launchOwn(uint16 dev, uint16 holdersBps, uint16 burnBps) internal returns (address token) {
        vm.prank(creator);
        token = pad.launch("Own", "OWN", "", 0, 1_000_000_000, dev, holdersBps, burnBps, false);
    }

    function test_withNoFeeOfItsOwnATokenPaysTheBaseOnly() public {
        address token = _launchOwn(0, 0, 0);
        (,,, uint16 fee,,,,,,, uint16 cut) = pad.curves(token);
        assertEq(fee, 100);
        assertEq(cut, 40);

        vm.prank(alice);
        pad.buy{value: 400 ether}(token, 0, alice, block.timestamp);
        assertEq(pad.protocolFees(), 1.6 ether, "0.4% to the terminal");
        assertEq(pad.creatorFees(creator), 2.4 ether, "0.6% to the creator");
    }

    function test_theOwnFeeIsCappedAtTenPercent() public {
        vm.prank(creator);
        vm.expectRevert(Launchpad.BadTerms.selector);
        pad.launch("Own", "OWN", "", 0, 1_000_000_000, 1_001, 0, 0, false);

        address token = _launchOwn(1_000, 0, 0);
        (,,, uint16 fee,,,,,,,) = pad.curves(token);
        assertEq(fee, 1_100, "the base and 10% on top");
    }

    /// The creator's split only ever cuts up their own fee: the base goes the same way on every token.
    function test_theSplitCutsUpOnlyTheOwnFee() public {
        address token = _launchOwn(500, 6_000, 4_000); // 5%: 60% to holders, 40% bought back, none to the creator
        vm.prank(alice);
        pad.buy{value: 400 ether}(token, 0, alice, block.timestamp);
        assertEq(pad.protocolFees(), 1.6 ether);
        assertEq(pad.creatorFees(creator), 2.4 ether, "the creator still gets the base");
        assertEq(token.balance, 12 ether, "60% of 5% to holders");
        assertGt(IERC20(token).balanceOf(pad.DEAD()), 0, "and 40% bought back and burned");
    }

    function test_onThePoolTheBaseIsTheSameThroughTheRouterOrNot() public {
        address token = _launchOwn(200, 0, 0);
        _graduate(token);
        assertEq(pools.earnersBps(token), 260);

        // Through the terminal
        uint256 c0 = pad.creatorFees(creator);
        uint256 t0 = pad.protocolFees();
        vm.prank(alice);
        router.buy{value: 400 ether}(token, 0, alice, _deadline());
        assertEq(pad.protocolFees() - t0, 1.6 ether, "0.4% to the terminal");
        assertEq(pad.creatorFees(creator) - c0, 10.4 ether, "0.6% and the 2% of their own");

        // Straight to the pool's venue, around the router: the same split. A trade on Infinity around the venue too, see
        // PoolsTest.test_aTradeAroundTheVenueStillPaysTheFee.
        c0 = pad.creatorFees(creator);
        t0 = pad.protocolFees();
        vm.prank(bob);
        venue.buy{value: 400 ether}(token, 0, bob, _deadline());
        assertEq(pad.protocolFees() - t0, 1.6 ether, "still 0.4% to the terminal");
        assertEq(pad.creatorFees(creator) - c0, 10.4 ether);
    }

    function test_theOwnerCantTakeMoreOrLessOnOurPool() public view {
        // The pool takes the terminal's 0.4% itself and the router adds nothing on it, so no venue fee changes what a token pays.
        (address listed, uint16 feeBps,) = router.venueAt(1);
        assertEq(listed, address(venue));
        assertEq(feeBps, 0);
        assertEq(pools.PROTOCOL_BPS(), 40);
    }
}

contract RankTest is Base {
    address internal token;

    function setUp() public override {
        super.setUp();
        token = _launch();
        vm.deal(alice, 40_000_000 ether);
    }

    function _roundTrip(address who, uint256 zro) internal {
        vm.prank(who);
        uint256 got = router.buy{value: zro}(token, 0, who, _deadline());
        vm.roll(vm.getBlockNumber() + 1);
        vm.startPrank(who);
        IERC20(token).approve(address(router), got);
        router.sell(token, got, 0, who, _deadline());
        vm.stopPrank();
    }

    function test_theMarksAreFixed() public view {
        uint256[6] memory from = [uint256(0), 2_000 ether, 10_000 ether, 40_000 ether, 200_000 ether, 1_000_000 ether];
        uint256[6] memory off = [uint256(0), 5, 10, 15, 20, 25];
        for (uint256 r; r <= router.RANKS(); ++r) {
            (uint256 v, uint256 o) = router.rankAt(r);
            assertEq(v, from[r]);
            assertEq(o, off[r]);
        }
    }

    function test_volumeCountsBuysAndSalesThroughTheRouter() public {
        _roundTrip(alice, 400 ether);
        uint256 v = router.volumeOf(alice);
        assertGt(v, 760 ether, "the buy and the sale both count");
        assertLt(v, 800 ether);
        assertEq(router.rankOf(alice), 0);
    }

    function test_aTradeStraightToTheCurveDoesntCount() public {
        vm.prank(alice);
        pad.buy{value: 400 ether}(token, 0, alice, _deadline());
        assertEq(router.volumeOf(alice), 0);
    }

    function test_passingAMarkRanksUpAndTheNextTradePaysLess() public {
        vm.expectEmit(true, false, false, false, address(router));
        emit Router.RankUp(alice, 1, 0);
        vm.prank(alice);
        router.buy{value: 2_000 ether}(token, 0, alice, _deadline());
        assertEq(router.rankOf(alice), 1);
        assertEq(router.discountOf(alice), 5);
        assertEq(pad.buyFeeBpsFor(token, alice), 95);
        assertEq(pad.buyFeeBpsFor(token, bob), 100);

        // The same buy, alice ranked and bob not: she pays 0.95%, the creator gets the same, the terminal less.
        uint256 t0 = pad.protocolFees();
        uint256 c0 = pad.creatorFees(creator);
        vm.prank(alice);
        router.buy{value: 400 ether}(token, 0, alice, _deadline());
        assertEq(pad.protocolFees() - t0, 1.4 ether, "0.35% to the terminal");
        assertEq(pad.creatorFees(creator) - c0, 2.4 ether, "the creator's 0.6% doesn't change");

        t0 = pad.protocolFees();
        vm.prank(bob);
        router.buy{value: 400 ether}(token, 0, bob, _deadline());
        assertEq(pad.protocolFees() - t0, 1.6 ether, "an unranked trader pays the full 0.4%");
    }

    function test_theTopRankLeavesTheTerminalAQuarterOfItsCut() public {
        vm.prank(alice);
        router.buy{value: 1_000_000 ether}(token, 0, alice, _deadline()); // fills the curve, the rest comes back
        // Not all of it was used, so finish the volume on the pool.
        while (router.rankOf(alice) < router.RANKS()) {
            vm.prank(alice);
            router.buy{value: 400_000 ether}(token, 0, alice, _deadline());
        }
        assertEq(router.discountOf(alice), 25);

        // On the pool the hook asks the router whose trade it is, through the venue.
        uint256 t0 = pad.protocolFees();
        vm.prank(alice);
        router.buy{value: 4_000 ether}(token, 0, alice, _deadline());
        assertEq(pad.protocolFees() - t0, 6 ether, "0.15% on the pool");
    }

    function test_aSaleIsDiscountedOnTheCurveToo() public {
        vm.prank(alice);
        uint256 got = router.buy{value: 4_000 ether}(token, 0, alice, _deadline());
        assertEq(router.rankOf(alice), 1);
        vm.roll(vm.getBlockNumber() + 1);

        uint256 t0 = pad.protocolFees();
        vm.startPrank(alice);
        IERC20(token).approve(address(router), got);
        router.sell(token, got / 2, 0, alice, _deadline());
        vm.stopPrank();
        uint256 cut = pad.protocolFees() - t0;
        // 0.35% of what left the curve; the sale's gross isn't known here, so check the share against the creator's 0.6%.
        assertGt(cut, 0);
        assertLt(cut * 60, pad.creatorFees(creator) * 40, "below the unranked 0.4 for every 0.6");
    }

    /// A ranked trader's sale on the pool pays the terminal less too: the hook asks the router whose trade it is.
    function test_aSaleIsDiscountedOnThePoolToo() public {
        address carol = makeAddr("carol");
        _graduate(token); // bob holds what the curve sold
        vm.prank(alice);
        router.buy{value: 2_000 ether}(token, 0, alice, _deadline()); // alice ranks up, on the pool
        assertEq(router.rankOf(alice), 1);
        vm.roll(vm.getBlockNumber() + 1);
        uint256 amount = IERC20(token).balanceOf(bob) / 100;
        vm.startPrank(bob);
        IERC20(token).transfer(alice, amount);
        IERC20(token).transfer(carol, amount);
        vm.stopPrank();

        // The same sale from the same pool, by alice and by carol, who has no rank.
        uint256 snapshot = vm.snapshotState();
        uint256 aliceCut = _poolSaleCut(alice, amount);
        vm.revertToState(snapshot);
        uint256 carolCut = _poolSaleCut(carol, amount);
        assertGt(carolCut, 0);
        assertApproxEqAbs(aliceCut * 40, carolCut * 35, 40 * 35, "35 of the terminal's 40 bps");
    }

    function _poolSaleCut(address who, uint256 amount) internal returns (uint256) {
        uint256 t0 = pad.protocolFees();
        vm.startPrank(who);
        IERC20(token).approve(address(router), amount);
        router.sell(token, amount, 0, who, _deadline());
        vm.stopPrank();
        return pad.protocolFees() - t0;
    }
}

/// Coins from the curve or the pool stay where they landed until the next block.
contract HoldTest is Base {
    address internal token;

    function setUp() public override {
        super.setUp();
        token = _launch();
    }

    function test_aSandwichCantSellInTheBlockItBought() public {
        vm.prank(bob);
        uint256 got = router.buy{value: 400 ether}(token, 0, bob, _deadline()); // the front-run
        vm.prank(alice);
        router.buy{value: 400 ether}(token, 0, alice, _deadline()); // the victim

        vm.startPrank(bob);
        IERC20(token).approve(address(router), got);
        vm.expectRevert();
        router.sell(token, got, 0, bob, _deadline()); // the back-run
        vm.stopPrank();

        assertEq(HoldsOneBlock(token).boughtInBlock(bob), vm.getBlockNumber());
        vm.roll(vm.getBlockNumber() + 1);
        vm.prank(bob);
        router.sell(token, got, 0, bob, _deadline());
    }

    /// On Infinity the coins come out of its vault, through Submarine's venue, and the buyer is held the same way.
    function test_aSandwichOnThePoolCantSellInTheBlockItBoughtEither() public {
        _graduate(token);
        vm.roll(vm.getBlockNumber() + 1);
        vm.prank(alice);
        uint256 got = router.buy{value: 400 ether}(token, 0, alice, _deadline()); // the front-run
        vm.prank(bob);
        router.buy{value: 400 ether}(token, 0, bob, _deadline()); // the victim

        vm.startPrank(alice);
        IERC20(token).approve(address(router), got);
        vm.expectRevert();
        router.sell(token, got, 0, alice, _deadline()); // the back-run
        IERC20(token).approve(address(venue), got);
        vm.expectRevert(HoldsOneBlock.BoughtThisBlock.selector);
        venue.sell(token, got, 0, alice, _deadline()); // nor straight to the venue
        vm.stopPrank();

        vm.roll(vm.getBlockNumber() + 1);
        vm.startPrank(alice);
        IERC20(token).approve(address(router), got);
        router.sell(token, got, 0, alice, _deadline());
        vm.stopPrank();
    }

    function test_noHandingTheCoinsToAnotherWalletInTheSameBlockEither() public {
        vm.prank(bob);
        uint256 got = pad.buy{value: 400 ether}(token, 0, bob, _deadline());
        vm.prank(bob);
        vm.expectRevert(HoldsOneBlock.BoughtThisBlock.selector);
        IERC20(token).transfer(alice, got);
    }

    function test_coinsSentByAWalletDontHoldTheOneThatGetsThem() public {
        vm.prank(bob);
        uint256 got = pad.buy{value: 400 ether}(token, 0, bob, _deadline());
        vm.roll(vm.getBlockNumber() + 1);
        vm.prank(bob);
        IERC20(token).transfer(alice, got);
        vm.startPrank(alice);
        IERC20(token).approve(address(pad), got);
        pad.sell(token, got, 0, alice, _deadline()); // same block as she got them, and that's fine
        vm.stopPrank();
    }

    function test_theMarketItselfKeepsTradingInTheSameBlock() public {
        for (uint256 i; i < 5; ++i) {
            vm.prank(i % 2 == 0 ? alice : bob);
            pad.buy{value: 400 ether}(token, 0, i % 2 == 0 ? alice : bob, _deadline());
        }
        _graduate(token); // the launchpad hands its coins to the pool in the same block
        assertEq(HoldsOneBlock(token).boughtInBlock(address(pad)), 0);
        assertEq(HoldsOneBlock(token).boughtInBlock(address(pools)), 0, "the hook passes the LP coins on to the vault");
        assertEq(HoldsOneBlock(token).boughtInBlock(address(infinityVault)), 0);
        assertEq(HoldsOneBlock(token).boughtInBlock(address(venue)), 0);
        vm.prank(alice);
        venue.buy{value: 400 ether}(token, 0, alice, _deadline());
        assertEq(HoldsOneBlock(token).boughtInBlock(address(venue)), 0, "the venue passes a buy on and is never held");
        assertEq(HoldsOneBlock(token).boughtInBlock(address(infinityVault)), 0);
    }

    function test_aHolderTokenHoldsToo() public {
        vm.prank(creator);
        address h = pad.launch("H", "H", "", 0, 1_000_000_000, 300, 10_000, 0, false);
        vm.prank(bob);
        uint256 got = pad.buy{value: 400 ether}(h, 0, bob, _deadline());
        vm.prank(bob);
        vm.expectRevert(HoldsOneBlock.BoughtThisBlock.selector);
        HolderToken(h).transfer(alice, got);
    }
}

/// Limit orders and copies trade through the router for someone, and count as that someone's trades.
contract ForwardedVolumeTest is Base {
    address internal token;
    address internal leader = makeAddr("leader");
    address internal follower = makeAddr("follower");

    function setUp() public override {
        super.setUp();
        token = _launch();
        vm.deal(leader, 40_000 ether);
        vm.deal(follower, 40_000 ether);
    }

    receive() external payable {}

    function test_aLimitBuyCountsForItsOwner() public {
        vm.prank(alice);
        uint256 id = limits.placeBuy{value: 400 ether}(token, 1, 0);
        limits.fill(id, 400 ether);
        assertGt(router.volumeOf(alice), 396 ether);
        assertEq(router.volumeOf(address(limits)), 0);
    }

    function test_aLimitSaleCountsForItsOwner() public {
        vm.prank(alice);
        uint256 got = router.buy{value: 800 ether}(token, 0, alice, _deadline());
        uint256 before = router.volumeOf(alice);
        vm.roll(vm.getBlockNumber() + 1);
        vm.startPrank(alice);
        IERC20(token).approve(address(limits), got);
        uint256 id = limits.placeSell(token, got, 1, 0);
        vm.stopPrank();
        limits.fill(id, got);
        assertGt(router.volumeOf(alice) - before, 760 ether, "the sale is alice's volume");
        assertEq(router.volumeOf(address(limits)), 0, "not the order book's");
    }

    function test_copiesCountForTheFollower() public {
        vm.prank(follower);
        copyVault.deposit{value: 2_000 ether}();
        vm.prank(follower);
        copyVault.follow(leader, CopyVault.Rules(400 ether, 1_200 ether, 2_000 ether, 10_000, 500, 10_000, 5_000, false, true, 0));
        vm.prank(leader);
        router.buy{value: 400 ether}(token, 0, leader, _deadline());

        copyVault.copyBuy(follower, leader, token);
        uint256 bought = router.volumeOf(follower);
        assertGt(bought, 0, "the copy is the follower's volume");
        assertEq(router.volumeOf(address(copyVault)), 0);

        uint256 held = IERC20(token).balanceOf(leader);
        vm.roll(vm.getBlockNumber() + 1);
        vm.startPrank(leader);
        IERC20(token).approve(address(router), held);
        router.sell(token, held, 0, leader, _deadline());
        vm.stopPrank();
        copyVault.copySell(follower, leader, token);
        assertGt(router.volumeOf(follower), bought, "and so is the copied sale");
        assertEq(router.volumeOf(address(copyVault)), 0);
    }

    function test_nobodyElseCanTradeInSomeoneElsesName() public {
        vm.prank(bob);
        vm.expectRevert(Router.NotForwarder.selector);
        router.buyFor{value: 400 ether}(token, 0, bob, _deadline(), alice);

        vm.prank(owner);
        vm.expectRevert(Router.BadConfig.selector);
        router.setForwarders(new address[](0));
    }
}
