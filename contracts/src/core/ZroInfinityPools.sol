// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

import {IVault} from "infinity-core/src/interfaces/IVault.sol";
import {ILockCallback} from "infinity-core/src/interfaces/ILockCallback.sol";
import {IHooks} from "infinity-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "infinity-core/src/interfaces/IPoolManager.sol";
import {ICLHooks} from "infinity-core/src/pool-cl/interfaces/ICLHooks.sol";
import {ICLPoolManager} from "infinity-core/src/pool-cl/interfaces/ICLPoolManager.sol";
import {TickMath} from "infinity-core/src/pool-cl/libraries/TickMath.sol";
import {SqrtPriceMath} from "infinity-core/src/pool-cl/libraries/SqrtPriceMath.sol";
import {PoolKey} from "infinity-core/src/types/PoolKey.sol";
import {PoolId} from "infinity-core/src/types/PoolId.sol";
import {Currency, CurrencyLibrary} from "infinity-core/src/types/Currency.sol";
import {BalanceDelta, BalanceDeltaLibrary} from "infinity-core/src/types/BalanceDelta.sol";
import {BeforeSwapDelta, toBeforeSwapDelta} from "infinity-core/src/types/BeforeSwapDelta.sol";

interface ILaunchRegistry {
    function payFromPool(address token) external payable;
    function payProtocolFromPool(address token, address trader) external payable;
    function router() external view returns (address);
}

/// @dev The router's word on whose trade is in progress and what their volume rank takes off the terminal's cut.
interface ITraderBook {
    function currentTrader() external view returns (address);
    function discountOf(address trader) external view returns (uint256);
}

/// @title ZroInfinityPools
/// @notice Where a token goes when its curve fills: a ZRO/token pool on PancakeSwap Infinity's concentrated-liquidity engine, with
/// this contract as the pool's hook and the launchpad's migrator. Trades go through `ZroInfinityVenue`, the router's venue: Infinity
/// never calls a hook for a swap the hook makes itself, so a hook can't also be the venue whose trades it charges.
///
/// @dev Why Infinity and why a hook. A token's fee has to keep being paid on every trade after it leaves the curve, to its holders,
/// its burn and its creator, whoever trades and through whatever router. A v2 or v3 pool can't do that: their only fee belongs to
/// whoever holds the liquidity. Infinity lets a hook take its own cut inside the swap. Infinity's core is GPL-2.0-or-later, so it may
/// run in production; Uniswap v4's core may not until 2027 without a grant. Hence this file is GPL too.
///
/// What it keeps from the constant-product pools it replaces, so the rest of Submarine reads it the same way:
/// - The fee: `earnersBps` of every trade's ZRO side, frozen when the pool opens. Of it, `burnBps` buys the token back from its own
///   pool and sends it to the dead address; the rest goes to the launchpad, which pays the holders and the creator.
/// - The liquidity: the graduation's ZRO and tokens, as one position over the whole price range, owned by this contract, which has
///   no way to remove it. Nobody else can add liquidity either, which is also what keeps the quotes below exact.
/// - The events, with the same fields.
///
/// The hook takes its fee as a claim on the vault (ERC-6909), not as tokens: mid-swap the vault may hold less ZRO than the fee, and
/// a large buy would revert (the bug Cinder found and fixed). The claims are turned into ZRO and paid out in `distribute`, which
/// the venue runs after every trade it makes and anyone can run for trades made around it.
contract ZroInfinityPools is ICLHooks, ILockCallback, Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;
    using BalanceDeltaLibrary for BalanceDelta;

    uint256 public constant BPS = 10_000;
    /// @notice The terminal's 0.4% of every trade's 1% base fee, taken here like the creator's part, so it's the same however a
    /// trade reaches the pool. A trader's volume rank, through Submarine's router, takes some off.
    uint256 public constant PROTOCOL_BPS = 40;
    address public constant DEAD = 0x000000000000000000000000000000000000dEaD;
    /// @notice The whole range is one position, so any spacing works; a wide one keeps swaps to few steps.
    int24 public constant TICK_SPACING = 200;
    /// @notice No LP fee: the token's fee arrives through this hook instead. Infinity's protocol fee is separate and applies even at
    /// a zero LP fee, up to 0.4% a swap, if the pool manager's owner names a controller that charges one. None is named, so it is
    /// zero, and the quotes below assume it stays so.
    uint24 public constant LP_FEE = 0;
    /// @notice How far one burn may move the price, about 5%. What it can't buy within that is paid to the holders and the creator
    /// with the rest of the fee.
    uint256 public constant BURN_PRICE_STEP = 9_747; // of 10,000 on the sqrt price

    // beforeInitialize | beforeAddLiquidity | beforeRemoveLiquidity | beforeSwap | afterSwap | both swap return deltas
    uint16 public constant HOOK_BITMAP = (1 << 0) | (1 << 2) | (1 << 4) | (1 << 6) | (1 << 7) | (1 << 10) | (1 << 11);

    IVault public immutable vault;
    ICLPoolManager public immutable poolManager;
    ILaunchRegistry public launchpad;
    /// @notice Submarine's venue for these pools. Its trades come from the router, so they can carry a trader's rank.
    address public venue;

    /// @notice A graduated token's fee on the ZRO side of every trade, set for good when its pool opens. It goes to its earners.
    mapping(address => uint16) public earnersBps;
    /// @notice Of that fee, the part that buys the token back from its pool and burns it, set for good with the pool.
    mapping(address => uint16) public burnBps;
    /// @notice The creator's and holders' fees collected and not yet paid out, held as claims on the vault, in ZRO.
    mapping(address => uint256) public pending;
    /// @notice The terminal's cut collected and not yet paid out, held the same way.
    mapping(address => uint256) public pendingProtocol;
    /// @notice The token each pool trades, by pool id, for the hook callbacks, which only see the key.
    mapping(PoolId => address) public tokenOf;

    event PoolCreated(address indexed token, address indexed by, bool graduated);
    event Swap(
        address indexed token, address indexed trader, bool isBuy, uint256 zroAmount, uint256 tokenAmount, uint256 reserveZro, uint256 reserveToken
    );
    event Burned(address indexed token, uint256 zro, uint256 tokens);
    event LiquidityAdded(address indexed token, address indexed provider, uint256 zro, uint256 tokens, uint256 sharesMinted);

    error NotLaunchpad();
    error NotVault();
    error NotPoolManager();
    error NoPool();
    error PoolExists();
    error ZeroAmount();
    error BadConfig();
    error Locked();
    error TransferFailed();

    // The fee a trade's `beforeSwap` took, for its `afterSwap` to report. Infinity never calls this hook for its own swaps (the
    // burns), so those pay nothing and aren't reported as trades without any flag of ours.
    bytes32 private constant FEE_SLOT = keccak256("submarine.pools.fee");
    /// @dev Per token, the terminal's cut charged on trades through the venue in this transaction: the part whose trader is known.
    bytes32 private constant VENUE_CUT_SLOT = keccak256("submarine.pools.venuecut");

    enum Action {
        Seed,
        Distribute
    }

    constructor(address owner_, IVault vault_, ICLPoolManager poolManager_) Ownable(owner_) {
        vault = vault_;
        poolManager = poolManager_;
    }

    modifier onlyPoolManager() {
        if (msg.sender != address(poolManager)) revert NotPoolManager();
        _;
    }

    function setLaunchpad(address launchpad_) external onlyOwner {
        if (address(launchpad) != address(0) || launchpad_ == address(0)) revert BadConfig();
        launchpad = ILaunchRegistry(launchpad_);
    }

    /// @notice Once only, since a token's one-block hold names it for good.
    function setVenue(address venue_) external onlyOwner {
        if (venue != address(0) || venue_ == address(0)) revert BadConfig();
        venue = venue_;
    }

    // ------------------------------------------------------------------ views

    /// @notice The pool's key, which a wallet or another router needs to trade it on Infinity directly.
    function poolKeyOf(address token) public view returns (PoolKey memory key) {
        key = PoolKey({
            currency0: CurrencyLibrary.NATIVE,
            currency1: Currency.wrap(token),
            hooks: IHooks(address(this)),
            poolManager: IPoolManager(address(poolManager)),
            fee: LP_FEE,
            parameters: bytes32((uint256(uint24(TICK_SPACING)) << 16) | uint256(HOOK_BITMAP))
        });
    }

    /// @notice The pool as reserves, for readers built for constant-product pools: the ZRO and tokens its liquidity is worth at the
    /// current price. `totalShares` is the liquidity itself.
    function pools(address token) external view returns (uint256 reserveZro, uint256 reserveToken, uint256 totalShares) {
        (uint160 sqrtP, uint128 liquidity) = _state(token);
        if (liquidity == 0) return (0, 0, 0);
        (reserveZro, reserveToken) = _reserves(sqrtP, liquidity);
        totalShares = liquidity;
    }

    /// @notice ZRO per whole token, with 18 decimals, before any fee.
    function priceOf(address token) external view returns (uint256) {
        (uint160 sqrtP, uint128 liquidity) = _state(token);
        if (liquidity == 0) return 0;
        // sqrtP is sqrt(tokens per ZRO) in Q64.96, so ZRO per token is 2^192 / sqrtP^2.
        return Math.mulDiv(1 ether, 1 << 192, uint256(sqrtP) * uint256(sqrtP));
    }

    /// @notice Tokens out for a ZRO amount, after the fee. Exact while the graduation's position is the pool's only liquidity.
    function quoteBuy(address token, uint256 zroIn) public view returns (uint256) {
        (uint160 sqrtP, uint128 liquidity) = _state(token);
        if (liquidity == 0 || zroIn == 0) return 0;
        uint256 net = zroIn - _feeOn(token, zroIn);
        if (net == 0) return 0;
        uint160 next = SqrtPriceMath.getNextSqrtPriceFromInput(sqrtP, liquidity, net, true);
        return SqrtPriceMath.getAmount1Delta(next, sqrtP, liquidity, false);
    }

    /// @notice ZRO out for a token amount, after the fee.
    function quoteSell(address token, uint256 tokensIn) public view returns (uint256) {
        (uint160 sqrtP, uint128 liquidity) = _state(token);
        if (liquidity == 0 || tokensIn == 0) return 0;
        uint160 next = SqrtPriceMath.getNextSqrtPriceFromInput(sqrtP, liquidity, tokensIn, false);
        uint256 gross = SqrtPriceMath.getAmount0Delta(sqrtP, next, liquidity, false);
        return gross - _feeOn(token, gross);
    }

    // ------------------------------------------------------------------ the launchpad's side

    /// @notice Opens a graduated token's pool at the price its curve ended on, with all of the ZRO and tokens it was given as one
    /// position over the whole range that can never be removed.
    function seed(address token, uint256 tokenAmount, uint16 earnersBps_, uint16 burnBps_) external payable nonReentrant {
        if (msg.sender != address(launchpad)) revert NotLaunchpad();
        if (tokenOf[poolKeyOf(token).toId()] != address(0)) revert PoolExists();
        if (msg.value == 0 || tokenAmount == 0) revert ZeroAmount();
        if (earnersBps_ > 1_100 || burnBps_ > BPS) revert BadConfig();
        IERC20(token).safeTransferFrom(msg.sender, address(this), tokenAmount);
        earnersBps[token] = earnersBps_;
        burnBps[token] = burnBps_;
        PoolKey memory key = poolKeyOf(token);
        tokenOf[key.toId()] = token;

        // Tokens per ZRO, as a Q64.96 square root: exactly where the curve's last buy left the price.
        uint160 sqrtP = uint160(Math.sqrt(Math.mulDiv(tokenAmount, 1 << 192, msg.value)));
        poolManager.initialize(key, sqrtP);
        vault.lock(abi.encode(Action.Seed, abi.encode(token, msg.value, tokenAmount, sqrtP)));

        // The liquidity maths rounds down, so a few wei of either side can be left over. They stay here for good: sending tokens to
        // the dead address would count as a burn the token never chose, and paying ZRO out would skew its earners' exact shares.
        emit PoolCreated(token, msg.sender, true);
    }

    // ------------------------------------------------------------------ fees

    /// @notice Pays out the fees a token's pool has collected: the burn share buys the token back and burns it, the rest goes to
    /// the launchpad for its holders and creator. Runs after every trade through this venue; anyone may run it for the rest.
    function distribute(address token) external nonReentrant {
        _distribute(token);
    }

    function _distribute(address token) private {
        uint256 earners = pending[token];
        uint256 protocol = pendingProtocol[token];
        if (earners + protocol == 0) return;
        pending[token] = 0;
        pendingProtocol[token] = 0;
        bytes memory res = vault.lock(abi.encode(Action.Distribute, abi.encode(token, earners, protocol)));
        (uint256 spent, uint256 burned) = abi.decode(res, (uint256, uint256));
        if (burned > 0) emit Burned(token, spent, burned);
        if (earners > spent) launchpad.payFromPool{value: earners - spent}(token);
        // A referrer shares the terminal's cut of a trade made through the venue, whose trader the router knows. Only that trade's
        // cut is theirs: what trades made straight on the pool left waiting has no known trader and goes to the treasury whole.
        bytes32 slot = keccak256(abi.encode(VENUE_CUT_SLOT, token));
        uint256 known = msg.sender == venue ? Math.min(_tload(slot), protocol) : 0;
        if (known > 0) {
            _tstore(slot, 0);
            launchpad.payProtocolFromPool{value: known}(token, _currentTrader());
        }
        if (protocol > known) launchpad.payProtocolFromPool{value: protocol - known}(token, address(0));
    }

    /// @inheritdoc ILockCallback
    function lockAcquired(bytes calldata data) external returns (bytes memory) {
        if (msg.sender != address(vault)) revert NotVault();
        (Action action, bytes memory args) = abi.decode(data, (Action, bytes));
        if (action == Action.Seed) return _lockSeed(args);
        return _lockDistribute(args);
    }

    function _lockSeed(bytes memory args) private returns (bytes memory) {
        (address token, uint256 zro, uint256 tokens, uint160 sqrtP) = abi.decode(args, (address, uint256, uint256, uint160));
        PoolKey memory key = poolKeyOf(token);
        int24 top = (TickMath.MAX_TICK / TICK_SPACING) * TICK_SPACING;
        // The whole range, so the position holds ZRO and tokens at every price. Its liquidity is the most both amounts cover.
        uint256 fromZro = Math.mulDiv(zro, sqrtP, 1 << 96);
        uint256 fromTokens = Math.mulDiv(tokens, 1 << 96, sqrtP);
        uint128 liquidity = uint128(Math.min(fromZro, fromTokens));
        if (liquidity == 0) revert ZeroAmount();
        (BalanceDelta delta,) = poolManager.modifyLiquidity(
            key,
            ICLPoolManager.ModifyLiquidityParams({tickLower: -top, tickUpper: top, liquidityDelta: int256(uint256(liquidity)), salt: bytes32(0)}),
            ""
        );
        uint256 paidZro = _settle(key.currency0, delta.amount0());
        uint256 paidTokens = _settle(key.currency1, delta.amount1());
        emit LiquidityAdded(token, DEAD, paidZro, paidTokens, liquidity);
        return "";
    }

    function _lockDistribute(bytes memory args) private returns (bytes memory) {
        (address token, uint256 earners, uint256 protocol) = abi.decode(args, (address, uint256, uint256));
        PoolKey memory key = poolKeyOf(token);
        uint256 amount = earners + protocol;
        // The claims become ZRO credit in this lock. Only the earners' part buys back and burns.
        vault.burn(address(this), CurrencyLibrary.NATIVE, amount);
        uint256 toBurn = (earners * burnBps[token]) / BPS;
        uint256 spent;
        uint256 burned;
        if (toBurn > 0) {
            (uint160 sqrtP,,,) = poolManager.getSlot0(key.toId());
            uint160 limit = uint160((uint256(sqrtP) * BURN_PRICE_STEP) / BPS);
            if (limit <= TickMath.MIN_SQRT_RATIO) limit = TickMath.MIN_SQRT_RATIO + 1;
            BalanceDelta delta = poolManager.swap(
                key, ICLPoolManager.SwapParams({zeroForOne: true, amountSpecified: -int256(toBurn), sqrtPriceLimitX96: limit}), ""
            );
            spent = uint256(uint128(-delta.amount0()));
            burned = _take(key.currency1, delta.amount1(), DEAD);
        }
        // The rest of the credit leaves as ZRO, to be paid to the launchpad once the lock closes.
        if (amount > spent) vault.take(CurrencyLibrary.NATIVE, address(this), amount - spent);
        return abi.encode(spent, burned);
    }

    // ------------------------------------------------------------------ the hook

    /// @inheritdoc IHooks
    function getHooksRegistrationBitmap() external pure returns (uint16) {
        return HOOK_BITMAP;
    }

    /// @notice Only this contract opens pools that wear this hook, and only for a token it was given.
    function beforeInitialize(address sender, PoolKey calldata key, uint160) external view onlyPoolManager returns (bytes4) {
        if (sender != address(this) || tokenOf[key.toId()] == address(0)) revert NotLaunchpad();
        return ICLHooks.beforeInitialize.selector;
    }

    /// @notice The graduation's position is the only liquidity: nobody else adds any, so the quotes stay exact.
    function beforeAddLiquidity(address sender, PoolKey calldata, ICLPoolManager.ModifyLiquidityParams calldata, bytes calldata)
        external
        view
        onlyPoolManager
        returns (bytes4)
    {
        if (sender != address(this)) revert Locked();
        return ICLHooks.beforeAddLiquidity.selector;
    }

    /// @notice And nobody, this contract included, ever takes it out.
    function beforeRemoveLiquidity(address, PoolKey calldata, ICLPoolManager.ModifyLiquidityParams calldata, bytes calldata)
        external
        view
        onlyPoolManager
        returns (bytes4)
    {
        revert Locked();
    }

    /// @notice A trade whose given amount is ZRO pays its fee out of that amount, before the swap.
    function beforeSwap(address sender, PoolKey calldata key, ICLPoolManager.SwapParams calldata params, bytes calldata)
        external
        onlyPoolManager
        returns (bytes4, BeforeSwapDelta, uint24)
    {
        address token = tokenOf[key.toId()];
        _tstore(FEE_SLOT, 0);
        if (token == address(0)) return (ICLHooks.beforeSwap.selector, toBeforeSwapDelta(0, 0), 0);
        bool specifiedIsZro = (params.amountSpecified < 0) == params.zeroForOne;
        if (!specifiedIsZro) return (ICLHooks.beforeSwap.selector, toBeforeSwapDelta(0, 0), 0);
        uint256 size = params.amountSpecified < 0 ? uint256(-params.amountSpecified) : uint256(params.amountSpecified);
        uint256 fee = _charge(token, size, sender);
        if (fee == 0) return (ICLHooks.beforeSwap.selector, toBeforeSwapDelta(0, 0), 0);
        _tstore(FEE_SLOT, fee);
        return (ICLHooks.beforeSwap.selector, toBeforeSwapDelta(int128(int256(fee)), 0), 0);
    }

    /// @notice A trade whose given amount is the token pays its fee out of the ZRO side the swap produced. Every trade is reported.
    function afterSwap(address sender, PoolKey calldata key, ICLPoolManager.SwapParams calldata params, BalanceDelta delta, bytes calldata hookData)
        external
        onlyPoolManager
        returns (bytes4, int128)
    {
        address token = tokenOf[key.toId()];
        if (token == address(0)) return (ICLHooks.afterSwap.selector, 0);
        bool specifiedIsZro = (params.amountSpecified < 0) == params.zeroForOne;
        int128 zroDelta = delta.amount0();
        uint256 zroMoved = zroDelta < 0 ? uint256(uint128(-zroDelta)) : uint256(uint128(zroDelta));
        uint256 tokensMoved = delta.amount1() < 0 ? uint256(uint128(-delta.amount1())) : uint256(uint128(delta.amount1()));
        uint256 feeAfter;
        if (!specifiedIsZro) feeAfter = _charge(token, zroMoved, sender);
        uint256 feeBefore = _tload(FEE_SLOT);
        _tstore(FEE_SLOT, 0);

        // The trader is the recipient Submarine's venue names in the hook data, or whoever called the pool manager otherwise.
        address trader = hookData.length == 32 ? abi.decode(hookData, (address)) : sender;
        (uint160 sqrtP, uint128 liquidity) = _state(token);
        (uint256 reserveZro, uint256 reserveToken) = _reserves(sqrtP, liquidity);
        if (params.zeroForOne) emit Swap(token, trader, true, zroMoved + feeBefore + feeAfter, tokensMoved, reserveZro, reserveToken);
        else emit Swap(token, trader, false, zroMoved - feeAfter, tokensMoved, reserveZro, reserveToken);
        return (ICLHooks.afterSwap.selector, int128(int256(feeAfter)));
    }

    function afterInitialize(address, PoolKey calldata, uint160, int24) external pure returns (bytes4) {
        revert BadConfig();
    }

    function afterAddLiquidity(address, PoolKey calldata, ICLPoolManager.ModifyLiquidityParams calldata, BalanceDelta, BalanceDelta, bytes calldata)
        external
        pure
        returns (bytes4, BalanceDelta)
    {
        revert BadConfig();
    }

    function afterRemoveLiquidity(address, PoolKey calldata, ICLPoolManager.ModifyLiquidityParams calldata, BalanceDelta, BalanceDelta, bytes calldata)
        external
        pure
        returns (bytes4, BalanceDelta)
    {
        revert BadConfig();
    }

    function beforeDonate(address, PoolKey calldata, uint256, uint256, bytes calldata) external pure returns (bytes4) {
        revert BadConfig();
    }

    function afterDonate(address, PoolKey calldata, uint256, uint256, bytes calldata) external pure returns (bytes4) {
        revert BadConfig();
    }

    // ------------------------------------------------------------------ internals

    /// @dev The fee on `size` ZRO of a trade: the creator's and holders' part, and the terminal's 0.4% less the trader's rank when
    /// the trade comes through Submarine's venue. Recorded as a claim on the vault, so no ZRO has to be there yet; the returned delta
    /// nets it in the swap.
    function _charge(address token, uint256 size, address sender) private returns (uint256 fee) {
        uint256 off;
        bool viaVenue = sender == venue && venue != address(0);
        if (viaVenue) {
            address router = launchpad.router();
            if (router != address(0)) off = Math.min(ITraderBook(router).discountOf(ITraderBook(router).currentTrader()), PROTOCOL_BPS);
        }
        uint256 earners = (size * earnersBps[token]) / BPS;
        uint256 protocol = (size * (PROTOCOL_BPS - off)) / BPS;
        fee = earners + protocol;
        if (fee == 0) return 0;
        if (viaVenue && protocol > 0) {
            bytes32 slot = keccak256(abi.encode(VENUE_CUT_SLOT, token));
            _tstore(slot, _tload(slot) + protocol);
        }
        vault.mint(address(this), CurrencyLibrary.NATIVE, fee);
        pending[token] += earners;
        pendingProtocol[token] += protocol;
    }

    /// @dev The fee a trader without a rank pays on `size` ZRO, rounded in the same two parts as `_charge`.
    function _feeOn(address token, uint256 size) private view returns (uint256) {
        return (size * earnersBps[token]) / BPS + (size * PROTOCOL_BPS) / BPS;
    }

    function _currentTrader() private view returns (address) {
        address router = launchpad.router();
        return router == address(0) ? address(0) : ITraderBook(router).currentTrader();
    }

    function _state(address token) private view returns (uint160 sqrtP, uint128 liquidity) {
        PoolId id = poolKeyOf(token).toId();
        if (tokenOf[id] == address(0)) return (0, 0);
        (sqrtP,,,) = poolManager.getSlot0(id);
        liquidity = poolManager.getLiquidity(id);
    }

    /// @dev What full-range liquidity is worth at a price: ZRO = L / sqrtP and tokens = L * sqrtP, in Q64.96.
    function _reserves(uint160 sqrtP, uint128 liquidity) private pure returns (uint256 zro, uint256 tokens) {
        if (sqrtP == 0) return (0, 0);
        zro = Math.mulDiv(liquidity, 1 << 96, sqrtP);
        tokens = Math.mulDiv(liquidity, sqrtP, 1 << 96);
    }

    /// @dev Pays a negative delta: ZRO from this contract's balance, tokens it holds. Returns what was paid.
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

    function _tstore(bytes32 slot, uint256 value) private {
        assembly ("memory-safe") {
            tstore(slot, value)
        }
    }

    function _tload(bytes32 slot) private view returns (uint256 value) {
        assembly ("memory-safe") {
            value := tload(slot)
        }
    }

    /// @dev ZRO arrives from the vault when fees are paid out.
    receive() external payable {
        if (msg.sender != address(vault)) revert NotVault();
    }
}
