# Submarine

A trading terminal and token launchpad for [Zero](https://layerzero.network/zero), LayerZero's chain. Tokens launch on a bonding curve and move to a PancakeSwap Infinity pool when it fills. Tokens from Submarine and other launchpads trade through one router, with limit orders, stop losses, DCA, copy trading and agent vaults that fill on chain.

Submarine is not deployed on Zero yet. Until Zero's network details are public it runs on a local chain.

Website: https://submarine.live. Documentation: https://submarine.live/docs.

## Repository structure

```
contracts/      Solidity contracts, Foundry tests and the deploy script
indexer/        Reads the chain, serves the public REST API and a live event stream
keeper/         Fills orders and runs copies for anyone; permissionless
web/            The terminal (Next.js) and the documentation pages
mcp/            MCP server for AI agents: market data, quotes, trading through an agent vault
alerts/         Telegram alerts bot
launchpads/     One JSON file per outside launchpad the indexer and router understand
scripts/        Local demo, deployment and launchpad tools
```

## Contracts

| Contract | Role |
|---|---|
| `core/Launchpad.sol` | Bonding curve launches, the token's fee split and holder rewards |
| `core/TokenFactory.sol` | Deploys launch tokens for the launchpad |
| `core/ZroInfinityPools.sol` | PancakeSwap Infinity hook that opens a token's pool at graduation, locks its liquidity and takes the token's fee inside every swap |
| `periphery/ZroInfinityVenue.sol` | The router's venue for those pools |
| `periphery/Router.sol` | Quotes every listed venue and trades on the best |
| `periphery/LimitOrders.sol` | Limit orders, stop losses, trailing stops, orders on events and DCA |
| `periphery/CopyVault.sol` | Copy trading within limits the follower sets |
| `periphery/AgentVault.sol` | A vault its owner funds for an AI agent; the agent trades within limits, only the owner withdraws |
| `periphery/Referrals.sol` | Referral shares of the terminal's fee |
| `periphery/ExitProbe.sol` | Never deployed; run in an `eth_call` to test that a token can be sold |
| `fees/BuybackVault.sol` | Treasury that can only buy back and burn one token |

Every function, event and error is described on the [contract reference](https://submarine.live/docs/reference) page.

## Getting started

Requires Node.js and [Foundry](https://book.getfoundry.sh).

```sh
npm install
forge build --root contracts
forge test --root contracts
```

To run the whole stack on a local chain with demo data (Windows PowerShell):

```powershell
powershell -ExecutionPolicy Bypass -File scripts\dev-local.ps1
```

Then open http://localhost:3000. Stop it with `scripts\stop-local.ps1`.

## Security

The contracts have had four independent reviews. Every finding that was fixed has a regression test in `contracts/test/Audit*.t.sol`. These reviews are not a formal audit: do not put real money through the contracts until they have one. What the owner can and cannot do is set out on the [risks](https://submarine.live/docs/risks) page.

## License

No license is granted for the repository as a whole: you may read it, and all other rights are reserved. Files with an SPDX header are under that license (MIT or GPL-2.0-or-later). `contracts/lib` keeps its upstream licenses, including PancakeSwap Infinity's core under GPL-2.0-or-later, which is why the files that import it are GPL-2.0-or-later too.
