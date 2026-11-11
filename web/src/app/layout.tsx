import type { Metadata, Viewport } from 'next';
import { headers } from 'next/headers';
import { IBM_Plex_Sans } from 'next/font/google';
import { Shell } from '@/components/Shell';
import './globals.css';

const sans = IBM_Plex_Sans({ subsets: ['latin'], weight: ['400', '500', '600', '700'], variable: '--font-sans', display: 'swap' });

export const metadata: Metadata = {
  title: 'Submarine',
  description: 'Trade every token on Zero from one screen.',
};

export const viewport: Viewport = { themeColor: '#0a0a0d', width: 'device-width', initialScale: 1 };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Reading the request makes every page render per request, which is what lets each one carry its own script nonce.
  await headers();
  return (
    <html lang="en" className={sans.variable}>
      <body>
        <Shell>{children}</Shell>
      </body>
    </html>
  );
}
