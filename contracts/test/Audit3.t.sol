// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Base, PlainToken} from "./Base.t.sol";
import {DirectTrader} from "./Pools.t.sol";
import {IVenue} from "../src/interfaces/IVenue.sol";
import {Launchpad} from "../src/core/Launchpad.sol";
import {Referrals} from "../src/periphery/Referrals.sol";
import {Router} from "../src/periphery/Router.sol";

/// A venue that quotes well, consumes the money it is given but for one wei, and sends tokens back.
/// Enough to show what the router's refund maths does when the refund is smaller than its own fee.
contract ThinVenue is IVenue {
    IERC20 internal immutable token;

    constructor(IERC20 token_) {
        token = token_;
    }

    function quoteBuy(address, uint256 zroIn) external pure returns (uint256) {
        return zroIn * 1_000;
    }

    function quoteSell(address, uint256 tokensIn) external pure returns (uint256) {
        return tokensIn / 1_000;
    }

    function buy(address, uint256, address recipient, uint256) external payable returns (uint256) {
        token.transfer(recipient, msg.value * 1_000);
        (bool ok,) = msg.sender.call{value: 1}("");
        if (!ok) revert();
        return msg.value * 1_000;
    }

    function sell(address, uint256, uint256, address, uint256) external returns (uint256) {
        return 0;
    }

    receive() external payable {}
}

contract Audit3Test is Base {
    DirectTrader internal direct;

    function setUp() public override {
        super.setUp();
        direct = new DirectTrader(infinityVault, poolManager);
        vm.deal(address(direct), 100_000 ether);
    }

    function _launchPlain() internal returns (address token) {
        vm.prank(creator);
        token = pad.launch("Meme", "MEME", "", 0);
    }

    /// 1. A trade through the venue pays the referrer on its own cut only. What a trade made straight on the pool left waiting
    /// has no known trader, so it goes to the treasury whole instead of being credited to whoever trades through the venue next.
    function test_aVenueTradeIsCreditedOnlyWithItsOwnCut() public {
        address quiet = _launchPlain();
        address busy = _launchPlain();
        _graduate(quiet);
        _graduate(busy);
        vm.prank(bob);
        referrals.link(alice);

        // The same buy by bob on two pools, one of them with a stranger's direct trade waiting to be paid out.
        uint256 before = referrals.earned(alice);
        vm.prank(bob);
        router.buy{value: 100 ether}(quiet, 0, bob, _deadline());
        uint256 plain = referrals.earned(alice) - before;
        assertGt(plain, 0, "a venue trade pays the referrer");

        direct.buy(pools.poolKeyOf(busy), 500 ether);
        uint256 protocolBefore = pad.protocolFees();
        before = referrals.earned(alice);
        vm.prank(bob);
        router.buy{value: 100 ether}(busy, 0, bob, _deadline());
        assertEq(referrals.earned(alice) - before, plain, "the stranger's cut isn't credited to bob's referrer");
        assertGt(pad.protocolFees(), protocolBefore, "it went to the treasury");

        // Run by anyone, the waiting cut of a direct trade has no trader at all.
        direct.buy(pools.poolKeyOf(busy), 100 ether);
        before = referrals.earned(alice);
        pools.distribute(busy);
        assertEq(referrals.earned(alice), before);
    }

    /// 2. A venue that hands part back: the router's fee is only on what the venue really kept, and the refund is
    /// grown by the fee that never left, so a one wei refund doesn't break the maths.
    function test_theRouterFeeIsOnlyOnWhatTheVenueKept() public {
        PlainToken extra = new PlainToken();
        ThinVenue thin = new ThinVenue(IERC20(address(extra)));
        extra.transfer(address(thin), 1_000_000 ether);
        _listVenue(address(thin), 100, "thin"); // 1% router fee

        uint256 treasuryBefore = address(vault).balance;
        vm.prank(alice);
        router.buy{value: 1 ether}(address(extra), 0, alice, _deadline());
        // The fee is worked back out of what the venue kept, 0.99, so it stays at the 1% of the money sent rather
        // than at 1% of 0.99: the refund of one wei barely moves it. Done as gross * feeBps / (BPS - feeBps).
        assertApproxEqAbs(address(vault).balance - treasuryBefore, 0.01 ether, 3);
    }

    /// 3. A referral is for good: once a wallet is linked, whether it meant to or not, it can't be changed.
    function test_aReferralCannotBeFixedOnceLinked() public {
        vm.prank(bob);
        referrals.link(alice);
        vm.prank(bob);
        vm.expectRevert(Referrals.AlreadyLinked.selector);
        referrals.link(creator);
    }

    /// 4. The boundary the curve's rounding is built around: a sale of everything the curve still holds from a
    /// nearly filled curve pays out at most the raise, so `raised -= gross` never underflows.
    function test_sellingEverythingBackAtTheEdgeOfTheCurveNeverExceedsTheRaise() public {
        address token = _launchPlain();
        vm.prank(alice);
        pad.buy{value: 5_990 ether}(token, 0, alice, block.timestamp);
        (,,,,,,, uint128 raised, uint128 sold,,) = pad.curves(token);
        assertLt(raised, pad.RAISE_TARGET(), "not graduated yet");
        vm.roll(block.number + 1); // bought coins can't leave in the block they were bought in

        vm.prank(alice);
        IERC20(token).approve(address(pad), sold);
        vm.prank(alice);
        pad.sell(token, sold, 0, alice, block.timestamp);
        (,,,,,,, uint128 afterRaise, uint128 afterSold,,) = pad.curves(token);
        assertEq(afterSold, 0);
        assertEq(afterRaise, 0, "the whole real raise went out, and it was there to go out");
    }

    /// 5. A sale can't name the router as its recipient: the ZRO would stay there, since `rescue` only moves tokens.
    function test_aSaleToTheRouterItselfIsRefused() public {
        address token = _launchPlain();
        vm.prank(alice);
        pad.buy{value: 100 ether}(token, 0, alice, block.timestamp);
        uint256 tokens = IERC20(token).balanceOf(alice);
        vm.roll(block.number + 1);
        vm.prank(alice);
        IERC20(token).approve(address(router), tokens);

        vm.prank(alice);
        vm.expectRevert(Router.BadConfig.selector);
        router.sell(token, tokens, 0, address(router), _deadline());
    }
}
