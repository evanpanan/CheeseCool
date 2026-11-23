import type { Metadata } from 'next';
export const siteTitle='CheeseCool · 把好东西都存起来';
export const siteDescription='用 CheeseCool 收藏文章、视频和工具链接，让 AI 生成摘要、整理主题，发现内容之间的关联，建立可交互的个人芝士库。';
export function siteOrigin(env:Record<string,string|undefined>=process.env):URL|null {
  const value=env.NEXT_PUBLIC_SITE_URL || env.VERCEL_PROJECT_PRODUCTION_URL || env.VERCEL_URL;
  if(!value)return null;
  try {
    const url=new URL(value.includes('://')?value:'https://'+value);
    if(!['http:','https:'].includes(url.protocol) || url.username || url.password)return null;
    return new URL(url.origin);
  } catch {return null;}
}
export function isPublicProduction(env:Record<string,string|undefined>=process.env) {
  const url=siteOrigin(env);
  return Boolean(url && !['localhost','127.0.0.1','[::1]'].includes(url.hostname) && (!env.VERCEL_ENV || env.VERCEL_ENV==='production'));
}
export function siteMetadata(env:Record<string,string|undefined>=process.env):Metadata {
  const url=siteOrigin(env);
  const index=isPublicProduction(env);
  return {
    metadataBase:url ?? new URL('http://localhost:3000'),
    applicationName:'CheeseCool',
    title:{default:siteTitle,template:'%s · CheeseCool'},
    description:siteDescription,
    keywords:['CheeseCool','芝士库','AI 收藏','个人知识库','知识图谱','智能摘要','链接收藏'],
    category:'productivity',
    manifest:'/manifest.webmanifest',
    icons:{icon:[{url:'/favicon.svg?v=cheese2',type:'image/svg+xml',sizes:'any'},{url:'/favicon.ico?v=cheese2',sizes:'16x16 32x32 48x48'}],apple:[{url:'/apple-icon.png',sizes:'180x180',type:'image/png'}]},
    openGraph:{siteName:'CheeseCool',locale:'zh_CN',title:siteTitle,description:siteDescription,type:'website',url:url?.href,
      images:[{url:'/cheesecool-social.png',width:1200,height:630,type:'image/png',alt:'CheeseCool · 把好东西都存起来，AI 智能收藏与知识关联'}]},
    twitter:{card:'summary_large_image',title:siteTitle,description:siteDescription,images:[{url:'/cheesecool-social.png',alt:'CheeseCool · AI 智能收藏与芝士库'}]},
    appleWebApp:{capable:true,title:'CheeseCool',statusBarStyle:'default'},
    robots:{index,follow:index,googleBot:{index,follow:index,'max-image-preview':'large','max-snippet':-1,'max-video-preview':-1}},
    referrer:'same-origin',
  };
}
export function siteStructuredData(env:Record<string,string|undefined>=process.env) {
  const url=siteOrigin(env);if(!url)return null;
  return {'@context':'https://schema.org','@graph':[
    {'@type':'WebSite','@id':url.href+'#website',name:'CheeseCool',alternateName:'芝士库',url:url.href,inLanguage:'zh-CN',description:siteDescription},
    {'@type':'WebApplication','@id':url.href+'#application',name:'CheeseCool',url:url.href,applicationCategory:'ProductivityApplication',operatingSystem:'Web',inLanguage:'zh-CN',description:siteDescription,image:new URL('/cheesecool-social.png',url).href},
  ]};
}
