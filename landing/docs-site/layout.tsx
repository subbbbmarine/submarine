import type { Metadata, Viewport } from 'next';
import Link from 'next/link';
import { IBM_Plex_Sans } from 'next/font/google';
import { SUBMARINE_PATH, SUBMARINE_VIEWBOX } from '@/lib/submarine';
import './globals.css';

/**
 * The docs on their own, served as plain files beside the landing page on submarine.live. The terminal isn't live yet, so
 * this has no wallet, search or menu: the S goes home, and a line says what isn't there yet.
 */
const sans = IBM_Plex_Sans({ subsets: ['latin'], weight: ['400', '500', '600', '700'], variable: '--font-sans', display: 'swap' });

export const metadata: Metadata = {
  metadataBase: new URL('https://submarine.live'),
  title: 'Docs · Submarine',
  description: 'How Submarine works: the curve, fees, orders, copy trading, points, and the API for builders.',
  openGraph: { images: ['/assets/og.jpg'], siteName: 'Submarine' },
  twitter: { card: 'summary_large_image', images: ['/assets/og.jpg'] },
};

export const viewport: Viewport = { themeColor: '#0a0a0d', width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={sans.variable}>
      <body>
        <div className="flex min-h-screen flex-col">
          <div className="shrink-0 bg-accent/10 px-4 py-1.5 text-center text-[13px] leading-snug text-accent">
            Submarine is in development. The contracts are not on Zero yet, so the terminal opens at launch.
          </div>
          <header className="flex h-14 shrink-0 items-center gap-1 border-b border-white/[.06] px-2">
            <a href="/" className="flex h-10 shrink-0 items-center px-3 text-ink" aria-label="Submarine, home" title="Submarine">
              <svg viewBox={SUBMARINE_VIEWBOX} className="h-7 w-auto" aria-hidden="true">
                <path fill="currentColor" fillRule="evenodd" d={SUBMARINE_PATH} />
              </svg>
            </a>
            <Link href="/docs" className="flex h-10 items-center rounded-lg px-3 text-[14px] font-medium text-ink hover:bg-white/[.05]">
              Docs
            </Link>
          </header>
          <main className="min-w-0 flex-1 px-2 pb-2 pt-2">{children}</main>
        </div>
      </body>
    </html>
  );
}
