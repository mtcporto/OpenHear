import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Cabecalhos necessarios para AudioContext e AudioWorklet funcionarem
  // corretamente em browsers modernos (incluindo Android Chrome)
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
        ],
      },
    ];
  },
};

export default nextConfig;
