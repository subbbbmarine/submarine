// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IVenue} from "../interfaces/IVenue.sol";

/// @notice Coins bought from the curve or the pool can't leave the wallet that got them until the next block. A sandwich has to
/// buy before a trade and sell after it in the same block, so this takes away the risk-free version of it, and an ordinary
/// trader, who never sells in the block they bought in, doesn't notice.
/// @dev Only coins coming out of the market mark a wallet: the launchpad's curve, and on the pool Infinity's vault, where every
/// pool's coins sit, and Submarine's venue, which takes a buy's coins from the vault before handing them on. The pools' hook counts
/// too: at graduation it takes the coins from the launchpad and puts them in the vault in the same block. None of the four is
/// ever marked itself, so they keep trading with everyone in the same block.
abstract contract HoldsOneBlock is ERC20 {
    address private immutable _curve;
    address private immutable _vault;
    address private immutable _venue;
    address private immutable _hook;
    /// @notice The block a wallet last got coins from the market in. It can move them again from the next block.
    mapping(address => uint256) public boughtInBlock;

    error BoughtThisBlock();

    constructor(address curve_, address vault_, address venue_, address hook_) {
        _curve = curve_;
        _vault = vault_;
        _venue = venue_;
        _hook = hook_;
    }

    function _isMarket(address a) private view returns (bool) {
        return a == _curve || a == _vault || a == _venue || a == _hook;
    }

    function _hold(address from, address to) internal {
        if (from != address(0) && boughtInBlock[from] == block.number) revert BoughtThisBlock();
        if (_isMarket(from) && !_isMarket(to)) boughtInBlock[to] = block.number;
    }

    /// @dev Submarine's own contracts that move a holder's coins: the launchpad, its router and the router's forwarders (limit
    /// orders and the copy vault). Each is set once and only ever takes coins from whoever calls it, so treating them as approved
    /// lets nobody move anyone else's coins, and saves every holder an approval before their first sale or order.
    function _trusted(address spender) private view returns (bool) {
        return spender == _curve || ISpenders(_curve).trusts(spender);
    }

    /// @notice Unlimited for those contracts, so a wallet or site that reads it knows no approval is needed.
    function allowance(address owner, address spender) public view override returns (uint256) {
        return _trusted(spender) ? type(uint256).max : super.allowance(owner, spender);
    }

    function _spendAllowance(address owner, address spender, uint256 value) internal override {
        if (!_trusted(spender)) super._spendAllowance(owner, spender, value);
    }
}

/// @notice Deploys the tokens, so their code doesn't count toward this contract's size. See TokenFactory.sol.
interface ITokenFactory {
    function create(bool holders, string calldata name_, string calldata symbol_, string calldata uri_, uint256 supply, address vault_, address venue_, address hook_, address[] calldata exempt)
        external
        returns (address);
}

interface ISpenders {
    function trusts(address spender) external view returns (bool);
    function isForwarder(address forwarder) external view returns (bool);
}

/// @notice A launched token: fixed supply, minted once to the launchpad, with no owner and no way to mint more.
contract LaunchToken is HoldsOneBlock {
    string public metadataURI;

    constructor(string memory name_, string memory symbol_, string memory uri_, uint256 supply, address to, address vault_, address venue_, address hook_)
        ERC20(name_, symbol_)
        HoldsOneBlock(to, vault_, venue_, hook_)
    {
        metadataURI = uri_;
        _mint(to, supply);
    }

    function _update(address from, address to, uint256 value) internal override {
        _hold(from, to);
        super._update(from, to, value);
    }
}

/// @notice The same, for a token whose trading fees go to its holders. Each holder's share is worked out on every transfer, so
/// tokens only earn from the moment they're held, and a holder can claim at any time. Still no owner, no mint, no tax and no
/// pause: rewards come from the launchpad and the pool, in ZRO, and nothing is taken from a transfer. The same one-block hold.
/// @dev The usual reward-per-share accounting, with a correction per account so a transfer doesn't move rewards already earned.
/// Contracts that only pass tokens through earn nothing, so their share goes to the people who hold.
contract HolderToken is HoldsOneBlock {
    /// @dev Big enough to keep the dust small and small enough that perShare times a whole supply can't overflow, given MIN_EARNING.
    uint256 private constant MAGNITUDE = 2 ** 96;
    /// @notice Rewards wait until this much is held, or one wei of tokens could take a whole payout and overflow the sums.
    uint256 public constant MIN_EARNING = 1 ether;

    string public metadataURI;
    uint256 public perShare;
    uint256 public earningSupply;
    uint256 public waiting;
    mapping(address => bool) public notEarning;
    mapping(address => int256) private _corrections;
    mapping(address => uint256) public claimedBy;

    event RewardsAdded(uint256 amount);
    event RewardsClaimed(address indexed holder, uint256 amount);

    error NothingToClaim();
    error TransferFailed();

    constructor(string memory name_, string memory symbol_, string memory uri_, uint256 supply, address to, address vault_, address venue_, address hook_, address[] memory exempt)
        ERC20(name_, symbol_)
        HoldsOneBlock(to, vault_, venue_, hook_)
    {
        metadataURI = uri_;
        notEarning[to] = true;
        for (uint256 i; i < exempt.length; ++i) {
            notEarning[exempt[i]] = true;
        }
        _mint(to, supply);
    }

    function addRewards() external payable {
        uint256 total = waiting + msg.value;
        if (earningSupply < MIN_EARNING) {
            waiting = total;
            return;
        }
        waiting = 0;
        perShare += (total * MAGNITUDE) / earningSupply;
        emit RewardsAdded(total);
    }

    /// @notice ZRO this holder can claim right now.
    function rewardOf(address who) public view returns (uint256) {
        if (notEarning[who]) return 0;
        int256 earned = int256(perShare * balanceOf(who)) + _corrections[who];
        if (earned <= 0) return 0;
        uint256 total = uint256(earned) / MAGNITUDE;
        uint256 taken = claimedBy[who];
        return total > taken ? total - taken : 0;
    }

    function claim() external {
        _claim(msg.sender);
    }

    /// @notice The money only ever goes to the holder, so anyone can pay their gas for them.
    function claimFor(address who) external {
        _claim(who);
    }

    function _claim(address who) private {
        uint256 amount = rewardOf(who);
        if (amount == 0) revert NothingToClaim();
        claimedBy[who] += amount;
        (bool ok,) = who.call{value: amount}("");
        if (!ok) revert TransferFailed();
        emit RewardsClaimed(who, amount);
    }

    function _update(address from, address to, uint256 value) internal override {
        _hold(from, to);
        super._update(from, to, value);
        int256 shift = int256(perShare * value);
        if (from != address(0) && !notEarning[from]) {
            _corrections[from] += shift;
            earningSupply -= value;
        }
        if (to != address(0) && !notEarning[to]) {
            _corrections[to] -= shift;
            earningSupply += value;
        }
    }
}

interface IReferrals {
    function referrerOf(address trader) external view returns (address);
    function credit(address trader) external payable;
}

interface ITraderSource {
    function currentTrader() external view returns (address);
    /// @notice How much the trader's volume rank takes off the terminal's cut, in basis points of the trade.
    function discountOf(address trader) external view returns (uint256);
}

interface IPoolSeed {
    function seed(address token, uint256 tokenAmount, uint16 earnersBps, uint16 burnBps) external payable;
    /// @notice Where the pools' coins sit, and the venue that trades them: the two places pool coins come out of.
    function vault() external view returns (address);
    function venue() external view returns (address);
}

/// @title Launchpad
/// @notice Constant-product bonding curve with virtual reserves. Every token sells 80% of its supply on the curve for 6,000 ZRO, then
/// the raised ZRO and the other 20% seed a pool whose LP shares are burned. Whatever the supply, a token opens at a market cap of
/// 1,875 ZRO and moves to its pool at 30,000 ZRO. Every token pays the same 1% base fee, 0.4% to the terminal and 0.6% to its
/// creator. On top of that its creator may add a fee of their own, up to 10%, and say who it pays: them, the token's holders or
/// buying the token back and burning it. All of it is set at launch and for good.
/// @dev The numbers come from  vTOK = C^2 / (C - L)  and  vZRO = RAISE * L / (C - L)  with C = 80% and L = 20% of the supply, which
/// makes the pool open at exactly the price the curve ended on, so graduation leaves no gap for bots. Rounding always favours the
/// curve, so its real ZRO can never fall short of what sellers are owed.
contract Launchpad is IVenue, Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// @notice The default terms, for a launch that doesn't choose.
    uint256 public constant SUPPLY = 1_000_000_000 ether;
    uint256 public constant CURVE_SUPPLY = (SUPPLY * 4) / 5;
    uint256 public constant LP_SUPPLY = SUPPLY / 5;
    uint256 public constant VIRTUAL_TOKENS = (SUPPLY * 16) / 15;

    uint256 public constant RAISE_TARGET = 6_000 ether;
    uint256 public constant VIRTUAL_ZRO = 2_000 ether; // virtual native coin (ZRO)

    uint256 public constant MIN_WHOLE_SUPPLY = 1_000_000_000;
    uint256 public constant MAX_WHOLE_SUPPLY = 1_000_000_000_000_000;

    uint256 public constant BPS = 10_000;
    /// @notice The base fee every token pays, and how it splits. Fixed here, so no owner can change it for any token.
    uint16 public constant BASE_FEE_BPS = 100;
    uint16 public constant PROTOCOL_BPS = 40;
    uint16 public constant CREATOR_BASE_BPS = 60;
    /// @notice The most a creator can add on top of the base fee.
    uint16 public constant MAX_DEV_FEE_BPS = 1_000;
    uint256 public constant MAX_LAUNCH_FEE = 40 ether;
    /// @notice Of the treasury's cut of a referred trader's trade, the part that goes to Referrals instead.
    uint256 public constant REFERRAL_BPS = 4_000;

    /// @notice Where a token's own fee on top of the base goes is three shares, in basis points of it: its holders, buying the
    /// token back and burning it, and its creator, who gets whatever the other two leave.
    address public constant DEAD = 0x000000000000000000000000000000000000dEaD;

    /// @notice With anti-snipe on, a buy pays this at launch, falling in a straight line to the token's own fee.
    uint16 public constant SNIPE_START_BPS = 5_000;
    uint256 public constant SNIPE_SECONDS = 60;

    struct Curve {
        address creator;
        uint40 createdAt;
        bool graduated;
        uint16 feeBps; // the whole fee a trader without a rank pays: the base and the creator's own on top
        uint16 holdersBps; // of the creator's own fee
        uint16 burnBps; // of the creator's own fee
        bool antiSnipe;
        uint128 raised; // real ZRO in the curve
        uint128 sold; // tokens the curve has sold, net of sells
        uint128 supply;
        uint16 protocolBps; // the terminal's cut of each trade, before a trader's rank takes some off
    }

    IPoolSeed public immutable pools;
    ITokenFactory public immutable factory;
    address public immutable treasury;
    IReferrals public immutable referrals;
    /// @notice The router, set once. A trade through it is asked who it's for, and that trader's rank lowers the terminal's cut,
    /// here and on the pool.
    address public router;
    uint256 public launchFee;

    mapping(address => Curve) public curves;
    mapping(address => uint256) public creatorFees; // claimable, so an earner that rejects ZRO cannot block trading
    uint256 public protocolFees;
    address[] private _tokens;
    /// @dev Contracts that pass a holder token through without being holders. Set once, since a token copies the list when it's made.
    address[] private _notEarning;
    bool public notEarningSet;

    event TokenLaunched(
        address indexed token,
        address indexed creator,
        string name,
        string symbol,
        string uri,
        uint256 timestamp,
        uint256 supply,
        uint16 feeBps,
        uint16 holdersBps,
        uint16 burnBps,
        bool antiSnipe
    );
    event Trade(
        address indexed token,
        address indexed trader,
        bool isBuy,
        uint256 zroAmount, // ZRO the trader paid, or received, fee included in the buy figure and excluded from the sell figure
        uint256 tokenAmount,
        uint256 fee,
        uint256 toTreasury, // the part of `fee` that went to the treasury, with the rest to whoever earns this token's fees
        uint256 raisedAfter,
        uint256 soldAfter
    );
    event Graduated(address indexed token, uint256 zroToPool, uint256 tokensToPool);
    /// @notice Where the earners' part of a fee went. `toBurn` bought `burned` tokens on the curve, sent to the dead address.
    event EarnersPaid(address indexed token, uint256 toCreator, uint256 toHolders, uint256 toBurn, uint256 burned);
    event PoolFeePaid(address indexed token, uint256 amount);
    /// @notice The terminal's cut of a trade on a graduated token's pool, after any part a referral took.
    event ProtocolFeeFromPool(address indexed token, uint256 toTreasury);
    event CreatorFeesClaimed(address indexed creator, uint256 amount);
    event ProtocolFeesCollected(address indexed treasury, uint256 amount);
    event LaunchFeeUpdated(uint256 launchFee);

    error UnknownToken();
    error AlreadyGraduated();
    error Expired();
    error Slippage();
    error ZeroAmount();
    error BadMetadata();
    error BadConfig();
    error BadTerms();
    error WrongLaunchFee();
    error TransferFailed();
    error NotPools();

    constructor(address owner_, address treasury_, address pools_, address referrals_, address factory_) Ownable(owner_) {
        if (treasury_ == address(0) || pools_ == address(0) || factory_ == address(0)) revert BadConfig();
        factory = ITokenFactory(factory_);
        treasury = treasury_;
        pools = IPoolSeed(pools_);
        referrals = IReferrals(referrals_); // zero means no referral program
    }

    // ------------------------------------------------------------------ reads

    function isToken(address token) public view returns (bool) {
        return curves[token].creator != address(0);
    }

    function tokensCount() external view returns (uint256) {
        return _tokens.length;
    }

    function tokenAt(uint256 i) external view returns (address) {
        return _tokens[i];
    }

    /// @notice Spot price on the curve, in wei of ZRO per whole token.
    function priceOf(address token) external view returns (uint256) {
        Curve storage c = curves[token];
        return Math.mulDiv(VIRTUAL_ZRO + c.raised, 1 ether, _virtualTokens(c.supply) - c.sold);
    }

    /// @notice What a buy pays right now, in basis points, for a trader without a rank. It only differs from the token's fee
    /// during anti-snipe.
    function buyFeeBps(address token) public view returns (uint256) {
        return _buyFee(curves[token]);
    }

    /// @notice The same for a given trader through the router, with their rank taken off.
    function buyFeeBpsFor(address token, address trader) external view returns (uint256) {
        return _buyFee(curves[token]) - _discountOf(trader);
    }

    /// @inheritdoc IVenue
    function quoteBuy(address token, uint256 zroIn) external view returns (uint256 tokensOut) {
        Curve storage c = curves[token];
        if (c.creator == address(0) || c.graduated || zroIn == 0) return 0;
        (tokensOut,,) = _buyMath(c, zroIn, _buyFee(c));
    }

    /// @inheritdoc IVenue
    function quoteSell(address token, uint256 tokensIn) external view returns (uint256 zroOut) {
        Curve storage c = curves[token];
        if (c.creator == address(0) || c.graduated || tokensIn == 0 || tokensIn > c.sold) return 0;
        (zroOut,,) = _sellMath(c, tokensIn, c.feeBps);
    }

    // ------------------------------------------------------------------ actions

    /// @notice Create a token on the default terms. Any ZRO sent beyond the launch fee is the creator's first buy, in the same transaction.
    function launch(string calldata name_, string calldata symbol_, string calldata uri_, uint256 minTokensOut)
        external
        payable
        nonReentrant
        returns (address)
    {
        return _launch(name_, symbol_, uri_, minTokensOut, SUPPLY, 0, 0, 0, false);
    }

    /// @notice Create a token on terms of the creator's choosing, which can never change after this.
    /// @param wholeSupply In whole coins.
    /// @param devFeeBps The creator's own fee on top of the 1% base, up to 10%. Zero for none.
    /// @param holdersBps Of that own fee, what goes to the token's holders.
    /// @param burnBps Of the same, what buys the token back and burns it. The creator gets the rest; the two add up to 10,000 at most.
    function launch(
        string calldata name_,
        string calldata symbol_,
        string calldata uri_,
        uint256 minTokensOut,
        uint256 wholeSupply,
        uint16 devFeeBps,
        uint16 holdersBps,
        uint16 burnBps,
        bool antiSnipe
    ) external payable nonReentrant returns (address) {
        if (wholeSupply < MIN_WHOLE_SUPPLY || wholeSupply > MAX_WHOLE_SUPPLY) revert BadTerms();
        return _launch(name_, symbol_, uri_, minTokensOut, wholeSupply * 1 ether, devFeeBps, holdersBps, burnBps, antiSnipe);
    }

    function _launch(
        string calldata name_,
        string calldata symbol_,
        string calldata uri_,
        uint256 minTokensOut,
        uint256 supply,
        uint16 devFeeBps,
        uint16 holdersBps,
        uint16 burnBps,
        bool antiSnipe
    ) private returns (address token) {
        uint256 nameLen = bytes(name_).length;
        uint256 symbolLen = bytes(symbol_).length;
        if (nameLen == 0 || nameLen > 64 || symbolLen == 0 || symbolLen > 16 || bytes(uri_).length > 512) revert BadMetadata();
        if (devFeeBps > MAX_DEV_FEE_BPS || uint256(holdersBps) + burnBps > BPS) revert BadTerms();
        // With no fee of its own there is nothing to split, so the shares are kept clean rather than meaningless.
        if (devFeeBps == 0 && (holdersBps != 0 || burnBps != 0)) revert BadTerms();
        uint16 feeBps_ = BASE_FEE_BPS + devFeeBps;
        uint256 fee = launchFee;
        if (msg.value < fee) revert WrongLaunchFee();

        token = factory.create(holdersBps > 0, name_, symbol_, uri_, supply, pools.vault(), pools.venue(), address(pools), holdersBps > 0 ? _exempt() : new address[](0));
        curves[token] = Curve({creator: msg.sender, createdAt: uint40(block.timestamp), graduated: false, feeBps: feeBps_, holdersBps: holdersBps, burnBps: burnBps, antiSnipe: antiSnipe, raised: 0, sold: 0, supply: uint128(supply), protocolBps: PROTOCOL_BPS});
        _tokens.push(token);
        protocolFees += fee;
        emit TokenLaunched(token, msg.sender, name_, symbol_, uri_, block.timestamp, supply, feeBps_, holdersBps, burnBps, antiSnipe);

        uint256 firstBuy = msg.value - fee;
        if (firstBuy > 0) {
            // The creator's own first buy never pays the anti-snipe rate: it's the one buy that can't be a sniper.
            uint256 out = _buy(token, firstBuy, msg.sender, feeBps_, 0);
            if (out < minTokensOut) revert Slippage();
        }
    }

    /// @inheritdoc IVenue
    function buy(address token, uint256 minOut, address recipient, uint256 deadline)
        external
        payable
        nonReentrant
        returns (uint256 tokensOut)
    {
        if (block.timestamp > deadline) revert Expired();
        Curve storage c = curves[token];
        if (c.creator == address(0)) revert UnknownToken();
        uint256 off = _discount();
        tokensOut = _buy(token, msg.value, recipient, _buyFee(c) - off, off);
        if (tokensOut < minOut) revert Slippage();
    }

    /// @inheritdoc IVenue
    function sell(address token, uint256 tokensIn, uint256 minOut, address recipient, uint256 deadline)
        external
        nonReentrant
        returns (uint256 zroOut)
    {
        if (block.timestamp > deadline) revert Expired();
        Curve storage c = curves[token];
        if (c.creator == address(0)) revert UnknownToken();
        if (c.graduated) revert AlreadyGraduated();
        if (tokensIn == 0 || tokensIn > c.sold) revert ZeroAmount();

        uint256 off = _discount();
        (uint256 net, uint256 gross, uint256 fee) = _sellMath(c, tokensIn, c.feeBps - off);
        if (net < minOut) revert Slippage();

        c.raised -= uint128(gross);
        c.sold -= uint128(tokensIn);

        // The tokens come in first, so on a token that pays its holders a seller doesn't earn from their own sale.
        IERC20(token).safeTransferFrom(msg.sender, address(this), tokensIn);
        uint256 toTreasury = _splitFee(token, c, fee, gross, recipient, off);
        _send(recipient, net);
        emit Trade(token, recipient, false, net, tokensIn, fee, toTreasury, c.raised, c.sold);
        return net;
    }

    function claimCreatorFees() external nonReentrant {
        uint256 amount = creatorFees[msg.sender];
        if (amount == 0) revert ZeroAmount();
        creatorFees[msg.sender] = 0;
        _send(msg.sender, amount);
        emit CreatorFeesClaimed(msg.sender, amount);
    }

    /// @notice Anyone may push accumulated protocol fees to the treasury.
    function collectProtocolFees() external nonReentrant {
        uint256 amount = protocolFees;
        if (amount == 0) revert ZeroAmount();
        protocolFees = 0;
        _send(treasury, amount);
        emit ProtocolFeesCollected(treasury, amount);
    }

    /// @notice A token's fee on its pool, which goes to the same places its fee on the curve did. The pool has already burned
    /// the buyback's part in the same swap, so this is the creator's base share and the rest of their own fee.
    function payFromPool(address token) external payable {
        if (msg.sender != address(pools)) revert NotPools();
        Curve storage c = curves[token];
        if (c.creator == address(0)) revert UnknownToken();
        uint256 amount = msg.value;
        if (amount > 0) {
            uint256 dev = c.feeBps - BASE_FEE_BPS;
            // What arrived is CREATOR_BASE + dev * (1 - burn) parts of the trade; holders get their part of that.
            uint256 parts = uint256(CREATOR_BASE_BPS) * BPS + dev * (BPS - c.burnBps);
            uint256 toHolders = Math.mulDiv(amount, dev * c.holdersBps, parts);
            if (toHolders > 0) HolderToken(token).addRewards{value: toHolders}();
            creatorFees[c.creator] += amount - toHolders;
            emit EarnersPaid(token, amount - toHolders, toHolders, 0, 0);
        }
        emit PoolFeePaid(token, amount);
    }

    /// @notice The terminal's cut of a trade on a graduated token's pool. The pool takes it itself, so it's the same 0.4%,
    /// less the trader's rank, however the trade reached it, and a referrer shares it as on the curve.
    function payProtocolFromPool(address token, address trader) external payable {
        if (msg.sender != address(pools)) revert NotPools();
        if (curves[token].creator == address(0)) revert UnknownToken();
        uint256 kept = msg.value - _refer(msg.value, trader);
        protocolFees += kept;
        emit ProtocolFeeFromPool(token, kept);
    }

    /// @notice Capped, and the treasury and the fees can't be changed: this is all the owner can do here.
    function setLaunchFee(uint256 launchFee_) external onlyOwner {
        if (launchFee_ > MAX_LAUNCH_FEE) revert BadConfig();
        launchFee = launchFee_;
        emit LaunchFeeUpdated(launchFee_);
    }

    /// @notice Whether our tokens treat `spender` as approved: the router or one of its forwarders, all set once.
    function trusts(address spender) external view returns (bool) {
        address r = router;
        return r != address(0) && (spender == r || ISpenders(r).isForwarder(spender));
    }

    function setRouter(address router_) external onlyOwner {
        if (router != address(0) || router_ == address(0)) revert BadConfig();
        router = router_;
    }

    /// @notice Which of our contracts hold tokens without being holders. Once only, since every holder token copies this list.
    function setNotEarning(address[] calldata list) external onlyOwner {
        if (notEarningSet) revert BadConfig();
        notEarningSet = true;
        for (uint256 i; i < list.length; ++i) {
            _notEarning.push(list[i]);
        }
    }

    // ------------------------------------------------------------------ internals

    function _exempt() private view returns (address[] memory list) {
        uint256 n = _notEarning.length;
        list = new address[](n + 2);
        for (uint256 i; i < n; ++i) {
            list[i] = _notEarning[i];
        }
        list[n] = address(pools);
        list[n + 1] = 0x000000000000000000000000000000000000dEaD;
    }

    function _virtualTokens(uint256 supply) private pure returns (uint256) {
        return (supply * 16) / 15;
    }

    function _buyFee(Curve storage c) private view returns (uint256) {
        uint256 base = c.feeBps;
        if (!c.antiSnipe) return base;
        uint256 elapsed = block.timestamp - c.createdAt;
        if (elapsed >= SNIPE_SECONDS) return base;
        return SNIPE_START_BPS - ((SNIPE_START_BPS - base) * elapsed) / SNIPE_SECONDS;
    }

    /// @dev Only a trade through the router has a trader the rank can belong to: one straight to the curve pays the full fee.
    function _discount() private view returns (uint256) {
        return msg.sender == router && router != address(0) ? _discountOf(ITraderSource(router).currentTrader()) : 0;
    }

    function _discountOf(address trader) private view returns (uint256) {
        if (router == address(0) || trader == address(0)) return 0;
        // Never more than the terminal's own cut, whatever the router answers: the creator's share isn't the router's to give.
        return Math.min(ITraderSource(router).discountOf(trader), PROTOCOL_BPS);
    }

    function _buy(address token, uint256 zroIn, address recipient, uint256 feeRate, uint256 off) private returns (uint256 tokensOut) {
        Curve storage c = curves[token];
        if (c.graduated) revert AlreadyGraduated();
        if (zroIn == 0) revert ZeroAmount();

        uint256 used;
        uint256 fee;
        (tokensOut, used, fee) = _buyMath(c, zroIn, feeRate);
        if (tokensOut == 0) revert ZeroAmount();

        c.raised += uint128(used - fee);
        c.sold += uint128(tokensOut);
        // Before the tokens go out, so on a token that pays its holders a buyer doesn't earn from their own buy.
        uint256 toTreasury = _splitFee(token, c, fee, used, recipient, off);

        IERC20(token).safeTransfer(recipient, tokensOut);
        emit Trade(token, recipient, true, used, tokensOut, fee, toTreasury, c.raised, c.sold);

        if (c.raised == RAISE_TARGET) _graduate(token, c);
        if (zroIn > used) _send(msg.sender, zroIn - used); // the buy that fills the curve only pays for what is left
    }

    /// @return tokensOut Tokens the buyer receives.
    /// @return used ZRO actually taken, fee included. Below `zroIn` only when the buy fills the curve.
    /// @return fee The part of `used` that is fee.
    function _buyMath(Curve storage c, uint256 zroIn, uint256 feeRate) private view returns (uint256 tokensOut, uint256 used, uint256 fee) {
        uint256 raised = c.raised;
        uint256 room = RAISE_TARGET - raised;
        fee = Math.mulDiv(zroIn, feeRate, BPS, Math.Rounding.Ceil);
        uint256 net = zroIn - fee;
        used = zroIn;
        if (net >= room) {
            net = room;
            used = Math.mulDiv(net, BPS, BPS - feeRate, Math.Rounding.Ceil);
            fee = used - net;
            return ((uint256(c.supply) * 4) / 5 - c.sold, used, fee);
        }
        uint256 vTokens = _virtualTokens(c.supply);
        // tokens left in the virtual reserve after the buy, rounded up so the buyer never gets a wei too many
        uint256 tokensAfter = Math.mulDiv(VIRTUAL_ZRO, vTokens, VIRTUAL_ZRO + raised + net, Math.Rounding.Ceil);
        tokensOut = vTokens - c.sold - tokensAfter;
    }

    /// @return net ZRO the seller receives.
    /// @return gross ZRO leaving the curve, fee included.
    /// @return fee The part of `gross` that is fee.
    function _sellMath(Curve storage c, uint256 tokensIn, uint256 feeRate) private view returns (uint256 net, uint256 gross, uint256 fee) {
        uint256 raised = c.raised;
        uint256 vTokens = _virtualTokens(c.supply);
        uint256 zroAfter = Math.mulDiv(VIRTUAL_ZRO, vTokens, vTokens - c.sold + tokensIn, Math.Rounding.Ceil);
        // Rounding can leave the virtual side a wei above what the curve holds; a seller then simply gets nothing more.
        uint256 before = VIRTUAL_ZRO + raised;
        gross = before > zroAfter ? before - zroAfter : 0;
        fee = Math.mulDiv(gross, feeRate, BPS, Math.Rounding.Ceil);
        net = gross - fee;
    }

    /// @dev Both parts of the base are of the trade, not of the fee, so everything above the base, the creator's own fee and the
    /// extra of anti-snipe, goes where the creator said. A trader's rank comes off the terminal's cut only. A referred trader's
    /// trade sends part of what's left of that cut to Referrals, and `toTreasury` is the rest.
    function _splitFee(address token, Curve storage c, uint256 fee, uint256 traded, address recipient, uint256 off) private returns (uint256 toTreasury) {
        uint256 cut = Math.min((traded * (c.protocolBps - off)) / BPS, fee);
        uint256 base = Math.min((traded * CREATOR_BASE_BPS) / BPS, fee - cut);
        if (base > 0) creatorFees[c.creator] += base;
        _payEarners(token, c, fee - cut - base, base);
        address trader = recipient == router && router != address(0) ? ITraderSource(router).currentTrader() : recipient;
        toTreasury = cut - _refer(cut, trader);
        protocolFees += toTreasury;
    }

    /// @dev A referred trader's share of the terminal's cut goes to Referrals.
    /// @return back What went to Referrals.
    function _refer(uint256 cut, address trader) private returns (uint256 back) {
        if (address(referrals) == address(0) || cut == 0 || trader == address(0)) return 0;
        if (referrals.referrerOf(trader) == address(0)) return 0;
        back = (cut * REFERRAL_BPS) / BPS;
        referrals.credit{value: back}(trader);
    }

    /// @dev The creator's own fee on a trade on the curve: the burn share buys tokens here, holders get theirs, the creator the
    /// rest. `base`, already credited, is only reported with it, so the event shows all the creator got.
    function _payEarners(address token, Curve storage c, uint256 amount, uint256 base) private {
        if (amount == 0 && base == 0) return;
        uint256 toBurn = (amount * c.burnBps) / BPS;
        uint256 toHolders = (amount * c.holdersBps) / BPS;
        uint256 burned;
        uint256 spent;
        if (toBurn > 0) (burned, spent) = _burnOnCurve(token, c, toBurn);
        // Rounding, and a burn the curve had no room left for, go to the creator, so nothing is stranded here.
        uint256 toCreator = amount - toHolders - spent;
        if (toHolders > 0) HolderToken(token).addRewards{value: toHolders}();
        if (toCreator > 0) creatorFees[c.creator] += toCreator;
        emit EarnersPaid(token, toCreator + base, toHolders, spent, burned);
    }

    /// @dev Buys on the curve with no fee, since it is paid out of a fee, and sends what it bought to the dead address. Never
    /// past the end of the curve: the buy that fills it graduates the token right after, from `_buy`.
    function _burnOnCurve(address token, Curve storage c, uint256 zro) private returns (uint256 burned, uint256 spent) {
        if (c.graduated || c.raised >= RAISE_TARGET) return (0, 0);
        (burned, spent,) = _buyMath(c, zro, 0);
        if (burned == 0) return (0, 0);
        c.raised += uint128(spent);
        c.sold += uint128(burned);
        IERC20(token).safeTransfer(DEAD, burned);
    }

    function _graduate(address token, Curve storage c) private {
        c.graduated = true;
        uint256 lpSupply = uint256(c.supply) / 5;
        IERC20(token).forceApprove(address(pools), lpSupply);
        // On the pool the token pays the same: the pool takes the terminal's 0.4% itself, and the creator's part as below.
        // The pool burns from the whole of the creator's part, so the buyback's share is restated as a share of that.
        uint256 dev = c.feeBps - BASE_FEE_BPS;
        uint256 poolBurnBps = (dev * c.burnBps) / (CREATOR_BASE_BPS + dev);
        pools.seed{value: RAISE_TARGET}(token, lpSupply, c.feeBps - c.protocolBps, uint16(poolBurnBps));
        emit Graduated(token, RAISE_TARGET, lpSupply);
    }

    function _send(address to, uint256 amount) private {
        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert TransferFailed();
    }
}
