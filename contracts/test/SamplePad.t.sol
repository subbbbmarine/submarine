// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {SamplePad, SamplePadToken} from "./SamplePad.sol";

contract SamplePadTest is Test {
    SamplePad pad = new SamplePad();
    address alice = makeAddr("alice");

    function setUp() public {
        vm.deal(alice, 400 ether);
    }

    function test_buyAndSellBackOwesNothingExtra() public {
        vm.startPrank(alice);
        address token = pad.createToken{value: 0.4 ether}("A", "A", "");
        uint256 held = SamplePadToken(token).balanceOf(alice);
        assertEq(held, pad.previewPurchase(token, 0) + held);
        SamplePadToken(token).approve(address(pad), held);
        uint256 quoted = pad.previewDump(token, held);
        uint256 got = pad.dump(token, held, quoted);
        vm.stopPrank();
        assertEq(got, quoted);
        assertLe(got, 0.4 ether);
        assertGe(address(pad).balance, 0);
    }

    function test_fillingBuyStopsTradingAndRefunds() public {
        vm.startPrank(alice);
        address token = pad.createToken("A", "A", "");
        uint256 before = alice.balance;
        pad.purchase{value: 4 ether}(token, 0);
        assertEq(before - alice.balance, pad.TARGET());
        (,,, bool done) = pad.markets(token);
        assertTrue(done);
        vm.expectRevert(SamplePad.Closed.selector);
        pad.purchase{value: 1}(token, 0);
        vm.stopPrank();
    }
}
