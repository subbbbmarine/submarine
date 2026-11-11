// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {IVault} from "infinity-core/src/interfaces/IVault.sol";
import {ILockCallback} from "infinity-core/src/interfaces/ILockCallback.sol";
import {ICLPoolManager} from "infinity-core/src/pool-cl/interfaces/ICLPoolManager.sol";
import {TickMath} from "infinity-core/src/pool-cl/libraries/TickMath.sol";
import {PoolKey} from "infinity-core/src/types/PoolKey.sol";
import {Currency} from "infinity-core/src/types/Currency.sol";
import {BalanceDelta, BalanceDeltaLibrary} from "infinity-core/src/types/BalanceDelta.sol";

import {IVenue} from "../interfaces/IVenue.sol";
import {ZroInfinityPools} from "../core/ZroInfinityPools.sol";

/// @title ZroInfinityVenue
/// @notice The router's way into graduated tokens' Infinity pools: buys and sells through Infinity's vault, then pays out the fee the
/// pool's hook collected on the trade. Holds nothing between calls.
/// @dev A contract of its own because Infinity skips a pool's hook when the hook itself is the one swapping: the venue has to be a
/// different address for its trades to pay the fee like everyone else's. It names the trade's recipient in the hook data, so the
/// pool's Swap event shows the trader and not the router.
contract ZroInfinityVenue is IVenue, ILockCallback, ReentrancyGuard {
    using SafeERC20 for IERC20;
    using BalanceDeltaLibrary for BalanceDelta;

    IVault public immutable vault;
    ICLPoolManager public immutable poolManager;
    ZroInfinityPools public immutable pools;

    error NotVault();
    error NoPool();
    error ZeroAmount();
    error Slippage();
    error Expired();
    error TransferFailed();

    constructor(ZroInfinityPools pools_) {
        pools = pools_;
        vault = pools_.vault();
        poolManager = pools_.poolManager();
    }

    /// @inheritdoc IVenue
    function quoteBuy(address token, uint256 zroIn) external view returns (uint256) {
        return pools.quoteBuy(token, zroIn);
    }

    /// @inheritdoc IVenue
    function quoteSell(address token, uint256 tokensIn) external view returns (uint256) {
        return pools.quoteSell(token, tokensIn);
    }

    /// @inheritdoc IVenue
    function buy(address token, uint256 minOut, address recipient, uint256 deadline) external payable nonReentrant returns (uint256 tokensOut) {
        if (block.timestamp > deadline) revert Expired();
        if (msg.value == 0) revert ZeroAmount();
        _requirePool(token);
        tokensOut = abi.decode(vault.lock(abi.encode(token, true, msg.value, recipient)), (uint256));
        if (tokensOut == 0 || tokensOut < minOut) revert Slippage();
        // The fee is paid out before the buyer holds the tokens, so on a token that pays its holders nobody earns from their own buy.
        pools.distribute(token);
        IERC20(token).safeTransfer(recipient, tokensOut);
    }

    /// @inheritdoc IVenue
    function sell(address token, uint256 tokensIn, uint256 minOut, address recipient, uint256 deadline) external nonReentrant returns (uint256 zroOut) {
        if (block.timestamp > deadline) revert Expired();
        _requirePool(token);
        IERC20 t = IERC20(token);
        uint256 before = t.balanceOf(address(this));
        t.safeTransferFrom(msg.sender, address(this), tokensIn);
        uint256 got = t.balanceOf(address(this)) - before;
        if (got == 0) revert ZeroAmount();
        zroOut = abi.decode(vault.lock(abi.encode(token, false, got, recipient)), (uint256));
        if (zroOut == 0 || zroOut < minOut) revert Slippage();
        pools.distribute(token);
    }

    /// @inheritdoc ILockCallback
    function lockAcquired(bytes calldata data) external returns (bytes memory) {
        if (msg.sender != address(vault)) revert NotVault();
        (address token, bool isBuy, uint256 amountIn, address recipient) = abi.decode(data, (address, bool, uint256, address));
        PoolKey memory key = pools.poolKeyOf(token);
        BalanceDelta delta = poolManager.swap(
            key,
            ICLPoolManager.SwapParams({
                zeroForOne: isBuy,
                amountSpecified: -int256(amountIn),
                sqrtPriceLimitX96: isBuy ? TickMath.MIN_SQRT_RATIO + 1 : TickMath.MAX_SQRT_RATIO - 1
            }),
            abi.encode(recipient)
        );
        // What the trade owes is paid from what came in; what it produced goes straight to the recipient.
        uint256 paid0 = _settle(key.currency0, delta.amount0());
        _settle(key.currency1, delta.amount1());
        // A sale's ZRO goes straight to the recipient; a buy's tokens come here first, see `buy`.
        uint256 out = isBuy ? _take(key.currency1, delta.amount1(), address(this)) : _take(key.currency0, delta.amount0(), recipient);
        // A buy stopped by the price limit spends less than it was sent; whatever is left goes back.
        if (isBuy && amountIn > paid0) {
            (bool ok,) = recipient.call{value: amountIn - paid0}("");
            if (!ok) revert TransferFailed();
        }
        return abi.encode(out);
    }

    function _requirePool(address token) private view {
        (,, uint256 liquidity) = pools.pools(token);
        if (liquidity == 0) revert NoPool();
    }

    function _settle(Currency currency, int128 delta) private returns (uint256 owed) {
        if (delta >= 0) return 0;
        owed = uint256(uint128(-delta));
        if (currency.isNative()) {
            vault.settle{value: owed}();
        } else {
            vault.sync(currency);
            IERC20(Currency.unwrap(currency)).safeTransfer(address(vault), owed);
            vault.settle();
        }
    }

    function _take(Currency currency, int128 delta, address to) private returns (uint256 amount) {
        if (delta <= 0) return 0;
        amount = uint256(uint128(delta));
        vault.take(currency, to, amount);
    }
}
