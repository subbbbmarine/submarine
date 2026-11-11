'use client';

import { useState } from 'react';

export function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard
          .writeText(text)
          .then(() => {
            setDone(true);
            setTimeout(() => setDone(false), 1500);
          })
          .catch(() => {});
      }}
      className="shrink-0 rounded-md px-2 py-0.5 text-[12px] font-medium text-muted transition-colors hover:bg-white/[.07] hover:text-ink"
    >
      {done ? 'Copied' : label}
    </button>
  );
}
