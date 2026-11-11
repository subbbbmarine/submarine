// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.8.26;

import {Base} from "./Base.t.sol";
import {Launchpad, LaunchToken} from "../src/core/Launchpad.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract LaunchpadTest is Base {
    function test_constantsAreTheSolvedCurve() public view {
        uint256 c = pad.CURVE_SUPPLY();
        uint256 l = pad.LP_SUPPLY();
        assertEq(c + l, pad.SUPPLY());
        assertEq(pad.VIRTUAL_TOKENS(), (c * c) / (c - l));
        assertEq(pad.VIRTUAL_ZRO(), (pad.RAISE_TARGET() * l) / (c - l));
    }

    function test_launchMintsFixedSupplyToCurve() public {
        address token = _launch();
        assertEq(IERC20(token).totalSupply(), pad.SUPPLY());
        assertEq(IERC20(token).balanceOf(address(pad)), pad.SUPPLY());
        assertTrue(pad.isToken(token));
        assertEq(pad.tokensCount(), 1);
    }

    function test_tokenHasNoMintFunction() public {
        address token = _launch();
        (bool ok,) = token.call(abi.encodeWithSignature("mint(address,uint256)", alice, 1 ether));
        assertFalse(ok, "nobody may mint a launched token");
    }

    function test_launchWithFirstBuyIsAtomic() public {
        vm.prank(creator);
        address token = pad.launch{value: 400 ether}("Meme", "MEME", "", 1);
        assertGt(IERC20(token).balanceOf(creator), 0);
        (,,,,,,, uint128 raised,,,) = pad.curves(token);
        assertEq(raised, 396 ether);
    }

    function test_launchRevertsOnBadMetadata() public {
        vm.startPrank(creator);
        vm.expectRevert(Launchpad.BadMetadata.selector);
        pad.launch("", "X", "", 0);
        vm.expectRevert(Launchpad.BadMetadata.selector);
        pad.launch("X", "", "", 0);
        vm.stopPrank();
    }

    function test_launchFeeGoesToProtocol() public {
        vm.prank(owner);
        pad.setLaunchFee(4 ether);
        vm.startPrank(creator);
        vm.expectRevert(Launchpad.WrongLaunchFee.selector);
        pad.launch("Meme", "MEME", "", 0);
        pad.launch{value: 4 ether}("Meme", "MEME", "", 0);
        vm.stopPrank();
        assertEq(pad.protocolFees(), 4 ether);
    }

    function test_buyMatchesQuoteAndSplitsFee() public {
        address token = _launch();
        uint256 quote = pad.quoteBuy(token, 400 ether);
        vm.prank(alice);
        uint256 out = pad.buy{value: 400 ether}(token, quote, alice, _deadline());
        assertEq(out, quote);
        assertEq(IERC20(token).balanceOf(alice), out);
        assertEq(pad.creatorFees(creator), 2.4 ether);
        assertEq(pad.protocolFees(), 1.6 ether);
    }

    function test_buySlippageAndDeadline() public {
        address token = _launch();
        uint256 quote = pad.quoteBuy(token, 400 ether);
        vm.startPrank(alice);
        vm.expectRevert(Launchpad.Slippage.selector);
        pad.buy{value: 400 ether}(token, quote + 1, alice, _deadline());
        vm.warp(block.timestamp + 100);
        vm.expectRevert(Launchpad.Expired.selector);
        pad.buy{value: 400 ether}(token, 0, alice, block.timestamp - 1);
        vm.stopPrank();
    }

    function test_priceRisesWithBuys() public {
        address token = _launch();
        uint256 p0 = pad.priceOf(token);
        vm.prank(alice);
        pad.buy{value: 400 ether}(token, 0, alice, _deadline());
        assertGt(pad.priceOf(token), p0);
    }

    function test_sellMatchesQuote() public {
        address token = _launch();
        vm.startPrank(alice);
        uint256 got = pad.buy{value: 400 ether}(token, 0, alice, _deadline());
        IERC20(token).approve(address(pad), got);
        uint256 quote = pad.quoteSell(token, got);
        uint256 before = alice.balance;
        vm.roll(vm.getBlockNumber() + 1);
        uint256 net = pad.sell(token, got, quote, alice, _deadline());
        vm.stopPrank();
        assertEq(net, quote);
        assertEq(alice.balance - before, net);
    }

    function test_roundTripLosesOnlyFees() public {
        address token = _launch();
        vm.startPrank(alice);
        uint256 got = pad.buy{value: 400 ether}(token, 0, alice, _deadline());
        IERC20(token).approve(address(pad), got);
        vm.roll(vm.getBlockNumber() + 1);
        uint256 net = pad.sell(token, got, 0, alice, _deadline());
        vm.stopPrank();
        assertLt(net, 400 ether);
        assertApproxEqRel(net, 392.04 ether, 0.0001e18); // 0.99 * 0.99
    }

    function test_cannotSellMoreThanCurveSold() public {
        address token = _launch();
        vm.prank(alice);
        pad.buy{value: 400 ether}(token, 0, alice, _deadline());
        uint256 tooMuch = pad.SUPPLY();
        uint256 deadline = _deadline();
        vm.roll(vm.getBlockNumber() + 1);
        vm.prank(alice);
        vm.expectRevert(Launchpad.ZeroAmount.selector);
        pad.sell(token, tooMuch, 0, alice, deadline);
    }

    function test_graduationSeedsPoolAtTheCurvesLastPrice() public {
        address token = _launch();
        uint256 before = bob.balance;
        _graduate(token);

        (,, bool graduated,,,,, uint128 raised, uint128 sold,,) = pad.curves(token);
        assertTrue(graduated);
        assertEq(raised, pad.RAISE_TARGET());
        assertEq(sold, pad.CURVE_SUPPLY());
        assertEq(IERC20(token).balanceOf(bob), pad.CURVE_SUPPLY());

        uint256 curvePrice = pad.priceOf(token);
        assertApproxEqRel(curvePrice, pools.priceOf(token), 1e12, "no price step at graduation");
        assertApproxEqAbs(curvePrice, 3e13, 1, "3e-5 ZRO per token");

        // The pool is one full-range position its venue can't remove, worth the raise and the LP supply at this price.
        (uint256 rb, uint256 rt, uint256 total) = pools.pools(token);
        assertApproxEqRel(rb, 6_000 ether, 1e12);
        assertApproxEqRel(rt, pad.LP_SUPPLY(), 1e12);
        assertGt(total, 0);

        // bob sent 8,000 ZRO; only what the curve could take was charged
        uint256 spent = before - bob.balance;
        assertApproxEqAbs(spent, uint256(6_000 ether * 10_000) / 9_900, 2);
        assertEq(IERC20(token).balanceOf(address(pad)), 0, "nothing stranded on the launchpad");
    }

    function test_noTradingOnCurveAfterGraduation() public {
        address token = _launch();
        _graduate(token);
        vm.startPrank(alice);
        vm.expectRevert(Launchpad.AlreadyGraduated.selector);
        pad.buy{value: 400 ether}(token, 0, alice, _deadline());
        vm.stopPrank();
        vm.startPrank(bob);
        IERC20(token).approve(address(pad), 1 ether);
        vm.roll(vm.getBlockNumber() + 1);
        vm.expectRevert(Launchpad.AlreadyGraduated.selector);
        pad.sell(token, 1 ether, 0, bob, _deadline());
        vm.stopPrank();
        assertEq(pad.quoteBuy(token, 400 ether), 0);
    }

    function test_creatorThatRejectsZroCannotBlockTrading() public {
        Rejecter r = new Rejecter();
        vm.prank(address(r));
        address token = pad.launch("Meme", "MEME", "", 0);
        vm.prank(alice);
        pad.buy{value: 400 ether}(token, 0, alice, _deadline());
        assertEq(pad.creatorFees(address(r)), 2.4 ether);
    }

    function test_claimAndCollect() public {
        address token = _launch();
        vm.prank(alice);
        pad.buy{value: 400 ether}(token, 0, alice, _deadline());

        uint256 c0 = creator.balance;
        vm.prank(creator);
        pad.claimCreatorFees();
        assertEq(creator.balance - c0, 2.4 ether);

        pad.collectProtocolFees();
        assertEq(address(vault).balance, 1.6 ether);

        vm.expectRevert(Launchpad.ZeroAmount.selector);
        pad.collectProtocolFees();
    }

    function test_ownerFeeIsCapped() public {
        vm.startPrank(owner);
        vm.expectRevert(Launchpad.BadConfig.selector);
        pad.setLaunchFee(80 ether);
        vm.stopPrank();
    }

    /// The property Hermes' version broke: whatever anyone does, the curve can pay every seller and all owed fees.
    function testFuzz_curveAlwaysSolvent(uint96[8] memory amounts, uint8 sellMask) public {
        address token = _launch();
        vm.startPrank(alice);
        IERC20(token).approve(address(pad), type(uint256).max);
        for (uint256 i; i < amounts.length; ++i) {
            uint256 a = bound(amounts[i], 400 gwei, 2_000 ether);
            (,, bool graduated,,,,,,,,) = pad.curves(token);
            if (graduated) break;
            if ((sellMask >> i) & 1 == 1 && IERC20(token).balanceOf(alice) > 0) {
                uint256 bal = IERC20(token).balanceOf(alice);
                vm.roll(vm.getBlockNumber() + 1);
                pad.sell(token, bal / 2 + 1, 0, alice, block.timestamp);
            } else {
                pad.buy{value: a}(token, 0, alice, block.timestamp);
            }
            (,, bool gradNow,,,,, uint128 raised,,,) = pad.curves(token);
            // after graduation the raised ZRO has moved to the pool, so only the fees must remain here
            uint256 owed = (gradNow ? 0 : uint256(raised)) + pad.protocolFees() + pad.creatorFees(creator);
            assertGe(address(pad).balance, owed);
        }
        vm.stopPrank();

        // Everyone exits: the last seller still gets paid, and the fees are still all there.
        (,, bool done,,,,,,,,) = pad.curves(token);
        if (!done) {
            uint256 rest = IERC20(token).balanceOf(alice);
            if (rest > 0) {
                vm.roll(vm.getBlockNumber() + 1);
                vm.prank(alice);
                pad.sell(token, rest, 0, alice, block.timestamp);
            }
            (,,,,,,, uint128 raised, uint128 sold,,) = pad.curves(token);
            assertEq(sold, 0);
            assertLe(raised, 10, "dust only");
            assertGe(address(pad).balance, pad.protocolFees() + pad.creatorFees(creator));
        }
    }

    function testFuzz_curveNeverHandsOutMoreThanItsSupply(uint96 a, uint96 b) public {
        address token = _launch();
        vm.prank(alice);
        pad.buy{value: bound(a, 400 gwei, 20_000 ether)}(token, 0, alice, block.timestamp);
        (,, bool graduated,,,,,,,,) = pad.curves(token);
        if (!graduated) {
            vm.prank(bob);
            pad.buy{value: bound(b, 400 gwei, 20_000 ether)}(token, 0, bob, block.timestamp);
        }
        (,,,,,,,, uint128 sold,,) = pad.curves(token);
        assertLe(sold, pad.CURVE_SUPPLY());
        assertEq(IERC20(token).balanceOf(alice) + IERC20(token).balanceOf(bob), sold);
    }
}

contract Rejecter {
    receive() external payable {
        revert("no");
    }
}
