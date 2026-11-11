import { B, Bullets, C, Doc, H2, H3, Note, P, Table } from '../_ui/doc';
import { docMeta } from '../_ui/pages';

export const metadata = docMeta('alerts');

export default function Page() {
  return (
    <Doc
      slug="alerts"
      lead={
        <>
          Submarine can tell you when a token crosses a market cap, when your orders fill, and when wallets you follow trade. In the
          browser that works while a tab is open. The Telegram bot does the same with every tab closed.
        </>
      }
      toc={[
        ['browser', 'Alerts in the browser'],
        ['settings', 'Sound and notifications'],
        ['bot', 'The Telegram bot'],
        ['commands', 'Every command'],
        ['limits', 'Limits'],
      ]}
    >
      <H2 id="browser">Alerts in the browser</H2>
      <Table
        cols={['Alert', 'When it fires']}
        rows={[
          ['Market cap', 'A token goes above or below a cap you set. It fires once and is then removed'],
          ['Your orders', 'An order of yours fills, in full or in part'],
          ['Followed wallets', 'A wallet you follow trades. A notification while the tab is in the background, and a card on screen, up to 3 at once for 8 seconds each'],
        ]}
      />
      <P>
        Add a market cap alert with the bell by a token&apos;s name. Portfolio, under Alerts, lists every alert and how they reach you. The
        tab title shows how many you haven&apos;t seen yet. Followed wallets&apos; trades also show as cards with a button to do the same,
        wherever you are in Submarine.
      </P>

      <H2 id="settings">Sound and notifications</H2>
      <Bullets
        items={[
          <><B>Sound</B> is on by default: two short tones.</>,
          <><B>System notifications</B> are off by default. Turned on, they appear only while the tab is hidden, after your browser asks for permission.</>,
          <><B>Followed wallets</B> alerts are off by default.</>,
        ]}
      />

      <H2 id="bot">The Telegram bot</H2>
      <P>
        Send the bot commands from any Telegram chat, alone or in a group. It watches the chain itself and writes to you whatever
        Submarine&apos;s tabs are doing. There is nothing to link: a chat&apos;s settings belong to that chat.
      </P>
      <H3>A quick start</H3>
      <Bullets
        items={[
          <><C>/watch 0xWallet Whale</C> sends you every trade that wallet makes, named Whale.</>,
          <><C>/alert 0xToken above 50k</C> tells you once the token&apos;s market cap passes 50,000 dollars.</>,
          <><C>/orders 0xYourWallet</C> tells you when your orders fill.</>,
        ]}
      />
      <P>
        When two or more wallets you watch buy the same token within 60 seconds, the bot sends one message saying they bought together.
      </P>

      <H2 id="commands">Every command</H2>
      <Table
        cols={['Command', 'What it does']}
        rows={[
          [<C key="1">/start</C>, 'Shows the help'],
          [<C key="2">/help</C>, 'Shows the help'],
          [<C key="3">/watch &lt;wallet&gt; [name]</C>, 'Alerts on every trade by that wallet. A name can be up to 32 characters'],
          [<C key="4">/unwatch &lt;wallet&gt;</C>, 'Stops watching it'],
          [<C key="5">/watching</C>, 'Lists the wallets you watch'],
          [<C key="6">/alert &lt;token&gt; above|below &lt;cap&gt;</C>, 'Alerts once when its market cap in dollars crosses the level. Write 50000, 50k, 1.2m or 2b'],
          [<C key="7">/alerts</C>, 'Lists your market cap alerts, numbered'],
          [<C key="8">/unalert &lt;n&gt;</C>, 'Removes alert number n'],
          [<C key="9">/orders &lt;wallet&gt;</C>, 'Alerts when that wallet\'s orders fill'],
          [<C key="10">/orders</C>, 'Lists the wallets whose orders you follow'],
          [<C key="11">/unorders &lt;wallet&gt;</C>, 'Stops order alerts for it'],
        ]}
      />

      <H2 id="limits">Limits</H2>
      <Table
        cols={['What', 'Limit']}
        rows={[
          ['Commands', '20 a minute per chat. Past that, the bot warns once and ignores the rest for the minute'],
          ['Watched wallets', '100 per chat'],
          ['Market cap alerts', '50 per chat'],
          ['Wallets for order alerts', '20 per chat'],
          ['Messages', 'At most one a second per chat, with several alerts merged into one message. At most 200 waiting per chat'],
          ['Old trades', 'A trade older than 10 minutes is not sent'],
        ]}
      />
      <Note title="Dollar levels move with ZRO.">
        Market caps on the chain are in ZRO. The bot converts them at the ZRO price, refreshed every minute, so a dollar alert can fire when
        ZRO moves even if the token doesn&apos;t.
      </Note>
    </Doc>
  );
}
