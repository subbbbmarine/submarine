'use client';

import { useState } from 'react';
import { cn, priceParts, plainPrice } from '@/lib/format';
import { Silks } from './Silks';

export function Avatar({ address, uri, size = 36 }: { address: string; uri?: string | null; size?: number }) {
  const [broken, setBroken] = useState(false);
  if (uri && /^https?:\/\//.test(uri) && !broken) {
    return <img src={uri} alt="" width={size} height={size} onError={() => setBroken(true)} className="shrink-0 rounded-full bg-white/5 object-cover" style={{ width: size, height: size }} loading="lazy" />;
  }
  return <Silks address={address} size={size} />;
}

/** Tiny prices show their zero count as a subscript, the way traders read them. */
export function Price({ value, className }: { value: number; className?: string }) {
  const parts = priceParts(value);
  return (
    <span className={cn('num', className)}>
      {parts ? (
        <>
          0.0<sub className="text-[0.72em]">{parts.zeros}</sub>
          {parts.digits}
        </>
      ) : (
        plainPrice(value)
      )}
    </span>
  );
}

export function Progress({ value, className }: { value: number; className?: string }) {
  return (
    <div className={cn('h-1.5 overflow-hidden rounded-full bg-white/10', className)} role="progressbar" aria-valuenow={Math.round(value * 100)} aria-valuemin={0} aria-valuemax={100}>
      <div className="h-full rounded-full bg-accent transition-[width] duration-700 ease-out" style={{ width: `${Math.max(value * 100, value > 0 ? 2 : 0)}%` }} />
    </div>
  );
}

export function Empty({ title, body, children }: { title: string; body?: string; children?: React.ReactNode }) {
  return (
    <div className="px-4 py-10 text-center">
      <p className="text-muted">{title}</p>
      {body && <p className="mx-auto mt-1 max-w-xs text-[13px] leading-relaxed text-faint">{body}</p>}
      {children}
    </div>
  );
}

export function Change({ value, className }: { value: number; className?: string }) {
  const text = `${value > 0 ? '+' : ''}${(value * 100).toFixed(Math.abs(value) >= 1 ? 0 : 1)}%`;
  return <span className={cn('num', value > 0 ? 'text-up' : value < 0 ? 'text-down' : 'text-faint', className)}>{text}</span>;
}
