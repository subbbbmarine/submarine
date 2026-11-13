import type { Metadata, Viewport } from 'next';
import Link from 'next/link';
import { SUBMARINE_PATH, SUBMARINE_VIEWBOX } from '@/lib/submarine';
import './globals.css';
import './docs.css';

/**
 * The docs on their own, served as plain files beside the landing page on submarine.live, in the landing page's look: the same
 * bar, the same frame of lines, General Sans. The terminal isn't live yet, so there is no wallet, search or menu.
 */
export const metadata: Metadata = {
  metadataBase: new URL('https://submarine.live'),
  title: 'Docs · Submarine',
  description: 'How Submarine works: the curve, fees, orders, copy trading, points, and the API for builders.',
  openGraph: { images: ['/assets/og.jpg'], siteName: 'Submarine' },
  twitter: { card: 'summary_large_image', images: ['/assets/og.jpg'] },
};

export const viewport: Viewport = { themeColor: '#0a0a0b', width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://api.fontshare.com" />
        <link rel="stylesheet" href="https://api.fontshare.com/v2/css?f[]=general-sans@300,400,500,600&display=swap" />
      </head>
      <body className="docs">
        <div className="flex min-h-screen flex-col">
          <header className="sticky top-0 z-20 shrink-0 border-b border-white/[.08] bg-[#0a0a0b]/85 backdrop-blur-md">
            <div className="frame flex h-16 items-center gap-8" style={{ paddingInline: 'var(--px)' }}>
              <a href="/" className="flex shrink-0 items-center gap-2.5 text-[19px] font-medium tracking-tight text-ink" aria-label="Submarine, home">
                <svg viewBox={SUBMARINE_VIEWBOX} className="h-6 w-auto" aria-hidden="true">
                  <path fill="currentColor" fillRule="evenodd" d={SUBMARINE_PATH} />
                </svg>
                Submarine
              </a>
              <nav className="ml-auto flex items-center gap-6 text-[15px] text-muted sm:gap-8">
                <Link href="/docs" className="text-ink">
                  Docs
                </Link>
                <a href="https://github.com/subbbbmarine/submarine" target="_blank" rel="noopener noreferrer" className="hover:text-ink">
                  GitHub
                </a>
                <a href="https://x.com/subbbbmarine" target="_blank" rel="noopener noreferrer" className="hover:text-ink">
                  X
                </a>
              </nav>
            </div>
          </header>
          <div className="border-b border-white/[.08]">
            <p className="frame py-2.5 text-[13px] leading-snug text-muted" style={{ paddingInline: 'var(--px)' }}>
              <span className="text-accent">In development.</span> The contracts are not on Zero yet, so the terminal opens at launch.
            </p>
          </div>
          <main className="frame min-w-0 flex-1">{children}</main>
        </div>
      </body>
    </html>
  );
}
