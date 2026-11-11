'use client';

import { useMemo, useState } from 'react';
import { blocky } from '@/lib/blockies';
import { useProfile } from '@/lib/profiles';

/** A wallet's blocky pattern, the one MetaMask draws for the same address. */
export function Blockie({ address, size = 28 }: { address: string; size?: number }) {
  const b = useMemo(() => blocky(address), [address]);
  return (
    <svg viewBox={`0 0 ${b.size} ${b.size}`} width={size} height={size} className="shrink-0 rounded-full" shapeRendering="crispEdges" aria-hidden="true">
      <rect width={b.size} height={b.size} fill={b.bg} />
      {b.cells.map((v, i) => (v ? <rect key={i} x={i % b.size} y={Math.floor(i / b.size)} width="1" height="1" fill={v === 1 ? b.color : b.spot} /> : null))}
    </svg>
  );
}

/** A wallet's picture: the one it chose for its public profile, or its blocky pattern. */
export function WalletPic({ address, size = 28 }: { address: string; size?: number }) {
  const profile = useProfile(address);
  const [broken, setBroken] = useState<string | null>(null);
  const src = profile?.image && /^https?:\/\//.test(profile.image) && broken !== profile.image ? profile.image : null;
  if (src) return <img src={src} alt="" width={size} height={size} onError={() => setBroken(src)} className="shrink-0 rounded-full bg-white/5 object-cover" style={{ width: size, height: size }} loading="lazy" />;
  return <Blockie address={address} size={size} />;
}
