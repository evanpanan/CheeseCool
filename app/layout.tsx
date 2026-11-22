import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  applicationName: 'CheeseCool',
  title: { default: 'CheeseCool · 把好东西都存起来', template: '%s · CheeseCool' },
  description: '把好东西都存起来。智能收藏与芝士库。',
  openGraph: {
    siteName: 'CheeseCool',
    title: 'CheeseCool · 把好东西都存起来',
    description: '智能收藏与芝士库。',
    type: 'website',
  },
  appleWebApp: { capable: true, title: 'CheeseCool', statusBarStyle: 'default' },
  robots: { index: false, follow: false },
  referrer: 'same-origin',
};

export const viewport: Viewport = {
  themeColor: '#FFFFFF',
  colorScheme: 'light',
  viewportFit: 'cover',
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}
