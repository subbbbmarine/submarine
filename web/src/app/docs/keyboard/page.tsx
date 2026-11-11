import type { ReactNode } from 'react';
import { Doc, H2, Note, P, Table } from '../_ui/doc';
import { docMeta } from '../_ui/pages';

export const metadata = docMeta('keyboard');

function K({ children }: { children: ReactNode }) {
  return <kbd className="num mx-0.5 inline-flex min-w-[24px] items-center justify-center rounded-md border border-white/15 bg-white/[.06] px-1.5 py-0.5 text-[12px] text-ink">{children}</kbd>;
}

export default function Page() {
  return (
    <Doc
      slug="keyboard"
      lead={<>Trade without the mouse. Keys never act while you are typing in a field.</>}
      toc={[
        ['trading', 'On the trading screen'],
        ['search', 'Search'],
        ['chart', 'On the chart'],
        ['elsewhere', 'Everywhere else'],
      ]}
    >
      <H2 id="trading">On the trading screen</H2>
      <Table
        cols={['Key', 'Does']}
        rows={[
          [<><K>B</K></>, 'Buys at your quick size. With no wallet yet, creates one'],
          [<><K>S</K></>, 'Sells half'],
          [<><K>Shift</K>+<K>S</K></>, 'Sells everything'],
          [<><K>1</K><K>2</K><K>3</K><K>4</K></>, 'Sets the quick size to 5, 50, 200 or 500 ZRO'],
          [<><K>J</K><K>K</K> or <K>↓</K><K>↑</K></>, 'Steps through the token list'],
          [<><K>Enter</K></>, 'Opens the row in focus'],
        ]}
      />
      <Note title="B and S trade at once.">
        With a wallet in this browser there is no popup to confirm, so a key press is a trade. With MetaMask, the extension still asks.
        Keyboard trading is off while the box asking you to save a new key is open.
      </Note>

      <H2 id="search">Search</H2>
      <Table
        cols={['Key', 'Does']}
        rows={[
          [<><K>/</K></>, 'Jumps to the search box'],
          [<><K>↓</K><K>↑</K></>, 'Moves through the results'],
          [<><K>Enter</K></>, 'Opens the result'],
          [<><K>Esc</K></>, 'Closes the results'],
        ]}
      />
      <P>Search finds tokens by name, ticker or address, and wallets by their address or its first four characters after 0x.</P>

      <H2 id="chart">On the chart</H2>
      <Table
        cols={['Key', 'Does']}
        rows={[
          [<><K>Delete</K> or <K>Backspace</K></>, 'Removes the selected line'],
          [<><K>Esc</K></>, 'Deselects a line, or stops drawing'],
        ]}
      />

      <H2 id="elsewhere">Everywhere else</H2>
      <Table
        cols={['Key', 'Does']}
        rows={[
          [<><K>Esc</K></>, 'Closes the wallet drawer and the share card'],
          [<><K>↓</K><K>↑</K> <K>Enter</K> <K>Esc</K></>, 'Pick a token in Multi\'s picker'],
        ]}
      />
    </Doc>
  );
}
