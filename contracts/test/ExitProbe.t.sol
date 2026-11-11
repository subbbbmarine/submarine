// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Base, PlainToken} from "./Base.t.sol";
import {ExitProbe} from "../src/periphery/ExitProbe.sol";
import {Router} from "../src/periphery/Router.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract ExitProbeTest is Base {
    ExitProbe internal probe;
    address internal token;

    function setUp() public override {
        super.setUp();
        probe = new ExitProbe();
        token = _launch();
    }

    function _run(uint256 amount) internal returns (uint256, uint256, bool) {
        bytes memory buyData = abi.encodeCall(Router.buy, (token, 0, address(probe), block.timestamp + 60));
        bytes memory sale = abi.encodeCall(Router.sell, (token, 0, 0, address(probe), block.timestamp + 60));
        // The amount is the second argument: everything before it, everything after it.
        bytes memory head = new bytes(36);
        bytes memory tail = new bytes(sale.length - 68);
        for (uint256 i; i < 36; ++i) head[i] = sale[i];
        for (uint256 i; i < tail.length; ++i) tail[i] = sale[68 + i];
        vm.deal(address(this), amount);
        return probe.probe{value: amount}(address(router), buyData, token, head, tail);
    }

    /// Our own tokens hold what was bought for a block, against sandwiches, so a round trip in one call can't sell. The site
    /// knows these tokens' code and doesn't probe them; the probe is for other launchpads' tokens.
    function test_ourOwnTokenHoldsForABlockOnTheCurve() public {
        (uint256 bought, uint256 back, bool sold) = _run(400 ether);
        assertGt(bought, 0);
        assertFalse(sold);
        assertEq(back, 0);
    }

    function test_ourOwnTokenHoldsForABlockOnThePoolToo() public {
        _graduate(token);
        (uint256 bought,, bool sold) = _run(400 ether);
        assertGt(bought, 0);
        assertFalse(sold);
    }

    function test_aBuyThatCannotHappenRevertsSoTheCheckSaysNothing() public {
        token = address(new PlainToken()); // not on any venue
        vm.expectRevert();
        this.callRun();
    }

    function callRun() external {
        _run(400 ether);
    }

    function test_aSaleThatRevertsIsReported() public {
        // A venue that sells but won't buy back: the same shape as a token that blocks selling.
        OneWay oneWay = new OneWay(token);
        vm.prank(alice);
        router.buy{value: 400 ether}(token, 1, address(oneWay), block.timestamp + 60);
        vm.roll(vm.getBlockNumber() + 1); // so the venue can pass on what it bought
        bytes memory buyData = abi.encodeCall(OneWay.buy, (address(probe)));
        bytes memory sale = abi.encodeCall(OneWay.sell, (0));
        bytes memory head = new bytes(4);
        for (uint256 i; i < 4; ++i) head[i] = sale[i];
        vm.deal(address(this), 400 ether);
        (uint256 bought, uint256 back, bool sold) = probe.probe{value: 400 ether}(address(oneWay), buyData, token, head, "");
        assertGt(bought, 0);
        assertEq(back, 0);
        assertFalse(sold);
    }
}

contract OneWay {
    ERC20 internal immutable t;

    constructor(address token) {
        t = ERC20(token);
    }

    function buy(address to) external payable {
        t.transfer(to, t.balanceOf(address(this)));
    }

    function sell(uint256) external pure {
        revert("no sales");
    }
}
