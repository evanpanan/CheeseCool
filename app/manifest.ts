import type { MetadataRoute } from 'next';
import {siteDescription} from '@/lib/site-metadata';

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: 'CheeseCool',
    short_name: 'CheeseCool',
    description: siteDescription,
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
