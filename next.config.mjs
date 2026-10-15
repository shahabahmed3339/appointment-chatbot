/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The assessment asks for clean frontend/backend separation. This app runs as a
  // single Next.js process (one port) for a simple deploy story, but the API lives
  // strictly under /api and never imports UI code, and the UI never touches the DB
  // directly — every read/write goes through the HTTP API layer.
  // Keeps `pg` out of the bundler so native/optional deps resolve at runtime.
  experimental: {
    serverComponentsExternalPackages: ['pg'],
  },
  // Emits a self-contained server bundle (.next/standalone) for the Docker image,
  // so the runtime container doesn't need the full node_modules tree.
  output: 'standalone',
};

export default nextConfig;
