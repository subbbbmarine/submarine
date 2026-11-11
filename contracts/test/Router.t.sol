// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Base, PlainToken} from "./Base.t.sol";
import {Router} from "../src/periphery/Router.sol";
import {BuybackVault} from "../src/fees/BuybackVault.sol";
import {IVenue} from "../src/interfaces/IVenue.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// A stand-in third-party launchpad with a fixed price.
contract FixedVenue is IVenue {
    uint256 public tokensPerZro;

    constructor(uint256 tokensPerZro_) {
        tokensPerZro = tokensPerZro_;
    }

    receive() external payable {}

    function quoteBuy(address, uint256 b) public view returns (uint256) {
        return (b * tokensPerZro) / 1 ether;
    }

    function quoteSell(address, uint256 t) public view returns (uint256) {
        return (t * 1 ether) / tokensPerZro;
    }

    function buy(address token, uint256, address r, uint256) external payable returns (uint256 out) {
        out = quoteBuy(token, msg.value);
        IERC20(token).transfer(r, out);
    }

    function sell(address token, uint256 t, uint256, address r, uint256) external returns (uint256 out) {
        out = quoteSell(token, t);
        IERC20(token).transferFrom(msg.sender, address(this), t);
        (bool ok,) = r.call{value: out}("");
        require(ok);
    }
}

contract RevertingQuotes is IVenue {
    function quoteBuy(address, uint256) external pure returns (uint256) {
        revert("broken");
    }

    function quoteSell(address, uint256) external pure returns (uint256) {
        revert("broken");
    }

    function buy(address, uint256, address, uint256) external payable returns (uint256) {
        revert("broken");
    }

    function sell(address, uint256, uint256, address, uint256) external pure returns (uint256) {
        revert("broken");
    }
}

/// Answers anything, with nothing: try/catch can't handle a short return.
contract SilentVenue {
    fallback() external payable {}
}

/// Burns everything it's given when asked for a quote.
contract GasBombVenue {
    uint256 public sink;

    function quoteBuy(address, uint256) external view returns (uint256) {
        while (true) {
            if (sink == type(uint256).max) break;
        }
        return 0;
    }

    function quoteSell(address, uint256) external view returns (uint256) {
        while (true) {
            if (sink == type(uint256).max) break;
        }
        return 0;
    }
}

/// Promises the best price and then fails when it's time to deliver.
contract BaitVenue is IVenue {
    function quoteBuy(address, uint256) external pure returns (uint256) {
        return type(uint128).max;
    }

    function quoteSell(address, uint256) external pure returns (uint256) {
        return type(uint128).max;
    }

    function buy(address, uint256, address, uint256) external payable returns (uint256) {
        revert("no");
    }

    function sell(address, uint256, uint256, address, uint256) external pure returns (uint256) {
        revert("no");
    }
}

/// Takes half the tokens it's offered and pays for half.
contract HalfTakerVenue is IVenue {
    receive() external payable {}

    function quoteBuy(address, uint256) external pure returns (uint256) {
        return 0;
    }

    function quoteSell(address, uint256) external pure returns (uint256) {
        return type(uint128).max;
    }

    function buy(address, uint256, address, uint256) external payable returns (uint256) {
        revert("no");
    }

    function sell(address token, uint256 t, uint256, address r, uint256) external returns (uint256) {
        IERC20(token).transferFrom(msg.sender, address(this), t / 2);
        (bool ok,) = r.call{value: 400 ether}("");
        require(ok);
        return 400 ether;
    }
}

contract RouterTest is Base {
    // ---------------------------------------------------------------- routing

    function test_routesToCurveBeforeGraduationWithoutExtraFee() public {
        address token = _launch();
        uint256 q = pad.quoteBuy(token, 400 ether);
        (uint256 idx, uint256 out) = router.bestBuy(token, 400 ether);
        assertEq(idx, 0);
        assertEq(out, q);

        vm.prank(alice);
        uint256 got = router.buy{value: 400 ether}(token, q, alice, _deadline());
        assertEq(got, q);
        assertEq(address(vault).balance, 0, "router adds nothing on our own curve");
        assertEq(pad.protocolFees(), 1.6 ether);
    }

    function test_routesToPoolAfterGraduationAndTakesFee() public {
        address token = _launch();
        _graduate(token);
        (uint256 idx,) = router.bestBuy(token, 400 ether);
        assertEq(idx, 1);

        uint256 t0 = pad.protocolFees();
        vm.prank(alice);
        router.buy{value: 400 ether}(token, 1, alice, _deadline());
        assertEq(pad.protocolFees() - t0, 1.6 ether, "0.4% to the terminal, taken by the pool");
        assertEq(address(vault).balance, 0, "and nothing added by the router");
        assertGt(IERC20(token).balanceOf(alice), 0);
    }

    function test_sellThroughRouterEachStage() public {
        address token = _launch();
        vm.startPrank(alice);
        uint256 got = router.buy{value: 400 ether}(token, 1, alice, _deadline());
        IERC20(token).approve(address(router), type(uint256).max);
        uint256 b0 = alice.balance;
        uint256 q = router.quoteSell(token, got / 2);
        vm.roll(vm.getBlockNumber() + 1);
        uint256 out = router.sell(token, got / 2, q, alice, _deadline());
        assertEq(out, q);
        assertEq(alice.balance - b0, out);
        vm.stopPrank();

        _graduate(token);
        vm.startPrank(alice);
        uint256 t0 = pad.protocolFees();
        vm.roll(vm.getBlockNumber() + 1);
        uint256 out2 = router.sell(token, IERC20(token).balanceOf(alice), 1, alice, _deadline());
        vm.stopPrank();
        assertGt(out2, 0);
        assertGt(pad.protocolFees(), t0, "the pool paid the terminal its cut");
        assertEq(address(router).balance, 0, "router holds nothing");
    }

    function test_refundOnTheBuyThatFillsTheCurve() public {
        address token = _launch();
        uint256 b0 = bob.balance;
        vm.prank(bob);
        router.buy{value: 40_000 ether}(token, 1, bob, _deadline());
        assertApproxEqAbs(b0 - bob.balance, uint256(6_000 ether * 10_000) / 9_900, 2);
        assertEq(address(router).balance, 0);
        assertEq(IERC20(token).balanceOf(bob), pad.CURVE_SUPPLY());
    }

    function test_picksTheBetterOfTwoVenues() public {
        vm.prank(alice);
        PlainToken t = new PlainToken();
        FixedVenue bad = new FixedVenue(0.25 ether); // tokens per ZRO
        FixedVenue good = new FixedVenue(0.5 ether);
        vm.roll(vm.getBlockNumber() + 1);
        vm.startPrank(alice);
        t.transfer(address(bad), 1000 ether);
        vm.roll(vm.getBlockNumber() + 1);
        t.transfer(address(good), 1000 ether);
        vm.stopPrank();
        _listVenue(address(bad), 50, "bad");
        _listVenue(address(good), 50, "good");

        (uint256 idx,) = router.bestBuy(address(t), 400 ether);
        assertEq(idx, 3);
        vm.prank(bob);
        uint256 got = router.buy{value: 400 ether}(address(t), 1, bob, _deadline());
        assertEq(got, 199 ether, "0.5 per ZRO after 0.5%");
    }

    function test_noRouteForAnUnknownToken() public {
        vm.prank(alice);
        vm.expectRevert(Router.NoRoute.selector);
        router.buy{value: 400 ether}(address(0xBEEF), 0, alice, _deadline());
    }

    function test_slippageGuard() public {
        address token = _launch();
        uint256 q = router.quoteBuy(token, 400 ether);
        uint256 d = _deadline();
        vm.prank(alice);
        vm.expectRevert(Router.Slippage.selector);
        router.buy{value: 400 ether}(token, q + 1, alice, d);
    }

    // ---------------------------------------------------------------- broken venues (found in review)

    function _assertStillRoutes(address token) internal {
        vm.prank(alice);
        uint256 got = router.buy{value: 400 ether}(token, 1, alice, _deadline());
        assertGt(got, 0, "the trade still goes through");
    }

    function test_venueWithRevertingQuotesIsSkipped() public {
        address token = _launch();
        _listVenue(address(new RevertingQuotes()), 0, "broken");
        _assertStillRoutes(token);
    }

    function test_venueWithNoCodeIsSkipped() public {
        address token = _launch();
        _listVenue(address(0xDEAD1), 0, "gone");
        _assertStillRoutes(token);
    }

    function test_venueWithAShortAnswerIsSkipped() public {
        address token = _launch();
        _listVenue(address(new SilentVenue()), 0, "silent");
        _assertStillRoutes(token);
    }

    function test_venueThatBurnsGasOnAQuoteIsSkipped() public {
        address token = _launch();
        _listVenue(address(new GasBombVenue()), 0, "bomb");
        (uint256 idx,) = router.bestBuy(token, 400 ether);
        assertEq(idx, 0);
        // The cap has to leave room for a whole trade inside an ordinary gas limit.
        vm.prank(alice);
        uint256 got = router.buy{value: 400 ether, gas: 1_500_000}(token, 1, alice, _deadline());
        assertGt(got, 0);
    }

    function test_venueThatQuotesWellThenFailsIsPassedOver() public {
        address token = _launch();
        _listVenue(address(new BaitVenue()), 0, "bait");
        (uint256 idx,) = router.bestBuy(token, 400 ether);
        assertEq(idx, 2, "it does quote best");
        uint256 q = pad.quoteBuy(token, 400 ether);

        vm.prank(alice);
        uint256 got = router.buy{value: 400 ether}(token, 1, alice, _deadline());
        assertEq(got, q, "and the curve serves the trade instead");
        assertEq(address(router).balance, 0);

        vm.startPrank(alice);
        IERC20(token).approve(address(router), type(uint256).max);
        vm.roll(vm.getBlockNumber() + 1);
        uint256 out = router.sell(token, got, 1, alice, _deadline());
        vm.stopPrank();
        assertGt(out, 0);
        assertEq(IERC20(token).balanceOf(address(router)), 0);
    }

    function test_tokensAVenueDoesntTakeComeBack() public {
        address token = _launch();
        HalfTakerVenue half = new HalfTakerVenue();
        vm.deal(address(half), 4_000 ether);
        _listVenue(address(half), 0, "half");

        vm.startPrank(alice);
        uint256 got = router.buy{value: 400 ether}(token, 1, alice, _deadline());
        IERC20(token).approve(address(router), got);
        vm.roll(vm.getBlockNumber() + 1);
        router.sell(token, got, 1, alice, _deadline());
        vm.stopPrank();
        assertEq(IERC20(token).balanceOf(address(router)), 0, "nothing stays on the router");
        assertEq(IERC20(token).balanceOf(alice), got - got / 2);
    }

    // ---------------------------------------------------------------- fees

    /// Found in review: with a fee on a venue that refunds part of a buy (as the buy that fills a curve does), the fee was paid
    /// on ZRO that was then refunded.
    function test_feeIsOnlyOnWhatTheVenueKept() public {
        PlainToken t = new PlainToken();
        Refunder refunder = new Refunder(address(t), 6_000 ether);
        t.transfer(address(refunder), 1_000_000 ether);
        _listVenue(address(refunder), 50, "refunds");

        uint256 v0 = address(vault).balance;
        uint256 b0 = bob.balance;
        vm.prank(bob);
        router.buy{value: 40_000 ether}(address(t), 1, bob, _deadline());

        uint256 fee = address(vault).balance - v0;
        assertApproxEqAbs(fee, uint256(6_000 ether * 50) / 9_950, 10, "0.5% of what was used, not of 40,000 ZRO");
        assertApproxEqAbs(b0 - bob.balance, 6_000 ether + fee, 10);
        assertEq(address(router).balance, 0);
    }

    /// Our own curve and pool take the terminal's cut themselves, so the router's fee on them stays zero for good.
    function test_ourOwnVenuesKeepAZeroFee() public {
        vm.startPrank(owner);
        vm.expectRevert(Router.BadConfig.selector);
        router.setVenueFee(0, 50);
        vm.expectRevert(Router.BadConfig.selector);
        router.setVenueFee(1, 1);
        router.queueVenue(address(venue), 50, "again");
        vm.warp(block.timestamp + router.LISTING_DELAY());
        vm.expectRevert(Router.BadConfig.selector);
        router.listVenue(address(venue), 50, "again");
        vm.stopPrank();
    }

    function test_strayZroIsRejected() public {
        vm.prank(alice);
        (bool ok,) = address(router).call{value: 400 ether}("");
        assertFalse(ok);
    }

    function test_coinsSentStraightToTheRouterCanBeSentBack() public {
        address token = _launch();
        vm.prank(alice);
        router.buy{value: 400 ether}(token, 0, alice, block.timestamp);
        vm.roll(block.number + 1);
        uint256 held = IERC20(token).balanceOf(alice);
        uint256 stray = held / 2;
        vm.prank(alice);
        IERC20(token).transfer(address(router), stray);

        vm.prank(alice);
        vm.expectRevert();
        router.rescue(IERC20(token), alice);

        vm.prank(owner);
        router.rescue(IERC20(token), alice);
        assertEq(IERC20(token).balanceOf(address(router)), 0);
        assertEq(IERC20(token).balanceOf(alice), held);
    }

    // ---------------------------------------------------------------- admin

    function test_adminIsGatedAndCapped() public {
        vm.prank(alice);
        vm.expectRevert();
        router.queueVenue(address(1), 0, "x");
        vm.startPrank(owner);
        vm.expectRevert(Router.BadConfig.selector);
        router.queueVenue(address(1), 101, "x");
        vm.expectRevert(Router.BadConfig.selector);
        router.setVenueFee(0, 101);
        vm.stopPrank();
    }

    function test_newVenueMustWaitOutTheDelay() public {
        uint256 delay = router.LISTING_DELAY();
        vm.startPrank(owner);
        vm.expectRevert(Router.NotReady.selector);
        router.listVenue(address(1), 0, "x");

        router.queueVenue(address(1), 0, "x");
        vm.warp(block.timestamp + delay - 1);
        vm.expectRevert(Router.NotReady.selector);
        router.listVenue(address(1), 0, "x");

        vm.warp(block.timestamp + 1);
        router.listVenue(address(1), 0, "x");
        vm.stopPrank();
        assertEq(router.venuesCount(), 3);
    }

    function test_queueMatchesExactTerms() public {
        uint256 delay = router.LISTING_DELAY();
        vm.startPrank(owner);
        router.queueVenue(address(1), 0, "x");
        vm.warp(block.timestamp + delay);
        vm.expectRevert(Router.NotReady.selector);
        router.listVenue(address(1), 50, "x");
        vm.stopPrank();
    }

    function test_setupCantBeReopened() public view {
        assertFalse(router.setupOpen());
    }

    function test_removingAVenueIsInstant() public {
        vm.prank(owner);
        router.removeVenue(1);
        assertEq(router.venuesCount(), 1);
    }

    // ---------------------------------------------------------------- vault

    function _vaultWithToken(uint256 funded) internal returns (address token) {
        token = _launch();
        vm.prank(owner);
        vault.setBuybackToken(token);
        vm.deal(address(vault), funded);
        vm.warp(block.timestamp + vault.MIN_INTERVAL());
    }

    function test_buybackBuysAndBurns() public {
        address token = _vaultWithToken(4_000 ether);
        vm.prank(keeper);
        uint256 burned = vault.buyback(400 ether, 1);
        assertEq(IERC20(token).balanceOf(vault.DEAD()), burned);
        assertEq(vault.totalSpent(), 400 ether);
        assertEq(vault.totalBurned(), burned);
    }

    function test_onlyKeeperOrOwnerBuysBack() public {
        _vaultWithToken(4_000 ether);
        vm.prank(alice);
        vm.expectRevert(BuybackVault.NotKeeper.selector);
        vault.buyback(400 ether, 1);
    }

    function test_buybackRequiresASlippageFloor() public {
        _vaultWithToken(4_000 ether);
        vm.prank(keeper);
        vm.expectRevert(BuybackVault.BadConfig.selector);
        vault.buyback(400 ether, 0);
    }

    function test_nothingCanBeBoughtBeforeTheTokenIsSet() public {
        vm.deal(address(vault), 4_000 ether);
        vm.prank(keeper);
        vm.expectRevert(BuybackVault.NoToken.selector);
        vault.buyback(400 ether, 1);
    }

    /// Found in review: letting the keeper name the token let it buy its own and take the ZRO out through the pool.
    function test_theBuybackTokenIsSetOnce() public {
        _vaultWithToken(4_000 ether);
        vm.prank(owner);
        vm.expectRevert(BuybackVault.AlreadySet.selector);
        vault.setBuybackToken(address(0xBEEF));
    }

    /// Found in review: an owner could repoint the router and walk off with the balance.
    function test_theRouterIsSetOnce() public {
        vm.prank(owner);
        vm.expectRevert(BuybackVault.AlreadySet.selector);
        vault.setRouter(address(0xBEEF));
    }

    function test_spendingIsCappedPerRound() public {
        _vaultWithToken(40_000 ether);
        vm.prank(keeper);
        vm.expectRevert(BuybackVault.TooMuch.selector);
        vault.buyback(4_000 ether + 1, 1);

        vm.prank(keeper);
        vault.buyback(4_000 ether, 1);
    }

    function test_roundsAreSpacedOut() public {
        _vaultWithToken(40_000 ether);
        uint256 interval = vault.MIN_INTERVAL();
        vm.startPrank(keeper);
        vault.buyback(400 ether, 1);
        vm.expectRevert(BuybackVault.TooSoon.selector);
        vault.buyback(400 ether, 1);
        vm.warp(block.timestamp + interval);
        vault.buyback(400 ether, 1);
        vm.stopPrank();
    }

    function test_vaultHasNoWayOutButBuyback() public {
        vm.deal(address(vault), 400 ether);
        vm.startPrank(owner);
        (bool a,) = address(vault).call(abi.encodeWithSignature("withdrawZro(address,uint256)", owner, 400 ether));
        (bool b,) = address(vault).call(abi.encodeWithSignature("withdraw(address,uint256)", owner, 400 ether));
        vm.stopPrank();
        assertFalse(a);
        assertFalse(b);
        assertEq(address(vault).balance, 400 ether);
    }
}

/// A venue that uses at most `cap` of a buy and sends the rest back, 1,000 tokens per ZRO.
contract Refunder {
    PlainToken internal immutable t;
    uint256 internal immutable cap;

    constructor(address token, uint256 cap_) {
        t = PlainToken(token);
        cap = cap_;
    }

    function quoteBuy(address, uint256 zroIn) external view returns (uint256) {
        return (zroIn < cap ? zroIn : cap) / 1e15;
    }

    function quoteSell(address, uint256) external pure returns (uint256) {
        return 0;
    }

    function buy(address, uint256, address recipient, uint256) external payable returns (uint256 out) {
        uint256 used = msg.value < cap ? msg.value : cap;
        out = used / 1e15;
        t.transfer(recipient, out);
        if (msg.value > used) {
            (bool ok,) = msg.sender.call{value: msg.value - used}("");
            require(ok);
        }
    }
}
