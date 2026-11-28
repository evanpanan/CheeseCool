import {readPublic} from './public-http';
const text=(v:unknown,max=120000)=>typeof v==='string'?Array.from(v.trim()).slice(0,max).join(''):'';
const host=(u:URL,d:string)=>u.hostname===d||u.hostname.endsWith('.'+d);
export function youtubeId(u:URL){if(host(u,'youtu.be'))return u.pathname.split('/')[1]?.match(/^[\w-]{11}$/)?.[0]||null;if(!host(u,'youtube.com')&&!host(u,'youtube-nocookie.com'))return null;const id=u.searchParams.get('v')||u.pathname.match(/^\/(?:shorts|embed|live)\/([\w-]{11})(?:\/|$)/)?.[1];return id&&/^[\w-]{11}$/.test(id)?id:null;}
// Some public hydration objects contain the JS literal undefined; only normalize it outside strings.
function jsonState(raw:string){let out='',quoted=false,escape=false;for(let i=0;i<raw.length;i++){const c=raw[i];if(quoted){out+=c;if(escape)escape=false;else if(c==='\\')escape=true;else if(c==='"')quoted=false;}else if(c==='"'){quoted=true;out+=c;}else if(raw.startsWith('undefined',i)&&/[:\[,\s]/.test(raw[i-1]||'')&&/[\s,}\]]/.test(raw[i+9]||'')){out+='null';i+=8;}else out+=c;}return JSON.parse(out);}
/** Read a JSON object after a known assignment. Never evaluate page JavaScript. */
export function assignedJson(doc:Document,name:string){for(const script of [...doc.querySelectorAll('script')].slice(0,100)){const raw=script.textContent||'';if(raw.length>1800000)continue;const match=new RegExp('(?:var\\s+|window\\.)?'+name+'\\s*=\\s*(\\{)|window\\[\\s*[\"\']'+name+'[\"\']\\s*\\]\\s*=\\s*(\\{)').exec(raw);if(!match)continue;const start=match.index+match[0].length-1;let depth=0,quoted=false,escape=false;for(let i=start;i<raw.length;i++){const c=raw[i];if(quoted){if(escape)escape=false;else if(c==='\\')escape=true;else if(c==='"')quoted=false;}else if(c==='"')quoted=true;else if(c==='{')depth++;else if(c==='}'&&!--depth){try{return jsonState(raw.slice(start,i+1));}catch{return null;}}}}return null;}
function result(title:string,description:string,author:string,cover:string|null,scope:string,raw:string){const content=[title,author?'作者：'+author:'',description].filter(Boolean).join('\n\n');return {title,summary:text(description||content,420),content,cover_url:cover,raw_source:raw,media_type:'application/json',capture_scope:scope,source_truncated:content.length>120000};}
function richText(value:any){return text(typeof value==='string'?value:value?.simpleText||value?.content||(Array.isArray(value?.runs)?value.runs.map((r:any)=>typeof r.text==='string'?r.text:'').join(''):''));}
function boundVideoJsonLd(doc:Document,id:string,url:URL){
 let visited=0;
 function visit(value:any,depth=0):any{
  if(!value||typeof value!=='object'||depth>8||++visited>1200)return null;
  if(Array.isArray(value)){for(const item of value.slice(0,100)){const found=visit(item,depth+1);if(found)return found;}return null;}
  const types=[value['@type']].flat();
  if(types.includes('VideoObject')&&[value.url,value.embedUrl,value.contentUrl,value['@id']].some(v=>{try{return typeof v==='string'&&youtubeId(new URL(v,url))===id;}catch{return false;}})&&text(value.name)&&text(value.description))return value;
  for(const key of ['@graph','mainEntity','video']){const found=visit(value[key],depth+1);if(found)return found;}return null;
 }
 for(const script of [...doc.querySelectorAll('script[type="application/ld+json"]')].slice(0,24)){const raw=script.textContent||'';if(raw.length>600000)continue;try{const found=visit(JSON.parse(raw));if(found)return found;}catch{}}
 return null;
}
function douyinPage(doc:Document,url:URL){
 if(!host(url,'douyin.com')&&!host(url,'iesdouyin.com'))return null;
 const id=url.pathname.match(/\/(?:video|note)\/(\d+)(?:\/|$)/)?.[1]||url.searchParams.get('modal_id');if(!id||!/^\d{10,30}$/.test(id))return null;
 const states=[assignedJson(doc,'_ROUTER_DATA'),assignedJson(doc,'__INITIAL_STATE__')];
 const raw=doc.querySelector('script#RENDER_DATA')?.textContent||'';if(raw&&raw.length<1800000)try{states.push(JSON.parse(decodeURIComponent(raw)));}catch{}
 let visited=0;
 function visit(value:any,depth=0):any{
  if(!value||typeof value!=='object'||depth>12||++visited>3000)return null;
  if(String(value.aweme_id||value.awemeId||'')===id&&text(value.desc))return value;
  for(const child of (Array.isArray(value)?value.slice(0,100):Object.values(value).slice(0,100))){const found=visit(child,depth+1);if(found)return found;}return null;
 }
 for(const state of states){const note=visit(state);if(note)return result(text(note.desc,100),text(note.desc),text(note.author?.nickname,160),null,'video_description_partial',JSON.stringify(note));}return null;
}
export function socialPage(doc:Document,url:URL){
 const id=youtubeId(url);
 if(id){const state=assignedJson(doc,'ytInitialPlayerResponse'),v=state?.videoDetails;const thumb=Array.isArray(v?.thumbnail?.thumbnails)?v.thumbnail.thumbnails.at(-1)?.url:null;const player=v?.videoId===id&&text(v.title)?result(text(v.title,240),text(v.shortDescription),text(v.author,160),typeof thumb==='string'&&thumb.startsWith('https://')?thumb:null,text(v.shortDescription)?'video_description_partial':'video_metadata_only',JSON.stringify(state)):null;if(player?.capture_scope==='video_description_partial')return player;
 const ld=boundVideoJsonLd(doc,id,url);if(ld)return result(text(ld.name,240),text(ld.description),text(typeof ld.author==='string'?ld.author:ld.author?.name,160),null,'video_description_partial',JSON.stringify(ld));
 const initial=assignedJson(doc,'ytInitialData');
 const canonical=doc.querySelector('link[rel="canonical"]')?.getAttribute('href')||'';
 const bound=initial?.currentVideoEndpoint?.watchEndpoint?.videoId===id||Boolean(canonical)&&(()=>{try{return youtubeId(new URL(canonical,url))===id;}catch{return false;}})();
 if(bound){
  const entries=initial?.contents?.twoColumnWatchNextResults?.results?.results?.contents;const contents=Array.isArray(entries)?entries:[];
  const primary=contents.find((x:any)=>x.videoPrimaryInfoRenderer)?.videoPrimaryInfoRenderer;
  const secondary=contents.find((x:any)=>x.videoSecondaryInfoRenderer)?.videoSecondaryInfoRenderer;
  const title=richText(primary?.title),description=richText(secondary?.attributedDescription)||richText(secondary?.description);
  if(title&&description)return result(text(title,240),description,richText(secondary?.owner?.videoOwnerRenderer?.title),null,'video_description_partial',JSON.stringify({videoId:id,title,description}));
 }
 const meta=(key:string)=>doc.querySelector('meta[property="'+key+'"],meta[name="'+key+'"],meta[itemprop="'+key+'"]')?.getAttribute('content')||'';
 const title=meta('og:title')||meta('name'),description=meta('og:description')||meta('description');
 if(title&&description&&!genericSocialShell(title,description,url))return result(text(title,240),text(description),meta('author'),meta('og:image')||null,'video_description_partial',JSON.stringify({title,description}));if(player)return player;}

 if(host(url,'xiaohongshu.com')){const id=url.pathname.match(/\/(?:explore|discovery\/item)\/([a-f\d]{24})(?:\/|$)/i)?.[1];if(!id)return null;const state=assignedJson(doc,'__INITIAL_STATE__'),map=state?.note?.noteDetailMap;const note=map?.[id]?.note;if(note&&note.noteId===id&&(text(note.title)||text(note.desc))){return result(text(note.title,240)||text(note.desc,100),text(note.desc),text(note.user?.nickname,160),null,'social_post_partial',JSON.stringify(note));}}
 return douyinPage(doc,url);
}
export async function youtubeSource(url:URL,read: (url:URL,accept?:string)=>Promise<{text:string}>=readPublic){const id=youtubeId(url);if(!id)return null;const endpoint=new URL('https://www.youtube.com/oembed');endpoint.search=new URLSearchParams({url:'https://www.youtube.com/watch?v='+id,format:'json'}).toString();const raw=await read(endpoint,'application/json'),data=JSON.parse(raw.text);if(data.type!=='video'||!text(data.title)||genericSocialShell(text(data.title),'',url))return null;return result(text(data.title,240),'',text(data.author_name,160),typeof data.thumbnail_url==='string'&&data.thumbnail_url.startsWith('https://')?data.thumbnail_url:null,'video_metadata_only',raw.text);}
export function genericSocialShell(title:string,description:string,url:URL){return Boolean(youtubeId(url)&&(/^(?:-?\s*)?YouTube\s*$/i.test(title)||/Enjoy the videos and music you love|视频和音乐|upload original content/i.test(description)))||Boolean(host(url,'xiaohongshu.com')&&/^(?:小红书(?:\s*[-—]|$)|登录|安全验证|log in|sign in|rednote\s*[-—])/i.test(title));}
