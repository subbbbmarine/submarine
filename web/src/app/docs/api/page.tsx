import type { ReactNode } from 'react';
import { B, C, Code, Doc, H2, H3, L, Note, P, Stats, Table } from '../_ui/doc';
import { SUBMARINE_API } from '../_ui/deployment';
import { docMeta } from '../_ui/pages';

export const metadata = docMeta('api');

type R = { m?: 'GET' | 'POST'; path: string; q?: string; what: ReactNode };

function Routes({ rows }: { rows: R[] }) {
  return (
    <div className="mt-4 divide-y divide-white/[.06] rounded-xl border border-white/[.06]">
      {rows.map((r) => (
        <div key={(r.m ?? 'GET') + r.path} className="px-3.5 py-3">
          <p className="num break-all text-[13px]">
            <span className={`mr-2 rounded px-1.5 py-0.5 text-[11px] font-semibold ${r.m === 'POST' ? 'bg-up/15 text-up' : 'bg-accent/15 text-accent'}`}>{r.m ?? 'GET'}</span>
            <span className="text-ink">{r.path}</span>
          </p>
          {r.q && <p className="num mt-1 break-all text-[12px] text-faint">{r.q}</p>}
          <p className="mt-1 text-[14px] leading-relaxed text-muted">{r.what}</p>
        </div>
      ))}
    </div>
  );
}

export default function Page() {
  return (
    <Doc
      slug="api"
      lead={
        <>
          Everything Submarine shows comes from this API, and anyone can use it. There is no key. Answers are JSON, amounts are plain numbers
          in ZRO and whole tokens, and times are Unix seconds.
        </>
      }
      toc={[
        ['basics', 'The basics'],
        ['token-card', 'A token card'],
        ['tokens', 'Tokens'],
        ['token-analysis', 'One token in depth'],
        ['discovery', 'Discovery'],
        ['wallets', 'Wallets and orders'],
        ['market', 'Market and protocol'],
        ['profiles', 'Profiles and metadata'],
        ['stream', 'The live stream'],
        ['limits', 'Limits'],
      ]}
    >
      <H2 id="basics">The basics</H2>
      <Stats
        items={[
          ['Base URL', 'See below', 'The same host the site uses'],
          ['Auth', 'None', 'Every route is public'],
          ['Live data', 'SSE', 'One stream instead of polling'],
        ]}
      />
      <Code lang="text" title="Base URL" code={SUBMARINE_API} />
      <P>The API&apos;s address is filled in at launch, once Submarine is deployed on Zero.</P>
      <Code
        lang="bash"
        code={`curl "${SUBMARINE_API}/api/v1/tokens?sort=volume&limit=2"`}
      />
      <Code
        lang="json"
        title="Answer, trimmed"
        code={`{
  "tokens": [
    {
      "address": "0x…",
      "name": "Example",
      "symbol": "EXM",
      "source": "terminal",
      "price": 0.0000075,
      "market_cap": 7500,
      "raised": 2000.0,
      "progress": 0.333,
      "graduated": false,
      "holders": 41,
      "volume_24h": 4960,
      "change_24h": 0.18,
      …
    }
  ]
}`}
      />
      <P>
        Addresses can be sent in any case and come back lowercased. A route that takes a list of addresses reads at most 200 of them. A
        missing token answers <C>404</C>, a malformed address <C>400</C>.
      </P>

      <H2 id="token-card">A token card</H2>
      <P>Every list of tokens uses the same shape, so a card built for one route works for all of them.</P>
      <Table
        cols={['Field', 'Type', 'What it is']}
        rows={[
          [<C key="a">address, name, symbol, uri</C>, 'string', 'The token. uri is its metadata link, see /meta'],
          [<C key="b">source</C>, 'string', 'terminal for Submarine\'s own launchpad, external for anything else found on the chain'],
          [<C key="c">launchpad</C>, 'string | null', 'Which connected launchpad, for an external token'],
          [<C key="d">creator, created_at, block</C>, '', 'Who made it and when'],
          [<C key="e">price</C>, 'number', 'ZRO per whole token, at the last trade'],
          [<C key="f">market_cap</C>, 'number', 'price × total_supply, in ZRO'],
          [<C key="g">raised, progress</C>, 'number', 'ZRO in the curve, and raised over the target (6,000 ZRO here), from 0 to 1'],
          [<C key="h">graduated, has_pool, tradable</C>, 'boolean', 'Moved to a pool; has a Submarine pool, which only graduation opens; can be traded from Submarine'],
          [<C key="i">fee_bps, holders_bps, burn_bps, anti_snipe</C>, '', 'The token\'s terms. fee_route is holders when holders_bps is above 0, else creator'],
          [<C key="j">holders, volume_24h, trades_24h, change_24h</C>, 'number', 'Holders now, and the last 24 hours. change_24h is a fraction: 0.18 is +18%'],
          [<C key="k">links</C>, 'object | null', 'website, twitter, telegram, discord'],
        ]}
      />

      <H2 id="tokens">Tokens</H2>
      <Routes
        rows={[
          { path: '/api/v1/tokens', q: '?sort=new|volume|progress|mcap|active &stage=curve|graduating|graduated|external &launchpad=<id>|terminal &q= &creator= &addresses=a,b &limit=50 (max 500) &offset=', what: 'Lists tokens. graduating is a curve token that has raised at least a quarter of the target.' },
          { path: '/api/v1/tokens/:address', what: 'One token card, plus change_5m, change_1h, change_6h, buys_24h, sells_24h, buy_volume_24h, sell_volume_24h, and what its fee has paid: creator_earned, holders_earned, burned_zro, burned_tokens and their sum earner_fees.' },
          { path: '/api/v1/tokens/:address/trades', q: '?limit=50 (max 1000) &trader=<address> | &traders=a,b', what: 'Latest trades, newest first. Each has tx_hash, ts, trader, is_buy, zro, amount, price and venue.' },
          { path: '/api/v1/tokens/:address/candles', q: '?interval=1|5|60|300|900|3600|14400|86400 &before=<unix> &limit=300 (max 4000)', what: 'Candles t, o, h, l, c, v, oldest first. interval is in seconds, 60 if not given. Use before to page back through history.' },
          { path: '/api/v1/tokens/:address/holders', q: '?limit=20', what: 'Holders and amounts, biggest first.' },
          { path: '/api/v1/tokens/:address/viewers', q: '?id=<page id>', what: 'How many pages have this token open. A page that sends an id counts for 50 seconds; the site checks in every 20.' },
        ]}
      />

      <H2 id="token-analysis">One token in depth</H2>
      <Routes
        rows={[
          { path: '/api/v1/tokens/:address/holders/labelled', q: '?limit=100 (max 200)', what: 'Holders with share, profit and labels: dev, insider, sniper, bundle, whale, top10, fresh, smart, bot, cluster. The glossary says what each means.' },
          { path: '/api/v1/tokens/:address/traders', q: '?limit=50 (max 200)', what: 'Everyone who traded it, with what they put in, took out and still hold.' },
          { path: '/api/v1/tokens/:address/first-buyers', what: 'The first 70 buyers in order, and what each has done since.' },
          { path: '/api/v1/tokens/:address/clusters', what: 'The holders map: wallets, the transfers between them, and linked groups.' },
          { path: '/api/v1/tokens/:address/risk', what: 'Shares held by the dev, the top 10, snipers, bundles and insiders, smart holders, and ath, the highest price.' },
          { path: '/api/v1/tokens/:address/security', what: 'For our tokens: no owner, not mintable, pool liquidity locked for good once graduated (lp_burned). For others: the owner() if any, and whether it is renounced.' },
          { path: '/api/v1/tokens/:address/dev', what: 'The creator: every buy, sale, transfer and burn, what they hold and sold, wallets they sent coins to, how many bought in the launch block, and their other launches.' },
          { path: '/api/v1/tokens/:address/orderbook', what: 'Up to 500 limit orders on it with what was resting at each moment, for the heatmap. Orders waiting on an event have no level and are left out.' },
        ]}
      />

      <H2 id="discovery">Discovery</H2>
      <Routes
        rows={[
          {
            path: '/api/v1/pulse/new | near | migrated',
            q: '?min_age &max_age (s) &min_mcap &max_mcap &min_volume (ZRO) &min_holders &max_holders &min_progress &max_progress &max_dev &max_top10 &max_snipers &max_bundles &max_insiders (0 to 1) &min_smart &socials=1 &launchpad= &limit=60 (max 150)',
            what: 'Pulse\'s three columns: new launches, those 40% or more along their curve, and those that reached a pool. Every filter is optional. Each card carries its risk figures.',
          },
          { path: '/api/v1/trending', q: '?window=1m|5m|1h|6h|24h &sort=volume|change|trades', what: 'Up to 50 tokens moving in the window, with window_volume, window_trades, window_buyers and window_change.' },
          { path: '/api/v1/radar', q: '?tokens=a,b,c (up to 10)', what: 'Wallets early on several of the given tokens. With none given, today\'s five busiest.' },
          { path: '/api/v1/search', q: '?q=', what: 'Up to 8 tokens by name, ticker or address, and up to 5 wallets by address or its first four characters after 0x.' },
          { path: '/api/v1/launchpads', what: 'Every launchpad Submarine works with: its own first, then one per file in launchpads/.' },
          { path: '/api/v1/launchpads/stats', what: 'Tokens, graduations and 24 hour volume per launchpad, and contracts minting tokens that nobody has connected yet.' },
        ]}
      />

      <H2 id="wallets">Wallets and orders</H2>
      <Routes
        rows={[
          { path: '/api/v1/wallet/:address', what: 'Holdings with cost, the latest 50 trades, totals, tokens it launched, up to 100 closed positions, its stats, how many orders it has open, and tokens that pay it holder rewards.' },
          { path: '/api/v1/wallet/:address/trades', q: '?limit=5000 (max 20000)', what: 'Its whole history in a compact form: ts, token, is_buy, zro, amount.' },
          { path: '/api/v1/wallet/:address/record', q: '?days=7|30', what: 'Profit, win rate, holding time, buy sizes and flags such as selling within 10 seconds of buying.' },
          { path: '/api/v1/wallets', q: '?addresses=a,b', what: 'Stats for many wallets in one call.' },
          { path: '/api/v1/inflow', q: '?wallets=a,b &window=1m|5m|1h|6h|24h', what: 'What a list of wallets put into each token over the window.' },
          { path: '/api/v1/leaderboard', q: '?window=24h|7d (all time if not given) &limit=50', what: 'Traders by profit marked to the current price, with volume, trades, tokens and wins.' },
          { path: '/api/v1/orders', q: '?owner= &token= &open=1|0', what: 'Up to 200 orders with kind, limit_price, size_zro, left_zro, filled_share and status: open, partial, filled, cancelled, expired, or unfilled_expired (past its time and still holding funds).' },
          { path: '/api/v1/orders/:id/fills', what: 'Each fill of an order: tx_hash, ts, zro, tokens and the keeper that made it.' },
          { path: '/api/v1/vault/:address', what: 'A follower\'s copy vault: who they follow and with what rules, their exits, positions, history, and a balance estimate from events. The contract\'s balanceOf is the real figure.' },
          { path: '/api/v1/referrals/:address', what: 'referrer, referred, active_traders, from_referrals, cashback, earned, claimed and unclaimed.' },
          { path: '/api/v1/points/rules', what: 'The points rules: perZroTraded, perZroOnYourCoins, perZroElsewhere and minVolume, in ZRO.' },
          { path: '/api/v1/points/leaders', q: '?limit=50 (max 200)', what: 'Wallets whose points count, by points: total, wallets, and leaders with place, points, traded, onCoins and elsewhere.' },
          { path: '/api/v1/points/:address', what: 'One address: points, traded, onCoins, elsewhere, live (whether it counts yet), place, share of all points, and the rules.' },
        ]}
      />

      <H2 id="market">Market and protocol</H2>
      <Routes
        rows={[
          { path: '/api/v1/market/stats', what: 'Tokens, graduations, external tokens, and 24 hour volume, trades and traders across the chain.' },
          { path: '/api/v1/market/trades', q: '?traders=a,b &limit=30', what: 'The latest trades across every token, with each token\'s name and the trader\'s holding.' },
          { path: '/api/v1/protocol/stats', q: '?range=24h|7d|30d|all', what: 'Submarine\'s own figures: totals, this window against the one before, a series to chart, venues, top tokens and creators, limit orders, and the treasury. Shared for 10 seconds between everyone asking.' },
          { path: '/api/v1/zro-price', what: 'ZRO in US dollars, for display only. From Binance, or CoinGecko if that fails, refreshed every minute. usd is null when neither answered.' },
          { path: '/health', what: 'chainId, the block the indexer has reached against the chain head, and the deployment: every contract address.' },
        ]}
      />

      <H2 id="profiles">Profiles and metadata</H2>
      <Routes
        rows={[
          { path: '/api/v1/profiles', q: '?a=addr1,addr2 (up to 100)', what: 'Public names and pictures, keyed by address.' },
          { m: 'POST', path: '/api/v1/profile', what: 'Sets a wallet\'s own name and picture. Body: address, name, image (a data URL, or null to remove), time, and signature over the message below. One change every 15 seconds.' },
          { m: 'POST', path: '/api/v1/meta', what: 'Saves a token\'s picture, description and links before launch, and answers with the uri to launch it with. Body: image (PNG, JPEG, WebP or GIF data URL, 2 MB and 4096 by 4096 pixels at most) or imageUrl, description (600 characters at most), website, twitter, telegram, discord.' },
          { path: '/api/v1/meta/:hash', what: 'The saved metadata. It never changes, so it can be cached for good.' },
          { path: '/api/v1/images/:file', what: 'A saved picture, named by the hash of its bytes.' },
        ]}
      />
      <Code
        lang="text"
        title="What a wallet signs to set its profile"
        code={`Submarine profile
Wallet: <address, lowercase>
Name: <name, or (none)>
Picture: <sha256 of the image bytes, or same, or none>
Time: <unix seconds, within 10 minutes of now>`}
      />
      <P>A name is 2 to 24 letters, digits, spaces, dots, dashes or underscores, and can&apos;t look like an address.</P>

      <H2 id="stream">The live stream</H2>
      <P>
        <C>GET /api/v1/stream</C> is a stream of server-sent events. Open it once and every change arrives as it lands, so there is no need to
        ask again and again. A comment line keeps it open every 15 seconds.
      </P>
      <Table
        cols={['Event', 'Data']}
        rows={[
          [<C key="1">trade</C>, 'tx, idx, block, ts, token, trader, isBuy, zro, amount, price, venue'],
          [<C key="2">launch</C>, 'address, name, symbol, creator, ts. external and launchpad for tokens from elsewhere'],
          [<C key="3">graduated</C>, 'token, ts'],
          [<C key="4">order</C>, 'id of an order that was placed, filled, closed or moved'],
          [<C key="5">vault</C>, 'follower, kind, token, for anything in the copy vault'],
          [<C key="6">dev</C>, 'token, kind, when a creator transfers or burns'],
          [<C key="7">profile</C>, 'address, name, image, when a profile changes'],
        ]}
      />
      <Code
        lang="ts"
        code={`const es = new EventSource('${SUBMARINE_API}/api/v1/stream');
es.addEventListener('trade', (e) => {
  const t = JSON.parse(e.data);
  console.log(t.token, t.isBuy ? 'buy' : 'sell', t.zro);
});`}
      />

      <H2 id="limits">Limits</H2>
      <Table
        cols={['What', 'Limit']}
        rows={[
          ['Routes under /api/v1/', '30 requests a second per address, with bursts up to 120'],
          ['POST /api/v1/meta', '20 a minute per address, bursts of 6, and 10 MB or 24 new files an hour'],
          ['The live stream', '20 open streams per address'],
          ['Past a limit', 'HTTP 429. Wait and try again'],
        ]}
      />
      <Note title="Figures are for reading, not for settling.">
        Profit, prices in dollars and market caps here are worked out from events. Before you trade, quote on chain: the router&apos;s{' '}
        <C>quoteBuy</C> and <C>quoteSell</C> are what a trade will really get. See <L to="launch-from-code">Launch and trade from code</L>.
      </Note>
      <P>
        <B>Building an agent?</B> The <L to="mcp">MCP server</L> wraps the most useful routes and live quotes as tools.
      </P>
      <H3>Where this comes from</H3>
      <P>
        <C>indexer/src/api.ts</C>, <C>traderRoutes.ts</C> and <C>profiles.ts</C>. Rate limits are set in front of it, in{' '}
        <C>deploy/server/setup.sh</C>.
      </P>
    </Doc>
  );
}
