'use client';

import { useId } from 'react';

// Generated token art. A token with no picture still gets a coat of its own: a pattern and two colours from its address, so
// the same token looks the same everywhere and two tokens with the same ticker don't look alike.

/** Black, grey, white and yellow only, so a screen full of tokens stays one palette. Patterns do the telling apart. */
const COLOURS: Array<[string, string]> = [
  ['#66e4ec', '#0a0a0a'],
  ['#0a0a0a', '#66e4ec'],
  ['#f5f5f5', '#0a0a0a'],
  ['#0a0a0a', '#f5f5f5'],
  ['#2e2e2e', '#66e4ec'],
  ['#66e4ec', '#f5f5f5'],
  ['#8a8a8a', '#0a0a0a'],
  ['#f5f5f5', '#66e4ec'],
  ['#3a3a3a', '#d4d4d4'],
  ['#d4d4d4', '#2e2e2e'],
  ['#9cf0f4', '#3a3a3a'],
  ['#6b6b6b', '#9cf0f4'],
];

const PATTERNS: Array<(t: string) => React.ReactNode> = [
  // hoops
  (t) => (
    <>
      <rect y="5" width="40" height="7" fill={t} />
      <rect y="17" width="40" height="7" fill={t} />
      <rect y="29" width="40" height="7" fill={t} />
    </>
  ),
  // stripes
  (t) => (
    <>
      <rect x="5" width="7" height="40" fill={t} />
      <rect x="17" width="7" height="40" fill={t} />
      <rect x="29" width="7" height="40" fill={t} />
    </>
  ),
  // sash
  (t) => <polygon points="-2,10 10,-2 42,30 30,42" fill={t} />,
  // chevrons
  (t) => (
    <g fill="none" stroke={t} strokeWidth="7">
      <path d="M-3 6 20 22 43 6" />
      <path d="M-3 22 20 38 43 22" />
    </g>
  ),
  // quarters
  (t) => (
    <>
      <rect width="20" height="20" fill={t} />
      <rect x="20" y="20" width="20" height="20" fill={t} />
    </>
  ),
  // halves
  (t) => <rect width="20" height="40" fill={t} />,
  // cross
  (t) => (
    <>
      <rect x="15" width="10" height="40" fill={t} />
      <rect y="15" width="40" height="10" fill={t} />
    </>
  ),
  // diamonds
  (t) => (
    <>
      <polygon points="20,1 29,12 20,23 11,12" fill={t} />
      <polygon points="6,17 15,28 6,39 -3,28" fill={t} />
      <polygon points="34,17 43,28 34,39 25,28" fill={t} />
    </>
  ),
  // spots
  (t) => (
    <>
      <circle cx="11" cy="11" r="5" fill={t} />
      <circle cx="29" cy="11" r="5" fill={t} />
      <circle cx="20" cy="22" r="5" fill={t} />
      <circle cx="11" cy="33" r="5" fill={t} />
      <circle cx="29" cy="33" r="5" fill={t} />
    </>
  ),
  // target
  (t) => <circle cx="20" cy="20" r="11" fill="none" stroke={t} strokeWidth="7" />,
  // star
  (t) => <polygon points="20,4 24.7,14.6 36.2,15.8 27.6,23.5 30,34.9 20,29 10,34.9 12.4,23.5 3.8,15.8 15.3,14.6" fill={t} />,
  // collar and body
  (t) => <polygon points="-2,-2 42,-2 42,14 20,26 -2,14" fill={t} />,
];

function bytesOf(address: string): number[] {
  const hex = address.replace(/^0x/, '').toLowerCase();
  const out: number[] = [];
  for (let i = 0; i + 1 < hex.length; i += 2) out.push(parseInt(hex.slice(i, i + 2), 16) || 0);
  return out.length >= 6 ? out : [...out, 7, 11, 13, 17, 19, 23];
}

export function Silks({ address, size = 32 }: { address: string; size?: number }) {
  const id = useId();
  // The tail of an address varies best: contract addresses from the same deployer can share leading bytes.
  const b = bytesOf(address).slice(-6);
  const [base, trim] = COLOURS[b[0]! % COLOURS.length]!;
  const draw = PATTERNS[b[1]! % PATTERNS.length]!;
  const turn = (b[2]! % 4) * 90;
  return (
    <svg viewBox="0 0 40 40" width={size} height={size} className="block shrink-0" aria-hidden="true">
      <clipPath id={id}>
        <circle cx="20" cy="20" r="20" />
      </clipPath>
      <g clipPath={`url(#${id})`}>
        <rect width="40" height="40" fill={base} />
        <g transform={`rotate(${turn} 20 20)`}>{draw(trim)}</g>
      </g>
      <circle cx="20" cy="20" r="19.25" fill="none" stroke="rgb(255 255 255 / .2)" strokeWidth="1.5" />
    </svg>
  );
}
