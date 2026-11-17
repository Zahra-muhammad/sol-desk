import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Native/WASM packages must be loaded by Node at runtime, not bundled.
  serverExternalPackages: ['@node-rs/argon2', '@electric-sql/pglite', 'postgres'],
  poweredByHeader: false,
  // The dev badge sits on top of the start button.
  devIndicators: false,
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          // Never let another site frame the lock screen.
          { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'no-referrer' },
          { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ];
  },
};

export default nextConfig;
