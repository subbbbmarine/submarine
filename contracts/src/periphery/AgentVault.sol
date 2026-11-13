// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Router} from "./Router.sol";

/// @title AgentVault
/// @notice A vault a person deploys for an AI agent or a bot of their own. The person owns it and funds it with ZRO. The agent
/// gets a key of its own and may only buy and sell through Submarine's router, with everything it buys and every ZRO a sale
/// brings landing back in the vault, within limits only the owner sets: the most one buy may spend, the most it may spend in a
/// day, how far a trade may slip from the router's quote, and, if the owner wants, a list of the only tokens it may buy.
///
/// Only the owner can take ZRO or tokens out, at any time, and the owner can change or remove the agent at any time. The owner
/// is fixed when the vault is made and can't be changed, so there is no call the agent could use to take the vault over.
/// @dev The limits bound what a leaked agent key can spend, not how well it trades: inside them it can still buy badly, so the
/// owner should keep in the vault only what they would let the agent lose, and turn on the token list for anything larger.
contract AgentVault is ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant BPS = 10_000;
    /// @notice No trade may be allowed to slip more than half from the quote, whatever the owner sets.
    uint16 public constant MAX_SLIPPAGE_BPS = 5_000;

    struct Limits {
        uint128 perTrade; // most ZRO one buy may spend
        uint128 perDay; // most ZRO the agent's buys may spend in a UTC day
        uint16 slippageBps; // a trade's minimum must be at least the router's quote less this
        bool listedOnly; // buy only tokens the owner has listed
    }

    Router public immutable router;
    address public immutable owner;
    /// @notice The key allowed to trade. Zero when there is none.
    address public agent;
    Limits public limits;
    /// @notice ZRO the agent's buys spent on `day` (Unix time / 1 day).
    uint128 public spentToday;
    uint32 public day;
    mapping(address => bool) public listed;

    event AgentSet(address indexed agent);
    event LimitsSet(Limits limits);
    event Listed(address indexed token, bool listed);
    event Deposited(address indexed from, uint256 amount);
    event Withdrawn(address indexed to, uint256 amount);
    event TokensWithdrawn(address indexed token, address indexed to, uint256 amount);
    event Bought(address indexed token, address indexed by, uint256 zro, uint256 tokens);
    event Sold(address indexed token, address indexed by, uint256 tokens, uint256 zro);

    error NotOwner();
    error NotAllowed();
    error BadLimits();
    error OverTrade();
    error OverDay();
    error NotListed();
    error MinTooLow();
    error TransferFailed();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    /// @notice The agent or the owner. The owner's own trades skip the agent's limits.
    modifier onlyTrader() {
        if (msg.sender != owner && (msg.sender != agent || agent == address(0))) revert NotAllowed();
        _;
    }

    constructor(address router_, address owner_, address agent_, Limits memory limits_) payable {
        if (owner_ == address(0) || agent_ == owner_) revert BadLimits();
        router = Router(payable(router_));
        owner = owner_;
        _setLimits(limits_);
        agent = agent_;
        emit AgentSet(agent_);
        if (msg.value > 0) emit Deposited(owner_, msg.value);
    }

    /// @notice ZRO sent straight here, by the owner or a refund from the router, stays in the vault.
    receive() external payable {
        if (msg.sender != address(router)) emit Deposited(msg.sender, msg.value);
    }

    // ------------------------------------------------------------------ the owner

    function setAgent(address agent_) external onlyOwner {
        if (agent_ == owner) revert BadLimits();
        agent = agent_;
        emit AgentSet(agent_);
    }

    function setLimits(Limits calldata limits_) external onlyOwner {
        _setLimits(limits_);
    }

    function setListed(address[] calldata tokens, bool on) external onlyOwner {
        for (uint256 i; i < tokens.length; ++i) {
            listed[tokens[i]] = on;
            emit Listed(tokens[i], on);
        }
    }

    function withdraw(uint256 amount, address to) external onlyOwner nonReentrant {
        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert TransferFailed();
        emit Withdrawn(to, amount);
    }

    function withdrawTokens(IERC20 token, uint256 amount, address to) external onlyOwner nonReentrant {
        token.safeTransfer(to, amount);
        emit TokensWithdrawn(address(token), to, amount);
    }

    // ------------------------------------------------------------------ trading

    /// @notice Buys `token` with `zroIn` of the vault's ZRO through the router. The tokens stay here.
    function buy(address token, uint256 zroIn, uint256 minOut, uint256 deadline)
        external
        onlyTrader
        nonReentrant
        returns (uint256 tokensOut)
    {
        if (msg.sender != owner) {
            Limits memory l = limits;
            if (zroIn > l.perTrade) revert OverTrade();
            if (l.listedOnly && !listed[token]) revert NotListed();
            uint32 today = uint32(block.timestamp / 1 days);
            uint256 spent = today == day ? spentToday : 0;
            if (spent + zroIn > l.perDay) revert OverDay();
            (day, spentToday) = (today, uint128(spent + zroIn));
            if (minOut < _floor(router.quoteBuy(token, zroIn), l.slippageBps)) revert MinTooLow();
        }
        uint256 before = address(this).balance;
        tokensOut = router.buy{value: zroIn}(token, minOut, address(this), deadline);
        // A buy that fills a curve may come back partly refunded; only what was really spent is spent.
        uint256 back = address(this).balance + zroIn - before;
        if (back > 0 && msg.sender != owner) spentToday -= uint128(back);
        emit Bought(token, msg.sender, zroIn - back, tokensOut);
    }

    /// @notice Sells `tokensIn` of the vault's `token` through the router. The ZRO comes back here.
    function sell(address token, uint256 tokensIn, uint256 minOut, uint256 deadline)
        external
        onlyTrader
        nonReentrant
        returns (uint256 zroOut)
    {
        if (msg.sender != owner && minOut < _floor(router.quoteSell(token, tokensIn), limits.slippageBps)) revert MinTooLow();
        IERC20(token).forceApprove(address(router), tokensIn);
        zroOut = router.sell(token, tokensIn, minOut, address(this), deadline);
        IERC20(token).forceApprove(address(router), 0);
        emit Sold(token, msg.sender, tokensIn, zroOut);
    }

    // ------------------------------------------------------------------ views

    /// @notice What the agent may still spend today, given the vault's balance.
    function leftToday() external view returns (uint256) {
        uint256 spent = uint32(block.timestamp / 1 days) == day ? spentToday : 0;
        uint256 left = limits.perDay > spent ? limits.perDay - spent : 0;
        return left < address(this).balance ? left : address(this).balance;
    }

    function _floor(uint256 quote, uint16 slippageBps) private pure returns (uint256) {
        return (quote * (BPS - slippageBps)) / BPS;
    }

    function _setLimits(Limits memory l) private {
        if (l.slippageBps > MAX_SLIPPAGE_BPS || l.perTrade > l.perDay) revert BadLimits();
        limits = l;
        emit LimitsSet(l);
    }
}

/// @title AgentVaultFactory
/// @notice Makes an AgentVault owned by whoever calls it, so the site and the indexer can find every vault in one place.
contract AgentVaultFactory {
    Router public immutable router;
    mapping(address => address[]) private _vaults;
    mapping(address => bool) public isVault;

    event Created(address indexed owner, address indexed vault, address indexed agent);

    constructor(address router_) {
        router = Router(payable(router_));
    }

    /// @notice A new vault owned by the caller, funded with whatever ZRO comes with the call.
    function create(address agent, AgentVault.Limits calldata limits) external payable returns (AgentVault vault) {
        vault = new AgentVault{value: msg.value}(address(router), msg.sender, agent, limits);
        _vaults[msg.sender].push(address(vault));
        isVault[address(vault)] = true;
        emit Created(msg.sender, address(vault), agent);
    }

    function vaultsOf(address owner) external view returns (address[] memory) {
        return _vaults[owner];
    }
}
