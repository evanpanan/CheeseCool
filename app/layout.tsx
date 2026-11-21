import type { Metadata, Viewport } from 'next';
import './globals.css';
import { SiteFooter } from './site-footer';

export const metadata: Metadata = {
  applicationName: 'CheeseCool',
  title: { default: 'CheeseCool — Save the cool stuff.', template: '%s · CheeseCool' },
  description: '把好东西都存起来。你的 AI 智能收藏与芝士库。',
  openGraph: {
    siteName: 'CheeseCool',
    title: 'CheeseCool — Save the cool stuff.',
    description: 'Your AI-powered second brain.',
    type: 'website',
  },
  appleWebApp: { capable: true, title: 'CheeseCool', statusBarStyle: 'default' },
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

export const viewport: Viewport = {
  themeColor: '#FFFFFF',
  colorScheme: 'light',
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return <html lang="zh-CN"><body>
    <div className="site-body">{children}</div>
    <SiteFooter/>
  </body></html>;
}
