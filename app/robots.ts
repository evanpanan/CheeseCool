import type { MetadataRoute } from 'next';
import { siteOrigin,isPublicProduction } from '@/lib/site-metadata';
export default function robots():MetadataRoute.Robots {
  const url=siteOrigin();
  if(!isPublicProduction() || !url)return {rules:{userAgent:'*',disallow:'/'}};
  return {rules:{userAgent:'*',allow:'/',disallow:['/login','/settings','/network','/auth/']},sitemap:new URL('/sitemap.xml',url).href,host:url.origin};
}
