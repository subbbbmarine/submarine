// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.8.26;

import {Base, PlainToken} from "./Base.t.sol";
import {ZroInfinityPools} from "../src/core/ZroInfinityPools.sol";
import {HoldsOneBlock} from "../src/core/Launchpad.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IVault} from "infinity-core/src/interfaces/IVault.sol";
import {ILockCallback} from "infinity-core/src/interfaces/ILockCallback.sol";
import {ICLPoolManager} from "infinity-core/src/pool-cl/interfaces/ICLPoolManager.sol";
import {TickMath} from "infinity-core/src/pool-cl/libraries/TickMath.sol";
import {PoolKey} from "infinity-core/src/types/PoolKey.sol";
import {BalanceDelta, BalanceDeltaLibrary} from "infinity-core/src/types/BalanceDelta.sol";

/// Trades a pool straight on Infinity, the way another router or a bot would, without going through Submarine's venue.
contract DirectTrader is ILockCallback {
    using BalanceDeltaLibrary for BalanceDelta;

    IVault internal immutable vault;
    ICLPoolManager internal immutable pm;

    constructor(IVault vault_, ICLPoolManager pm_) {
        vault = vault_;
        pm = pm_;
    }

    function buy(PoolKey memory key, uint256 zro) external payable {
        vault.lock(abi.encode(uint8(0), key, zro));
    }

    function addLiquidity(PoolKey memory key) external payable {
        vault.lock(abi.encode(uint8(1), key, uint256(0)));
    }

    function removeLiquidity(PoolKey memory key) external {
        vault.lock(abi.encode(uint8(2), key, uint256(0)));
    }

    function lockAcquired(bytes calldata data) external returns (bytes memory) {
        (uint8 what, PoolKey memory key, uint256 zro) = abi.decode(data, (uint8, PoolKey, uint256));
        int24 top = (TickMath.MAX_TICK / 200) * 200;
        if (what == 0) {
            BalanceDelta d = pm.swap(
                key, ICLPoolManager.SwapParams({zeroForOne: true, amountSpecified: -int256(zro), sqrtPriceLimitX96: TickMath.MIN_SQRT_RATIO + 1}), ""
            );
            vault.settle{value: uint256(uint128(-d.amount0()))}();
            vault.take(key.currency1, address(this), uint256(uint128(d.amount1())));
        } else {
            pm.modifyLiquidity(
                key,
                ICLPoolManager.ModifyLiquidityParams({tickLower: -top, tickUpper: top, liquidityDelta: what == 1 ? int256(1e18) : -int256(1e18), salt: bytes32(0)}),
                ""
            );
        }
        return "";
    }

    function send(address token, address to, uint256 amount) external {
        IERC20(token).transfer(to, amount);
    }

    receive() external payable {}
}

contract PoolsTest is Base {
    address internal constant DEAD = 0x000000000000000000000000000000000000dEaD;
    DirectTrader internal direct;

    function setUp() public override {
        super.setUp();
        direct = new DirectTrader(infinityVault, poolManager);
        vm.deal(address(direct), 100_000 ether);
    }

    function _launchShares(uint16 fee, uint16 holdersBps, uint16 burnBps) internal returns (address token) {
        vm.prank(creator);
        // `fee` is the whole fee a trader pays, the 1% base included; the creator's own is what's above it.
        token = pad.launch("Meme", "MEME", "", 0, 1_000_000_000, fee - 100, holdersBps, burnBps, false);
    }

    function test_launchpadWiringIsOneShot() public {
        vm.prank(owner);
        vm.expectRevert(ZroInfinityPools.BadConfig.selector);
        pools.setLaunchpad(address(1));
    }

    function test_onlyLaunchpadSeeds() public {
        vm.prank(alice);
        PlainToken plain = new PlainToken();
        vm.prank(alice);
        vm.expectRevert(ZroInfinityPools.NotLaunchpad.selector);
        pools.seed{value: 400 ether}(address(plain), 1 ether, 0, 0);
    }

    function test_nobodyElseOpensAPoolWearingTheHook() public {
        address token = _launch();
        PoolKey memory key = pools.poolKeyOf(token);
        vm.prank(alice);
        vm.expectRevert();
        poolManager.initialize(key, uint160(1) << 96);
    }

    function test_graduationOpensOneLockedFullRangePosition() public {
        address token = _launch();
        _graduate(token);
        (uint256 rz, uint256 rt, uint256 liquidity) = pools.pools(token);
        assertApproxEqRel(rz, 6_000 ether, 1e12);
        assertApproxEqRel(rt, pad.LP_SUPPLY(), 1e12);
        assertGt(liquidity, 0);
        assertLt(IERC20(token).balanceOf(address(pools)), 1e6, "every token went into the pool but a few wei of rounding");
        assertApproxEqRel(pools.priceOf(token), pad.priceOf(token), 1e12, "no price step at graduation");
    }

    function test_nobodyAddsOrRemovesLiquidity() public {
        address token = _launch();
        _graduate(token);
        PoolKey memory key = pools.poolKeyOf(token);
        vm.expectRevert();
        direct.addLiquidity(key);
        vm.expectRevert();
        direct.removeLiquidity(key);
    }

    function test_swapBothWaysMatchesQuotes() public {
        address token = _launch();
        _graduate(token);
        uint256 quoted = pools.quoteBuy(token, 400 ether);
        vm.prank(alice);
        uint256 got = venue.buy{value: 400 ether}(token, 0, alice, _deadline());
        assertEq(got, quoted, "buy");

        uint256 quotedBack = pools.quoteSell(token, got);
        vm.startPrank(alice);
        IERC20(token).approve(address(venue), got);
        vm.roll(vm.getBlockNumber() + 1);
        uint256 back = venue.sell(token, got, 0, alice, _deadline());
        vm.stopPrank();
        assertEq(back, quotedBack, "sell");
        assertLt(back, 400 ether, "a round trip costs the fee");
        assertEq(address(venue).balance, 0, "nothing stays on the venue");
        assertEq(IERC20(token).balanceOf(address(venue)), 0);
    }

    function test_aTradeAroundTheVenueStillPaysTheFee() public {
        address token = _launchShares(500, 0, 0); // all to the creator
        _graduate(token);
        PoolKey memory key = pools.poolKeyOf(token);
        uint256 before = pad.creatorFees(creator);
        uint256 terminalBefore = pad.protocolFees();
        direct.buy(key, 400 ether);
        assertEq(pools.pending(token), 18.4 ether, "4.6% of 400 ZRO held for the earners: the creator's 0.6% and their own 4%");
        assertEq(pools.pendingProtocol(token), 1.6 ether, "and the terminal's 0.4%, with no rank to take any off");
        assertGt(IERC20(token).balanceOf(address(direct)), 0);

        pools.distribute(token);
        assertEq(pools.pending(token), 0);
        assertEq(pools.pendingProtocol(token), 0);
        assertEq(pad.creatorFees(creator) - before, 18.4 ether);
        assertEq(pad.protocolFees() - terminalBefore, 1.6 ether);
    }

    /// The one-block hold reaches a trade around the venue too: its coins come out of Infinity's vault, which marks whoever gets them.
    function test_aTradeAroundTheVenueHoldsItsCoinsForABlock() public {
        address token = _launch();
        _graduate(token);
        vm.roll(vm.getBlockNumber() + 1);
        direct.buy(pools.poolKeyOf(token), 400 ether);
        uint256 got = IERC20(token).balanceOf(address(direct));
        assertGt(got, 0);
        vm.expectRevert(HoldsOneBlock.BoughtThisBlock.selector);
        direct.send(token, alice, got);

        vm.roll(vm.getBlockNumber() + 1);
        direct.send(token, alice, got);
        assertEq(IERC20(token).balanceOf(alice), got);
    }

    function test_aBuyWhoseFeeIsMoreThanTheVaultHoldsGoesThrough() public {
        address token = _launchShares(1_000, 0, 0); // 10% fee: 9.6% to the creator, 0.4% to the terminal
        _graduate(token);
        // 10% of 100,000 ZRO is more than the 6,000 the pool started with.
        vm.deal(alice, 200_000 ether);
        vm.prank(alice);
        uint256 got = venue.buy{value: 100_000 ether}(token, 0, alice, _deadline());
        assertGt(got, 0);
        assertEq(pools.pending(token), 0, "paid out in the same trade");
        assertEq(pools.pendingProtocol(token), 0, "the terminal's part too");
    }

    function test_theBurnShareBuysBackAndBurns() public {
        address token = _launchShares(500, 0, 5_000); // half of the creator's own 4% burned
        _graduate(token);
        uint256 deadBefore = IERC20(token).balanceOf(DEAD);
        uint256 creatorBefore = pad.creatorFees(creator);
        vm.prank(alice);
        venue.buy{value: 400 ether}(token, 0, alice, _deadline());
        assertGt(IERC20(token).balanceOf(DEAD), deadBefore, "bought back and burned");
        // The creator's 0.6% base and the other half of their own 4%. The burn's share is restated as a whole basis point of the
        // pool's cut, so this is near, not exact.
        assertApproxEqRel(pad.creatorFees(creator) - creatorBefore, 2.4 ether + 8 ether, 0.001e18, "the rest to the creator");
    }

    function testFuzz_roundTripsNeverPayOut(uint96 zro) public {
        address token = _launch();
        _graduate(token);
        uint256 amount = bound(uint256(zro), 1 ether, 100_000 ether);
        vm.deal(alice, amount);
        vm.prank(alice);
        uint256 got = venue.buy{value: amount}(token, 0, alice, _deadline());
        vm.startPrank(alice);
        IERC20(token).approve(address(venue), got);
        vm.roll(vm.getBlockNumber() + 1);
        uint256 back = venue.sell(token, got, 0, alice, _deadline());
        vm.stopPrank();
        assertLt(back, amount);
        assertEq(address(venue).balance, 0);
    }
}
