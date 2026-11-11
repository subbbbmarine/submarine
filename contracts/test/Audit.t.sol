// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Base} from "./Base.t.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Launchpad} from "../src/core/Launchpad.sol";
import {LimitOrders} from "../src/periphery/LimitOrders.sol";
import {Receiver} from "./helpers/Receiver.sol";

/// @notice What the audit of 2026-11-07 found, held to the fixed behaviour.
contract AuditOwnerRefusesZroTest is Base {
    function _holding(Receiver who, uint256 zro) private returns (address token, uint256 held) {
        vm.deal(address(who), zro);
        token = _launch();
        vm.prank(address(who));
        pad.buy{value: zro}(token, 0, address(who), block.timestamp);
        held = IERC20(token).balanceOf(address(who));
        vm.prank(address(who));
        IERC20(token).approve(address(limits), held);
    }

    /// Cancelling used to revert when the owner refused its ZRO, which left the escrow with no way out.
    function test_cancelClosesTheOrderAndHoldsTheEscrowForAnOwnerThatRefusesZro() public {
        Receiver buyer = new Receiver();
        vm.deal(address(buyer), 400 ether);
        address token = _launch();

        uint256 id = buyer.placeBuy{value: 400 ether}(address(limits), token, 1, uint40(block.timestamp + 1 days));
        vm.prank(address(buyer));
        limits.cancel(id);

        assertFalse(limits.getOrder(id).open, "closed");
        assertEq(limits.credit(address(buyer)), 400 ether, "held for them");

        // It can't go to the wallet that refused it, so the owner names another.
        uint256 before = alice.balance;
        vm.roll(vm.getBlockNumber() + 1);
        vm.prank(address(buyer));
        limits.withdraw(alice);
        assertEq(alice.balance - before, 400 ether, "reached the address they named");
        assertEq(limits.credit(address(buyer)), 0, "gone from the books");
        assertEq(address(limits).balance, 0, "nothing left behind");
    }

    function test_withdrawCannotBeRepeatedOrSentNowhere() public {
        Receiver buyer = new Receiver();
        vm.deal(address(buyer), 400 ether);
        address token = _launch();
        uint256 id = buyer.placeBuy{value: 400 ether}(address(limits), token, 1, 0);
        vm.prank(address(buyer));
        limits.cancel(id);

        vm.roll(vm.getBlockNumber() + 1);
        vm.startPrank(address(buyer));
        vm.expectRevert(LimitOrders.BadOrder.selector);
        limits.withdraw(address(0));
        vm.roll(vm.getBlockNumber() + 1);
        vm.expectRevert(LimitOrders.BadOrder.selector);
        limits.withdraw(address(limits));
        vm.roll(vm.getBlockNumber() + 1);
        limits.withdraw(alice);
        vm.roll(vm.getBlockNumber() + 1);
        vm.expectRevert(LimitOrders.BadOrder.selector);
        limits.withdraw(alice);
        vm.stopPrank();

        vm.roll(vm.getBlockNumber() + 1);
        vm.expectRevert(LimitOrders.BadOrder.selector);
        vm.prank(bob);
        limits.withdraw(bob); // nothing is held for them
    }

    /// Filling a sale used to revert on paying the owner, so such an order could never fill.
    function test_aSaleFillsAndHoldsTheProceedsForAnOwnerThatRefusesZro() public {
        Receiver seller = new Receiver();
        (address token, uint256 held) = _holding(seller, 2_000 ether);
        vm.roll(vm.getBlockNumber() + 1);
        vm.prank(address(seller));
        uint256 id = limits.placeSell(token, held, 1, 0);

        uint256 k0 = keeper.balance;
        vm.roll(vm.getBlockNumber() + 1);
        vm.prank(keeper);
        limits.fill(id, held);

        assertFalse(limits.getOrder(id).open, "filled");
        assertEq(keeper.balance - k0, limits.runFee(), "the keeper still got paid");
        assertGt(limits.credit(address(seller)), 0, "the proceeds wait for them");
        assertEq(address(limits).balance, limits.credit(address(seller)), "and that's all the contract holds");
    }

    /// A buy that finishes the curve comes back partly refunded, and that refund used to revert the fill.
    function test_aRefundOnABuyThatFinishesTheCurveIsHeldForAnOwnerThatRefusesZro() public {
        Receiver buyer = new Receiver();
        vm.deal(address(buyer), 8_000 ether);
        address token = _launch();

        uint256 id = buyer.placeBuy{value: 8_000 ether}(address(limits), token, 1, 0);
        vm.roll(vm.getBlockNumber() + 1);
        vm.prank(keeper);
        limits.fill(id, 8_000 ether);

        (,, bool graduated,,,,,,,,) = pad.curves(token);
        assertTrue(graduated, "it finished the curve");
        assertGt(limits.credit(address(buyer)), 0, "the unused part waits for them");
    }

    /// A wallet that does take ZRO gets it directly and never meets the credit at all.
    function test_anOrdinaryOwnerIsPaidDirectly() public {
        address token = _launch();
        vm.prank(alice);
        uint256 id = limits.placeBuy{value: 400 ether}(token, 1, 0);
        uint256 before = alice.balance;
        vm.prank(alice);
        limits.cancel(id);
        assertEq(alice.balance - before, 400 ether);
        assertEq(limits.credit(alice), 0);
    }

    /// Whatever gas a keeper sends, it can't make an ordinary owner's payment fail and land in credit. Too little gas fails the whole fill.
    function test_aKeeperCannotStarveAPaymentIntoCredit() public {
        address token = _launch();
        vm.prank(bob);
        pad.buy{value: 800 ether}(token, 0, alice, block.timestamp);
        uint256 held = IERC20(token).balanceOf(alice);
        vm.startPrank(alice);
        IERC20(token).approve(address(limits), held);
        vm.roll(vm.getBlockNumber() + 1);
        uint256 id = limits.placeSell(token, held, 1, 0);
        vm.stopPrank();

        bool someFilled;
        for (uint256 gasGiven = 60_000; gasGiven < 800_000; gasGiven += 7_000) {
            uint256 snapshot = vm.snapshotState();
            vm.prank(keeper);
            try limits.fill{gas: gasGiven}(id, held) {
                someFilled = true;
            } catch {}
            assertEq(limits.credit(alice), 0, "never in credit");
            vm.revertToState(snapshot);
        }
        assertTrue(someFilled, "enough gas does fill it");
    }

    /// An expired order in a batch closes and holds the escrow too, and the rest of the batch goes on.
    function test_anExpiredOrderOfAnOwnerThatRefusesZroClosesThroughAFill() public {
        Receiver buyer = new Receiver();
        vm.deal(address(buyer), 400 ether);
        address token = _launch();
        uint256 id = buyer.placeBuy{value: 400 ether}(address(limits), token, 1, uint40(block.timestamp + 1 hours));

        vm.warp(block.timestamp + 2 hours);
        vm.roll(vm.getBlockNumber() + 1);
        vm.prank(keeper);
        limits.fill(id, 400 ether);

        assertFalse(limits.getOrder(id).open);
        assertEq(limits.credit(address(buyer)), 400 ether);
    }
}

contract AuditFeesTest is Base {
    /// Raising the fees after an order was placed used to stop it clearing, because its minimum was built from the old ones.
    function test_raisingTheFeesDoesNotTouchAnOpenOrder() public {
        address token = _launch();
        vm.prank(bob);
        pad.buy{value: 2_000 ether}(token, 0, bob, block.timestamp);

        // Priced exactly at today's market, so any extra fee would take it below its own minimum.
        uint256 part = 40 ether;
        uint256 runBefore = limits.runFee();
        uint256 out = pad.quoteBuy(token, part - runBefore);
        vm.prank(alice);
        uint256 id = limits.placeBuy{value: part}(token, out, 0);

        uint256 maxRun = limits.MAX_RUN_FEE();
        uint16 maxFee = uint16(limits.MAX_FEE_BPS());
        vm.prank(owner);
        limits.setConfig(maxFee, maxRun);

        uint256 k0 = keeper.balance;
        uint256 t0 = address(vault).balance;
        vm.roll(vm.getBlockNumber() + 1);
        vm.prank(keeper);
        limits.fill(id, part);

        assertFalse(limits.getOrder(id).open, "it still clears");
        assertEq(keeper.balance - k0, runBefore, "at the run fee it was placed under");
        assertEq(address(vault).balance, t0, "and with no fee added");
    }

    function test_anOrderPlacedAfterAChangeTakesTheNewFees() public {
        address token = _launch();
        uint256 maxRun = limits.MAX_RUN_FEE();
        vm.prank(owner);
        limits.setConfig(100, maxRun);

        vm.prank(alice);
        uint256 id = limits.placeBuy{value: 400 ether}(token, 1, 0);
        LimitOrders.Order memory o = limits.getOrder(id);
        assertEq(o.runFee, maxRun);
        assertEq(o.feeBps, 100);
    }

    /// A sale is checked against its minimum after the fees, so it's where a changed fee would bite hardest.
    function test_raisingTheFeesDoesNotTouchAnOpenSale() public {
        address token = _launch();
        vm.prank(bob);
        pad.buy{value: 800 ether}(token, 0, alice, block.timestamp);
        uint256 held = IERC20(token).balanceOf(alice);
        uint256 run = limits.runFee();
        uint256 minimum = pad.quoteSell(token, held) - run;

        vm.startPrank(alice);
        IERC20(token).approve(address(limits), held);
        vm.roll(vm.getBlockNumber() + 1);
        uint256 id = limits.placeSell(token, held, minimum, 0);
        vm.stopPrank();

        uint256 maxRun = limits.MAX_RUN_FEE();
        vm.prank(owner);
        limits.setConfig(100, maxRun);

        uint256 k0 = keeper.balance;
        vm.roll(vm.getBlockNumber() + 1);
        vm.prank(keeper);
        limits.fill(id, held);
        assertFalse(limits.getOrder(id).open);
        assertEq(keeper.balance - k0, run);
    }
}

contract AuditLaunchTermsTest is Base {
    event Trade(address indexed token, address indexed trader, bool isBuy, uint256 zroAmount, uint256 tokenAmount, uint256 fee, uint256 toTreasury, uint256 raisedAfter, uint256 soldAfter);

    function _launchAt(uint16 feeBps) private returns (address token) {
        vm.prank(creator);
        token = pad.launch("P", "P", "", 0, 1_000_000_000, feeBps - 100, 0, 0, false);
    }

    /// The terminal's cut and the creator's base share are constants, so no owner can move them under a token, before or after it
    /// moves to its pool.
    function test_theBaseFeeIsFixedOnTheCurveAndOnThePool() public {
        address token = _launchAt(300);
        (,,, uint16 fee,,,,,,, uint16 cut) = pad.curves(token);
        assertEq(fee, 300);
        assertEq(cut, 40);

        uint256 before = pad.protocolFees();
        vm.prank(bob);
        pad.buy{value: 400 ether}(token, 0, bob, block.timestamp);
        assertEq(pad.protocolFees() - before, 1.6 ether, "0.4% of the trade");

        vm.prank(bob);
        pad.buy{value: 8_000 ether}(token, 0, bob, block.timestamp); // graduates
        assertEq(pools.earnersBps(token), 260, "the creator's 0.6% and their own 2%");
    }

    /// Nothing reaches this today, since only tokens the launchpad seeded have an earners' cut, but money sent for a token it never
    /// launched would have been stranded, so it's refused.
    function test_payFromPoolRefusesAnUnknownToken() public {
        vm.deal(address(pools), 400 ether);
        vm.expectRevert(Launchpad.UnknownToken.selector);
        vm.prank(address(pools));
        pad.payFromPool{value: 400 ether}(address(0xdead));
        assertEq(pad.creatorFees(address(0)), 0);
    }

    /// Open to anyone, and only ever a gift to the token's holders.
    function test_anyoneCanAddRewards() public {
        vm.prank(creator);
        address token = pad.launch("H", "H", "", 0, 1_000_000_000, 800, 10_000, 0, false);
        vm.prank(bob);
        pad.buy{value: 800 ether}(token, 0, bob, block.timestamp);

        (bool ok,) = token.call{value: 400 ether}(abi.encodeWithSignature("addRewards()"));
        assertTrue(ok, "a stranger added rewards");
    }
}
