// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Base, PlainToken} from "./Base.t.sol";

/// Independent checks of round three's "our own contracts are pre-approved" change: it must not let anything move a
/// holder's coins, and must stay inside the four contracts it names.
contract Audit4Test is Base {
    function _bought() internal returns (address token, uint256 held) {
        vm.prank(creator);
        token = pad.launch("Meme", "MEME", "", 0);
        vm.prank(alice);
        pad.buy{value: 100 ether}(token, 0, alice, block.timestamp);
        held = IERC20(token).balanceOf(alice);
        vm.roll(block.number + 1);
    }

    /// Exactly the launchpad, the router, the limit orders and the copy vault, and nothing else.
    function test_theApprovedSetIsOnlyThoseFour() public {
        (address token,) = _bought();
        assertEq(IERC20(token).allowance(alice, address(pad)), type(uint256).max, "the launchpad");
        assertEq(IERC20(token).allowance(alice, address(router)), type(uint256).max, "the router");
        assertEq(IERC20(token).allowance(alice, address(limits)), type(uint256).max, "limit orders");
        assertEq(IERC20(token).allowance(alice, address(copyVault)), type(uint256).max, "the copy vault");

        address[5] memory others = [address(pools), address(venue), address(vault), address(referrals), bob];
        for (uint256 i; i < others.length; ++i) {
            assertEq(IERC20(token).allowance(alice, others[i]), 0, "not approved");
        }
    }

    /// A stranger can't pull with the launchpad's or the router's approval: those two only ever take from their caller.
    function test_aStrangerCannotSellWithTheApproval() public {
        (address token, uint256 held) = _bought();

        vm.prank(bob);
        vm.expectRevert(); // bob holds none, so the launchpad's transferFrom of alice's coins underflows
        pad.sell(token, held, 0, bob, block.timestamp);

        vm.prank(bob);
        vm.expectRevert();
        router.sell(token, held, 0, bob, _deadline());

        assertEq(IERC20(token).balanceOf(alice), held, "alice still has them all");
    }

    /// A sale or order still checks the balance it is told to take, so a claim bigger than the holding fails loudly.
    function test_anOrderBiggerThanTheHoldingFails() public {
        (address token, uint256 held) = _bought();
        vm.prank(alice);
        vm.expectRevert();
        limits.placeSell(token, held + 1, 1, 0);
    }

    /// Anyone can launch, and the token still comes out tied to this launchpad: its curve, its approved contracts.
    function test_anyonesLaunchStillGetsItsApprovalsFromThisLaunchpad() public {
        assertGt(address(pad.factory()).code.length, 0);
        vm.prank(bob);
        address token = pad.launch("X", "X", "", 0);
        assertEq(IERC20(token).allowance(bob, address(router)), type(uint256).max);
        assertEq(IERC20(token).allowance(bob, bob), 0);
        (address creatorOf, , , , , , , , , , ) = pad.curves(token);
        assertEq(creatorOf, bob);
    }
}

/// A venue that keeps half and hands the rest back, and sends tokens so it is the one the router picks.
contract HalfVenue {
    IERC20 internal immutable token;
    constructor(IERC20 t) { token = t; }
    function quoteBuy(address, uint256 zroIn) external pure returns (uint256) { return zroIn * 1_000; }
    function quoteSell(address, uint256 tokensIn) external pure returns (uint256) { return tokensIn / 1_000; }
    function buy(address, uint256, address recipient, uint256) external payable returns (uint256) {
        token.transfer(recipient, 1_000 ether);
        (bool ok,) = msg.sender.call{value: msg.value / 2}("");
        if (!ok) revert();
        return 1_000 ether;
    }
    receive() external payable {}
}

contract RouterFeeShapeTest is Base {
    function test_theFeeOnARefundedBuyIsAboutTheFeeBpsOfWhatWasKept() public {
        PlainToken extra = new PlainToken();
        HalfVenue half = new HalfVenue(IERC20(address(extra)));
        extra.transfer(address(half), 1_000_000 ether);
        _listVenue(address(half), 100, "half"); // 1% router fee

        uint256 treasuryBefore = address(vault).balance;
        vm.prank(alice);
        router.buy{value: 1 ether}(address(extra), 0, alice, _deadline());
        uint256 fee = address(vault).balance - treasuryBefore;
        emit log_named_decimal_uint("fee on a half-refunded 1 ether buy", fee, 18);
        // Exactly the fee on the 0.5 the venue kept, not 1% of the 1 ether that was sent: the formula is
        // gross * feeBps / (BPS - feeBps) and the gross here is 0.5, since half came straight back.
        assertEq(fee, 0.005 ether);
    }
}
