import {JSDOM} from 'jsdom';

const articleTypes=new Set(['Article','NewsArticle','BlogPosting','TechArticle','ScholarlyArticle','Report']);
const normalize=(s:string)=>s.normalize('NFKC').replace(/\s+/gu,' ').trim().toLowerCase();
export function readableText(value:string){
 if(!/<\/?(?:p|div|br|h[1-6]|ul|li|pre|section|article)\b/i.test(value))return value.replace(/\r\n?/g,'\n').trim();
 const fragment=JSDOM.fragment(value.replace(/<br\s*\/?\s*>/gi,'\n').replace(/<\/(?:p|div|h[1-6]|li|pre|section|article)>/gi,'\n\n'));
 fragment.querySelectorAll('script,style,iframe,form').forEach(n=>n.remove());
 return (fragment.textContent||'').replace(/\r\n?/g,'\n').replace(/[\t ]+\n/g,'\n').replace(/\n{3,}/g,'\n\n').trim();
}
function samePage(value:unknown,url:URL){
 if(typeof value!=='string')return null;
 try{const candidate=new URL(value,url);const search=(u:URL)=>{const p=new URLSearchParams(u.search);for(const key of [...p.keys()])if(/^(utm_|fbclid$|gclid$)/i.test(key))p.delete(key);p.sort();return p.toString();};return candidate.origin===url.origin&&candidate.pathname.replace(/\/$/,'')===url.pathname.replace(/\/$/,'')&&search(candidate)===search(url);}catch{return false;}
}
/** Only explicit public article bodies, never arbitrary hydration strings or executable scripts. */
export function structuredArticle(doc:Document,url:URL){
 const candidates:{body:string;title:string;matched:boolean}[]=[];let visited=0,bytes=0;
 const title=doc.querySelector('meta[property="og:title"]')?.getAttribute('content')||doc.title;
 function visit(value:unknown,depth:number){
  if(depth>10||visited++>1500||!value||typeof value!=='object')return;
  if(Array.isArray(value)){for(const entry of value.slice(0,100))visit(entry,depth+1);return;}
  const item=value as Record<string,any>,types=[item['@type']].flat().filter(t=>typeof t==='string').map(t=>t.replace(/^https?:\/\/schema.org\//,''));
  if(types.some(t=>articleTypes.has(t))&&typeof item.articleBody==='string'&&item.articleBody.length>=80){
   const identity=item.url||item.mainEntityOfPage?.['@id']||(typeof item.mainEntityOfPage==='string'?item.mainEntityOfPage:null)||item['@id'];const match=samePage(identity,url);
   if(match!==false)candidates.push({body:readableText(item.articleBody),title:typeof item.headline==='string'?item.headline:'',matched:match===true});
  }
  for(const key of ['@graph','mainEntity','itemListElement','item'])visit(item[key],depth+1);
 }
 for(const script of [...doc.querySelectorAll('script[type="application/ld+json"]')].slice(0,32)){
  const text=script.textContent||'';bytes+=text.length;if(text.length>600000||bytes>1200000)continue;
  try{visit(JSON.parse(text),0);}catch{/* malformed metadata does not break the primary extractor */}
 }
 const bound=candidates.filter(c=>c.matched),headed=candidates.filter(c=>normalize(c.title)===normalize(title)&&normalize(title));
 const eligible=bound.length?bound:headed.length?headed:candidates.length===1?candidates:[];
 return eligible.sort((a,b)=>b.body.length-a.body.length)[0]||null;
}
export function semanticArticle(doc:Document){
 const root=doc.querySelector('article')||doc.querySelector('main,[role="main"]');if(!root)return '';
 const copy=root.cloneNode(true) as HTMLElement;
 copy.querySelectorAll('script,style,noscript,nav,aside,header,footer,form,button,input,iframe,[hidden],[aria-hidden="true"],[role="navigation"]').forEach(n=>n.remove());
 return readableText(copy.innerHTML);
}
