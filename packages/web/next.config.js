/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: true },
  // Rewrites go through Next's own proxy, which drops the upstream socket after
  // 30s by default. Image generation (plan + Nano Banana Pro + QA) takes ~60s,
  // so the browser was getting "socket hang up" while the API finished the job.
  experimental: { proxyTimeout: 300_000 },
  async rewrites() {
    const apiUrl = process.env.API_INTERNAL_URL || (process.env.NODE_ENV === 'production' ? 'http://api:3001' : 'http://localhost:3001');
    return [
      {
        source: '/api/:path*',
        destination: `${apiUrl}/api/:path*`,
      },
    ];
  },
};

module.exports = nextConfig;
