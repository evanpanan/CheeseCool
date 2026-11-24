import { createHash } from 'node:crypto';
import { Readability } from '@mozilla/readability';
import { JSDOM } from 'jsdom';
import { identify, webUrl } from './urls';
import { readPublic } from './public-http';

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
    const image = meta('og:image') || meta('twitter:image');
    const title = meta('og:title') || meta('twitter:title') || doc.title;
    const description = meta('og:description') || meta('twitter:description') || meta('description');
    const blocked=/^(?:just a moment|access denied|attention required|security verification|verify you are human|sign in|log in|登录|安全验证|访问受限)/i.test(clean(title,240))||Boolean(doc.querySelector('input[type="password"]')&&clean(doc.body?.textContent,2000).length<500);
    const article = new Readability(doc, { maxElemsToParse: 25_000 }).parse();
    const fullText=(article?.textContent||'').replace(/\r\n?/g,'\n').split('\n').map(s=>s.replace(/[\t ]+/g,' ').trim()).filter(Boolean).join('\n\n').trim();
    const text=Array.from(fullText).slice(0,500000).join('');
    return {
      title: clean(title || article?.title, 240),
      summary: clean(description || article?.excerpt || text, 420),
      content: text || clean(description, 120_000),
      cover_url: image ? imageUrl(image, url) : null,
      capture:blocked?'blocked':text.length>=80?'article':'metadata_only',contentTruncated:Array.from(fullText).length>500000,
    };
  } finally {
    dom.window.close();
  }
}

async function specialized(url: URL) {
  const platform = identify(url);
  const github = url.pathname.match(/^\/([\w.-]+)\/([\w.-]+)\/?$/);
  if (platform === 'github' && github && url.hostname === 'github.com') {
    const api = new URL(`https://api.github.com/repos/${github[1]}/${github[2]}`);
    const [repoResponse, readmeResponse] = await Promise.allSettled([
      readPublic(api, 'application/vnd.github+json'),
      readPublic(new URL(api.href + '/readme'), 'application/vnd.github+json'),
    ]);
    if (repoResponse.status === 'rejected') return null;
    const repo = JSON.parse(repoResponse.value.text);
    const readme = readmeResponse.status === 'fulfilled' ? JSON.parse(readmeResponse.value.text) : null;
    const text = readme?.encoding === 'base64' && typeof readme.content === 'string'
      ? Buffer.from(readme.content, 'base64').toString('utf8') : '';
    const combined=[repo.description,repo.language,repo.topics?.join(', '),text].filter(Boolean).join('\n\n');
    return {
      title: clean(repo.full_name, 240),
      summary: clean(repo.description || text, 420),
      content:Array.from(combined).slice(0,500000).join(''),raw_source:JSON.stringify({repository:repo,readme}),media_type:'application/json',capture_scope:text?'repository':'repository_metadata',source_truncated:Array.from(combined).length>500000,
      cover_url: null,
    };
  }
  if (platform === 'x' && /\/status\/\d+/.test(url.pathname)) {
    const api = new URL('https://publish.twitter.com/oembed');
    api.search = new URLSearchParams({ url: url.href, omit_script: 'true' }).toString();
    const { text } = await readPublic(api, 'application/json');
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

export async function extract(input: URL,validators?:{etag?:string|null;lastModified?:string|null}) {
  const [page, originalExtra] = await Promise.all([
    readPublic(input,undefined,identify(input)==='web'?validators:undefined).catch(() => null),
    specialized(input).catch(() => null),
  ]);
  const url = originalExtra ? input : page?.url ?? input;
  if(page?.notModified)return {notModified:true,source:null,data:null,final_url:url.href,platform:identify(url),completeness:'unchanged',etag:page.etag,lastModified:page.lastModified};
  let html: ReturnType<typeof extractHtml> | null = null;
  if (page) {
    try { html = extractHtml(page.text, page.url); }
    catch { /* A public API response can still supply content. */ }
  }
  const extra = originalExtra ?? (url.href !== input.href
    ? await specialized(url).catch(() => null) : null);
  const platform = identify(url);
  // Social pages can expose only a login shell. Require platform metadata or a public embed.
  const validHtml = html?.capture!=='blocked'&&html?.content && (platform === 'web' || platform === 'github' ||
    (html.cover_url && html.title && html.summary));
  const data = extra ? { ...extra, cover_url: html?.cover_url ?? extra.cover_url } : validHtml ? html : null;
  return {
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
    completeness:extra?extra.capture_scope:['douyin','xiaohongshu'].includes(platform)?'metadata_only':html?.capture||'metadata_only',
  };
}
