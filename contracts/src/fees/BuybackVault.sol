// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IVenue} from "../interfaces/IVenue.sol";

/// @title BuybackVault
/// @notice The terminal's treasury. Every fee lands here, and the only way out is buying one token and burning it: there is
/// no withdraw function, for the owner or anyone else.
/// @dev Letting a keeper name the token to buy would let it buy a token it controls and walk off with the ZRO, so the token
/// is set once and never changes. Until it is set, fees simply accumulate. The router is also set once, and spending is
/// capped per round, which limits what a compromised keeper can lose to a bad price: it can still choose a poor moment and
/// a low minimum, so the cap is the real protection, not the minimum.
contract BuybackVault is Ownable2Step, ReentrancyGuard {
    address public constant DEAD = 0x000000000000000000000000000000000000dEaD;
    uint256 public constant BPS = 10_000;
    uint256 public constant MAX_SPEND_BPS = 1_000; // 10% of the balance per round
    uint256 public constant MIN_INTERVAL = 1 hours;

    IVenue public router;
    address public buybackToken;
    address public keeper;
    uint256 public lastBuyback;
    uint256 public totalSpent;
    uint256 public totalBurned;

    event Buyback(address indexed token, uint256 zroSpent, uint256 tokensBurned);
    event KeeperUpdated(address keeper);
    event RouterSet(address router);
    event BuybackTokenSet(address token);

    error NotKeeper();
    error BadConfig();
    error AlreadySet();
    error NoToken();
    error TooSoon();
    error TooMuch();

    constructor(address owner_, address keeper_) Ownable(owner_) {
        keeper = keeper_;
    }

    /// @notice One-shot: the router needs this vault's address as its treasury, so it can only exist after the vault does.
    function setRouter(address router_) external onlyOwner {
        if (address(router) != address(0)) revert AlreadySet();
        if (router_ == address(0)) revert BadConfig();
        router = IVenue(router_);
        emit RouterSet(router_);
    }

    /// @notice One-shot: the token this treasury will ever buy.
    function setBuybackToken(address token) external onlyOwner {
        if (buybackToken != address(0)) revert AlreadySet();
        if (token == address(0)) revert BadConfig();
        buybackToken = token;
        emit BuybackTokenSet(token);
    }

    function setKeeper(address keeper_) external onlyOwner {
        keeper = keeper_;
        emit KeeperUpdated(keeper_);
    }

    /// @notice Spend vault ZRO on the buyback token and send everything bought to the dead address.
    function buyback(uint256 zroAmount, uint256 minOut) external nonReentrant returns (uint256 burned) {
        if (msg.sender != keeper && msg.sender != owner()) revert NotKeeper();
        address token = buybackToken;
        if (token == address(0)) revert NoToken();
        if (minOut == 0 || zroAmount == 0) revert BadConfig();
        if (block.timestamp < lastBuyback + MIN_INTERVAL) revert TooSoon();
        uint256 before = address(this).balance;
        if (zroAmount > (before * MAX_SPEND_BPS) / BPS) revert TooMuch();
        lastBuyback = block.timestamp;

        burned = router.buy{value: zroAmount}(token, minOut, DEAD, block.timestamp);
        uint256 spent = before - address(this).balance; // a refund from the router lowers the true spend
        totalSpent += spent;
        totalBurned += burned;
        emit Buyback(token, spent, burned);
    }

    receive() external payable {}
}
