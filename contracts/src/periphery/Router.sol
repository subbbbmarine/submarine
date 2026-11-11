// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IVenue} from "../interfaces/IVenue.sol";

interface IReferralBook {
    function referrerOf(address trader) external view returns (address);
    function credit(address trader) external payable;
}

/// @title Router
/// @notice One entry point for every venue: it asks each listed venue for a quote and trades on the best one. A new
/// launchpad joins by listing an adapter, and nothing else changes. Router itself has the IVenue shape, so limit orders
/// and agents can treat "the best price anywhere" as one venue.
/// @dev The fee is per venue because our own curve and pool already take the terminal's 0.4% themselves, on every trade of
/// our tokens, so they're listed at zero. On other launchpads' venues the router's fee is the terminal's cut, once. Trading
/// such a venue directly skips the router and its fee. The router holds no funds between calls.
///
/// Every trade through here adds to its trader's volume, for good. Past each mark of volume the terminal's cut on that
/// trader's trades gets smaller, here and on our own curve, which asks `discountOf`. The marks are fixed in this code.
///
/// Trust: a listed venue receives traders' funds and is only bound by each trader's own minimum, so listing is the power
/// that matters. After setup a new venue must wait out LISTING_DELAY in public, which gives anyone time to leave. Removing
/// a venue is instant, because that is the emergency action. The treasury can't be changed at all.
contract Router is IVenue, Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant BPS = 10_000;
    uint256 public constant MAX_FEE_BPS = 100; // 1%
    uint256 public constant MAX_VENUES = 16;
    uint256 public constant LISTING_DELAY = 2 days;
    /// @dev Enough for any honest quote. A venue can't stall routing by burning gas in one.
    uint256 public constant QUOTE_GAS = 300_000;
    uint256 private constant NONE = type(uint256).max;
    /// @notice Of the router's fee on a referred trader's trade, the part that goes to Referrals instead of the treasury.
    uint256 public constant REFERRAL_BPS = 4_000;
    /// @dev Transient slot holding who the trade in progress is for, so a venue paying fees can tell.
    bytes32 private constant TRADER_SLOT = keccak256("terminal.router.trader");
    /// @notice How many ranks there are above the first, which every wallet starts at.
    uint256 public constant RANKS = 5;

    /// @notice A wallet's latest trade of a token through here. Copy trading checks a leader's trade against this, so a
    /// buy only counts when the wallet bought for itself: nobody can make a leader appear to buy by sending them tokens.
    struct Activity {
        uint40 buyBlock;
        uint40 sellBlock;
        uint16 soldBps; // the share of its holding the latest sale let go
        uint128 buyZro; // ZRO the latest buy spent, fee included
        uint128 buyTokens;
        uint128 sellZro; // ZRO the latest sale brought, after the fee
        uint128 sellTokens;
    }

    struct Venue {
        IVenue venue;
        uint16 feeBps;
        string name;
    }

    Venue[] private _venues;
    address public immutable treasury;
    /// @notice True only during deployment, before any funds pass through. Once closed, it stays closed.
    bool public setupOpen = true;
    mapping(bytes32 => uint256) public queuedAt;
    IReferralBook public immutable referrals;
    mapping(address => mapping(address => Activity)) private _activity;
    /// @notice ZRO a wallet has traded through here, buys and sales alike.
    mapping(address => uint256) public volumeOf;
    /// @notice Our own order and copy contracts, which trade here for their users, so those trades count for the users: their
    /// volume, their rank and their referrer. Set once.
    mapping(address => bool) public isForwarder;
    bool public forwardersSet;
    /// @notice Venues listed at deployment, our own curve and pool, which take the terminal's cut themselves. Their router fee
    /// stays what it was listed at, zero, for good.
    mapping(address => bool) public feeFixed;

    event Routed(
        address indexed token,
        address indexed trader,
        address indexed venue,
        bool isBuy,
        uint256 zroAmount,
        uint256 tokenAmount,
        uint256 fee
    );
    event SetupFinished();
    event VenueQueued(bytes32 indexed id, address indexed venue, uint16 feeBps, string name, uint256 listableAt);
    event VenueQueueCancelled(bytes32 indexed id);
    event VenueListed(uint256 indexed index, address indexed venue, uint16 feeBps, string name);
    event VenueUpdated(uint256 indexed index, uint16 feeBps);
    event VenueRemoved(uint256 indexed index, address indexed venue);
    /// @notice A wallet passed a mark of volume, and pays less from its next trade.
    event RankUp(address indexed trader, uint256 rank, uint256 volume);
    event Rescued(address indexed token, address indexed to, uint256 amount);

    error NoRoute();
    error Expired();
    error Slippage();
    error BadConfig();
    error NotReady();
    error TransferFailed();
    error StrayZro();
    error NotForwarder();

    constructor(address owner_, address treasury_, address referrals_) Ownable(owner_) {
        if (treasury_ == address(0)) revert BadConfig();
        treasury = treasury_;
        referrals = IReferralBook(referrals_); // zero means no referral program
    }

    // ------------------------------------------------------------------ admin

    /// @notice Once only, since a forwarder decides whose trade it is.
    function setForwarders(address[] calldata list) external onlyOwner {
        if (forwardersSet) revert BadConfig();
        forwardersSet = true;
        for (uint256 i; i < list.length; ++i) {
            isForwarder[list[i]] = true;
        }
    }

    function finishSetup() external onlyOwner {
        setupOpen = false;
        emit SetupFinished();
    }

    /// @notice Announces a venue. It can be listed once LISTING_DELAY has passed.
    function queueVenue(address venue, uint16 feeBps, string calldata name) external onlyOwner returns (bytes32 id) {
        if (venue == address(0) || feeBps > MAX_FEE_BPS) revert BadConfig();
        id = keccak256(abi.encode(venue, feeBps, name));
        queuedAt[id] = block.timestamp;
        emit VenueQueued(id, venue, feeBps, name, block.timestamp + LISTING_DELAY);
    }

    function cancelQueuedVenue(bytes32 id) external onlyOwner {
        delete queuedAt[id];
        emit VenueQueueCancelled(id);
    }

    function listVenue(address venue, uint16 feeBps, string calldata name) external onlyOwner {
        if (venue == address(0) || feeBps > MAX_FEE_BPS || _venues.length >= MAX_VENUES) revert BadConfig();
        if (!setupOpen) {
            bytes32 id = keccak256(abi.encode(venue, feeBps, name));
            uint256 at = queuedAt[id];
            if (at == 0 || block.timestamp < at + LISTING_DELAY) revert NotReady();
            delete queuedAt[id];
        }
        if (feeFixed[venue] && feeBps != 0) revert BadConfig(); // nor by listing it again with one
        if (setupOpen) feeFixed[venue] = true;
        _venues.push(Venue(IVenue(venue), feeBps, name));
        emit VenueListed(_venues.length - 1, venue, feeBps, name);
    }

    /// @notice Capped by MAX_FEE_BPS, and every trade still has the trader's own minimum as a floor.
    function setVenueFee(uint256 index, uint16 feeBps) external onlyOwner {
        if (feeBps > MAX_FEE_BPS || feeFixed[address(_venues[index].venue)]) revert BadConfig();
        _venues[index].feeBps = feeBps;
        emit VenueUpdated(index, feeBps);
    }

    function removeVenue(uint256 index) external onlyOwner {
        address gone = address(_venues[index].venue);
        _venues[index] = _venues[_venues.length - 1];
        _venues.pop();
        emit VenueRemoved(index, gone);
    }

    // ------------------------------------------------------------------ reads

    /// @notice Sends on coins someone sent straight to the router by mistake, so they can go back to whoever sent them. The router
    /// holds no coins between calls, since a sale hands back whatever its venue didn't take, so this can only move strays.
    function rescue(IERC20 token, address to) external onlyOwner nonReentrant {
        if (to == address(0)) revert BadConfig();
        uint256 amount = token.balanceOf(address(this));
        token.safeTransfer(to, amount);
        emit Rescued(address(token), to, amount);
    }

    function venuesCount() external view returns (uint256) {
        return _venues.length;
    }

    function venueAt(uint256 index) external view returns (address venue, uint16 feeBps, string memory name) {
        Venue storage v = _venues[index];
        return (address(v.venue), v.feeBps, v.name);
    }

    /// @notice Best buy across venues. A venue that fails to answer properly just doesn't get the trade.
    function bestBuy(address token, uint256 zroIn) public view returns (uint256 index, uint256 tokensOut) {
        return _bestBuy(token, zroIn, 0);
    }

    /// @notice Best sell across venues, after each venue's router fee.
    function bestSell(address token, uint256 tokensIn) public view returns (uint256 index, uint256 zroOut) {
        return _bestSell(token, tokensIn, 0);
    }

    /// @notice The volume a rank starts at and what it takes off the terminal's cut, in basis points of a trade. Rank 0 is
    /// where everyone starts.
    function rankAt(uint256 rank) public pure returns (uint256 volume, uint256 offBps) {
        if (rank == 1) return (2_000 ether, 5);
        if (rank == 2) return (10_000 ether, 10);
        if (rank == 3) return (40_000 ether, 15);
        if (rank == 4) return (200_000 ether, 20);
        if (rank == 5) return (1_000_000 ether, 25);
        return (0, 0);
    }

    function rankOf(address trader) public view returns (uint256 rank) {
        uint256 v = volumeOf[trader];
        for (uint256 r = RANKS; r > 0; --r) {
            (uint256 from,) = rankAt(r);
            if (v >= from) return r;
        }
    }

    function discountOf(address trader) public view returns (uint256 offBps) {
        (, offBps) = rankAt(rankOf(trader));
    }

    function activityOf(address wallet, address token) external view returns (Activity memory) {
        return _activity[wallet][token];
    }

    /// @notice Who the trade in progress is for. Zero outside a trade. A venue that sees the router as its trader asks this.
    function currentTrader() external view returns (address who) {
        bytes32 slot = TRADER_SLOT;
        assembly {
            who := tload(slot)
        }
    }

    /// @inheritdoc IVenue
    function quoteBuy(address token, uint256 zroIn) external view returns (uint256 tokensOut) {
        (, tokensOut) = bestBuy(token, zroIn);
    }

    /// @inheritdoc IVenue
    function quoteSell(address token, uint256 tokensIn) external view returns (uint256 zroOut) {
        (, zroOut) = bestSell(token, tokensIn);
    }

    // ------------------------------------------------------------------ trades

    /// @inheritdoc IVenue
    function buy(address token, uint256 minOut, address recipient, uint256 deadline)
        external
        payable
        nonReentrant
        returns (uint256 tokensOut)
    {
        return _buy(token, minOut, recipient, deadline, recipient, true);
    }

    /// @notice A buy one of our order or copy contracts makes for `trader`, which counts as theirs.
    function buyFor(address token, uint256 minOut, address recipient, uint256 deadline, address trader)
        external
        payable
        nonReentrant
        returns (uint256 tokensOut)
    {
        if (!isForwarder[msg.sender]) revert NotForwarder();
        return _buy(token, minOut, recipient, deadline, trader, false);
    }

    /// @inheritdoc IVenue
    function sell(address token, uint256 tokensIn, uint256 minOut, address recipient, uint256 deadline)
        external
        nonReentrant
        returns (uint256 zroOut)
    {
        return _sell(token, tokensIn, minOut, recipient, deadline, msg.sender, true);
    }

    /// @notice A sale one of our order or copy contracts makes for `trader`, which counts as theirs. The tokens come from it.
    function sellFor(address token, uint256 tokensIn, uint256 minOut, address recipient, uint256 deadline, address trader)
        external
        nonReentrant
        returns (uint256 zroOut)
    {
        if (!isForwarder[msg.sender]) revert NotForwarder();
        return _sell(token, tokensIn, minOut, recipient, deadline, trader, false);
    }

    /// @param trader Whose trade it is: whose volume it adds to, whose rank lowers the fee and whose referrer shares it.
    /// @param direct Made by the trader themselves, so it's what copy trading follows.
    function _buy(address token, uint256 minOut, address recipient, uint256 deadline, address trader, bool direct) private returns (uint256 tokensOut) {
        if (block.timestamp > deadline) revert Expired();
        if (token.code.length == 0) revert NoRoute();
        // Tokens bought for the router itself would stay here for good, with nothing to send them on.
        if (recipient == address(this) || recipient == address(0)) revert BadConfig();
        uint256 balanceBefore = address(this).balance - msg.value;
        uint256 tokenBefore = IERC20(token).balanceOf(recipient);
        bytes memory payload = abi.encodeCall(IVenue.buy, (token, 0, recipient, deadline));
        _setTrader(trader);

        // Best quote first. A venue that quotes well and then fails is passed over for the next one.
        address venue;
        uint256 feeBps;
        uint256 fee;
        uint256 tried;
        uint256 off = discountOf(trader);
        while (true) {
            (uint256 index,) = _bestBuy(token, msg.value, tried);
            if (index == NONE) revert NoRoute();
            venue = address(_venues[index].venue);
            feeBps = _venues[index].feeBps > off ? _venues[index].feeBps - off : 0;
            fee = (msg.value * feeBps) / BPS;
            (bool ok,) = venue.call{value: msg.value - fee}(payload);
            if (ok) break;
            tried |= 1 << index;
        }

        tokensOut = IERC20(token).balanceOf(recipient) - tokenBefore; // what really arrived, not what the venue claims
        if (tokensOut == 0 || tokensOut < minOut) revert Slippage();

        // A venue may refund part of the ZRO (the buy that fills a curve). The fee is only on what the venue kept, and the
        // refund goes back to the trader.
        uint256 returned = address(this).balance - balanceBefore - fee;
        if (returned > 0) fee = ((msg.value - fee - returned) * feeBps) / (BPS - feeBps);
        uint256 refund = address(this).balance - balanceBefore - fee;

        _payFee(fee, trader);
        if (refund > 0) _send(msg.sender, refund);
        _addVolume(trader, msg.value - refund);
        if (direct && recipient == msg.sender) {
            Activity storage a = _activity[msg.sender][token];
            (a.buyBlock, a.buyZro, a.buyTokens) = (uint40(block.number), uint128(msg.value - refund), uint128(tokensOut));
        }
        _setTrader(address(0));
        emit Routed(token, trader, venue, true, msg.value - refund, tokensOut, fee);
    }

    function _sell(address token, uint256 tokensIn, uint256 minOut, address recipient, uint256 deadline, address trader, bool direct)
        private
        returns (uint256 zroOut)
    {
        if (block.timestamp > deadline) revert Expired();
        // ZRO sent to the router itself would stay here for good, as tokens bought for it would.
        if (recipient == address(this) || recipient == address(0)) revert BadConfig();
        IERC20 t = IERC20(token);
        uint256 tokenBefore = t.balanceOf(address(this));
        t.safeTransferFrom(msg.sender, address(this), tokensIn);
        uint256 got = t.balanceOf(address(this)) - tokenBefore;
        uint256 balanceBefore = address(this).balance;
        bytes memory payload = abi.encodeCall(IVenue.sell, (token, got, 0, address(this), deadline));
        _setTrader(trader);

        address venue;
        uint256 feeBps;
        uint256 tried;
        uint256 off = discountOf(trader);
        while (true) {
            (uint256 index,) = _bestSell(token, got, tried);
            if (index == NONE) revert NoRoute();
            venue = address(_venues[index].venue);
            feeBps = _venues[index].feeBps > off ? _venues[index].feeBps - off : 0;
            t.forceApprove(venue, got);
            (bool ok,) = venue.call(payload);
            t.forceApprove(venue, 0);
            if (ok) break;
            tried |= 1 << index;
        }

        uint256 gross = address(this).balance - balanceBefore;
        uint256 fee = (gross * feeBps) / BPS;
        zroOut = gross - fee;
        if (zroOut == 0 || zroOut < minOut) revert Slippage();

        // Anything the venue didn't take goes back, because nothing may stay here between calls.
        uint256 left = t.balanceOf(address(this)) - tokenBefore;
        if (left > 0) t.safeTransfer(msg.sender, left);

        _payFee(fee, trader);
        _send(recipient, zroOut);
        _addVolume(trader, gross);
        uint256 sold = got - left;
        if (direct) {
            Activity storage a = _activity[msg.sender][token];
            uint256 kept = t.balanceOf(msg.sender);
            (a.sellBlock, a.soldBps, a.sellZro, a.sellTokens) = (uint40(block.number), uint16((sold * BPS) / (sold + kept)), uint128(zroOut), uint128(sold));
        }
        _setTrader(address(0));
        emit Routed(token, trader, venue, false, zroOut, sold, fee);
    }

    // ------------------------------------------------------------------ internals

    function _bestBuy(address token, uint256 zroIn, uint256 skip) private view returns (uint256 index, uint256 tokensOut) {
        index = NONE;
        uint256 n = _venues.length;
        for (uint256 i; i < n; ++i) {
            if (skip & (1 << i) != 0) continue;
            Venue storage v = _venues[i];
            uint256 net = zroIn - (zroIn * v.feeBps) / BPS;
            uint256 out = _quote(v.venue, abi.encodeCall(IVenue.quoteBuy, (token, net)));
            if (out > tokensOut) (index, tokensOut) = (i, out);
        }
    }

    function _bestSell(address token, uint256 tokensIn, uint256 skip) private view returns (uint256 index, uint256 zroOut) {
        index = NONE;
        uint256 n = _venues.length;
        for (uint256 i; i < n; ++i) {
            if (skip & (1 << i) != 0) continue;
            Venue storage v = _venues[i];
            uint256 gross = _quote(v.venue, abi.encodeCall(IVenue.quoteSell, (token, tokensIn)));
            uint256 net = gross - (gross * v.feeBps) / BPS;
            if (net > zroOut) (index, zroOut) = (i, net);
        }
    }

    /// @dev A raw call rather than try/catch, which still reverts on a venue with no code or a short answer. Any failure,
    /// any malformed answer and any gas-burning quote all simply read as "no quote".
    function _quote(IVenue venue, bytes memory payload) private view returns (uint256) {
        (bool ok, bytes memory ret) = address(venue).staticcall{gas: QUOTE_GAS}(payload);
        return ok && ret.length == 32 ? abi.decode(ret, (uint256)) : 0;
    }

    /// @dev A referred trader's share of the fee goes to Referrals, the rest to the treasury.
    function _payFee(uint256 fee, address trader) private {
        if (fee == 0) return;
        uint256 back;
        if (address(referrals) != address(0) && referrals.referrerOf(trader) != address(0)) {
            back = (fee * REFERRAL_BPS) / BPS;
            referrals.credit{value: back}(trader);
        }
        _send(treasury, fee - back);
    }

    /// @dev After the trade, so the rank it reaches only counts from the next one.
    function _addVolume(address trader, uint256 zro) private {
        uint256 was = rankOf(trader);
        volumeOf[trader] += zro;
        uint256 now_ = rankOf(trader);
        if (now_ > was) emit RankUp(trader, now_, volumeOf[trader]);
    }

    function _setTrader(address who) private {
        bytes32 slot = TRADER_SLOT;
        assembly {
            tstore(slot, who)
        }
    }

    function _send(address to, uint256 amount) private {
        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert TransferFailed();
    }

    /// @dev Only venues pay the router, and only in the middle of a trade: refunds on buys and proceeds on sells.
    receive() external payable {
        if (!_reentrancyGuardEntered()) revert StrayZro();
    }
}
