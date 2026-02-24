import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // Amplify SSR 배포를 위해 standalone 모드 필수
  output: 'standalone',
  // Amplify SSR Lambda는 runtime process.env를 주입하지 않는 경우가 있음
  // 빌드 타임(Amplify 콘솔 env 주입 시점)에 값을 서버 번들에 직접 포함시켜 해결
  env: {
    GOOGLE_MAPS_API_KEY: process.env.GOOGLE_MAPS_API_KEY ?? '',
    OPENAI_API_KEY: process.env.OPENAI_API_KEY ?? '',
  },
  images: {
    remotePatterns: [
      {
        // Google Places 음식점 사진
        protocol: 'https',
        hostname: 'maps.googleapis.com',
      },
      {
        protocol: 'https',
        hostname: 'places.googleapis.com',
      },
      {
        protocol: 'https',
        hostname: 'lh3.googleusercontent.com',
      },
    ],
  },
}

export default nextConfig
