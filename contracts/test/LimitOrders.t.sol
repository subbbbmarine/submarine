// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Base} from "./Base.t.sol";
import {LimitOrders} from "../src/periphery/LimitOrders.sol";
import {Router} from "../src/periphery/Router.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract LimitOrdersTest is Base {
    address internal token;

    function setUp() public override {
        super.setUp();
        token = _launch();
    }

    function _bobHolds(uint256 zro) internal returns (uint256 got) {
        vm.startPrank(bob);
        got = router.buy{value: zro}(token, 1, bob, _deadline());
        IERC20(token).approve(address(limits), type(uint256).max);
        vm.stopPrank();
    }

    function test_buyFillsWhenThePriceAllows() public {
        uint256 q = router.quoteBuy(token, 400 ether - limits.runFee());
        vm.prank(alice);
        uint256 id = limits.placeBuy{value: 400 ether}(token, q, 0);

        uint256 k0 = keeper.balance;
        vm.roll(vm.getBlockNumber() + 1);
        vm.prank(keeper);
        limits.fill(id, 400 ether);
        assertEq(IERC20(token).balanceOf(alice), q);
        assertEq(keeper.balance - k0, limits.runFee());
        assertFalse(limits.getOrder(id).open);
    }

    function test_buyDoesNotFillAbovePrice() public {
        uint256 q = router.quoteBuy(token, 400 ether);
        vm.prank(alice);
        uint256 id = limits.placeBuy{value: 400 ether}(token, q * 2, 0);
        vm.roll(vm.getBlockNumber() + 1);
        vm.prank(keeper);
        vm.expectRevert();
        limits.fill(id, 400 ether);
        assertTrue(limits.getOrder(id).open);
    }

    function test_sellFillsOnceThePriceRises() public {
        uint256 held = _bobHolds(400 ether);
        vm.roll(vm.getBlockNumber() + 1);
        vm.prank(bob);
        uint256 id = limits.placeSell(token, held, 400 ether, 0); // wants more than it paid
        vm.prank(keeper);
        vm.expectRevert();
        limits.fill(id, held);

        vm.prank(alice);
        router.buy{value: 2_000 ether}(token, 1, alice, _deadline()); // price goes up

        uint256 b0 = bob.balance;
        vm.roll(vm.getBlockNumber() + 1);
        vm.prank(keeper);
        limits.fill(id, held);
        assertGt(bob.balance - b0, 400 ether - limits.runFee());
        assertFalse(limits.getOrder(id).open);
    }

    function test_partialFillsScaleTheMinimum() public {
        uint256 q = router.quoteBuy(token, 200 ether - limits.runFee());
        vm.prank(alice);
        uint256 id = limits.placeBuy{value: 400 ether}(token, q, 0);
        vm.roll(vm.getBlockNumber() + 1);
        vm.prank(keeper);
        limits.fill(id, 100 ether);
        LimitOrders.Order memory o = limits.getOrder(id);
        assertEq(o.left, 300 ether);
        assertTrue(o.open);
    }

    /// In Prorata's code the batch path paid the run fee to the contract itself. Here the keeper gets it.
    function test_batchPaysTheRealKeeper() public {
        vm.startPrank(alice);
        uint256 a = limits.placeBuy{value: 40 ether}(token, 1, 0);
        uint256 b = limits.placeBuy{value: 40 ether}(token, 1, 0);
        vm.stopPrank();

        uint256[] memory ids = new uint256[](2);
        uint256[] memory parts = new uint256[](2);
        (ids[0], ids[1], parts[0], parts[1]) = (a, b, 40 ether, 40 ether);

        uint256 k0 = keeper.balance;
        vm.roll(vm.getBlockNumber() + 1);
        vm.prank(keeper);
        assertEq(limits.fillBatch(ids, parts), 2);
        assertEq(keeper.balance - k0, limits.runFee() * 2);
        assertEq(address(limits).balance, 0, "nothing stranded");
    }

    function test_batchSkipsWhatCantFill() public {
        vm.startPrank(alice);
        uint256 a = limits.placeBuy{value: 40 ether}(token, 1, 0);
        uint256 b = limits.placeBuy{value: 40 ether}(token, type(uint128).max, 0);
        vm.stopPrank();
        uint256[] memory ids = new uint256[](2);
        uint256[] memory parts = new uint256[](2);
        (ids[0], ids[1], parts[0], parts[1]) = (a, b, 40 ether, 40 ether);
        vm.roll(vm.getBlockNumber() + 1);
        vm.prank(keeper);
        assertEq(limits.fillBatch(ids, parts), 1);
        assertFalse(limits.getOrder(a).open);
        assertTrue(limits.getOrder(b).open);
    }

    function test_proRataBatchFillsEveryOrderBySize() public {
        vm.startPrank(alice);
        uint256 a = limits.placeBuy{value: 120 ether}(token, 1, 0);
        uint256 b = limits.placeBuy{value: 40 ether}(token, 1, 0);
        vm.stopPrank();
        uint256[] memory ids = new uint256[](2);
        uint256[] memory parts = new uint256[](2);
        (ids[0], ids[1], parts[0], parts[1]) = (a, b, 60 ether, 20 ether); // half of each
        vm.prank(keeper);
        limits.fillBatch(ids, parts);
        assertEq(limits.getOrder(a).left, 60 ether);
        assertEq(limits.getOrder(b).left, 20 ether);
    }

    function test_fillFromBatchIsNotCallableFromOutside() public {
        vm.prank(alice);
        uint256 id = limits.placeBuy{value: 40 ether}(token, 1, 0);
        vm.prank(bob);
        vm.expectRevert(LimitOrders.Busy.selector);
        limits.fillFromBatch(id, 40 ether, bob);
    }

    function test_orderSurvivesGraduation() public {
        uint256 held = _bobHolds(400 ether);
        vm.roll(vm.getBlockNumber() + 1);
        vm.prank(bob);
        uint256 id = limits.placeSell(token, held, 1, 0);
        vm.prank(alice);
        router.buy{value: 12_000 ether}(token, 1, alice, _deadline()); // fills the curve

        (,, bool graduated,,,,,,,,) = pad.curves(token);
        assertTrue(graduated);
        uint256 b0 = bob.balance;
        vm.roll(vm.getBlockNumber() + 1);
        vm.prank(keeper);
        limits.fill(id, held);
        assertGt(bob.balance, b0, "the same order now fills on the pool");
    }

    function test_buyThatFillsTheCurveRefundsTheOwner() public {
        vm.prank(alice);
        uint256 id = limits.placeBuy{value: 40_000 ether}(token, 1, 0);
        uint256 a0 = alice.balance;
        vm.roll(vm.getBlockNumber() + 1);
        vm.prank(keeper);
        limits.fill(id, 40_000 ether);
        assertGt(alice.balance - a0, 32_000 ether, "most of the ZRO came back");
        assertEq(address(limits).balance, 0);
    }

    function test_cancelRefunds() public {
        vm.startPrank(alice);
        uint256 id = limits.placeBuy{value: 400 ether}(token, 1, 0);
        uint256 a0 = alice.balance;
        limits.cancel(id);
        vm.stopPrank();
        assertEq(alice.balance - a0, 400 ether);

        uint256 held = _bobHolds(400 ether);
        vm.roll(vm.getBlockNumber() + 1);
        vm.startPrank(bob);
        uint256 id2 = limits.placeSell(token, held, 1, 0);
        limits.cancel(id2);
        vm.stopPrank();
        assertEq(IERC20(token).balanceOf(bob), held);
    }

    function test_onlyOwnerCancels() public {
        vm.prank(alice);
        uint256 id = limits.placeBuy{value: 400 ether}(token, 1, 0);
        vm.prank(bob);
        vm.expectRevert(LimitOrders.NotYours.selector);
        limits.cancel(id);
    }

    function test_expiredOrderRefundsInsteadOfFilling() public {
        vm.prank(alice);
        uint256 id = limits.placeBuy{value: 400 ether}(token, 1, uint40(block.timestamp + 10));
        vm.warp(block.timestamp + 11);
        uint256 a0 = alice.balance;
        vm.roll(vm.getBlockNumber() + 1);
        vm.prank(keeper);
        limits.fill(id, 400 ether);
        assertEq(alice.balance - a0, 400 ether);
        assertFalse(limits.getOrder(id).open);
        assertEq(IERC20(token).balanceOf(alice), 0);
    }

    function test_cannotFillTwice() public {
        vm.prank(alice);
        uint256 id = limits.placeBuy{value: 400 ether}(token, 1, 0);
        vm.roll(vm.getBlockNumber() + 1);
        vm.startPrank(keeper);
        limits.fill(id, 400 ether);
        vm.roll(vm.getBlockNumber() + 1);
        vm.expectRevert(LimitOrders.NotOpen.selector);
        limits.fill(id, 400 ether);
        vm.stopPrank();
    }

    function test_openIdsListsOnlyOpen() public {
        vm.startPrank(alice);
        uint256 a = limits.placeBuy{value: 400 ether}(token, 1, 0);
        uint256 b = limits.placeBuy{value: 400 ether}(token, 1, 0);
        limits.cancel(a);
        vm.stopPrank();
        uint256[] memory ids = limits.openIds(0, 10);
        assertEq(ids.length, 1);
        assertEq(ids[0], b);
    }

    /// Found in review: the run fee was paid per fill, so 1000 tiny fills took 99% of the order.
    function test_slicingABuyPaysNoMoreThanOneRunFee() public {
        uint256 oneFill = router.quoteBuy(token, 40 ether);
        vm.prank(alice);
        uint256 id = limits.placeBuy{value: 40.4 ether}(token, oneFill / 100, 0);

        uint256 n = 200;
        uint256 part = 40.4 ether / n;
        uint256[] memory ids = new uint256[](n);
        uint256[] memory parts = new uint256[](n);
        for (uint256 i; i < n; ++i) (ids[i], parts[i]) = (id, part);

        uint256 k0 = keeper.balance;
        vm.roll(vm.getBlockNumber() + 1);
        vm.prank(keeper);
        assertEq(limits.fillBatch(ids, parts), n);

        assertLe(keeper.balance - k0, limits.runFee() + n, "at most one run fee, give or take rounding");
        assertGe(IERC20(token).balanceOf(alice), (oneFill * 99) / 100, "the owner gets what one fill would have given");
    }

    function test_slicingASellPaysNoMoreThanOneRunFee() public {
        uint256 held = _bobHolds(400 ether);
        vm.roll(vm.getBlockNumber() + 1);
        vm.prank(bob);
        uint256 id = limits.placeSell(token, held, 1, 0);

        uint256 n = 200;
        uint256 part = held / n;
        uint256[] memory ids = new uint256[](n);
        uint256[] memory parts = new uint256[](n);
        for (uint256 i; i < n; ++i) (ids[i], parts[i]) = (id, part);

        uint256 k0 = keeper.balance;
        uint256 b0 = bob.balance;
        vm.roll(vm.getBlockNumber() + 1);
        vm.prank(keeper);
        limits.fillBatch(ids, parts);
        assertLe(keeper.balance - k0, limits.runFee() + n);
        assertGt(bob.balance - b0, 360 ether, "the seller keeps the proceeds");
    }

    /// Found in review: an owner whose wallet burns all its gas took an entire batch down.
    function test_gasBurningOwnerCantKillABatch() public {
        GasBurner burner = new GasBurner();
        vm.deal(address(burner), 400 ether);
        uint256 burnerTokens = burner.buy(router, token);
        vm.roll(vm.getBlockNumber() + 1);
        uint256 bad = burner.placeSell(limits, token, burnerTokens);

        vm.prank(alice);
        uint256 good = limits.placeBuy{value: 40 ether}(token, 1, 0);

        uint256[] memory ids = new uint256[](2);
        uint256[] memory parts = new uint256[](2);
        (ids[0], ids[1], parts[0], parts[1]) = (bad, good, burnerTokens, 40 ether);

        vm.prank(keeper);
        assertEq(limits.fillBatch{gas: 3_000_000}(ids, parts), 2, "both fill, whatever the wallet does with its gas");
        assertFalse(limits.getOrder(good).open);
        assertFalse(limits.getOrder(bad).open);
        assertGt(limits.credit(address(burner)), 0, "and what it wouldn't take waits for it");
    }

    function test_strayZroIsRejected() public {
        vm.prank(alice);
        (bool ok,) = address(limits).call{value: 400 ether}("");
        assertFalse(ok);
    }

    function test_ownerCantRaiseFeesPastTheCaps() public {
        vm.startPrank(owner);
        vm.expectRevert(LimitOrders.BadOrder.selector);
        limits.setConfig(101, 0);
        vm.expectRevert(LimitOrders.BadOrder.selector);
        limits.setConfig(0, 0.8 ether);
        vm.stopPrank();
    }

    function test_rejectsBadOrders() public {
        vm.startPrank(alice);
        vm.expectRevert(LimitOrders.BadOrder.selector);
        limits.placeBuy{value: 1 wei}(token, 1, 0);
        vm.expectRevert(LimitOrders.BadOrder.selector);
        limits.placeBuy{value: 400 ether}(token, 0, 0);
        vm.expectRevert(LimitOrders.BadOrder.selector);
        limits.placeBuy{value: 400 ether}(token, 1, uint40(block.timestamp));
        vm.stopPrank();
    }
}

/// A wallet that burns all the gas it's sent with.
contract GasBurner {
    uint256 private _sink;

    function buy(Router router, address token) external returns (uint256) {
        return router.buy{value: 200 ether}(token, 1, address(this), block.timestamp);
    }

    function placeSell(LimitOrders limits, address token, uint256 amount) external returns (uint256) {
        IERC20(token).approve(address(limits), amount);
        return limits.placeSell(token, amount, 1, 0);
    }

    receive() external payable {
        while (true) {
            _sink += 1;
        }
    }
}
