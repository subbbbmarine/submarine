import type { ReactNode } from 'react';
import { B, C, Code, Doc, H2, H3, L, Note, P, Table } from '../_ui/doc';
import { docMeta } from '../_ui/pages';

export const metadata = docMeta('reference');

type Fn = [string, string, ReactNode];

function Fns({ rows }: { rows: Fn[] }) {
  return <Table cols={['Function', 'Who', 'What it does']} rows={rows.map(([sig, who, what]) => [<C key="s">{sig}</C>, who, what])} />;
}

function Consts({ rows }: { rows: Array<[string, string, ReactNode]> }) {
  return <Table cols={['Constant', 'Value', 'Meaning']} rows={rows.map(([n, v, m]) => [<C key="n">{n}</C>, <span key="v" className="num whitespace-nowrap text-ink">{v}</span>, m])} />;
}

export default function Page() {
  return (
    <Doc
      slug="reference"
      lead={
        <>
          Every public function, constant and error in <C>contracts/src</C>, by contract. Amounts are in wei unless a row says otherwise, and
          shares are in basis points, where 10,000 is 100%.
        </>
      }
      toc={[
        ['ivenue', 'IVenue'],
        ['launchpad', 'Launchpad'],
        ['tokens', 'LaunchToken and HolderToken'],
        ['pools', 'ZroInfinityPools'],
        ['pool-venue', 'ZroInfinityVenue'],
        ['infinity', 'Infinity core'],
        ['router', 'Router'],
        ['limit-orders', 'LimitOrders'],
        ['copy-vault', 'CopyVault'],
        ['buyback-vault', 'BuybackVault'],
        ['referrals', 'Referrals'],
        ['exit-probe', 'ExitProbe'],
      ]}
    >
      <H2 id="ivenue">IVenue</H2>
      <P>The shape every market has, so the router, limit orders and agents can treat them all alike. A venue that can&apos;t serve a token quotes 0 instead of reverting.</P>
      <Code
        lang="solidity"
        code={`interface IVenue {
    function quoteBuy(address token, uint256 zroIn) external view returns (uint256 tokensOut);
    function quoteSell(address token, uint256 tokensIn) external view returns (uint256 zroOut);
    function buy(address token, uint256 minOut, address recipient, uint256 deadline) external payable returns (uint256 tokensOut);
    function sell(address token, uint256 tokensIn, uint256 minOut, address recipient, uint256 deadline) external returns (uint256 zroOut);
}`}
      />

      <H2 id="launchpad">Launchpad</H2>
      <P>
        Launches tokens and runs one constant-product curve per token, with virtual reserves. Every token sells 80% of its supply on the
        curve for 6,000 ZRO, then the raised ZRO and the other 20% open a pool on PancakeSwap Infinity whose liquidity can never be removed.
        Ownable2Step and ReentrancyGuard.
      </P>
      <H3>Constants</H3>
      <Consts
        rows={[
          ['SUPPLY', '1,000,000,000 tokens', 'Default supply, for a launch that doesn\'t choose'],
          ['CURVE_SUPPLY / LP_SUPPLY', '80% / 20%', 'Of the default supply. Any other supply splits the same way'],
          ['VIRTUAL_TOKENS', 'supply × 16 / 15', 'The token side of the virtual reserve'],
          ['VIRTUAL_ZRO', '2,000 ZRO', 'The ZRO side of the virtual reserve'],
          ['RAISE_TARGET', '6,000 ZRO', 'Real ZRO raised at which the token graduates'],
          ['MIN_WHOLE_SUPPLY / MAX_WHOLE_SUPPLY', '10⁹ / 10¹⁵ whole tokens', 'The supply a creator may choose'],
          ['BPS', '10,000', '100%'],
          ['BASE_FEE_BPS', '100', 'The 1% base every token pays on every trade, on its curve and on its pool'],
          ['PROTOCOL_BPS', '40', 'Of each trade, Submarine\'s part of the base: 0.4%, less a trader\'s rank discount'],
          ['CREATOR_BASE_BPS', '60', 'Of each trade, the creator\'s part of the base: 0.6%'],
          ['MAX_DEV_FEE_BPS', '1,000', 'The most a creator may add on top of the base: 10%'],
          ['MAX_LAUNCH_FEE', '40 ZRO', 'The most the owner can ever charge to launch'],
          ['REFERRAL_BPS', '4,000', 'Of Submarine\'s cut of a referred trade, 40% goes to Referrals'],
          ['SNIPE_START_BPS / SNIPE_SECONDS', '5,000 / 60', 'Anti-snipe: a buy pays 50% at launch, falling to the token\'s fee over 60 s'],
          ['DEAD', '0x…dEaD', 'Where burned tokens go'],
        ]}
      />
      <P>
        Storage you can read: <C>launchFee</C>, <C>router</C>, <C>treasury</C>, <C>pools</C>, <C>referrals</C>,{' '}
        <C>creatorFees(address)</C>, <C>protocolFees</C>, <C>notEarningSet</C> and <C>curves(token)</C>. The trading fees are constants,
        so nothing in storage can change them.
      </P>
      <Code
        lang="solidity"
        title="curves(token) returns"
        code={`struct Curve {
    address creator;
    uint40  createdAt;
    bool    graduated;
    uint16  feeBps;       // what a trader without a rank pays: 100 + the own fee, 100 to 1,100
    uint16  holdersBps;   // of the creator's own fee only
    uint16  burnBps;      // of the creator's own fee only
    bool    antiSnipe;
    uint128 raised;       // real ZRO in the curve
    uint128 sold;         // tokens sold, net of sales
    uint128 supply;
    uint16  protocolBps;  // Submarine's cut before a rank discount, always 40
}`}
      />
      <H3>Functions</H3>
      <Fns
        rows={[
          ['launch(name, symbol, uri, minTokensOut)', 'Anyone, payable', 'Launches on the default terms: 1 billion supply, no own fee (1% in all), no anti-snipe. ZRO sent beyond the launch fee is the creator\'s first buy, in the same transaction'],
          ['launch(name, symbol, uri, minTokensOut, wholeSupply, devFeeBps, holdersBps, burnBps, antiSnipe)', 'Anyone, payable', 'Launches on the creator\'s terms, fixed for good. devFeeBps is the own fee on top of the base, 0 to 1,000. holdersBps and burnBps are shares of that own fee, 10,000 or less together; the creator gets the rest. With devFeeBps 0 both must be 0'],
          ['buy(token, minOut, recipient, deadline)', 'Anyone, payable', 'Buys on the curve. Through the router, the trader\'s rank discount comes off the fee. The buy that fills the curve only pays for what is left, refunds the rest, and graduates the token'],
          ['sell(token, tokensIn, minOut, recipient, deadline)', 'Anyone', 'Sells on the curve, with the same discount through the router. Reverts once the token has graduated'],
          ['quoteBuy(token, zroIn) / quoteSell(token, tokensIn)', 'View', 'What a trade would get right now for a trader without a rank, fee included. 0 for an unknown or graduated token'],
          ['priceOf(token)', 'View', 'Spot price in wei per whole token'],
          ['buyFeeBps(token)', 'View', 'What a buy pays right now without a rank. Differs from feeBps only during anti-snipe'],
          ['buyFeeBpsFor(token, trader)', 'View', 'The same for one trader through the router, with their rank discount taken off'],
          ['isToken(token), tokensCount(), tokenAt(i)', 'View', 'Whether a token is from here, and the list of every token'],
          ['claimCreatorFees()', 'Creator', 'Sends the caller\'s creator fees'],
          ['collectProtocolFees()', 'Anyone', 'Pushes the treasury\'s fees to the treasury'],
          ['payFromPool(token)', 'ZroInfinityPools only', 'A graduated token\'s fee from its pool, less the burn the hook already made, paid to its holders and creator'],
          ['payProtocolFromPool(token, trader)', 'ZroInfinityPools only', 'Submarine\'s 0.4% of pool trades, which the hook took. Sends the trader\'s referral share, exactly as on the curve, and adds the rest to protocolFees'],
          ['setLaunchFee(launchFee)', 'Owner', 'The fee to launch, capped at 40 ZRO. The only setting the owner has here: the trading fees can\'t change'],
          ['setRouter(router), setNotEarning(list)', 'Owner, once', 'Wiring at deployment'],
        ]}
      />
      <H3>Limits on a launch</H3>
      <P>A name of 1 to 64 bytes, a symbol of 1 to 16 bytes, and a uri of at most 512 bytes. Anything else reverts with <C>BadMetadata</C>.</P>
      <H3>Errors</H3>
      <P>
        <C>UnknownToken</C>, <C>AlreadyGraduated</C>, <C>Expired</C>, <C>Slippage</C>, <C>ZeroAmount</C>, <C>BadMetadata</C>,{' '}
        <C>BadConfig</C>, <C>BadTerms</C>, <C>WrongLaunchFee</C>, <C>TransferFailed</C>, <C>NotPools</C>.
      </P>
      <Note title="Rounding always favours the curve.">Fees round up and token amounts round down, so the curve&apos;s real ZRO can never fall short of what sellers are owed.</Note>

      <H2 id="tokens">LaunchToken and HolderToken</H2>
      <P>
        A plain ERC-20 with a fixed supply minted once to the launchpad, a <C>metadataURI</C>, no owner and no way to mint more. A token
        whose creator gave its holders a share is a <B>HolderToken</B> instead, which adds rewards in ZRO. Neither takes anything from a
        transfer.
      </P>
      <P>
        Both inherit <C>HoldsOneBlock</C>: a wallet that got coins from the market (the launchpad&apos;s curve, Infinity&apos;s Vault or
        ZroInfinityVenue) can&apos;t send any of that token until the next block, and a transfer from it in the same block reverts with{' '}
        <C>BoughtThisBlock</C>. <C>boughtInBlock(wallet)</C> is the block it last got coins from the market in. Coins sent by another
        wallet don&apos;t mark the one that gets them, and the market itself is never marked, so it keeps trading with everyone in the same
        block. A sandwich can&apos;t close in the block it opened.
      </P>
      <Fns
        rows={[
          ['addRewards()', 'Anyone, payable', 'Adds ZRO for holders, split by balance. Waits while less than MIN_EARNING (1 token) is held by earning wallets'],
          ['rewardOf(holder)', 'View', 'ZRO this holder can claim now'],
          ['claim()', 'Holder', 'Sends the caller\'s rewards'],
          ['claimFor(holder)', 'Anyone', 'Sends a holder\'s rewards to that holder. Anyone may pay the gas, the money only goes to the holder'],
          ['perShare, earningSupply, waiting, notEarning(addr), claimedBy(addr)', 'View', 'The bookkeeping behind rewardOf'],
        ]}
      />
      <P>
        Not earning: the launchpad, ZroInfinityPools, the dead address, and the Router, LimitOrders, BuybackVault, CopyVault,
        ZroInfinityVenue and Infinity&apos;s Vault, which holds every pool&apos;s tokens. Tokens in those contracts earn nothing, so their
        share goes to people who hold. Errors: <C>BoughtThisBlock</C>, and on a HolderToken <C>NothingToClaim</C> and{' '}
        <C>TransferFailed</C>.
      </P>

      <H2 id="pools">ZroInfinityPools</H2>
      <P>
        The hook of every graduated token&apos;s pool on PancakeSwap Infinity, and the launchpad&apos;s migrator. At graduation it opens a
        ZRO/token pool on Infinity&apos;s CLPoolManager at the price the curve ended on, and puts the 6,000 ZRO and 20% of the supply in as one
        position over the whole price range. It owns that position and has no way to remove it. As the hook it refuses liquidity from anyone
        else and every removal, so the position is the pool&apos;s only liquidity, for good. It doesn&apos;t trade itself: trades come
        through <C>ZroInfinityVenue</C> or straight through Infinity. GPL-2.0-or-later, Ownable and ReentrancyGuard. Rebasing tokens are not
        supported.
      </P>
      <Consts
        rows={[
          ['TICK_SPACING', '200', 'The whole range is one position, so any spacing works. A wide one keeps a swap to few steps'],
          ['LP_FEE', '0', 'No LP fee. The token\'s fee comes through the hook instead'],
          ['BURN_PRICE_STEP', '9,747', 'Of 10,000, on the square-root price: one burn moves the price at most about 5%'],
          ['HOOK_BITMAP', '3,285 (0x0CD5)', 'Bits 0, 2, 4, 6, 7, 10 and 11: beforeInitialize, beforeAddLiquidity, beforeRemoveLiquidity, beforeSwap, afterSwap, and both swap return deltas'],
          ['PROTOCOL_BPS', '40', 'Submarine\'s 0.4% of every pool trade, less the trader\'s rank discount when it comes through ZroInfinityVenue'],
          ['DEAD', '0x…dEaD', 'Where burned tokens go'],
          ['earnersBps(token)', 'feeBps − 40', 'A graduated token\'s fee for its earners on the ZRO side of every trade: the creator\'s 0.6% and the own fee, frozen when its pool opens. At most 1,060. Submarine\'s 0.4% is taken on top'],
          ['burnBps(token)', 'own × burn ÷ (60 + own)', 'Of that fee, the part that buys the token back from its pool and burns it: the launch burn share, restated as a share of the whole earners\' fee'],
        ]}
      />
      <Fns
        rows={[
          ['seed(token, tokenAmount, earnersBps, burnBps)', 'Launchpad only, payable', 'Opens a graduated token\'s pool at the curve\'s last price and puts all of the ZRO and tokens in as the one locked position. The few wei the liquidity maths rounds off stay in this contract'],
          ['distribute(token)', 'Anyone', 'Pays out the fees a pool has collected: the burn share buys the token back from its pool and sends it to the dead address, the rest goes to the launchpad for holders and the creator, and Submarine\'s cut goes to the launchpad\'s payProtocolFromPool. ZroInfinityVenue runs it after each of its trades'],
          ['pools(token)', 'View', '(reserveZro, reserveToken, totalShares): the ZRO and tokens the position is worth at the current price, and its liquidity, for readers built for constant-product pools. Zeros with no pool'],
          ['priceOf(token)', 'View', 'ZRO per whole token, in wei, before any fee. 0 with no pool'],
          ['quoteBuy(token, zroIn) / quoteSell(token, tokensIn)', 'View', 'What a trade would get, after the token\'s whole fee, for a trader without a rank. Exact while the locked position is the only liquidity, which the hook makes sure of, and while Infinity\'s protocol fee is off'],
          ['poolKeyOf(token)', 'View', 'The pool\'s Infinity key: ZRO (native) as currency0, the token as currency1, this hook, fee 0, tick spacing 200. What a wallet or another router needs to trade it on Infinity directly'],
          ['pending(token), pendingProtocol(token)', 'View', 'The earners\' fees and Submarine\'s cut collected and not yet paid out, held as claims on Infinity\'s vault'],
          ['tokenOf(poolId), vault, poolManager, launchpad', 'View', 'Which token a pool id trades, and the wiring'],
          ['beforeInitialize, beforeAddLiquidity, beforeRemoveLiquidity, beforeSwap, afterSwap', 'Pool manager only', 'The hook. Only this contract may open a pool with this hook or add to it, nobody may remove liquidity, and every trade pays the fee and is reported as a Swap'],
          ['lockAcquired(data)', 'Infinity vault only', 'Does the opening deposit and the payouts inside the vault\'s lock'],
          ['setLaunchpad(launchpad)', 'Owner, once', 'Wiring. The only thing the owner can do here'],
        ]}
      />
      <H3>How the fee is taken</H3>
      <P>
        When a trade names its ZRO amount, a buy with exact ZRO in or a sale for exact ZRO out, <C>beforeSwap</C> takes{' '}
        <C>earnersBps</C> plus <C>PROTOCOL_BPS</C> of it. When it names the token amount, <C>afterSwap</C> takes the same of the ZRO the
        swap moved. For a trade through ZroInfinityVenue the hook asks <C>launchpad.router()</C> for <C>currentTrader()</C> and{' '}
        <C>discountOf</C>, and takes the rank discount off Submarine&apos;s part. Either way the fee is recorded as a claim on Infinity&apos;s
        vault (ERC-6909) and added to <C>pending(token)</C> and <C>pendingProtocol(token)</C>, because in the middle of a swap the vault may
        hold less ZRO than the fee. <C>distribute</C> turns the claims into ZRO and pays them out.
      </P>
      <P>
        Infinity never calls a hook for a swap the hook makes itself, so the burns pay no fee and aren&apos;t reported as trades. That is also
        why trades come through a separate venue. A burn buys until the price has moved about 5% (<C>BURN_PRICE_STEP</C>); what it
        can&apos;t spend within that goes to the launchpad with the rest of the fee, for holders and the creator.
      </P>
      <P>
        Errors: <C>NotLaunchpad</C> (a seed from anyone else, or a pool with this hook opened by anyone else), <C>Locked</C> (liquidity added
        by anyone else, or any removal), <C>NotVault</C>, <C>NotPoolManager</C>, <C>PoolExists</C>, <C>ZeroAmount</C>, <C>BadConfig</C>{' '}
        (also every hook callback it didn&apos;t register), <C>NoPool</C>, <C>TransferFailed</C>.
      </P>

      <H2 id="pool-venue">ZroInfinityVenue</H2>
      <P>
        The router&apos;s way into the pools, listed as &quot;Submarine Pools&quot; with a router fee of 0, fixed for good, since the hook
        already takes Submarine&apos;s 0.4%. It buys and sells
        through Infinity&apos;s vault, then runs <C>distribute</C> so the fee is paid out in the same transaction. It is a contract of its own
        because Infinity skips a pool&apos;s hook when the hook itself swaps, and the venue&apos;s trades have to pay the fee like anyone
        else&apos;s. It names the trade&apos;s recipient in the hook data, so the pool&apos;s <C>Swap</C> event shows the trader and not the
        venue. Holds nothing between calls. GPL-2.0-or-later.
      </P>
      <Fns
        rows={[
          ['buy(token, minOut, recipient, deadline)', 'Anyone, payable', 'IVenue. Exact ZRO in. The fee is paid out before the buyer holds the tokens, so nobody earns holder rewards from their own buy. ZRO a swap couldn\'t spend goes back to the recipient'],
          ['sell(token, tokensIn, minOut, recipient, deadline)', 'Anyone', 'IVenue. Exact tokens in. The ZRO goes straight to the recipient, then the fee is paid out'],
          ['quoteBuy / quoteSell', 'View', 'ZroInfinityPools\' quotes'],
          ['vault, poolManager, pools', 'View', 'The wiring, fixed at deployment'],
          ['lockAcquired(data)', 'Infinity vault only', 'Makes the swap inside the vault\'s lock'],
        ]}
      />
      <P>
        Errors: <C>NoPool</C>, <C>Slippage</C>, <C>Expired</C>, <C>ZeroAmount</C>, <C>NotVault</C>, <C>TransferFailed</C>.
      </P>

      <H2 id="infinity">Infinity core</H2>
      <P>
        <C>contracts/lib/infinity-core</C> is PancakeSwap Infinity&apos;s core, unmodified, from pancakeswap/infinity-core-bsc-base at commit
        7c04695, under GPL-2.0-or-later. Submarine deploys two of its contracts on Zero: the <B>Vault</B>, which holds every pool&apos;s ZRO and
        tokens, and the <B>CLPoolManager</B>, which runs the pools and is the only app registered on the vault. Both are owned by
        Submarine&apos;s deployer. What that owner can do is on <L to="risks" at="owner">Risks</L>.
      </P>

      <H2 id="router">Router</H2>
      <P>
        One entry point for every venue. It asks each listed venue for a quote, trades on the best, and passes over a venue that quotes well
        and then fails. It holds nothing between calls and is itself an IVenue.
      </P>
      <Consts
        rows={[
          ['MAX_FEE_BPS', '100', 'A venue\'s router fee is at most 1%'],
          ['MAX_VENUES', '16', 'Venues listed at once'],
          ['LISTING_DELAY', '2 days', 'A new venue waits this long in public after setup'],
          ['QUOTE_GAS', '300,000', 'Gas a venue gets to answer a quote. More reads as no quote'],
          ['REFERRAL_BPS', '4,000', 'Of the router fee on a referred trade, 40% goes to Referrals'],
          ['RANKS', '5', 'Ranks above the first, which every wallet starts at'],
        ]}
      />
      <P>
        The deploy lists the Launchpad and ZroInfinityVenue, both with a router fee of 0, since the curve and the hook each take Submarine&apos;s
        0.4% themselves. A router fee only matters for any other venue listed later.
      </P>
      <H3>Volume ranks</H3>
      <P>
        <C>volumeOf(wallet)</C> is the ZRO a wallet has traded through the router, buys and sales, for good. It never goes down. Trades sent
        straight to a venue or to Infinity don&apos;t count. The marks are fixed in the code:
      </P>
      <Table
        cols={['rank', 'Name', 'From', 'offBps', "Submarine's cut"]}
        numeric={[0, 2, 3, 4]}
        rows={[
          ['0', 'Starter', '0 ZRO', '0', '0.40%'],
          ['1', 'Trader', '2,000 ZRO', '5', '0.35%'],
          ['2', 'Regular', '10,000 ZRO', '10', '0.30%'],
          ['3', 'Pro', '40,000 ZRO', '15', '0.25%'],
          ['4', 'Whale', '200,000 ZRO', '20', '0.20%'],
          ['5', 'Legend', '1,000,000 ZRO', '25', '0.15%'],
        ]}
      />
      <P>
        On the curve and on the pool, the launchpad and the hook take the discount off Submarine&apos;s cut, never more than 40. On any other
        venue it comes off the router&apos;s fee. Volume is added after each trade, so a new rank counts from the next one. The names are the
        site&apos;s; the contract only knows the numbers.
      </P>
      <H3>Functions</H3>
      <Fns
        rows={[
          ['buy(token, minOut, recipient, deadline)', 'Anyone, payable', 'Takes the venue\'s router fee, less the recipient\'s rank discount, from msg.value, buys on the best venue, and checks what really arrived at the recipient against minOut. The trade is the recipient\'s: their volume, rank and referrer'],
          ['sell(token, tokensIn, minOut, recipient, deadline)', 'Anyone', 'Pulls the tokens, sells on the best venue, takes the router fee less the seller\'s discount from the ZRO and sends the rest. The trade is the seller\'s, whoever the recipient is'],
          ['buyFor(token, minOut, recipient, deadline, trader)', 'Forwarders only, payable', 'A buy LimitOrders or CopyVault makes for a user. It counts for trader: volume, rank discount, referrer. Records no activity. Anyone else gets NotForwarder'],
          ['sellFor(token, tokensIn, minOut, recipient, deadline, trader)', 'Forwarders only', 'The same for a sale. The tokens come from the forwarder'],
          ['isForwarder(addr), feeFixed(venue)', 'View', 'True for LimitOrders and CopyVault; true for the venues listed at deployment, whose router fee stays 0'],
          ['volumeOf(wallet)', 'View', 'ZRO traded through here, in wei'],
          ['rankAt(rank)', 'Pure', 'The volume a rank starts at and its discount: (volume, offBps)'],
          ['rankOf(trader), discountOf(trader)', 'View', 'A wallet\'s rank, 0 to 5, and its discount in basis points of a trade'],
          ['bestBuy(token, zroIn) / bestSell(token, tokensIn)', 'View', 'The winning venue\'s index and its quote after the router fee'],
          ['quoteBuy / quoteSell', 'View', 'The best quote anywhere'],
          ['venuesCount(), venueAt(i)', 'View', 'Address, fee and name of each venue'],
          ['activityOf(wallet, token)', 'View', 'A wallet\'s latest buy and sale of a token through here. CopyVault copies from this'],
          ['currentTrader()', 'View', 'Who the trade in progress is for, from transient storage. Zero outside a trade'],
          ['queueVenue, cancelQueuedVenue, listVenue', 'Owner', 'Announce a venue, then list it after LISTING_DELAY'],
          ['setVenueFee(index, feeBps)', 'Owner', 'Another launchpad\'s router fee, capped at 1%. Submarine\'s own curve and pools were listed at deployment with 0 and keep it for good (feeFixed), and can\'t be listed again with a fee'],
          ['setForwarders(list)', 'Owner, once', 'The contracts that may trade in a user\'s name: LimitOrders and CopyVault, set at deployment'],
          ['removeVenue(index)', 'Owner', 'Instant, because it is the emergency action'],
          ['finishSetup()', 'Owner', 'Closes free listing for good'],
        ]}
      />
      <Code
        lang="solidity"
        title="activityOf(wallet, token) returns"
        code={`struct Activity {
    uint40  buyBlock;
    uint40  sellBlock;
    uint16  soldBps;    // share of its holding the latest sale let go
    uint128 buyZro;     // ZRO the latest buy spent, fee included
    uint128 buyTokens;
    uint128 sellZro;    // ZRO the latest sale brought, after the fee
    uint128 sellTokens;
}`}
      />
      <P>
        A buy only counts as activity when the wallet bought for itself (recipient equals sender), so nobody can make a wallet look like it
        bought. Trades made through <C>buyFor</C> and <C>sellFor</C> record no activity, so copy trading only ever follows a leader&apos;s own
        trades. Errors: <C>NoRoute</C>, <C>Expired</C>, <C>Slippage</C>, <C>BadConfig</C>, <C>NotReady</C>, <C>NotForwarder</C>,{' '}
        <C>TransferFailed</C>, <C>StrayZro</C>.
      </P>

      <H2 id="limit-orders">LimitOrders</H2>
      <P>
        Orders that wait for a condition. A buy escrows ZRO, a sale escrows tokens, and every order names the least it must get, which no
        condition overrides. Fills go through the router and anyone may make them. See <L to="orders">Limit orders and automation</L> for the
        trader&apos;s view.
      </P>
      <Consts
        rows={[
          ['feeBps', '0 (max 100)', 'Fee on top of the router\'s. None by default'],
          ['runFee', '0.04 ZRO (max 0.4)', 'Paid to whoever fills, per whole order, shared across its parts'],
          ['MAX_LEGS', '5', 'Legs in one sale group'],
          ['MAX_SLICES', '100', 'Most DCA parts. The least is 2'],
          ['LIMIT, STOP, TRAILING, ON_GRADUATION, ON_DEV_SELL, DCA', '0 to 5', 'Order kinds'],
        ]}
      />
      <Fns
        rows={[
          ['placeBuy(token, minOut, expiry)', 'Anyone, payable', 'A limit buy. msg.value must be more than twice the run fee'],
          ['placeBuyIf(token, minOut, expiry, kind, interval, slices)', 'Anyone, payable', 'LIMIT, ON_GRADUATION or DCA'],
          ['placeSell(token, amount, minOut, expiry)', 'Anyone', 'A limit sale'],
          ['placeSellLegs(token, amount, expiry, legs[])', 'Anyone', 'One escrow, up to 5 ways out. Returns the first leg\'s id'],
          ['fill(id, part)', 'Anyone', 'Fills part of an order, or closes and refunds it if expired. Reverts if the condition or minimum isn\'t met'],
          ['fillBatch(ids[], parts[])', 'Anyone', 'Fills many. One that can\'t fill is skipped'],
          ['poke(ids[])', 'Anyone', 'Raises each trailing stop\'s high to what its tokens would fetch now'],
          ['cancel(id)', 'Owner of the order', 'Refunds what is left. Cancelling a leg ends its whole group'],
          ['withdraw(to)', 'Anyone with credit', 'Sends ZRO the caller\'s wallet refused when an order paid out'],
          ['getOrder(id), available(id), openIds(from, count), ordersCount()', 'View', 'For keepers and the site'],
          ['setConfig(feeBps, runFee)', 'Owner', 'Capped. An open order keeps the fees it was placed under'],
        ]}
      />
      <Code
        lang="solidity"
        title="A leg of a sale group"
        code={`struct Leg {
    uint8   kind;      // LIMIT, STOP, TRAILING, ON_GRADUATION or ON_DEV_SELL
    uint128 share;     // tokens this leg may sell, of the group's
    uint128 minOut;    // least ZRO for the whole share
    uint128 trigger;   // STOP: ZRO for the whole share at which it fires
    uint16  trailBps;  // TRAILING: the drop that fires it. ON_DEV_SELL: share the creator must sell
}`}
      />
      <P>
        The run fee and the minimum both scale with the part being filled, rounded up, so splitting an order into many small fills pays the
        filler no more and never lets a part fill below its share. Errors: <C>Busy</C>, <C>BadOrder</C>, <C>NotYours</C>, <C>NotOpen</C>,{' '}
        <C>NotYet</C>.
      </P>

      <H2 id="copy-vault">CopyVault</H2>
      <P>
        Copy trading that runs with the browser closed. A follower deposits ZRO and sets rules per leader. Anyone may run a copy and earn the
        run fee, but only of a trade the leader really made through the router in the last 30 blocks, and only inside the rules. See{' '}
        <L to="copy-trading">Copy trading</L>.
      </P>
      <Consts
        rows={[
          ['WINDOW', '30 blocks, about 30 seconds at Zero\'s 1 second blocks', 'A copy may run this long after the leader\'s trade'],
          ['RUN_FEE', '0.04 ZRO', 'Paid by the follower to whoever runs a copy or an exit'],
          ['MAX_SLIPPAGE_BPS', '5,000', 'Slippage in a rule or an exit is at most 50%'],
        ]}
      />
      <Code
        lang="solidity"
        title="Rules and Exit"
        code={`struct Rules {
    uint128 perTrade;     // most ZRO one copied buy may spend (must be > 0)
    uint128 perToken;     // most ZRO copied into one token over time
    uint128 perDay;       // most ZRO copied from this leader in a UTC day
    uint16  sizeBps;      // the leader's size times this. 10,000 copies the same size
    uint16  slippageBps;  // from the quote at the moment of copying
    uint16  chaseBps;     // how much worse than the leader's own price it may still go in or out
    uint16  minSellBps;   // a copied sale never fetches less than this share of cost
    bool    buyOnce;      // only the first buy of each token
    bool    copySells;    // sell along with the leader
    uint32  maxAge;       // only tokens younger than this many seconds, 0 for any
}

struct Exit {
    uint16 takeProfitBps; // 5,000 sells everything at +50%. 0 for none
    uint16 stopLossBps;   // 3,000 sells everything at -30%. 0 for none
    uint16 slippageBps;
}`}
      />
      <Fns
        rows={[
          ['deposit()', 'Follower, payable', 'Adds ZRO to the caller\'s balance'],
          ['withdraw(amount, to)', 'Follower', 'Takes ZRO out, at any time'],
          ['follow(leader, rules) / unfollow(leader)', 'Follower', 'Starts, changes or stops copying a leader'],
          ['setExit(exit)', 'Follower', 'Take profit and stop loss over every position'],
          ['sell(token, tokens, minOut)', 'Follower', 'Sells part of the caller\'s own position'],
          ['withdrawTokens(token, tokens, to)', 'Follower', 'Takes tokens out, with their share of the cost'],
          ['copyBuy(follower, leader, token)', 'Anyone', 'Copies the leader\'s latest buy within the rules, and pays the caller the run fee'],
          ['copySell(follower, leader, token)', 'Anyone', 'Sells the share the leader sold, if copySells is on'],
          ['exit(follower, token)', 'Anyone', 'Sells the whole position once take profit or stop loss is reached'],
          ['collectRunnerCredit(to)', 'Runner', 'Run fees a runner\'s address refused when they were paid'],
          ['balanceOf(f), positions(f, token), copied(f, leader, token), exits(f), followOf(f, leader), runnerCredit(r)', 'View', 'Everything above, readable'],
        ]}
      />
      <P>
        Errors: <C>BadRules</C>, <C>NotFollowing</C>, <C>NothingToCopy</C>, <C>NotYet</C>, <C>TooLittle</C>, <C>TransferFailed</C>,{' '}
        <C>StrayZro</C>.
      </P>

      <H2 id="buyback-vault">BuybackVault</H2>
      <P>
        The treasury. Every Submarine fee lands here and the only way out is buying one token and sending it to the dead address. There is no
        withdraw function for anyone.
      </P>
      <Consts
        rows={[
          ['MAX_SPEND_BPS', '1,000', 'A buyback spends at most 10% of the balance'],
          ['MIN_INTERVAL', '1 hour', 'Between buybacks'],
        ]}
      />
      <Fns
        rows={[
          ['buyback(zroAmount, minOut)', 'Keeper or owner', 'Buys buybackToken through the router and sends it to the dead address'],
          ['setBuybackToken(token)', 'Owner, once', 'The one token it may ever buy. Until set, fees only accumulate'],
          ['setRouter(router)', 'Owner, once', 'Wiring'],
          ['setKeeper(keeper)', 'Owner', 'Who may run buybacks'],
          ['buybackToken, keeper, lastBuyback, totalSpent, totalBurned', 'View', 'State'],
        ]}
      />
      <P>
        Errors: <C>NotKeeper</C>, <C>BadConfig</C>, <C>AlreadySet</C>, <C>NoToken</C>, <C>TooSoon</C>, <C>TooMuch</C>.
      </P>

      <H2 id="referrals">Referrals</H2>
      <P>Who brought whom. Nothing in it can be changed by anyone, and it only holds what it was sent to pay out.</P>
      <Consts rows={[['REFERRER_BPS', '7,500', 'Of each credit, 75% to the referrer and 25% back to the trader']]} />
      <Fns
        rows={[
          ['link(referrer)', 'Trader, once', 'Links the caller for good. Not to themselves, and not to someone they referred'],
          ['credit(trader)', 'Anyone, payable', 'Splits what is sent between the trader\'s referrer and the trader'],
          ['claim()', 'Anyone with earnings', 'Sends the caller\'s earnings'],
          ['referrerOf(t), earned(a), referredCount(a)', 'View', 'State'],
        ]}
      />
      <P>
        Errors: <C>BadReferrer</C>, <C>AlreadyLinked</C>, <C>NothingToClaim</C>, <C>TransferFailed</C>.
      </P>

      <H2 id="exit-probe">ExitProbe</H2>
      <P>
        Never deployed. The site hands this contract&apos;s code to the node for a single <C>eth_call</C>, which buys through the router and
        sells straight back, to learn what a sale right after a buy would return. A token that taxes or refuses a sale shows up before anyone
        has spent anything. It is used for other launchpads&apos; tokens. A token launched on Submarine holds bought coins for one block, so the
        probe would always fail on it; for those the site works the round trip out from their fees instead.
      </P>
      <Code
        lang="solidity"
        code={`function probe(address venue, bytes calldata buyData, address token, bytes calldata sellHead, bytes calldata sellTail)
    external payable returns (uint256 bought, uint256 back, bool sold);`}
      />
      <Note title="Source of truth.">
        This page is written from <C>contracts/src</C>. Where it and the code disagree, the code wins. The events each contract emits are on{' '}
        <L to="events">Events to index</L>.
      </Note>
    </Doc>
  );
}
