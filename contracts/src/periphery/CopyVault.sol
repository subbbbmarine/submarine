// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {Router} from "./Router.sol";
import {ILaunchInfo} from "./LimitOrders.sol";

/// @title CopyVault
/// @notice Copy trading that keeps working with the browser closed. A follower deposits ZRO and names the wallets to copy
/// and the limits: how big a copy may be, per trade, per token and per day, how much worse than the leader's own price it
/// may fill, and whether to follow the leader's sales. Anyone may then run a copy, and earns a small fee for it, but only
/// of a buy or sale the leader really made through the router in the last few blocks, and only inside the follower's
/// limits. So there's no keeper to trust, and nobody can make a leader seem to buy.
///
/// What a copy buys stays in the vault as the follower's position until a copied sale, the follower's own take profit or
/// stop loss, or the follower sells or withdraws it. The follower can take ZRO and tokens out at any time.
/// @dev A follower's positions are per token, whichever leader they came from, so a leader's sale sells that share of the
/// whole position.
contract CopyVault is ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant BPS = 10_000;
    /// @notice How many blocks after a leader's trade a copy may still run. Zero's blocks are about a second, so this is about 30 seconds.
    uint256 public constant WINDOW = 30;
    /// @notice Paid from the follower's side to whoever runs a copy or an exit.
    uint256 public constant RUN_FEE = 0.04 ether;
    uint256 public constant MAX_SLIPPAGE_BPS = 5_000;

    /// @notice A follower's limits for one leader.
    struct Rules {
        uint128 perTrade; // most ZRO one copied buy may spend
        uint128 perToken; // most ZRO copied into one token over time
        uint128 perDay; // most ZRO copied from this leader in a day
        uint16 sizeBps; // the leader's own size times this, before the limits. 10,000 copies the same size.
        uint16 slippageBps; // how far the trade itself may slip from the quote at the moment of copying
        uint16 chaseBps; // how much worse than the leader's own price a copy may still go in at, or come out at
        uint16 minSellBps; // a copied sale never fetches less than this share of what the tokens cost
        bool buyOnce; // copy only the first buy of each token
        bool copySells; // sell along with the leader
        uint32 maxAge; // only tokens younger than this many seconds. Zero for any. Launchpad tokens only when set.
    }

    struct Follow {
        Rules rules;
        uint128 spentToday;
        uint32 day;
        bool active;
    }

    struct Position {
        uint128 tokens;
        uint128 cost; // ZRO the tokens cost, so take profit, stop loss and the copied-sale floor have a reference
    }

    struct Copied {
        uint128 spent;
        uint40 buyBlock;
        uint40 sellBlock;
        /// @dev What the leader held of the token when this follower last copied them, so a copied sale follows how far
        /// the leader's holding really fell since then, not only their latest sale.
        uint128 leaderHeld;
    }

    /// @notice Take profit and stop loss over a follower's whole position in a token, measured against its cost.
    struct Exit {
        uint16 takeProfitBps; // 5,000 sells everything at +50%. Zero for none.
        uint16 stopLossBps; // 3,000 sells everything at -30%. Zero for none.
        uint16 slippageBps;
    }

    Router public immutable router;
    ILaunchInfo public immutable launchpad;

    mapping(address => uint256) public balanceOf;
    /// @notice Run fees owed to runners that refused ZRO when they ran something. Collected with collectRunnerCredit.
    mapping(address => uint256) public runnerCredit;
    mapping(address => mapping(address => Follow)) private _follows;
    mapping(address => mapping(address => Position)) public positions;
    mapping(address => mapping(address => mapping(address => Copied))) public copied;
    mapping(address => Exit) public exits;

    event Deposited(address indexed follower, uint256 amount);
    event Withdrawn(address indexed follower, address to, uint256 amount);
    event Followed(address indexed follower, address indexed leader, Rules rules);
    event Unfollowed(address indexed follower, address indexed leader);
    event ExitSet(address indexed follower, Exit exit);
    event CopiedBuy(address indexed follower, address indexed leader, address indexed token, uint256 zro, uint256 tokens, address by);
    event CopiedSell(address indexed follower, address indexed leader, address indexed token, uint256 zro, uint256 tokens, address by);
    event Exited(address indexed follower, address indexed token, bool takeProfit, uint256 zro, uint256 tokens, address by);
    event Sold(address indexed follower, address indexed token, uint256 zro, uint256 tokens);
    event TokensWithdrawn(address indexed follower, address indexed token, address to, uint256 tokens);
    event RunnerCredited(address indexed runner, uint256 amount);

    error BadRules();
    error NotFollowing();
    error NothingToCopy();
    error NotYet();
    error TooLittle();
    error TransferFailed();
    error StrayZro();

    constructor(address router_, address launchpad_) {
        router = Router(payable(router_));
        launchpad = ILaunchInfo(launchpad_);
    }

    // ------------------------------------------------------------------ the follower's own actions

    function deposit() external payable {
        balanceOf[msg.sender] += msg.value;
        emit Deposited(msg.sender, msg.value);
    }

    function withdraw(uint256 amount, address to) external nonReentrant {
        if (amount == 0 || amount > balanceOf[msg.sender]) revert TooLittle();
        balanceOf[msg.sender] -= amount;
        _send(to, amount);
        emit Withdrawn(msg.sender, to, amount);
    }

    function follow(address leader, Rules calldata rules) external {
        if (leader == address(0) || leader == msg.sender) revert BadRules();
        if (rules.perTrade == 0 || rules.sizeBps == 0 || rules.slippageBps > MAX_SLIPPAGE_BPS || rules.chaseBps > BPS || rules.minSellBps > BPS) {
            revert BadRules();
        }
        Follow storage f = _follows[msg.sender][leader];
        f.rules = rules;
        f.active = true;
        emit Followed(msg.sender, leader, rules);
    }

    function unfollow(address leader) external {
        _follows[msg.sender][leader].active = false;
        emit Unfollowed(msg.sender, leader);
    }

    function setExit(Exit calldata rules) external {
        if (rules.stopLossBps >= BPS || rules.slippageBps > MAX_SLIPPAGE_BPS) revert BadRules();
        exits[msg.sender] = rules;
        emit ExitSet(msg.sender, rules);
    }

    /// @notice Sells part of the caller's own position here, at the caller's own minimum.
    function sell(address token, uint256 tokens, uint256 minOut) external nonReentrant returns (uint256 zro) {
        zro = _sellPosition(msg.sender, token, tokens, minOut, 0);
        emit Sold(msg.sender, token, zro, tokens);
    }

    /// @notice Takes tokens out of the vault to any address. Their share of the cost goes with them.
    function withdrawTokens(address token, uint256 tokens, address to) external nonReentrant {
        Position storage p = positions[msg.sender][token];
        if (tokens == 0 || tokens > p.tokens) revert TooLittle();
        p.cost -= uint128(Math.mulDiv(p.cost, tokens, p.tokens));
        p.tokens -= uint128(tokens);
        IERC20(token).safeTransfer(to, tokens);
        emit TokensWithdrawn(msg.sender, token, to, tokens);
    }

    // ------------------------------------------------------------------ runs, open to anyone

    /// @notice Copies `leader`'s latest buy of `token` for `follower`, within the follower's limits.
    function copyBuy(address follower, address leader, address token) external nonReentrant returns (uint256 tokensOut) {
        Follow storage f = _follows[follower][leader];
        if (!f.active) revert NotFollowing();
        Router.Activity memory a = router.activityOf(leader, token);
        if (a.buyBlock == 0 || block.number > uint256(a.buyBlock) + WINDOW || a.buyZro == 0) revert NothingToCopy();
        Copied storage c = copied[follower][leader][token];
        if (a.buyBlock <= c.buyBlock) revert NothingToCopy();
        c.buyBlock = a.buyBlock;
        Rules memory r = f.rules;
        if (r.buyOnce && c.spent > 0) revert NothingToCopy();
        if (r.maxAge != 0) {
            (, uint40 createdAt,,,,,,,,,) = launchpad.curves(token);
            if (createdAt == 0 || block.timestamp > uint256(createdAt) + r.maxAge) revert NothingToCopy();
        }

        uint32 today = uint32(block.timestamp / 1 days);
        if (f.day != today) (f.day, f.spentToday) = (today, 0);
        uint256 amount = (uint256(a.buyZro) * r.sizeBps) / BPS;
        amount = Math.min(amount, r.perTrade);
        amount = Math.min(amount, r.perToken > c.spent ? r.perToken - c.spent : 0);
        amount = Math.min(amount, r.perDay > f.spentToday ? r.perDay - f.spentToday : 0);
        uint256 funds = balanceOf[follower];
        amount = Math.min(amount, funds > RUN_FEE ? funds - RUN_FEE : 0);
        if (amount <= RUN_FEE) revert TooLittle();

        // A copy always comes after the leader, so it pays more than they did. How much more is the follower's call.
        uint256 quote = router.quoteBuy(token, amount);
        uint256 atLeaderPrice = Math.mulDiv(amount, a.buyTokens, a.buyZro);
        if (quote * (BPS + r.chaseBps) < atLeaderPrice * BPS) revert NotYet();
        uint256 minOut = Math.mulDiv(quote, BPS - r.slippageBps, BPS);
        balanceOf[follower] = funds - amount - RUN_FEE;
        uint256 zroBefore = address(this).balance - amount;
        uint256 tokenBefore = IERC20(token).balanceOf(address(this));
        // For the follower, so it adds to their volume and rank, not the vault's.
        router.buyFor{value: amount}(token, minOut == 0 ? 1 : minOut, address(this), block.timestamp, follower);
        tokensOut = IERC20(token).balanceOf(address(this)) - tokenBefore;
        uint256 refund = address(this).balance - zroBefore; // the part of `amount` a buy that filled a curve didn't use
        uint256 spent = amount - refund;
        balanceOf[follower] += refund;

        Position storage p = positions[follower][token];
        (p.tokens, p.cost) = (p.tokens + uint128(tokensOut), p.cost + uint128(spent));
        c.spent += uint128(spent);
        c.leaderHeld = uint128(IERC20(token).balanceOf(leader));
        f.spentToday += uint128(spent);
        _payRunner(msg.sender, RUN_FEE);
        emit CopiedBuy(follower, leader, token, spent, tokensOut, msg.sender);
    }

    /// @notice Copies `leader`'s latest sale of `token` for `follower`: the same share of the follower's position.
    function copySell(address follower, address leader, address token) external nonReentrant returns (uint256 zro) {
        Follow storage f = _follows[follower][leader];
        if (!f.active || !f.rules.copySells) revert NotFollowing();
        Router.Activity memory a = router.activityOf(leader, token);
        if (a.sellBlock == 0 || block.number > uint256(a.sellBlock) + WINDOW || a.sellTokens == 0) revert NothingToCopy();
        Copied storage c = copied[follower][leader][token];
        if (a.sellBlock <= c.sellBlock) revert NothingToCopy();
        c.sellBlock = a.sellBlock;

        // The share to sell: how far the leader's holding fell since the last copy, or their latest sale's share if that's
        // more. A tiny sale right after a real one can't hide the real one any more, and a leader who left keeps nothing.
        uint256 share = a.soldBps;
        uint256 heldNow = IERC20(token).balanceOf(leader);
        uint256 heldThen = c.leaderHeld;
        if (heldThen > heldNow) share = Math.max(share, Math.mulDiv(heldThen - heldNow, BPS, heldThen, Math.Rounding.Ceil));
        if (heldNow == 0) share = BPS;
        c.leaderHeld = uint128(heldNow);

        Position storage p = positions[follower][token];
        uint256 tokens = (uint256(p.tokens) * Math.min(share, BPS)) / BPS;
        if (tokens == 0) revert NothingToCopy();
        Rules memory r = f.rules;
        uint256 quote = router.quoteSell(token, tokens);
        uint256 atLeaderPrice = Math.mulDiv(tokens, a.sellZro, a.sellTokens);
        if (quote * BPS < atLeaderPrice * (BPS - r.chaseBps)) revert NotYet();
        uint256 floor = Math.mulDiv(Math.mulDiv(p.cost, tokens, p.tokens), r.minSellBps, BPS);
        zro = _sellPosition(follower, token, tokens, Math.max(Math.mulDiv(quote, BPS - r.slippageBps, BPS), floor), RUN_FEE);
        emit CopiedSell(follower, leader, token, zro, tokens, msg.sender);
    }

    /// @notice Sells a follower's whole position in `token` once their take profit or stop loss is reached.
    function exit(address follower, address token) external nonReentrant returns (uint256 zro) {
        Exit memory e = exits[follower];
        Position storage p = positions[follower][token];
        uint256 tokens = p.tokens;
        if (tokens == 0) revert NothingToCopy();
        uint256 value = router.quoteSell(token, tokens);
        uint256 cost = p.cost;
        bool takeProfit = e.takeProfitBps != 0 && value * BPS >= cost * (BPS + e.takeProfitBps);
        bool stopLoss = e.stopLossBps != 0 && value * BPS <= cost * (BPS - e.stopLossBps);
        if (!takeProfit && !stopLoss) revert NotYet();
        zro = _sellPosition(follower, token, tokens, Math.mulDiv(value, BPS - e.slippageBps, BPS), RUN_FEE);
        emit Exited(follower, token, takeProfit, zro, tokens, msg.sender);
    }

    // ------------------------------------------------------------------ reads

    function followOf(address follower, address leader) external view returns (Follow memory) {
        return _follows[follower][leader];
    }

    // ------------------------------------------------------------------ internals

    /// @return net What the follower's balance gained, after the run fee.
    function _sellPosition(address follower, address token, uint256 tokens, uint256 minOut, uint256 runFee) private returns (uint256 net) {
        Position storage p = positions[follower][token];
        if (tokens == 0 || tokens > p.tokens) revert TooLittle();
        p.cost -= uint128(Math.mulDiv(p.cost, tokens, p.tokens));
        p.tokens -= uint128(tokens);
        IERC20 t = IERC20(token);
        t.forceApprove(address(router), tokens);
        uint256 got = router.sellFor(token, tokens, minOut == 0 ? 1 : minOut, address(this), block.timestamp, follower);
        t.forceApprove(address(router), 0);
        if (got <= runFee) revert TooLittle();
        net = got - runFee;
        balanceOf[follower] += net;
        if (runFee > 0) _payRunner(msg.sender, runFee);
    }

    /// @dev The run fee goes straight to whoever ran it, or, for a runner that won't take ZRO, onto a credit it can collect,
    /// so the copy itself never fails over it.
    function _payRunner(address to, uint256 amount) private {
        (bool ok,) = to.call{value: amount}("");
        if (!ok) {
            runnerCredit[to] += amount;
            emit RunnerCredited(to, amount);
        }
    }

    /// @notice Run fees that couldn't be paid to a runner as they came, sent wherever it names.
    function collectRunnerCredit(address to) external nonReentrant {
        uint256 amount = runnerCredit[msg.sender];
        if (amount == 0) revert TooLittle();
        runnerCredit[msg.sender] = 0;
        _send(to, amount);
    }

    function _send(address to, uint256 amount) private {
        if (to == address(0)) revert TransferFailed();
        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert TransferFailed();
    }

    /// @dev ZRO only comes in through deposit, or from the router in the middle of a trade.
    receive() external payable {
        if (!_reentrancyGuardEntered()) revert StrayZro();
    }
}
