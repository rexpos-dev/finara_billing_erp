/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Isolated from the default .next used by `next dev` (port 3000), so a
  // `next build && next start -p 3004` demo run never collides with the dev
  // server's live build cache when both run at the same time.
  distDir: process.env.NEXT_BUILD_DIR || '.next',
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000'}/api/:path*`,
      },
    ];
  },
};

module.exports = nextConfig;
