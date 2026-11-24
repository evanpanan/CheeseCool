import type { Metadata, Viewport } from 'next';
import { siteMetadata, siteStructuredData } from '@/lib/site-metadata';
import { appearanceBootstrap } from '@/lib/appearance';
import './globals.css';
import './appearance.css';
import './interaction.css';
import './intelligence.css';
import './header-controls.css';
import './account-menu.css';
import { SessionMotion } from './session-motion';

export const metadata: Metadata = siteMetadata();

export const viewport: Viewport = {
  themeColor: '#FFFFFF',
  colorScheme: 'light dark',
  viewportFit: 'cover',
};

export default function Layout({ children }: { children: React.ReactNode }) {
  const structured=siteStructuredData();
  return <html lang="zh-CN" suppressHydrationWarning>
    <head><script dangerouslySetInnerHTML={{ __html: appearanceBootstrap }}/>{structured && <script type="application/ld+json" dangerouslySetInnerHTML={{__html:JSON.stringify(structured).replace(/</g,'\\u003c')}}/>}</head>
    <body>{children}<SessionMotion/></body>
  </html>;
}
