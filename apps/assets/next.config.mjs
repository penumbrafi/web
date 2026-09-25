/** @type {import('next').NextConfig} */
const nextConfig = {
  // Ship a self-contained server.js tree: the deploy workflow tars
  // .next/standalone and the systemd unit runs `node server.js` from it.
  output: 'standalone',
  experimental: {
    optimizePackageImports: ['recharts'],
  },
  logging: {
    incomingRequests: false,
  },
};

export default nextConfig;
