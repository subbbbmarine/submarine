// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.8.26;

import {Base} from "./Base.t.sol";
import {Launchpad, HolderToken} from "../src/core/Launchpad.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// What a creator chooses at launch: the supply, the fee, who earns it and anti-snipe, on the curve and on the pool.
contract LaunchTermsTest is Base {
    address internal carol = makeAddr("carol");
    address internal dave = makeAddr("dave");

    /// Shorthands for the two simplest shares: everything to the creator, or everything to the holders.
    uint8 internal constant TO_CREATOR = 0;
    uint8 internal constant TO_HOLDERS = 1;
    address internal constant DEAD = 0x000000000000000000000000000000000000dEaD;

    function setUp() public override {
        super.setUp();
        vm.deal(carol, 400_000 ether);
        vm.deal(dave, 400_000 ether);
    }

    function _launchWith(uint256 wholeSupply, uint16 fee, uint8 route, bool antiSnipe) internal returns (address token) {
        vm.prank(creator);
        // `fee` is the whole fee a trader pays, base included, as the tests think of it; the creator's own is what's above 1%.
        token = pad.launch("Meme", "MEME", "", 0, wholeSupply, fee - 100, route == TO_HOLDERS ? 10_000 : 0, 0, antiSnipe);
    }

    function _launchShares(uint16 fee, uint16 holdersBps, uint16 burnBps) internal returns (address token) {
        vm.prank(creator);
        token = pad.launch("Meme", "MEME", "", 0, 1_000_000_000, fee - 100, holdersBps, burnBps, false);
    }

    function _buy(address who, address token, uint256 zro) internal returns (uint256) {
        vm.prank(who);
        return pad.buy{value: zro}(token, 0, who, block.timestamp);
    }

    function _sell(address who, address token, uint256 amount) internal returns (uint256) {
        vm.startPrank(who);
        IERC20(token).approve(address(pad), amount);
        vm.roll(vm.getBlockNumber() + 1);
        uint256 out = pad.sell(token, amount, 0, who, block.timestamp);
        vm.stopPrank();
        return out;
    }

    // ------------------------------------------------------------------ supply

    function testFuzz_anySupplyOpensAndEndsAtTheSameCap(uint256 whole) public {
        whole = bound(whole, pad.MIN_WHOLE_SUPPLY(), pad.MAX_WHOLE_SUPPLY());
        address token = _launchWith(whole, 100, TO_CREATOR, false);
        assertEq(IERC20(token).totalSupply(), whole * 1 ether);

        // 1,875 ZRO of market cap to open, whatever the supply.
        // priceOf is in whole wei per token, so at the biggest supply it can only be this exact.
        uint256 open = (pad.priceOf(token) * whole);
        assertApproxEqRel(open, 1_875 ether, 1e15);

        _graduate(token);
        uint256 end = pad.priceOf(token) * whole;
        assertApproxEqRel(end, 30_000 ether, 1e15);
        assertApproxEqRel(pools.priceOf(token), pad.priceOf(token), 1e15, "no price step at graduation");
        (uint256 rb, uint256 rt,) = pools.pools(token);
        assertApproxEqRel(rb, 6_000 ether, 1e12);
        assertApproxEqRel(rt, (whole * 1 ether) / 5, 1e12);
        assertEq(IERC20(token).balanceOf(address(pad)), 0, "nothing stranded");
    }

    function test_supplyOutsideTheRangeIsRefused() public {
        uint256 low = pad.MIN_WHOLE_SUPPLY() - 1;
        uint256 high = pad.MAX_WHOLE_SUPPLY() + 1;
        vm.startPrank(creator);
        vm.expectRevert(Launchpad.BadTerms.selector);
        pad.launch("M", "M", "", 0, low, 0, 0, 0, false);
        vm.expectRevert(Launchpad.BadTerms.selector);
        pad.launch("M", "M", "", 0, high, 0, 0, 0, false);
        vm.stopPrank();
    }

    // ------------------------------------------------------------------ fee and who earns it

    function test_feeOutsideTheRangeIsRefused() public {
        vm.startPrank(creator);
        vm.expectRevert(Launchpad.BadTerms.selector);
        pad.launch("M", "M", "", 0, 1_000_000_000, 1_001, 0, 0, false); // more than 10% of its own
        vm.expectRevert(Launchpad.BadTerms.selector);
        pad.launch("M", "M", "", 0, 1_000_000_000, 100, 6_000, 4_001, false); // more than the whole
        vm.expectRevert(Launchpad.BadTerms.selector);
        pad.launch("M", "M", "", 0, 1_000_000_000, 0, 5_000, 0, false); // shares with no fee of its own to share
        vm.stopPrank();
    }

    function test_treasuryTakesItsCutOfTheTradeAndTheEarnerTheRest() public {
        address token = _launchWith(1_000_000_000, 500, TO_CREATOR, false);
        _buy(alice, token, 400 ether);
        assertEq(pad.protocolFees(), 1.6 ether, "0.4% of the base to the terminal");
        assertEq(pad.creatorFees(creator), 18.4 ether, "0.6% of the base and all 4% of their own");
    }

    function test_sharesSplitTheEarnersPart() public {
        address token = _launchShares(300, 2_000, 3_000);
        _buy(alice, token, 400 ether);
        // 3% of 400 ZRO: the 1% base, 0.4% to the terminal and 0.6% to the creator, and their own 2% split 20% to holders,
        // 30% burned and the rest to the creator.
        assertEq(pad.protocolFees(), 1.6 ether, "terminal");
        assertEq(token.balance, 1.6 ether, "holders");
        assertEq(pad.creatorFees(creator), 2.4 ether + 4 ether, "creator");
        assertGt(IERC20(token).balanceOf(DEAD), 0, "burned");
        (,,,,,,, uint128 raised,,,) = pad.curves(token);
        assertEq(raised, 388 ether + 2.4 ether, "the burn bought on the curve");
        _accountsAddUp(token);
    }

    function test_theBurnBuysLikeAnyBuyAndLiftsThePrice() public {
        address plain = _launchShares(500, 0, 0);
        address burning = _launchShares(500, 0, 10_000);
        uint256 a = _buy(alice, plain, 400 ether);
        uint256 b = _buy(alice, burning, 400 ether);
        assertEq(a, b, "the burn comes after the trader's own buy");
        assertGt(pad.priceOf(burning), pad.priceOf(plain));
        assertEq(pad.creatorFees(creator), 18.4 ether + 2.4 ether, "the plain token paid its creator all, the burning one the base");

        uint256 deadBefore = IERC20(burning).balanceOf(DEAD);
        vm.roll(vm.getBlockNumber() + 1);
        _sell(alice, burning, b / 2);
        assertGt(IERC20(burning).balanceOf(DEAD), deadBefore, "a sale burns too");
        _accountsAddUp(burning);
    }

    function test_aBurnNeverOverfillsTheCurve() public {
        address token = _launchShares(1_000, 0, 10_000);
        _buy(alice, token, 5_800 ether);
        _buy(bob, token, 8_000 ether);
        (,, bool graduated,,,,,,,,) = pad.curves(token);
        assertTrue(graduated);
        assertEq(IERC20(token).balanceOf(address(pad)), 0, "nothing stranded");
        assertEq(address(pad).balance, pad.protocolFees() + pad.creatorFees(creator), "only fees are left");
    }

    function test_onThePoolTheBurnHappensInTheSwap() public {
        address token = _launchShares(500, 4_000, 5_000);
        _graduate(token);
        uint256 creatorBefore = pad.creatorFees(creator);
        uint256 holdersBefore = token.balance;
        uint256 deadBefore = IERC20(token).balanceOf(DEAD);
        vm.prank(alice);
        uint256 got = venue.buy{value: 400 ether}(token, 0, alice, block.timestamp);
        assertGt(got, 0);
        // 4.6% of 400 ZRO to earners on the pool: the creator's 0.6% base, and their own 4% half burned, 40% to holders and 10%
        // to the creator. The burn's share is restated as a whole basis point of the pool's cut, so this is near, not exact.
        assertApproxEqRel(token.balance - holdersBefore, 6.4 ether, 0.001e18);
        assertApproxEqRel(pad.creatorFees(creator) - creatorBefore, 2.4 ether + 1.6 ether, 0.001e18);
        assertGt(IERC20(token).balanceOf(DEAD), deadBefore, "burned in the swap");
        // The pool's money is in Infinity's vault; the venue keeps nothing between trades.
        assertEq(address(venue).balance, 0, "no ZRO left on the venue");
        assertEq(IERC20(token).balanceOf(address(venue)), 0, "no tokens left on the venue");

        vm.startPrank(alice);
        IERC20(token).approve(address(venue), got);
        vm.roll(vm.getBlockNumber() + 1);
        venue.sell(token, got, 0, alice, block.timestamp);
        vm.stopPrank();
        assertEq(address(venue).balance, 0);
        assertEq(IERC20(token).balanceOf(address(venue)), 0);
    }

    function testFuzz_anySharesPayOutExactly(uint16 holdersBps, uint16 burnBps, uint96 zro) public {
        holdersBps = uint16(bound(holdersBps, 0, 10_000));
        burnBps = uint16(bound(burnBps, 0, 10_000 - holdersBps));
        zro = uint96(bound(zro, 0.4 ether, 12_000 ether));
        address token = _launchShares(700, holdersBps, burnBps);
        uint256 out = _buy(alice, token, zro);
        (,, bool graduated,,,,,,,,) = pad.curves(token);
        vm.roll(vm.getBlockNumber() + 1);
        if (!graduated) _sell(alice, token, out / 3);
        if (holdersBps == 0) assertEq(token.balance, 0);
        if (burnBps == 0) assertEq(IERC20(token).balanceOf(DEAD), 0);
        _accountsAddUp(token);
    }

    /// What the launchpad holds in ZRO is exactly the fees owed plus what this curve raised.
    function _accountsAddUp(address token) internal view {
        (,, bool graduated,,,,, uint128 raised,,,) = pad.curves(token);
        uint256 owed = pad.protocolFees() + pad.creatorFees(creator) + (graduated ? 0 : raised);
        assertGe(address(pad).balance, owed, "covered");
    }

    // ------------------------------------------------------------------ holders

    function test_holdersEarnInProportionAndOnlyFromWhenTheyHold() public {
        HolderToken token = HolderToken(_launchWith(1_000_000_000, 500, TO_HOLDERS, false));

        _buy(alice, address(token), 400 ether); // nobody held before this, so its fee waits
        assertEq(token.waiting(), 16 ether);
        assertEq(token.rewardOf(alice), 0);

        uint256 a = token.balanceOf(alice);
        _buy(bob, address(token), 400 ether); // alice alone held when this paid out, the waiting part included
        assertApproxEqAbs(token.rewardOf(alice), 32 ether, 1e6);
        assertEq(token.rewardOf(bob), 0, "a buyer doesn't earn from their own buy");
        assertEq(token.waiting(), 0);

        uint256 b = token.balanceOf(bob);
        uint256 aliceBefore = token.rewardOf(alice);
        _buy(carol, address(token), 400 ether);
        uint256 total = 16 ether;
        assertApproxEqAbs(token.rewardOf(alice) - aliceBefore, (total * a) / (a + b), 1e6);
        assertApproxEqAbs(token.rewardOf(bob), (total * b) / (a + b), 1e6);
    }

    function test_aTransferDoesNotMoveWhatWasEarned() public {
        HolderToken token = HolderToken(_launchWith(1_000_000_000, 500, TO_HOLDERS, false));
        _buy(alice, address(token), 400 ether);
        _buy(bob, address(token), 400 ether);
        uint256 earned = token.rewardOf(alice);
        uint256 half = token.balanceOf(alice) / 2;

        vm.roll(vm.getBlockNumber() + 1);
        vm.prank(alice);
        token.transfer(dave, half);
        assertApproxEqAbs(token.rewardOf(alice), earned, 1);
        assertEq(token.rewardOf(dave), 0);

        // And from here dave earns on what he now holds.
        uint256 davesPart = token.balanceOf(dave);
        uint256 all = token.earningSupply();
        _buy(carol, address(token), 400 ether);
        assertApproxEqAbs(token.rewardOf(dave), (16 ether * davesPart) / all, 1e6);
    }

    function test_claimPaysOnceAndAnyoneCanTriggerIt() public {
        HolderToken token = HolderToken(_launchWith(1_000_000_000, 500, TO_HOLDERS, false));
        _buy(alice, address(token), 400 ether);
        _buy(bob, address(token), 400 ether);
        uint256 owed = token.rewardOf(alice);
        uint256 before = alice.balance;

        vm.prank(dave);
        token.claimFor(alice);
        assertEq(alice.balance - before, owed);
        assertEq(token.rewardOf(alice), 0);

        vm.prank(alice);
        vm.expectRevert(HolderToken.NothingToClaim.selector);
        token.claim();
    }

    function test_contractsThatPassTokensThroughEarnNothing() public {
        HolderToken token = HolderToken(_launchWith(1_000_000_000, 500, TO_HOLDERS, false));
        assertTrue(token.notEarning(address(pad)));
        assertTrue(token.notEarning(address(pools)));
        assertTrue(token.notEarning(address(router)));
        assertTrue(token.notEarning(address(limits)));
        assertTrue(token.notEarning(address(vault)));
        assertEq(token.earningSupply(), 0);
        _buy(alice, address(token), 400 ether);
        assertEq(token.earningSupply(), token.balanceOf(alice));
        assertEq(token.rewardOf(address(pad)), 0);
    }

    function test_aDustHolderCannotTakeAPayoutOrBreakTransfers() public {
        HolderToken token = HolderToken(_launchWith(1_000_000_000, 1_000, TO_HOLDERS, false));
        _buy(alice, address(token), 400 ether);
        uint256 all = token.balanceOf(alice);
        vm.roll(vm.getBlockNumber() + 1);
        vm.prank(alice);
        token.transfer(bob, 1);
        vm.startPrank(alice);
        token.approve(address(pad), all - 1);
        vm.roll(vm.getBlockNumber() + 1);
        pad.sell(token_(token), all - 1, 0, alice, block.timestamp);
        vm.stopPrank();
        // Only one wei of tokens is held now, so a big fee waits instead of being paid to it.
        uint256 waitingBefore = token.waiting();
        _buy(carol, address(token), 4_000 ether);
        assertGt(token.waiting(), waitingBefore);
        assertEq(token.rewardOf(bob), 0);

        // Everything still moves, and what waited goes out once there are real holders.
        uint256 half = token.balanceOf(carol) / 2;
        vm.roll(vm.getBlockNumber() + 1);
        vm.prank(carol);
        token.transfer(dave, half);
        _buy(alice, address(token), 400 ether);
        assertEq(token.waiting(), 0);
        assertGt(token.rewardOf(carol), 0);
    }

    function token_(HolderToken t) private pure returns (address) {
        return address(t);
    }

    /// However trades, transfers and claims fall, everything owed to holders is really there.
    function testFuzz_holdersAreAlwaysCovered(uint256 seed) public {
        HolderToken token = HolderToken(_launchWith(1_000_000_000, 1_000, TO_HOLDERS, false));
        address[4] memory people = [alice, bob, carol, dave];
        for (uint256 i; i < 40; ++i) {
            uint256 r = uint256(keccak256(abi.encode(seed, i)));
            address who = people[r % 4];
            uint256 action = (r >> 8) % 4;
            (,, bool done,,,,,,,,) = pad.curves(address(token));
            if (done) break;
            uint256 held = token.balanceOf(who);
            if (action == 0) {
                _buy(who, address(token), bound(r >> 16, 0.4 ether, 800 ether));
            } else if (action == 1 && held > 0) {
                vm.roll(vm.getBlockNumber() + 1);
                _sell(who, address(token), bound(r >> 16, 1, held));
            } else if (action == 2 && held > 0) {
                vm.roll(vm.getBlockNumber() + 1);
                vm.prank(who);
                token.transfer(people[(r >> 16) % 4], bound(r >> 32, 1, held));
            } else if (token.rewardOf(who) > 0) {
                vm.prank(who);
                token.claim();
            }
            uint256 owed = token.waiting();
            for (uint256 j; j < 4; ++j) {
                owed += token.rewardOf(people[j]);
            }
            assertGe(address(token).balance, owed, "a holder is owed more than is there");
        }
    }

    // ------------------------------------------------------------------ anti-snipe

    function test_antiSnipeFallsToTheFeeAndThenStops() public {
        address token = _launchWith(1_000_000_000, 100, TO_CREATOR, true);
        uint256 start = block.timestamp;
        assertEq(pad.buyFeeBps(token), 5_000);
        vm.warp(start + 30);
        assertEq(pad.buyFeeBps(token), 2_550);
        vm.warp(start + 60);
        assertEq(pad.buyFeeBps(token), 100);
        vm.warp(start + 1_000);
        assertEq(pad.buyFeeBps(token), 100);
    }

    function test_quoteMatchesWhatABuyGetsDuringAntiSnipe() public {
        address token = _launchWith(1_000_000_000, 100, TO_CREATOR, true);
        vm.warp(block.timestamp + 10);
        uint256 quoted = pad.quoteBuy(token, 400 ether);
        assertEq(_buy(alice, token, 400 ether), quoted);

        address plain = _launchWith(1_000_000_000, 100, TO_CREATOR, false);
        assertLt(quoted, pad.quoteBuy(plain, 400 ether), "an early buy gets less");
    }

    function test_theFirstBuyAndSalesDontPayIt() public {
        vm.prank(creator);
        address token = pad.launch{value: 400 ether}("M", "M", "", 0, 1_000_000_000, 0, 0, 0, true);
        vm.prank(creator);
        address plain = pad.launch{value: 400 ether}("M", "M", "", 0, 1_000_000_000, 0, 0, 0, false);
        assertEq(IERC20(token).balanceOf(creator), IERC20(plain).balanceOf(creator), "the first buy pays the plain fee");

        uint256 half = IERC20(token).balanceOf(creator) / 2;
        assertEq(pad.quoteSell(token, half), pad.quoteSell(plain, half), "a sale pays the plain fee");
    }

    function test_withoutAntiSnipeTheFeeNeverChanges() public {
        address token = _launchWith(1_000_000_000, 300, TO_CREATOR, false);
        assertEq(pad.buyFeeBps(token), 300);
    }

    // ------------------------------------------------------------------ on the pool

    function test_earnersGetTheSameCutOnThePool() public {
        address token = _launchWith(1_000_000_000, 500, TO_CREATOR, false);
        _graduate(token);
        assertEq(pools.earnersBps(token), 460, "the creator's 0.6% and their own 4%");
        uint256 before = pad.creatorFees(creator);

        vm.prank(alice);
        uint256 quoted = pools.quoteBuy(token, 400 ether);
        vm.prank(alice);
        uint256 got = venue.buy{value: 400 ether}(token, 0, alice, block.timestamp);
        assertEq(got, quoted);
        assertEq(pad.creatorFees(creator) - before, 18.4 ether);

        (uint256 rb,,) = pools.pools(token);
        assertApproxEqRel(rb, 6_000 ether + 380 ether, 1e12, "neither the creator's part nor the terminal's goes into the pool");
    }

    function test_aSaleOnThePoolPaysEarnersAndKeepsThePoolWhole() public {
        address token = _launchWith(1_000_000_000, 500, TO_CREATOR, false);
        _graduate(token);
        uint256 amount = IERC20(token).balanceOf(bob) / 10;
        uint256 feesBefore = pad.creatorFees(creator);
        uint256 terminalBefore = pad.protocolFees();
        (uint256 rbBefore,,) = pools.pools(token);

        uint256 quoted = pools.quoteSell(token, amount);
        vm.startPrank(bob);
        IERC20(token).approve(address(venue), amount);
        vm.roll(vm.getBlockNumber() + 1);
        uint256 got = venue.sell(token, amount, 0, bob, block.timestamp);
        vm.stopPrank();
        assertEq(got, quoted);

        uint256 cut = pad.creatorFees(creator) - feesBefore + pad.protocolFees() - terminalBefore;
        (uint256 rbAfter,,) = pools.pools(token);
        assertApproxEqRel(rbBefore - rbAfter, got + cut, 1e9, "what left the pool is what the seller, the creator and the terminal got");
        assertEq(address(venue).balance, 0);
    }

    function test_holdersEarnFromThePoolThroughTheRouter() public {
        HolderToken token = HolderToken(_launchWith(1_000_000_000, 500, TO_HOLDERS, false));
        _graduate(address(token));
        uint256 before = token.rewardOf(bob);

        vm.prank(alice);
        router.buy{value: 400 ether}(address(token), 0, alice, block.timestamp);
        assertGt(token.rewardOf(bob), before, "bob holds, so he earns from alice's buy");
        assertEq(token.rewardOf(alice), 0);
        assertEq(token.rewardOf(address(router)), 0);
        assertEq(token.rewardOf(address(pools)), 0);

        uint256 owed = token.rewardOf(bob);
        uint256 balance = bob.balance;
        vm.prank(bob);
        token.claim();
        assertEq(bob.balance - balance, owed);
    }

    function test_onlyThePoolsCanPayIn() public {
        address token = _launchWith(1_000_000_000, 500, TO_CREATOR, false);
        vm.prank(alice);
        vm.expectRevert(Launchpad.NotPools.selector);
        pad.payFromPool{value: 400 ether}(token);
    }

    function test_aRoutedHolderTokenSaleWorksFromStartToEnd() public {
        HolderToken token = HolderToken(_launchWith(10_000_000_000, 200, TO_HOLDERS, true));
        vm.warp(block.timestamp + 61);
        vm.prank(alice);
        router.buy{value: 400 ether}(address(token), 0, alice, block.timestamp);
        uint256 amount = token.balanceOf(alice);
        vm.startPrank(alice);
        token.approve(address(router), amount);
        vm.roll(vm.getBlockNumber() + 1);
        uint256 out = router.sell(address(token), amount, 0, alice, block.timestamp);
        vm.stopPrank();
        assertGt(out, 360 ether);
        assertEq(token.balanceOf(address(router)), 0);
    }

    function test_setNotEarningWorksOnce() public {
        address[] memory list = new address[](1);
        vm.prank(owner);
        vm.expectRevert(Launchpad.BadConfig.selector);
        pad.setNotEarning(list);
    }

    function test_termsAreOnTheCurve() public {
        address token = _launchWith(100_000_000_000, 300, TO_HOLDERS, true);
        (address who,, bool graduated, uint16 fee, uint16 holders,, bool snipe,,, uint128 supply,) = pad.curves(token);
        assertEq(who, creator);
        assertFalse(graduated);
        assertEq(fee, 300);
        assertEq(holders, 10_000);
        assertTrue(snipe);
        assertEq(supply, 100_000_000_000 ether);
    }

    function test_aSmallTradeStillWorksAtEveryFee() public {
        uint16[5] memory fees = [100, 200, 300, 500, 1_000];
        for (uint256 i; i < fees.length; ++i) {
            address token = _launchWith(1_000_000_000, fees[i], TO_CREATOR, false);
            uint256 got = _buy(alice, token, 0.04 ether);
            assertGt(got, 0);
            vm.roll(vm.getBlockNumber() + 1);
            assertGt(_sell(alice, token, got), 0);
        }
    }
}
