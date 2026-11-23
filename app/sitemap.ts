import type { MetadataRoute } from 'next';
import { siteOrigin,isPublicProduction } from '@/lib/site-metadata';
export default function sitemap():MetadataRoute.Sitemap {
  const url=siteOrigin();
  return url && isPublicProduction()?[{url:url.href,changeFrequency:'weekly',priority:1}]:[];
}
