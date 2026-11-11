'use client';

import { useEffect, useRef, useState } from 'react';
import { useWallet } from '@/lib/wallet';

/**
 * A wallet made here has its key in this browser and nowhere else, so its owner gets the key before anything else happens.
 * It can't be clicked away, and it comes back after a reload until they say they've kept it.
 */
export function KeyBackup() {
  const unsaved = useWallet((s) => s.keyUnsaved);
  const exportKey = useWallet((s) => s.exportKey);
  const keySaved = useWallet((s) => s.keySaved);
  const [copied, setCopied] = useState<boolean | null>(null);
  const copyButton = useRef<HTMLButtonElement>(null);
  const doneButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (unsaved) copyButton.current?.focus();
  }, [unsaved]);

  if (!unsaved) return null;
  const key = exportKey() ?? '';

  const copy = () => {
    navigator.clipboard.writeText(key).then(
      () => setCopied(true),
      () => setCopied(false),
    );
  };

  return (
    <div className="animate-fade fixed inset-0 z-[70] flex items-center justify-center bg-black/80 p-3">
      <div
        className="animate-rise w-full max-w-[440px] rounded-2xl border border-white/10 bg-card p-5"
        role="dialog"
        aria-modal="true"
        aria-labelledby="key-backup-title"
        onKeyDown={(e) => {
          if (e.key !== 'Tab') return;
          e.preventDefault();
          (document.activeElement === copyButton.current ? doneButton : copyButton).current?.focus();
        }}
      >
        <h2 id="key-backup-title" className="text-[18px] font-semibold">
          Save your wallet key
        </h2>
        <p className="mt-2 text-[14px] leading-relaxed text-muted">
          This key is the only way into your wallet. It is kept only in this browser, and only for this address of the site. Without it the wallet can&apos;t be opened anywhere else, and nobody can restore it.
        </p>
        <code className="mt-3 block select-all break-all rounded-lg bg-black/40 p-3 text-[13px] text-accent">{key}</code>
        {copied === false && <p className="mt-2 text-[13px] leading-snug text-down">The browser refused to copy. Click the key to select it, then copy it yourself.</p>}
        <div className="mt-3 grid grid-cols-2 gap-2">
          <button ref={copyButton} onClick={copy} className="btn btn-soft h-11">
            {copied ? 'Copied' : 'Copy key'}
          </button>
          <button ref={doneButton} onClick={keySaved} className="btn btn-accent h-11">
            I saved it
          </button>
        </div>
      </div>
    </div>
  );
}
