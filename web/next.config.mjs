// The Content-Security-Policy is set per request in src/proxy.ts, since it carries a fresh script nonce for each page.

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Nothing here uses next/image, and its resizer is where Next's worst known holes are, so it isn't left running.
  images: { unoptimized: true },
  // Lets a production build run beside a dev server, which would otherwise share this folder with it.
  distDir: process.env.NEXT_DIST_DIR || '.next',
  experimental: {
    optimizePackageImports: ['viem'],
    cpus: 2, // builds run on a server other projects share, and each worker holds its own memory
  },
  async headers() {
    if (process.env.NODE_ENV !== 'production') return [];
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          { key: 'Cross-Origin-Opener-Policy', value: 'same-origin-allow-popups' },
        ],
      },
    ];
  },
};

export default nextConfig;
