# Submarine

A trading terminal and token launchpad for Zero, LayerZero's chain. One screen for everything that launches and trades on Zero: a feed of every token on the chain, its own launchpad, one-click trading, limit orders with partial fills and a heatmap, following and copying wallets, protocol stats, and a confirmation card timed live in milliseconds.

Zero's native coin, ZRO, pays for gas, trading and fees. Zero's mainnet is scheduled for November 30, 2026. Its chain ID, RPC and explorer are not public yet, and there is no public testnet RPC, so Submarine is not deployed on Zero yet. Until then it runs on a local chain.

Site: https://submarine.live. Docs: https://submarine.live/docs.

## Run it locally

Needs Node and Foundry. From the repository's folder, this starts a throwaway chain with demo data, the indexer, the keeper and the web app:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\dev-local.ps1
```

Then open http://localhost:3000, press **Create wallet**, and get test ZRO on the Portfolio page. Stop with:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\stop-local.ps1
```

The local chain id is 31337. The UI labels it as test data.

## What's here

| Part | What it does |
|---|---|
| `contracts/src/core/Launchpad.sol` | Bonding curve: a fixed supply of the creator's choosing, opening at a 1,875 ZRO market cap, 80% sold for 6,000 ZRO, then the rest seeds a pool at the same price, at a 30,000 ZRO market cap, with the liquidity locked for good. Every token pays a fixed 1% base; the creator can add up to 10% of their own on top, choose who earns that (holders, a buyback, themselves or a split) and turn on anti-snipe. Coins bought from the curve or pool can't move until the next block. `HolderToken`, in the same file, pays its holders |
| `contracts/src/core/ZroInfinityPools.sol` | Where graduated tokens trade: a ZRO/token pool on PancakeSwap Infinity per token, with this contract as the hook. It opens the pool at the curve's last price with the 6,000 ZRO and 20% of supply as one position over the whole range that nobody can remove, refuses anyone else's liquidity, and charges the token's fee on every trade, whoever makes it: the terminal's 0.4%, paid through the launchpad, and the rest for its creator, holders and burn. No LP fee. GPL-2.0-or-later |
| `contracts/src/periphery/ZroInfinityVenue.sol` | The router's venue for those pools, listed as "Submarine Pools" with a router fee of 0, fixed for good, since the hook already takes the terminal's cut: trades through Infinity's vault, then pays out the fee the hook collected. Separate from the hook because Infinity doesn't call a hook for swaps it makes itself. GPL-2.0-or-later |
| `contracts/lib/infinity-core` | PancakeSwap Infinity's core (Vault and CLPoolManager), unmodified, from pancakeswap/infinity-core-bsc-base at commit 7c04695. GPL-2.0-or-later. Submarine deploys its own copy on Zero |
| `contracts/src/periphery/Router.sol` | Quotes every listed venue and trades on the best. Another launchpad joins through a small `IVenue` adapter |
| `contracts/src/periphery/LimitOrders.sol` | Orders that wait for a condition: limits, stop losses, trailing stops, selling or buying when a token moves to its pool, selling when its creator sells, and DCA. Sale legs can share one escrow, so take profit and stop loss cover the same tokens. Ported from Prorata, trading through the router so they survive graduation |
| `contracts/src/periphery/CopyVault.sol` | Copy trading that runs with the browser closed. Followers deposit ZRO and set limits; anyone may run a copy, but only of a leader's real router trade in the last 30 blocks and only inside those limits |
| `contracts/src/periphery/Referrals.sol` | Who brought whom. 40% of the treasury's cut of a referred trader's trades goes here: three quarters to the referrer, one quarter back to the trader |
| `contracts/src/periphery/ExitProbe.sol` | Never deployed. Submarine hands its code to the node for one `eth_call`, to test what selling right after buying would bring back |
| `contracts/src/fees/BuybackVault.sol` | Treasury. The only way out is buying one token, set once, and burning it, capped at 10% of the balance per hour |
| `indexer/` | Follows the chain and finds every new ERC-20 by its mint, whoever launched it. REST API, points and a live event stream |
| `keeper/` | Fills orders whose condition has come, raises trailing stops' highs, runs copies and copy exits. Permissionless, so it's a convenience and not a trusted party |
| `alerts/` | Telegram bot: trades by watched wallets, several of them buying together, market cap alerts, order fills. Needs a token from BotFather in `alerts.env` on the server |
| `mcp/` | Read-only MCP server for AI agents: market data and on-chain quotes |
| `web/` | The site: Pulse with risk filters, token pages with labelled holders, top traders, first 70 buyers, a holders map and safety, automation orders, copy trading, referrals, volume ranks and points, several wallets with a PIN lock or MetaMask, browser alerts, radar, multichart, chart lines and indicators, the public API page and the docs at `/docs` |

Fees: every token launched on Submarine pays a fixed 1% base, 0.4% to the terminal and 0.6% to its creator, on the curve and on its Infinity pool, through the terminal or not. The creator may add up to 10% of their own on top, split between themselves, the holders and a buyback. On other venues the terminal's 0.4% is a router fee. Volume through the router counts for good and ranks a wallet up at 2,000 / 10,000 / 40,000 / 200,000 / 1,000,000 ZRO, each rank taking 0.05% more off the terminal's cut, down to 0.15%. Coins bought from our curve or pool can't move until the next block, so a sandwich can't close in the block it opened. The launch fee is 0 and can never be set above 40 ZRO. Limit orders and copy-vault copies pay a run fee of 0.04 ZRO to whoever runs them; the owner can raise the limit order one to at most 0.4 ZRO for new orders.

## Tests

```powershell
forge test --root contracts
```

The tests include fuzzing that the curve can always pay every seller and that it never hands out more than its supply.

An independent review on 2026-11-06 attacked these contracts with working exploits, and the fixes carry regression tests:

- Keepers could cut a limit order into many tiny fills and take the run fee on each, up to 99% of the order. The fee is now one per order, split across its parts.
- A keeper or owner could drain the treasury by buying a token they control, or by repointing its router. The token and router are now each set once, spending is capped per round, and the treasury address can't be changed anywhere.
- One broken venue could stop all routing. A venue that fails to quote or to deliver is now skipped.
- New venues now have to wait out a public 2 day delay after setup.
- Also fixed: fees charged on refunded coin, an order owner burning gas to kill a batch, and stray coin getting stranded.

Accepted: tokens that rebase aren't supported in pools or limit orders, and a keeper can still buy back at a poor moment, which the per-round cap limits. Without more settings the deploy script makes one key the owner and the keeper. Set `OWNER` to a multisig and `KEEPER` to a separate key before real money: every contract's ownership then goes to the multisig, the Infinity Vault and CLPoolManager included (their owner can pause every pool's trading, name a protocol-fee controller that may then take up to 0.4% of each swap, and register apps on the vault). Launchpad, Router, LimitOrders, BuybackVault and the Infinity Vault wait for the multisig to call `acceptOwnership`. The buyback token is set once, by the owner, after launch: until then the treasury's fees wait in BuybackVault.

A second review on 2026-11-07 found more. Fixed in the contracts, with tests in `contracts/test/Audit.t.sol`:

- An order whose owner's wallet refuses ZRO used to be stuck for good, since cancelling paid that wallet and reverted. Now the order closes and the ZRO waits in `credit`, which the owner sends anywhere with `withdraw`. A keeper sending too little gas can't push an ordinary owner's payment there: the fill reverts instead.
- Raising the limit order fees used to stop open orders clearing. Each order now keeps the fees it was placed under.
- Raising the treasury's cut used to shrink what earlier tokens' earners got, down to nothing on their pool. Each token now keeps the cut it launched under.
- Money sent for a token the launchpad never launched is refused rather than stranded. Nothing reaches that today.

A third review on 2026-11-10, with tests in `contracts/test/Audit3.t.sol`:

- A wallet's key was stored open in the browser until its owner chose a PIN. Now a PIN comes first, before a wallet is made or added, and keys are only ever stored encrypted with it.
- A tiny file could open into a huge picture. The indexer now reads a picture's size from its header and refuses anything over 4096 pixels a side, and caps what one address saves in an hour.
- Fetching another terminal's metadata could reach addresses inside the server's network. It now connects only to public addresses, checked on the connection itself, with no redirects and a size cap.
- On a pool, a referrer could be credited with fees from other people's trades, or miss their own. Each trade through the venue now carries only its own cut.
- A sale could name the router as its recipient and leave the ZRO stuck there. That is refused now.

**These reviews are not an audit. Don't put real money through these contracts until they've had one.**

## Design

Graphite and grey, in soft rounded panels. Turquoise is for acting and for what is selected. Green and red appear only on the direction of a number.

A bar along the top is the way around. The trading screen has three columns: a list on the left, the chart in the middle, buying on the right. You can drag the edges between them and double click to reset. Everything aims to be understood at a glance and to move smoothly:

- **No page changes.** Picking a token swaps the data in place, the list keeps its scroll and the chart redraws, while the address bar still gets a shareable link.
- **Market cap by default.** The chart and limit orders work in market cap, because 5,000 ZRO reads better than 0.000005. Price is one click away, as are the line and eight candle sizes from 1 second to 1 day.
- **A chart you can move.** Our own canvas. Wheel zooms around the pointer, dragging pans, and dragging the price scale, the time axis or the left edge stretches that side. Volume sits at the foot and reads its amount on hover. A candle's figures come up only with the pointer on the candle; anywhere else there's just the crosshair. Double click fits again.
- **Who did what.** B, S, T and Burn mark the creator's moves on the candle they happened in, with figures on hover. Your trades, your entry, your open orders and the wallets you follow are on the chart too.
- **Limit orders like an exchange.** They fill in parts as far as their level allows. A level means the market's price: what an order asks for already allows for the trade fee and the fee to whoever fills it, so it fills when the market gets there. Portfolio shows how much of each has filled, at what average, every fill, and how the finished ones ended. Click a level on the price scale to start one.
- **Heatmap.** What has waited at each level and for how long, buys in green and sales in red, brighter the more ZRO, in soft light with no hard ends. Trails keep the time, Clouds melt orders into zones, Beams show only what waits now. Point at a band and it lights up and says what it is. It covers limit orders in Submarine's contract, not the liquidity in a curve or pool.
- **Following wallets.** Click a wallet anywhere for its record beside the chart. Follow it and name it, and its trades come in under Tracked, one click from copying. They pop up on any page. Copying on its own is off until switched on per wallet, runs only while a tab is open, and only one tab at a time. It has a daily limit, ignores trades over a minute old, buys a token at most once a minute, and skips a token if a test sale reverts or loses 15%.
- **The dev, up front.** What the creator and the wallets it sent coins to hold and have sold, how many others bought in the launch block, and how its other tokens went. Linked only means coins sent straight from the dev, so wallets funded some other way look like anyone else.
- **Sell right after.** Before a buy, the trade card shows what selling straight away would bring back, tried on the chain with nothing spent. It reads "Not tested" if the node doesn't take state overrides.
- **Token list.** Volume and liquidity on every row beside the cap, more columns when the list is wide, and a click on a heading sorts by it. A second list can sit beside the first, each with its own filter or showing Feed, Leaders or Tracked instead.
- **Share card.** A picture of a trade to post: the return, what went in, what it's worth or what came out, over a full-card photo. There are ten free ones from Unsplash, listed in `docs/card-photos/SOURCES.md`, and a loss gets a red one unless you choose. The token's own chart or your own picture work too. It's drawn in the browser and goes nowhere unless you post or save it. On positions, closed trades and sales.
- **Stats.** Revenue, creator fees, volume, launches, moves to pools, traders, the treasury and limit orders, for 24 hours, 7 days, 30 days or all time, with the period before to compare. Every figure comes from contract events the indexer saw. A launch fee, off by default, isn't counted in revenue.
- **Rows glide.** When the order changes, rows slide to their new places instead of jumping.
- **Keyboard.** Up and down or J and K pick a token, B buys at your quick size, 1 to 4 pick that size (5, 50, 200 or 500 ZRO), S sells half, Shift S sells everything, slash searches.
- **Confirmation card.** Each trade shows its steps, sent, in a block and executed, with times measured in the browser.
- **Leaders, profiles and stars.** A ranking by profit and a page for every wallet with a trading calendar. Follows and stars stay in the browser, with no account.
- **Dollars or ZRO.** Amounts show in either, using a public ZRO price for display only. Every trade settles in ZRO.

Demo tokens use placeholder pictures from a public avatar service. A token with no picture gets a generated pattern from its address.

Type is IBM Plex Sans, with tabular figures.

## Licence

No licence is granted for the repository as a whole: you may read it, and all other rights are reserved. Files that carry their own SPDX header are under that licence (GPL-2.0-or-later or MIT), and everything in `contracts/lib` keeps its upstream licence.

## Credits

Pools run on PancakeSwap Infinity's core (GPL-2.0-or-later), in `contracts/lib/infinity-core`, so the files that import it are GPL-2.0-or-later too. Not Uniswap v4: its core is under the Business Source License until 2027-06-15, and running it in production before then needs a grant from Uniswap governance.

## Status

Works on any EVM node, and on the local chain from `dev-local.ps1`: launching, trading, graduation, routing, limit orders, indexing, portfolio.

Not done yet, because Zero's network details aren't public:

- Deploying the contracts on Zero. The addresses go in `contracts/deployments/<chainId>.json`, which the indexer, the keeper and the site all read, and on the docs' Contract addresses page.
- Setting Zero's chain ID and RPC for the site, the indexer, the keeper and the MCP server.
- How ZRO gets onto Zero, for the docs' Getting started page.

**Other launchpads** are one JSON file each in `launchpads/`, read by the indexer and served to the site, so adding one needs no new build. `node scripts/launchpad.mjs add 0x... "Name" --abi file.json` writes the file and `check <id> --real` proves it with tiny real trades. See `launchpads/README.md`. `contracts/test/SamplePad.sol` is a stand-in with different names, events, supply and curve to try it against. A launchpad with an unusual design may need more than a file: a launch that needs a signature from its own server can't be described in one.

The main indexer finds every token on the chain, so it lists tokens from a test deployment as outside tokens.
