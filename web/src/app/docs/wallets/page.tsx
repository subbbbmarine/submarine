import { B, Bullets, Doc, Go, H2, H3, L, Note, P, Table } from '../_ui/doc';
import { docMeta } from '../_ui/pages';

export const metadata = docMeta('wallets');

export default function Page() {
  return (
    <Doc
      slug="wallets"
      lead={
        <>
          The fastest way to trade here is a key that lives in this browser: trades sign themselves, with no popup. You can also connect
          MetaMask, keep several wallets side by side, lock them with a PIN, and give each one a public name and picture.
        </>
      }
      toc={[
        ['kinds', 'Three kinds of wallet'],
        ['browser', 'A wallet in this browser'],
        ['backup', 'Saving your key'],
        ['pin', 'Locking with a PIN'],
        ['metamask', 'MetaMask and other browser wallets'],
        ['several', 'Several wallets'],
        ['send', 'Sending ZRO'],
        ['profiles', 'Public profiles'],
        ['stored', 'What is stored where'],
      ]}
    >
      <H2 id="kinds">Three kinds of wallet</H2>
      <Table
        cols={['', 'New', 'Bring a key', 'MetaMask']}
        rows={[
          ['What it is', 'A fresh key made in this browser', 'A key you already have, pasted in', 'Your browser extension'],
          ['Trades', 'Sign themselves, no popup', 'Sign themselves, no popup', 'Each one asks you to confirm'],
          ['Key kept', 'In this browser', 'In this browser', 'In the extension'],
          ['Best for', 'Fast trading with a small balance', 'Moving an existing trading wallet here', 'Keeping the key out of the site'],
        ]}
      />

      <H2 id="browser">A wallet in this browser</H2>
      <P>
        Press the wallet button and choose <B>New</B>. The first time, you choose a <L to="wallets" at="pin">PIN</L>. You can give the wallet a
        name, or it becomes Wallet 1, Wallet 2 and so on. The key is made on your device and never leaves it. Nobody else holds a copy,
        which means nobody can recover it for you.
      </P>
      <P>
        While a tab is unlocked, anyone at this computer can trade from it. Keep only trading money in it.
      </P>

      <H2 id="backup">Saving your key</H2>
      <P>
        Right after you create a wallet, a box asks you to save its key: <B>Copy key</B>, store it somewhere safe, then press{' '}
        <B>I saved it</B>. The box comes back on every visit until you do, and keyboard trading stays off while it is open. Clearing this
        browser&apos;s site data deletes the key, so the copy you saved is the only way back.
      </P>

      <H2 id="pin">Locking with a PIN</H2>
      <P>
        Every wallet in this browser is locked with a PIN of <B>eight or more</B> digits or letters. You choose it when you make or add
        your first wallet, before its key is stored anywhere.
      </P>
      <Bullets
        items={[
          'Your keys are encrypted with AES-GCM, using a key made from the PIN by PBKDF2 with 600,000 rounds of SHA-256 and a random salt. They are never stored open.',
          'Submarine asks for the PIN in each new tab and after the browser restarts. A reload in the same tab doesn\'t ask again: the tab keeps the PIN\'s key in its own session storage until it closes.',
          'A wrong PIN just says so. Showing a key asks for the PIN again.',
        ]}
      />
      <Note title="A forgotten PIN locks your keys for good.">
        There is no reset. If you forget it, the only way back is the key you saved.
      </Note>

      <H2 id="metamask">MetaMask and other browser wallets</H2>
      <P>
        Choose MetaMask in the wallet menu. Submarine asks the extension to switch to Zero, and adds the network if it is missing. Every
        trade, order and claim then pops up in the extension for you to confirm. Keyboard trading and one-click buys still work, they just
        ask the extension first.
      </P>

      <H2 id="several">Several wallets</H2>
      <P>
        Keep as many as you like: new ones, keys you bring, and MetaMask. Switch with one click, rename them, or forget one, which removes it
        from this browser. The automation panel can buy with several of them at once. See <L to="orders" at="dca">Limit orders</L>.
      </P>

      <H2 id="send">Sending ZRO</H2>
      <P>
        Portfolio&apos;s Send tab sends ZRO from the active wallet to any address. Max keeps 0.2 ZRO back for gas.
      </P>

      <H2 id="profiles">Public profiles</H2>
      <P>
        Give a wallet a name and a picture, and everyone sees them wherever that wallet appears: trades, holders, leaderboards and its own
        page.
      </P>
      <Bullets
        items={[
          'A name is 2 to 24 letters, digits, spaces, dots, dashes or underscores, and can\'t look like an address.',
          'A picture is a PNG, JPEG, WebP or GIF, cropped to a 256 px square.',
          'Setting it is free. Your wallet signs a message that names the exact change, so only you can change your own profile. No transaction is sent.',
          'One change every 15 seconds.',
          'Without a picture, a wallet shows a pattern made from its address, the same one MetaMask shows. Use the pattern removes a picture.',
        ]}
      />
      <H3>Public wallet pages</H3>
      <P>
        Click any wallet to open its record: profit, win rate, how long it holds, its buy sizes, and flags such as selling within 10 seconds
        of buying. You can follow it from there. See <L to="copy-trading" at="follow">Copy trading</L>.
      </P>
      <H3>Volume rank</H3>
      <P>
        Every wallet has a rank, from Starter to Legend, by the ZRO it has traded through Submarine. Each rank lowers Submarine&apos;s cut of
        that wallet&apos;s trades, from 0.4% down to 0.15%. Portfolio, the wallet panel and every public wallet page show the wallet&apos;s
        volume on a scale with a mark for each rank. <B>Save card</B> makes a picture of the rank to share. The ranks and their marks are on{' '}
        <L to="fees" at="ranks">Fees</L>, and the same trades also earn <L to="points">points</L>.
      </P>

      <H2 id="stored">What is stored where</H2>
      <Table
        cols={['What', 'Where']}
        rows={[
          ['Keys', 'This browser\'s local storage, encrypted with your PIN'],
          ['The PIN\'s key, once typed', 'This tab\'s session storage, gone when the tab closes'],
          ['Which wallet is active', 'Session storage, the address only, never a key'],
          ['MetaMask\'s key', 'In MetaMask. Submarine only stores the address'],
          ['Follows, stars, drawings, presets', 'This browser'],
          ['Profile name and picture', 'Submarine\'s server, public'],
        ]}
      />
    </Doc>
  );
}
