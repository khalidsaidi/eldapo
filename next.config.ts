import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      {
        source: '/v1/entries:publish',
        destination: '/v1/entries/publish',
      },
    ];
  },
};

export default nextConfig;
