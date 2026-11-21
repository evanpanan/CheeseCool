import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: 'CheeseCool',
    short_name: 'CheeseCool',
    description: '你的 AI 智能收藏与芝士库。',
    start_url: '/',
    display: 'standalone',
    lang: 'zh-CN',
    background_color: '#FFFFFF',
    theme_color: '#FFFFFF',
    icons: [
      { src: '/cheesecool-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/cheesecool-512.png', sizes: '512x512', type: 'image/png' },
    ],
  };
}
