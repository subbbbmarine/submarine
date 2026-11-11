// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {IVenue} from "../interfaces/IVenue.sol";

/// @dev The router's way for our own contracts to trade for someone, so the trade counts as theirs.
interface IForwardingRouter {
    function buyFor(address token, uint256 minOut, address recipient, uint256 deadline, address trader) external payable returns (uint256);
    function sellFor(address token, uint256 tokensIn, uint256 minOut, address recipient, uint256 deadline, address trader) external returns (uint256);
}

/// @notice What the orders need to know about a token from this terminal's launchpad.
interface ILaunchInfo {
    function curves(address token)
        external
        view
        returns (address creator, uint40 createdAt, bool graduated, uint16 feeBps, uint16 holdersBps, uint16 burnBps, bool antiSnipe, uint128 raised, uint128 sold, uint128 supply, uint16 protocolBps);
}

/// @title LimitOrders
/// @notice Orders that wait for a condition, ported from Prorata to the native coin and grown into what a trader expects:
/// limits, stop losses, trailing stops, orders that fire when a token moves to its pool or when its creator sells, and
/// buys spread out over time. A buy escrows ZRO, a sale escrows tokens, and every order names the least it must get, which
/// no condition can override. Orders trade through the router, so they get the best venue at fill time.
///
/// Sales can come in groups that share one escrow: take profit at two levels and a stop loss on the same tokens, say.
/// Whichever leg fills first takes its tokens from the group, and the others carry on with what's left.
///
/// Filling is permissionless and pays up to one run fee per order, shared across its parts. Every condition is checked
/// here against the chain itself, so no keeper has to be trusted.
/// @dev Tokens whose balances change on their own (rebasing) aren't supported: escrow is tracked by amount.
contract LimitOrders is Ownable2Step {
    using SafeERC20 for IERC20;

    uint256 public constant BPS = 10_000;
    uint256 public constant MAX_FEE_BPS = 100; // 1%
    uint256 public constant MAX_RUN_FEE = 0.4 ether;
    uint256 public constant MAX_LEGS = 5;
    uint256 public constant MAX_SLICES = 100;
    uint256 private constant SEND_GAS = 100_000;
    /// @dev Enough that a payment gets all of SEND_GAS after the 1/64 rule and the call's own cost, so a keeper can't starve one on purpose.
    uint256 private constant GAS_TO_PAY = 140_000;

    /// @notice Fills once the market pays at least the minimum. Buy or sell.
    uint8 public constant LIMIT = 0;
    /// @notice Sale only. Fills once a part would fetch no more than `trigger` scaled to it, and never below the minimum.
    uint8 public constant STOP = 1;
    /// @notice Sale only. Fills once the market is `trailBps` below the highest seen since placing. `trigger` holds that high.
    uint8 public constant TRAILING = 2;
    /// @notice Buy or sell. Fills once the token has left its curve for a pool. Launchpad tokens only.
    uint8 public constant ON_GRADUATION = 3;
    /// @notice Sale only. Fills once the token's creator holds `trigger` tokens or fewer. Launchpad tokens only.
    uint8 public constant ON_DEV_SELL = 4;
    /// @notice Buy only. Fills in `slices` equal parts at least `interval` seconds apart, each held to its share of the minimum.
    uint8 public constant DCA = 5;

    struct Order {
        address owner;
        uint40 expiry;
        bool isBuy;
        bool open;
        uint16 feeBps; // as it stood when placed, since the owner's minimum was worked out from it
        uint8 kind;
        address token;
        uint96 runFee; // likewise
        uint128 left; // what this order may still trade: ZRO (buy) or tokens (sell)
        uint128 total; // as placed
        uint128 minOut; // least out for the whole order: tokens (buy) or ZRO (sell)
        uint128 trigger; // STOP: ZRO for the whole order. TRAILING: the high, in the same terms. ON_DEV_SELL: creator's tokens.
        uint32 group; // a sale group's first leg plus one, or 0 for an order on its own
        uint8 legs; // on a group's first leg, how many legs it has
        uint16 trailBps; // TRAILING: the drop that fires it. ON_DEV_SELL: how much of their holding the creator must sell.
        uint32 interval; // DCA
        uint40 lastFill; // DCA
        uint16 slices; // DCA
    }

    /// @notice One leg of a sale group. `share` is how much of the group's tokens this leg may sell.
    struct Leg {
        uint8 kind;
        uint128 share;
        uint128 minOut;
        uint128 trigger;
        uint16 trailBps;
    }

    IVenue public immutable router;
    address public immutable treasury;
    ILaunchInfo public immutable launchpad;
    uint16 public feeBps; // the router already takes the terminal's fee, so limit orders add none by default
    uint256 public runFee = 0.04 ether; // to whoever fills, per whole order

    /// @notice ZRO an order's owner was due and their wallet wouldn't take. It waits here for `withdraw`.
    mapping(address => uint256) public credit;
    /// @notice Tokens a sale group still holds, keyed by its first leg.
    mapping(uint256 => uint256) public groupLeft;

    Order[] private _orders;
    bool private _locked;

    event Placed(uint256 indexed id, address indexed owner, address indexed token, bool isBuy, uint256 amount, uint256 minOut, uint256 expiry);
    event Conditions(uint256 indexed id, uint8 kind, uint256 trigger, uint16 trailBps, uint32 interval, uint16 slices, uint256 group);
    event Filled(uint256 indexed id, uint256 zroSide, uint256 tokenSide, address indexed by);
    event Closed(uint256 indexed id, bool expired);
    event Peak(uint256 indexed id, uint256 value);
    event Config(uint16 feeBps, uint256 runFee);
    event Credited(address indexed owner, uint256 amount);
    event Withdrawn(address indexed owner, address indexed to, uint256 amount);

    error Busy();
    error BadOrder();
    error NotYours();
    error NotOpen();
    error NotYet();

    constructor(address owner_, address treasury_, address router_, address launchpad_) Ownable(owner_) {
        if (treasury_ == address(0) || router_ == address(0)) revert BadOrder();
        treasury = treasury_;
        router = IVenue(router_);
        launchpad = ILaunchInfo(launchpad_);
    }

    modifier lock() {
        if (_locked) revert Busy();
        _locked = true;
        _;
        _locked = false;
    }

    /// @notice Applies to orders placed from now on. An open order keeps the fees it was placed under.
    function setConfig(uint16 fee, uint256 run) external onlyOwner {
        if (fee > MAX_FEE_BPS || run > MAX_RUN_FEE) revert BadOrder();
        (feeBps, runFee) = (fee, run);
        emit Config(fee, run);
    }

    // ------------------------------------------------------------------ placing

    /// @notice Escrows the ZRO sent and buys once `minOut` tokens can be had for it, after fees.
    function placeBuy(address token, uint256 minOut, uint40 expiry) external payable lock returns (uint256 id) {
        return _placeBuy(token, minOut, expiry, LIMIT, 0, 0);
    }

    /// @notice A buy with a condition: LIMIT, ON_GRADUATION, or DCA in `slices` parts `interval` seconds apart.
    function placeBuyIf(address token, uint256 minOut, uint40 expiry, uint8 kind, uint32 interval, uint16 slices)
        external
        payable
        lock
        returns (uint256 id)
    {
        return _placeBuy(token, minOut, expiry, kind, interval, slices);
    }

    /// @notice Escrows `amount` tokens and sells once they fetch at least `minOut` ZRO, after fees.
    function placeSell(address token, uint256 amount, uint256 minOut, uint40 expiry) external lock returns (uint256 id) {
        _checkCommon(token, minOut, expiry);
        uint256 got = _pullTokens(token, amount);
        id = _push(_order(token, false, LIMIT, got, minOut, expiry));
        emit Placed(id, msg.sender, token, false, got, minOut, expiry);
    }

    /// @notice Escrows `amount` tokens once for several ways out of them, each one a leg. Returns the first leg's id.
    function placeSellLegs(address token, uint256 amount, uint40 expiry, Leg[] calldata legs) external lock returns (uint256 head) {
        uint256 n = legs.length;
        if (n == 0 || n > MAX_LEGS) revert BadOrder();
        if (token == address(0) || (expiry != 0 && expiry <= block.timestamp)) revert BadOrder();
        uint256 got = _pullTokens(token, amount);
        head = _orders.length;
        groupLeft[head] = got;
        for (uint256 i; i < n; ++i) {
            Leg calldata leg = legs[i];
            // A leg can't ask for more than was escrowed. It is only cut down to what arrived, for a token that took a little in transfer.
            if (leg.share == 0 || leg.minOut == 0 || leg.share > amount) revert BadOrder();
            uint256 share = leg.share > got ? got : leg.share;
            Order memory o = _order(token, false, leg.kind, share, leg.minOut, expiry);
            o.group = uint32(head + 1);
            if (i == 0) o.legs = uint8(n);
            _setSaleCondition(o, leg);
            uint256 id = _push(o);
            emit Placed(id, msg.sender, token, false, share, leg.minOut, expiry);
            emit Conditions(id, o.kind, o.trigger, o.trailBps, 0, 0, head);
        }
    }

    // ------------------------------------------------------------------ filling

    /// @notice Fills one order, fully if `part` covers what is left. Reverts if its condition or its minimum isn't met.
    /// An expired order is closed and refunded instead.
    function fill(uint256 id, uint256 part) external lock returns (uint256 zroSide, uint256 tokenSide) {
        return _fillOne(id, part, msg.sender);
    }

    /// @notice Fills a batch, each order for its `parts[i]` slice. An order that can't fill right now is skipped, not reverted.
    function fillBatch(uint256[] calldata ids, uint256[] calldata parts) external lock returns (uint256 filled) {
        uint256 n = ids.length < parts.length ? ids.length : parts.length;
        for (uint256 i; i < n; ++i) {
            try this.fillFromBatch(ids[i], parts[i], msg.sender) {
                ++filled;
            } catch {}
        }
    }

    /// @dev Only fillBatch calls this, to get a try/catch around each slice. `keeper` carries the real caller.
    function fillFromBatch(uint256 id, uint256 part, address keeper) external returns (uint256, uint256) {
        if (msg.sender != address(this)) revert Busy();
        return _fillOne(id, part, keeper);
    }

    /// @notice Raises each trailing stop's high to what its tokens would fetch now, if that's higher. Anyone may call it.
    function poke(uint256[] calldata ids) external {
        for (uint256 i; i < ids.length; ++i) {
            Order storage o = _orders[ids[i]];
            if (!o.open || o.kind != TRAILING) continue;
            // In the same terms as the trigger, ZRO for the whole order, but priced on what's left: after a partial fill the
            // rest sells with less impact than the whole would, and the check that fires it compares per token.
            uint256 left = o.left;
            if (left == 0) continue;
            uint256 value = Math.mulDiv(router.quoteSell(o.token, left), o.total, left);
            if (value > o.trigger && value <= type(uint128).max) {
                o.trigger = uint128(value);
                emit Peak(ids[i], value);
            }
        }
    }

    function cancel(uint256 id) external lock {
        Order storage o = _orders[id];
        if (o.owner != msg.sender) revert NotYours();
        if (!o.open) revert NotOpen();
        if (o.group == 0) {
            _close(o, id, false);
            return;
        }
        // A leg can't be pulled out alone: its tokens are the group's, so cancelling ends the group.
        uint256 head = o.group - 1;
        uint256 n = _orders[head].legs;
        for (uint256 i = head; i < head + n; ++i) {
            Order storage leg = _orders[i];
            if (leg.open) {
                leg.open = false;
                emit Closed(i, false);
            }
        }
        _refundGroup(head);
    }

    /// @notice Sends what `credit` holds for the caller to any address, since the caller's own wallet is the one that refused it.
    function withdraw(address to) external lock {
        uint256 amount = credit[msg.sender];
        if (amount == 0 || to == address(0) || to == address(this)) revert BadOrder();
        credit[msg.sender] = 0;
        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert BadOrder();
        emit Withdrawn(msg.sender, to, amount);
    }

    // ------------------------------------------------------------------ reads

    function ordersCount() external view returns (uint256) {
        return _orders.length;
    }

    function getOrder(uint256 id) external view returns (Order memory) {
        return _orders[id];
    }

    /// @notice How much of an order can trade right now: its own amount, capped by its group's remaining tokens.
    function available(uint256 id) public view returns (uint256) {
        Order storage o = _orders[id];
        if (!o.open) return 0;
        if (o.group == 0) return o.left;
        uint256 pool = groupLeft[o.group - 1];
        return o.left < pool ? o.left : pool;
    }

    /// @notice For keepers: the open orders among [from, from + count).
    function openIds(uint256 from, uint256 count) external view returns (uint256[] memory list) {
        uint256 end = from + count > _orders.length ? _orders.length : from + count;
        uint256[] memory tmp = new uint256[](end > from ? end - from : 0);
        uint256 n;
        for (uint256 i = from; i < end; ++i) {
            if (_orders[i].open) tmp[n++] = i;
        }
        list = new uint256[](n);
        for (uint256 i; i < n; ++i) {
            list[i] = tmp[i];
        }
    }

    // ------------------------------------------------------------------ internals

    function _placeBuy(address token, uint256 minOut, uint40 expiry, uint8 kind, uint32 interval, uint16 slices) internal returns (uint256 id) {
        _checkCommon(token, minOut, expiry);
        if (msg.value <= runFee * 2 || msg.value > type(uint128).max) revert BadOrder();
        if (kind != LIMIT && kind != ON_GRADUATION && kind != DCA) revert BadOrder();
        Order memory o = _order(token, true, kind, msg.value, minOut, expiry);
        if (kind == ON_GRADUATION) _creatorOf(token); // launchpad tokens only
        if (kind == DCA) {
            if (slices < 2 || slices > MAX_SLICES || interval == 0) revert BadOrder();
            (o.interval, o.slices) = (interval, slices);
        }
        id = _push(o);
        emit Placed(id, msg.sender, token, true, msg.value, minOut, expiry);
        if (kind != LIMIT) emit Conditions(id, kind, 0, 0, interval, slices, 0);
    }

    function _checkCommon(address token, uint256 minOut, uint40 expiry) private view {
        if (token == address(0) || minOut == 0 || minOut > type(uint128).max) revert BadOrder();
        if (expiry != 0 && expiry <= block.timestamp) revert BadOrder();
    }

    function _pullTokens(address token, uint256 amount) private returns (uint256 got) {
        if (amount == 0 || amount > type(uint128).max) revert BadOrder();
        IERC20 t = IERC20(token);
        uint256 before = t.balanceOf(address(this));
        t.safeTransferFrom(msg.sender, address(this), amount);
        got = t.balanceOf(address(this)) - before;
    }

    function _order(address token, bool isBuy, uint8 kind, uint256 amount, uint256 minOut, uint40 expiry) private view returns (Order memory o) {
        o.owner = msg.sender;
        o.expiry = expiry;
        o.isBuy = isBuy;
        o.open = true;
        o.feeBps = feeBps;
        o.kind = kind;
        o.token = token;
        o.runFee = uint96(runFee);
        o.left = uint128(amount);
        o.total = uint128(amount);
        o.minOut = uint128(minOut);
    }

    function _push(Order memory o) private returns (uint256 id) {
        id = _orders.length;
        _orders.push(o);
    }

    function _setSaleCondition(Order memory o, Leg calldata leg) private view {
        uint8 kind = leg.kind;
        if (kind == LIMIT || kind == ON_GRADUATION) {
            if (kind == ON_GRADUATION) _creatorOf(o.token);
        } else if (kind == STOP) {
            if (leg.trigger == 0) revert BadOrder();
            o.trigger = leg.trigger;
        } else if (kind == TRAILING) {
            if (leg.trailBps == 0 || leg.trailBps >= BPS) revert BadOrder();
            uint256 value = router.quoteSell(o.token, o.total);
            if (value == 0 || value > type(uint128).max) revert BadOrder();
            (o.trigger, o.trailBps) = (uint128(value), leg.trailBps);
        } else if (kind == ON_DEV_SELL) {
            if (leg.trailBps == 0 || leg.trailBps > BPS) revert BadOrder();
            uint256 holds = IERC20(o.token).balanceOf(_creatorOf(o.token));
            // Fires once the creator holds no more than this: what they have now, less the share they must sell.
            (o.trigger, o.trailBps) = (uint128((holds * (BPS - leg.trailBps)) / BPS), leg.trailBps);
        } else {
            revert BadOrder();
        }
    }

    function _creatorOf(address token) private view returns (address creator) {
        if (address(launchpad) == address(0)) revert BadOrder();
        (creator,,,,,,,,,,) = launchpad.curves(token);
        if (creator == address(0)) revert BadOrder();
    }

    function _graduated(address token) private view returns (bool done) {
        (,, done,,,,,,,,) = launchpad.curves(token);
    }

    function _fillOne(uint256 id, uint256 part, address keeper) internal returns (uint256 zroSide, uint256 tokenSide) {
        Order storage o = _orders[id];
        if (!o.open) revert NotOpen();
        if (o.expiry != 0 && block.timestamp > o.expiry) {
            _close(o, id, true);
            return (0, 0);
        }
        if (part == 0 || part > available(id)) revert BadOrder();
        _checkBefore(o, part);

        // The run fee scales with the slice, or cutting an order into many small fills would pay the keeper many times over.
        uint256 run = (uint256(o.runFee) * part + o.total - 1) / o.total;
        // The owner's minimum scales with the slice, rounded up: every part must clear its own share.
        uint256 scaled = (uint256(o.minOut) * part + o.total - 1) / o.total;

        if (o.isBuy) {
            uint256 fee = (part * o.feeBps) / BPS;
            if (part <= fee + run) revert BadOrder();
            uint256 before = address(this).balance;
            // For the owner, so it adds to their volume and rank like a trade they made themselves.
            uint256 out = IForwardingRouter(address(router)).buyFor{value: part - fee - run}(o.token, scaled, o.owner, block.timestamp, o.owner);
            // A buy that fills the curve comes back partly refunded; that ZRO belongs to this order's owner.
            uint256 refund = address(this).balance + (part - fee - run) - before;
            _spend(o, id, part);
            _send(treasury, fee);
            _send(keeper, run);
            _pay(o.owner, refund);
            emit Filled(id, part, out, keeper);
            return (part, out);
        }

        IERC20 t = IERC20(o.token);
        t.forceApprove(address(router), part);
        uint256 got = IForwardingRouter(address(router)).sellFor(o.token, part, 0, address(this), block.timestamp, o.owner);
        t.forceApprove(address(router), 0);
        _checkAfter(o, part, got);
        uint256 feeOut = (got * o.feeBps) / BPS;
        if (got < scaled + feeOut + run) revert BadOrder();
        _spend(o, id, part);
        _send(treasury, feeOut);
        _send(keeper, run);
        _pay(o.owner, got - feeOut - run);
        emit Filled(id, got, part, keeper);
        return (got, part);
    }

    /// @dev The conditions the chain can tell before trading.
    function _checkBefore(Order storage o, uint256 part) private {
        uint8 kind = o.kind;
        if (kind == ON_GRADUATION) {
            if (!_graduated(o.token)) revert NotYet();
        } else if (kind == ON_DEV_SELL) {
            if (IERC20(o.token).balanceOf(_creatorOf(o.token)) > o.trigger) revert NotYet();
        } else if (kind == DCA) {
            if (part > (uint256(o.total) + o.slices - 1) / o.slices) revert BadOrder();
            if (o.lastFill != 0 && block.timestamp < uint256(o.lastFill) + o.interval) revert NotYet();
            o.lastFill = uint40(block.timestamp);
        }
    }

    /// @dev The conditions about the market falling, judged by what the sale really fetched.
    function _checkAfter(Order storage o, uint256 part, uint256 got) private view {
        uint8 kind = o.kind;
        if (kind == STOP) {
            if (got * o.total > uint256(o.trigger) * part) revert NotYet();
        } else if (kind == TRAILING) {
            if (got * o.total * BPS > uint256(o.trigger) * part * (BPS - o.trailBps)) revert NotYet();
        }
    }

    function _spend(Order storage o, uint256 id, uint256 part) private {
        o.left = uint128(uint256(o.left) - part);
        if (o.group == 0) {
            if (o.left == 0) {
                o.open = false;
                emit Closed(id, false);
            }
            return;
        }
        uint256 head = o.group - 1;
        groupLeft[head] -= part;
        if (o.left == 0) {
            o.open = false;
            emit Closed(id, false);
        }
        _settleGroup(head);
    }

    /// @dev A group with nothing left closes every leg. A group whose legs have all closed hands its tokens back.
    function _settleGroup(uint256 head) private {
        uint256 n = _orders[head].legs;
        bool empty = groupLeft[head] == 0;
        bool anyOpen;
        for (uint256 i = head; i < head + n; ++i) {
            Order storage leg = _orders[i];
            if (!leg.open) continue;
            if (empty) {
                leg.open = false;
                emit Closed(i, false);
            } else {
                anyOpen = true;
            }
        }
        if (!empty && !anyOpen) _refundGroup(head);
    }

    function _refundGroup(uint256 head) private {
        uint256 amount = groupLeft[head];
        if (amount == 0) return;
        groupLeft[head] = 0;
        Order storage o = _orders[head];
        IERC20(o.token).safeTransfer(o.owner, amount);
    }

    function _close(Order storage o, uint256 id, bool expired) internal {
        if (!o.open) revert NotOpen();
        o.open = false;
        emit Closed(id, expired);
        if (o.group != 0) {
            _settleGroup(o.group - 1);
            return;
        }
        if (o.isBuy) _pay(o.owner, o.left);
        else IERC20(o.token).safeTransfer(o.owner, o.left);
    }

    /// @dev Gas-capped, so a wallet that burns all it's given can't take a whole batch down with it.
    function _send(address to, uint256 v) internal {
        if (v == 0) return;
        (bool ok,) = to.call{value: v, gas: SEND_GAS}("");
        if (!ok) revert BadOrder();
    }

    /// @dev An owner's wallet refusing its ZRO mustn't stop an order closing, or the escrow would have no way out. It's held for
    /// them instead. With too little gas left to give the wallet a fair try this reverts, so only a real refusal ever lands in credit.
    function _pay(address owner_, uint256 v) internal {
        if (v == 0) return;
        if (gasleft() < GAS_TO_PAY) revert BadOrder();
        (bool ok,) = owner_.call{value: v, gas: SEND_GAS}("");
        if (ok) return;
        credit[owner_] += v;
        emit Credited(owner_, v);
    }

    /// @dev Only the router pays in, and only mid-fill: refunds on buys and proceeds on sells.
    receive() external payable {
        if (!_locked) revert Busy();
    }
}
