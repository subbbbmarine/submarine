import { B, Bullets, Doc, H2, L, Note, P, Table } from '../_ui/doc';
import { docMeta } from '../_ui/pages';

export const metadata = docMeta('chart');

export default function Page() {
  return (
    <Doc
      slug="chart"
      lead={
        <>
          Every token has a live chart built from its trades on the chain, from its very first one. It marks what the creator did, your own
          trades and those of wallets you follow, and can show the limit orders resting at each level.
        </>
      }
      toc={[
        ['settings', 'Intervals and styles'],
        ['markers', 'Markers'],
        ['levels', 'Lines on the chart'],
        ['heatmap', 'The order heatmap'],
        ['drawing', 'Drawing'],
        ['mouse', 'Moving around'],
        ['tabs', 'Below the chart'],
      ]}
    >
      <H2 id="settings">Intervals and styles</H2>
      <Table
        cols={['Setting', 'Choices']}
        rows={[
          ['Interval', '1s, 5s, 1m, 5m, 15m, 1h, 4h, 1D. 1m to start'],
          ['Style', 'Candles or Line'],
          ['Scale', 'Market cap or Price'],
          ['Indicators', 'SMA 20, EMA 50, and VWAP as a dashed line'],
        ]}
      />
      <P>History loads as you scroll back, 4,000 bars at a time and up to 200,000.</P>

      <H2 id="markers">Markers</H2>
      <Table
        cols={['Marker', 'Means']}
        rows={[
          ['B', 'The creator bought'],
          ['S', 'The creator sold'],
          ['T', 'The creator sent the token straight to another wallet'],
          ['Burn', 'The creator burned some'],
          ['A three-letter tag', 'Your own trade, or one by a wallet you follow'],
        ]}
      />
      <P>A transfer only counts as T if the creator sent it directly. Tokens moved through a contract don&apos;t show.</P>

      <H2 id="levels">Lines on the chart</H2>
      <Bullets
        items={[
          'Your average entry, on a token you hold.',
          'Your open orders, at their levels.',
          <><B>Moves to a pool</B>: the market cap at which a curve token graduates, 30,000 ZRO.</>,
        ]}
      />

      <H2 id="heatmap">The order heatmap</H2>
      <P>
        The heatmap shows the limit orders waiting on the token right now, drawn out from the price scale at their levels: buys in green,
        sales in red, stop losses and trailing stops in amber, longer and brighter the more ZRO waits there. Green below the price is
        buy orders, red above it is sell orders and take profits. Amber below the price is sales that wait for it to fall there: they
        add to a drop rather than stop one, unless buy orders wait at the same level.
      </P>
      <Note title="It covers Submarine's limit orders only.">
        Liquidity in a curve or a pool isn&apos;t drawn, and orders that wait for an event, like a move to a pool, have no level. Click a level
        on the price scale to start an order there. See <L to="orders">Limit orders</L>.
      </Note>

      <H2 id="drawing">Drawing</H2>
      <Bullets
        items={[
          'Draw horizontal lines at any level. Drag one to move it.',
          'Remove a line with a right click, its little x, or Delete or Backspace while it is selected. Escape deselects it or stops drawing.',
          'Lines are kept per token in this browser and show in every open tab.',
        ]}
      />

      <H2 id="mouse">Moving around</H2>
      <Table
        cols={['Do this', 'To']}
        rows={[
          ['Scroll the wheel', 'Zoom around the pointer'],
          ['Scroll over the price scale', 'Stretch the price'],
          ['Swipe sideways or drag the chart', 'Move through time'],
          ['Drag the price scale', 'Stretch the price'],
          ['Drag the time axis', 'Stretch time from the side you grabbed'],
          ['Drag the strip along the left edge', 'Stretch both'],
          ['Double click', 'Fit everything again. On a scale, only that scale'],
          ['The + and − buttons, Reset view', 'Zoom and reset without a mouse'],
        ]}
      />

      <H2 id="tabs">Below the chart</H2>
      <Table
        cols={['Tab', 'Shows']}
        rows={[
          ['Trades', 'Every trade, filtered by All, Buys, Sells, Large, Dev or Tracked'],
          ['Holders', 'Holders with their share, profit and labels'],
          ['Traders', 'Everyone who traded it, by profit'],
          ['First 70', 'The first 70 buyers and what each has done since'],
          ['Map', 'Holders as a map, with the transfers between them and linked groups'],
          ['Safety', 'What the chain says about the contract, and the shares held by the dev, the top 10, snipers, bundles and insiders'],
        ]}
      />
      <P>
        The labels are explained in the <L to="glossary">Glossary</L>. The warnings turn on at a dev share of 10%, top 10 at 50%, snipers or
        bundles at 15%, and insiders at 10%.
      </P>
    </Doc>
  );
}
