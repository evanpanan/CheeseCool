import { createHash } from 'node:crypto';
import { Readability } from '@mozilla/readability';
import { JSDOM } from 'jsdom';
import { identify, webUrl } from './urls';
import { readPublic,PublicReadError } from './public-http';
import {githubSource} from './github-source';
import {homepageOverview} from './homepage';
import {structuredArticle,semanticArticle} from './structured-article';
import {socialPage,youtubeSource,youtubeId,genericSocialShell} from './social-source';

const clean = (value: string | null | undefined, size: number) =>
  (value ?? '').replace(/\s+/g, ' ').trim().slice(0, size);

function imageUrl(value: string, base: URL) {
  try {
    const url = webUrl(new URL(value, base).href);
    return url.protocol === 'https:' ? url.href : null;
  } catch { return null; }
}

export function extractHtml(html: string, url: URL) {
  const dom = new JSDOM(html, { url: url.href });
  try {
    const doc = dom.window.document;
    const meta = (key: string) =>
      doc.querySelector(`meta[property="${key}"],meta[name="${key}"]`)?.getAttribute('content');
    const social=socialPage(doc,url);
    if(social)return {...social,cover_url:social.cover_url?imageUrl(social.cover_url,url):null,capture:social.capture_scope,contentTruncated:social.source_truncated};
    const image = meta('og:image') || meta('twitter:image');
    const title = meta('og:title') || meta('twitter:title') || doc.title;
    const description = meta('og:description') || meta('twitter:description') || meta('description');
    const restricted=/^(?:just a moment|access denied|attention required|security verification|verify you are human|sign in|log in|登录|安全验证|访问受限)/i.test(clean(title,240))||Boolean(doc.querySelector('input[type="password"]')&&clean(doc.body?.textContent,2000).length<500);
    const blocked=restricted||genericSocialShell(clean(title,240),clean(description,1000),url);
    const homepage=blocked?null:homepageOverview(doc,url);
    if(homepage)return {title:clean(title,240),summary:clean(homepage.summary,420),content:homepage.content,cover_url:image?imageUrl(image,url):null,restriction:null,capture:homepage.content.length>=80?'homepage':'homepage_metadata_only',contentTruncated:false};
    const structured=blocked?null:structuredArticle(doc,url),semantic=blocked?'':semanticArticle(doc);
    const article = new Readability(doc, { maxElemsToParse: 25_000 }).parse();
    const chosen=structured&&structured.body.length>(article?.textContent?.length||0)*1.15?structured.body:article?.textContent||semantic;
    const fullText=(chosen||'').replace(/\r\n?/g,'\n').split('\n').map(s=>s.replace(/[\t ]+/g,' ').trim()).filter(Boolean).join('\n\n').trim();
    const text=Array.from(fullText).slice(0,500000).join('');
    return {
      title: clean(title || article?.title || structured?.title, 240),
      summary: clean(description || article?.excerpt || text, 420),
      content: text || clean(description, 120_000),
      cover_url: image ? imageUrl(image, url) : null,
      restriction:restricted?'access':blocked?'platform_shell':null,
      capture:blocked?'blocked':text.length>=80?(chosen===structured?.body?'structured_article':chosen===semantic?'semantic_article':'article'):'metadata_only',contentTruncated:Array.from(fullText).length>500000,
    };
  } finally {
    dom.window.close();
  }
}

async function specialized(url: URL,read=readPublic) {
  const platform = identify(url);
  if(platform==='github')return githubSource(url,read);
  const video=await youtubeSource(url,read);if(video)return video;
  if (platform === 'x' && /\/status\/\d+/.test(url.pathname)) {
    const api = new URL('https://publish.twitter.com/oembed');
    api.search = new URLSearchParams({ url: url.href, omit_script: 'true' }).toString();
    const { text } = await read(api, 'application/json');
    const data = JSON.parse(text);
    const dom = new JSDOM(typeof data.html === 'string' ? data.html : '');
    try {
      const originalText=dom.window.document.querySelector('blockquote p')?.textContent||'';const content=clean(originalText,24000);
      if (!content) return null;
      return {title:clean(content,100),summary:clean(content,420),content,cover_url:null,raw_source:text,media_type:'application/json',capture_scope:'public_embed',source_truncated:originalText.length>24000};
    } finally { dom.window.close(); }
  }
  return null;
}

export function captureFailure(error:unknown,blocked=false){
 if(blocked)return {code:'source_restricted',retryable:false};
 if(error instanceof PublicReadError)return {code:error.code,retryable:error.retryable};
 const message=error instanceof Error?error.message:'';
 if(/公开网络|公开域名|有效的公开网页|来源页面过大|字符编码|重定向次数/.test(message))return {code:'source_format',retryable:false};
 return {code:error?'source_temporary':'source_empty',retryable:Boolean(error)};
}

export async function extract(input: URL,validators?:{etag?:string|null;lastModified?:string|null},read=readPublic) {
  let pageError:unknown;
  const [page, originalExtra] = await Promise.all([
    read(input,undefined,identify(input)==='web'?validators:undefined).catch(error => {pageError=error;return null;}),
    specialized(input,read).catch(() => null),
  ]);
  const url = originalExtra ? input : page?.url ?? input;
  if(page?.notModified)return {failure:null,notModified:true,source:null,data:null,final_url:url.href,platform:identify(url),completeness:'unchanged',etag:page.etag,lastModified:page.lastModified};
  let html: ReturnType<typeof extractHtml> | null = null;
  if (page) {
    try { html = extractHtml(page.text, page.url); }
    catch { /* A public API response can still supply content. */ }
  }
  // A short-link shell or missing watch page must not prevent reading the canonical public video page.
  const videoId=youtubeId(input);
  if(videoId&&(!html||!('capture_scope' in html)||html.capture_scope==='video_metadata_only')){
    const fallback=new URL(input.hostname==='www.youtube.com'&&input.pathname==='/watch'?'https://www.youtube.com/embed/'+videoId:'https://www.youtube.com/watch?v='+videoId);
    if(page?.url.href!==fallback.href)try{const response=await read(fallback),candidate=extractHtml(response.text,response.url);if('capture_scope' in candidate&&candidate.capture_scope==='video_description_partial')html=candidate;}catch{/* Keep any concrete oEmbed metadata already collected. */}
  }
  const extra = html&&'capture_scope' in html ? html : originalExtra ?? (url.href !== input.href
    ? await specialized(url,read).catch(() => null) : null);
  const platform = identify(url);
  // Social pages can expose only a login shell. Require platform metadata or a public embed.
  const validHtml = !genericSocialShell(html?.title||'',html?.summary||'',url)&&html?.capture!=='blocked'&&html?.content && (platform === 'web' || platform === 'github' ||
    (html.title && html.summary));
  const data = extra ? { ...extra, cover_url: html?.cover_url ?? extra.cover_url } : validHtml ? html : null;
  return {
    failure:data?.content?null:captureFailure(pageError,Boolean(html&&'restriction' in html&&html.restriction==='access')),
    notModified:false,etag:page?.etag,lastModified:page?.lastModified,
    source: data?.content ? { raw: (extra?.raw_source || page?.text || data.content).slice(0, 1000000), mediaType:extra?.media_type||(page?'text/html':'text/plain'), truncated: (extra?.raw_source || page?.text || data.content).length > 1000000 || Boolean(extra?.source_truncated||!extra&&html?.contentTruncated) } : null,
    data: data?.content ? {
      content:data.content,summary:data.summary,cover_url:data.cover_url,
      title: data.title || url.hostname,
      source_hash: createHash('sha256').update(data.content).digest('hex'),
      fetched_at: new Date().toISOString(),
    } : null,
    final_url: url.href,
    platform,
    completeness:extra?extra.capture_scope:platform==='github'?'github_html_partial':platform!=='web'?'metadata_only':html?.capture||'metadata_only',
  };
}
