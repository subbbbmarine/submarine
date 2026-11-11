'use client';

import { useEffect, useRef, useState } from 'react';
import { BACKDROPS, backdropFor } from '@/lib/backdrops';
import { cn } from '@/lib/format';
import { drawCard, ownPicture, postUrl, type CardArt, type TradeCard } from '@/lib/shareCard';

/** The button on a trade's row. Rows open their token when clicked, so it keeps its click to itself. */
export function ShareButton({ onPress, className }: { onPress: () => void; className?: string }) {
  return (
    <button
      title="Share this trade as a picture"
      aria-label="Share this trade as a picture"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onPress();
      }}
      className={cn('flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-faint transition-colors hover:bg-white/[.06] hover:text-ink', className)}
    >
      <svg viewBox="0 0 24 24" className="h-[15px] w-[15px]" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M12 15V4M7.5 8.5 12 4l4.5 4.500M5 14v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4" />
      </svg>
    </button>
  );
}

/** The last choice is kept apart for wins and losses, so a red picture picked for a loss doesn't turn up on a win. */
const artKey = (profit: number) => `terminal.shareArt.v2.${profit >= 0 ? 'up' : 'down'}`;
const OWN_KEY = 'terminal.shareOwn.v1';

const read = (key: string) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
const write = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    // a full or blocked store only means the picture lasts this visit
  }
};

export function ShareSheet({ load, onClose }: { load: () => Promise<TradeCard>; onClose: () => void }) {
  const [card, setCard] = useState<TradeCard | null>(null);
  const [failed, setFailed] = useState(false);
  const [own, setOwn] = useState<string | null>(() => read(OWN_KEY));
  const [saved, setSaved] = useState<string | null>(null);
  const [image, setImage] = useState<{ blob: Blob; url: string } | null>(null);
  const [note, setNote] = useState('');
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let alive = true;
    load()
      .then((c) => {
        if (!alive) return;
        setSaved(read(artKey(c.profit)));
        setCard(c);
      })
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
    // The sheet is opened for one trade and closed again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // What's showing: your last choice for this kind of trade if it still exists, or a picture that fits the trade.
  const known = saved === 'chart' || (saved === 'own' && !!own) || BACKDROPS.some((b) => b.id === saved);
  const choice = !card ? '' : known ? saved! : backdropFor(card.token, card.profit).id;

  useEffect(() => {
    if (!card) return;
    let alive = true;
    const art: CardArt = choice === 'chart' ? { kind: 'chart' } : { kind: 'picture', src: choice === 'own' && own ? own : BACKDROPS.find((b) => b.id === choice)!.src };
    void drawCard(card, art)
      .then((blob) => {
        if (!alive) return;
        setImage((old) => {
          if (old) URL.revokeObjectURL(old.url);
          return { blob, url: URL.createObjectURL(blob) };
        });
      })
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [card, choice, own]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const pick = (id: string) => {
    setSaved(id);
    if (card) write(artKey(card.profit), id);
  };

  const upload = async (file: File | undefined) => {
    if (!file) return;
    try {
      const data = await ownPicture(file);
      setOwn(data);
      write(OWN_KEY, data);
      pick('own');
      setNote('');
    } catch {
      setNote("That file can't be read. Try a PNG, JPG or WebP.");
    }
  };

  const copy = async () => {
    if (!image) return false;
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': image.blob })]);
      return true;
    } catch {
      return false;
    }
  };

  const download = () => {
    if (!image || !card) return;
    const a = document.createElement('a');
    a.href = image.url;
    a.download = `trade-${card.symbol.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.png`;
    a.click();
  };

  const post = async () => {
    if (!card) return;
    const copied = await copy();
    if (!copied) download();
    setNote(copied ? 'The card is on your clipboard. Paste it into the post.' : 'The card is in your downloads. Attach it to the post.');
    window.open(postUrl(card), '_blank', 'noopener');
  };

  const tab = (on: boolean) => cn('h-8 rounded-[6px] px-2.5 text-[13px] font-medium transition-colors duration-150', on ? 'bg-white/[.12] text-ink' : 'text-muted hover:text-ink');

  return (
    <div className="animate-fade fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-3" onClick={onClose}>
      <div className="animate-rise no-scrollbar max-h-full w-full max-w-[620px] overflow-y-auto rounded-2xl border border-white/10 bg-card p-4" role="dialog" aria-modal="true" aria-label="Share this trade" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-[16px] font-semibold">Share this trade</h2>
          <button onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/5 text-muted transition-colors hover:text-ink" aria-label="Close">
            <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
              <path d="M4 4l8 8m0-8l-8 8" />
            </svg>
          </button>
        </div>
        {failed ? (
          <p className="mt-3 text-[13px] leading-relaxed text-muted">This trade can&apos;t be worked out: the wallet&apos;s buys of this token aren&apos;t in its history.</p>
        ) : (
          <>
            <div className="mt-3 flex aspect-[16/9] items-center justify-center overflow-hidden rounded-xl bg-white/[.04]">{image ? <img src={image.url} alt="The trade card" className="h-full w-full object-cover" /> : <span className="text-[13px] text-faint">Drawing the card</span>}</div>
            <div className="mt-3 grid grid-cols-5 gap-1.5">
              {BACKDROPS.map((b) => (
                <button
                  key={b.id}
                  onClick={() => pick(b.id)}
                  aria-pressed={choice === b.id}
                  aria-label={b.name}
                  title={b.name}
                  className={cn('aspect-[16/9] overflow-hidden rounded-lg outline outline-2 -outline-offset-2 transition-[outline-color,opacity] duration-150', choice === b.id ? 'outline-accent' : 'opacity-80 outline-transparent hover:opacity-100')}
                >
                  <img src={b.thumb} alt="" className="h-full w-full object-cover" />
                </button>
              ))}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-1">
              <button onClick={() => pick('chart')} aria-pressed={choice === 'chart'} className={tab(choice === 'chart')}>
                Its chart
              </button>
              {own && (
                <button onClick={() => pick('own')} aria-pressed={choice === 'own'} className={tab(choice === 'own')}>
                  Your picture
                </button>
              )}
              <button onClick={() => input.current?.click()} className={tab(false)}>
                {own ? 'Replace picture' : 'Upload a picture'}
              </button>
              <input
                ref={input}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                hidden
                onChange={(e) => {
                  void upload(e.target.files?.[0]);
                  e.target.value = '';
                }}
              />
            </div>
            {note && <p className="animate-fade mt-2 text-[13px] text-muted">{note}</p>}
            <div className="mt-3 grid grid-cols-3 gap-1.5">
              <button className="btn btn-accent h-10" disabled={!image} onClick={() => void post()}>
                Post on X
              </button>
              <button className="btn btn-soft h-10" disabled={!image} onClick={() => void copy().then((ok) => setNote(ok ? 'The card is on your clipboard.' : "This browser won't copy images. Use Download."))}>
                Copy image
              </button>
              <button className="btn btn-soft h-10" disabled={!image} onClick={download}>
                Download
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
