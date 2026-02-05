/** @type {import('next').NextConfig} */
const backendUrl =
  process.env.BACKEND_URL ||
  process.env.BACKEND_URL_INTERNAL ||
  process.env.NEXT_PUBLIC_API_URL ||
  'http://localhost:8001';

const nextConfig = {
  async rewrites() {
    return [
      {
        source: '/backend/:path*',
        destination: `${backendUrl}/:path*`,
      },
      // Proxy backend API to same-origin to avoid CORS / client "localhost" issues.
      {
        source: '/health',
        destination: `${backendUrl}/health`,
      },
      {
        source: '/documents/:path*',
        destination: `${backendUrl}/documents/:path*`,
      },
      {
        source: '/pipeline/:path*',
        destination: `${backendUrl}/pipeline/:path*`,
      },
    ];
  },
};

module.exports = nextConfig;
