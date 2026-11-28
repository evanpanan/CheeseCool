import {structuredArticle} from './structured-article';

/** Identify landing pages without mistaking an explicitly marked root article for a home page. */
export function homepageLocation(url:URL){
 if([...url.searchParams.keys()].some(key=>!/^(?:utm_.*|ref|source|from|lang|locale|fbclid|gclid)$/i.test(key)))return false;
 return /^\/(?:index\.(?:html?|php)|home|(?:[a-z]{2}(?:-[a-z]{2})?)(?:\/home)?)?\/?$/i.test(url.pathname);
}
const normalize=(value:string)=>value.replace(/\s+/g,' ').trim();
export function homepageOverview(doc:Document,url:URL){
 if(!homepageLocation(url))return null;
 if(structuredArticle(doc,url)?.matched)return null;
 if(doc.querySelector('meta[property="og:type"]')?.getAttribute('content')==='article'||doc.querySelector('meta[property="article:published_time"]'))return null;
 const headings=[...doc.querySelectorAll('h1,h2,h3')];
 const explicitHome=/^(?:home(?:page)?\b|首页|主页)/i.test(doc.title.trim())||doc.querySelector('meta[property="og:type"]')?.getAttribute('content')==='website';
 if(doc.querySelectorAll('article').length===1&&!explicitHome&&headings.every(node=>node.closest('article')))return null;
 const root=(doc.querySelector('main,[role="main"]')||doc.body)?.cloneNode(true) as Element|undefined;if(!root)return null;
 root.querySelectorAll('script,style,noscript,nav,footer,aside,form,button,input,textarea,[hidden],[aria-hidden="true"],[role="navigation"],[class~="news"],[class~="blog"],[class~="press"],[id="news"],[id="latest-news"],[id="newsletter"],[class*="cookie" i],[class~="footer"],[class*="newsletter" i]').forEach(node=>node.remove());
 // Linked article previews belong to their own URLs, not to the site's identity.
 root.querySelectorAll('article,a').forEach(node=>{
  if(node.tagName==='ARTICLE'&&(node.querySelector('time')||node.querySelector('a[href] h1,a[href] h2,a[href] h3')))node.remove();
  else if(node.tagName==='A'&&node.querySelector('h1,h2,h3,h4')){try{if(/^\/(?:news|blog|press|articles?|stories|updates)(?:\/|$)/i.test(new URL(node.getAttribute('href')||'',url).pathname)||node.querySelector('time'))node.remove();}catch{}}
 });
 const segments:string[]=[];const seen=new Set<string>();
 for(const node of [...root.querySelectorAll('h1,h2,h3,p,li,[role="heading"]')].slice(0,300)){
  if(node.parentElement?.closest('p,li')||node.closest('[style*="display:none"],[style*="display: none"]'))continue;
  const value=normalize(node.textContent||'');if(node.tagName==='LI'&&node.querySelector('a')&&value.length<60)continue;if(value.length<4||seen.has(value))continue;
  seen.add(value);segments.push(value.slice(0,1200));if(segments.join('\n\n').length>12000)break;
 }
 const description=normalize(doc.querySelector('meta[property="og:description"],meta[name="description"]')?.getAttribute('content')||'');
 const title=normalize(doc.querySelector('meta[property="og:title"]')?.getAttribute('content')||doc.title);
 const material=[title,description.length>=12?description:'',...segments].filter(Boolean);
 const content=Array.from([...new Set(material)].join('\n\n')).slice(0,16000).join('');
 return {content,summary:description.length>=12?description:segments.find(value=>value.length>=40)||segments[0]||title};
}
