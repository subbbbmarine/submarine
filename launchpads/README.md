# Launchpads

One JSON file here is one launchpad. That file is all it takes: the indexer follows its tokens and trades, reads its past on the next start, and the site offers it on the Launch page and trades its tokens, with no new build of anything.

## Adding one

```
node scripts/launchpad.mjs add 0xTheirContract "Their Name"
```

This reads what the contract has done on the chain, looks its functions and events up by their signatures, and writes a draft. If they published an ABI, `--abi file.json` is better. Then it says what it couldn't work out. Fix those lines, then check it:

```
node scripts/launchpad.mjs check their-name
```

That reads the file against the chain without spending anything. `--real` also launches, buys and sells for tiny amounts from the test wallet, and confirms each event reads the way the file says.

To put it live, run this. It copies these files and restarts the indexer, in seconds:

```
powershell -ExecutionPolicy Bypass -File scripts\deploy-server.ps1 -LaunchpadsOnly
```

To see what isn't connected yet, Stats lists every contract that has minted two or more tokens without a file here. To remove one, delete its file: its tokens stay as outside tokens.

## The file

`sample.json` is a complete example. Only `id`, `name`, `chainId` and `contract` are required, and the rest is what it enables:

| Part | What it enables | Without it |
| --- | --- | --- |
| `events` | Prices, charts, trades, raised amount, the end of its curve | Its tokens are listed by name, holders only |
| `launch` | The choice on the Launch page | It isn't offered there |
| `buy`, `sell` | Trading from here | The token page shows no trade card |
| `quoteBuy`, `quoteSell` | The "you get about" figure and slippage protection | Trades go with no minimum, so include them if at all possible |
| `curve.target` | The progress bar | No bar |
| `curve.startCap`, `curve.supply` | The market cap at launch, in ZRO, and price in the Launch preview | It says "Not known" |

**Calls.** `function` is the signature in plain Solidity, and `args` lists its arguments in order. These fields are filled in when the call is made, and anything else is sent as written:

| Field | Meaning |
| --- | --- |
| `{name}` `{symbol}` | From the Launch form |
| `{uri}` | The address of the picture, description and links saved for the token. Use this if its field holds metadata, and name that field as `uri` on its `created` event so they show here |
| `{image}` `{description}` | The picture's address and the description on their own, for a launchpad with separate fields |
| `{firstBuy}` | The first buy in wei. What's sent with a launch is this plus `launch.fee` |
| `{token}` | The token traded |
| `{zro}` `{amount}` | ZRO in on a buy, tokens in on a sale. `{amount}` is the input on quotes |
| `{minOut}` | The least accepted, from the quote and the slippage setting |
| `{to}` | The wallet trading |
| `{deadline}` | A timestamp two minutes from now |

`launch.fields` is which form fields to show. `launch.fee` is a ZRO amount as a string, or `{"read": "function launchFee() view returns (uint256)"}`. `output` on a quote is which return value is the amount, when there are several. `sell.spender` is who the tokens are approved to, if that isn't `contract`.

**Events.** `event` is the signature, and the rest name which of its fields means what. A launchpad has either `buy` and `sell`, or one `trade` with an `isBuy` field.

| Key | Means |
| --- | --- |
| `token` | The token. Required on every event |
| `trader`, `zro`, `tokens` | Who traded and the amounts. Required on trades |
| `raised` | ZRO in its curve after this trade |
| `reserveZro`, `reserveToken` | Its reserves after the trade, which give the true price. Without them the price is what this trade paid per token |
| `creator`, `uri` | On `created` |

`graduated` is the event that ends its curve. After it the token shows as finished and can't be traded from here, since it has moved somewhere we don't know.

`notHolders` lists other contracts of theirs that hold tokens, so they aren't counted as holders. `startBlock` is where to read its past from, which saves time on a launchpad much newer than our own deployment. `test: true` labels it as made for trying things out.

## What it can't do

- A launchpad that needs something off the chain to launch, such as a signature from its own server, needs more than a file.
- A launchpad's tokens don't get limit orders, since those trade through our router, which lists a small number of venues after a public delay.
- We take no fee on these trades, because the wallet talks to their contract directly.
