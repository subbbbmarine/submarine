// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Errors} from "@openzeppelin/contracts/interfaces/draft-IERC6093.sol";
import {Base} from "./Base.t.sol";
import {TokenFactory} from "../src/core/TokenFactory.sol";

/// Our tokens treat the launchpad, the router and its forwarders as approved, so a holder's first sale or order is one
/// transaction. Those contracts only take coins from whoever calls them, so nobody else gains a way to move a holder's coins.
contract NoApprovalTest is Base {
    function _bought(address who) internal returns (address token, uint256 held) {
        vm.prank(creator);
        token = pad.launch("Meme", "MEME", "", 0);
        vm.prank(who);
        pad.buy{value: 100 ether}(token, 0, who, block.timestamp);
        held = IERC20(token).balanceOf(who);
        vm.roll(block.number + 1); // bought coins can't move in the block they were bought in
    }

    function test_aSaleThroughTheRouterNeedsNoApproval() public {
        (address token, uint256 held) = _bought(alice);
        assertEq(IERC20(token).allowance(alice, address(router)), type(uint256).max);
        uint256 before = alice.balance;
        vm.prank(alice);
        router.sell(token, held, 0, alice, _deadline());
        assertGt(alice.balance, before);
        assertEq(IERC20(token).balanceOf(alice), 0);
    }

    function test_aSaleOnTheCurveNeedsNoApproval() public {
        (address token, uint256 held) = _bought(alice);
        vm.prank(alice);
        pad.sell(token, held, 0, alice, block.timestamp);
        assertEq(IERC20(token).balanceOf(alice), 0);
    }

    function test_aSellOrderNeedsNoApproval() public {
        (address token, uint256 held) = _bought(alice);
        assertEq(IERC20(token).allowance(alice, address(limits)), type(uint256).max);
        vm.prank(alice);
        limits.placeSell(token, held, 1, 0);
        assertEq(IERC20(token).balanceOf(address(limits)), held, "the order holds the coins");
    }

    function test_anyoneElseStillNeedsAnApproval() public {
        (address token, uint256 held) = _bought(alice);
        assertEq(IERC20(token).allowance(alice, bob), 0);
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(IERC20Errors.ERC20InsufficientAllowance.selector, bob, 0, held));
        IERC20(token).transferFrom(alice, bob, held);
    }

    function test_onlyItsLaunchpadUsesTheFactory() public {
        TokenFactory factory = TokenFactory(address(pad.factory()));
        vm.expectRevert(TokenFactory.BadConfig.selector);
        factory.setLaunchpad(bob);
        vm.prank(bob);
        vm.expectRevert(TokenFactory.NotLaunchpad.selector);
        factory.create(false, "Fake", "FAKE", "", 1e27, address(1), address(2), address(3), new address[](0));
    }
}
