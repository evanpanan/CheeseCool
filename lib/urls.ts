export const platformNames = {
  web: '网页', x: 'X', github: 'GitHub', xiaohongshu: '小红书', douyin: '抖音',
} as const;

export type Platform = keyof typeof platformNames;

export function identify(url: URL): Platform {
  const host = url.hostname;
  const matches = (domain: string) => host === domain || host.endsWith('.' + domain);
  if (matches('github.com')) return 'github';
  if (matches('x.com') || matches('twitter.com') || matches('t.co')) return 'x';
  if (matches('xiaohongshu.com') || matches('xhslink.com') || matches('xhslink.cn')) return 'xiaohongshu';
  if (matches('douyin.com') || matches('iesdouyin.com')) return 'douyin';
  return 'web';
}

export function webUrl(input: string): URL {
  const url = new URL(input);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
      url.port || url.href.length > 2048) {
    throw new Error('请输入有效的公开网页链接。');
  }
  return url;
}

export function pastedUrl(value: string): URL {
  const match = value.match(/https?:\/\/[^\s<>"，。！？、；【】]+/i);
  if (!match) throw new Error('请粘贴包含 http 或 https 的链接。');
  return webUrl(match[0].replace(/[)\]）】]+$/, ''));
}

export function canonical(url: URL): string {
  const key = new URL(url);
  key.hash = '';
  for (const param of [...key.searchParams.keys()]) {
    if (/^utm_/i.test(param) || ['fbclid', 'gclid', 'igshid'].includes(param)) {
      key.searchParams.delete(param);
    }
  }
  const post = key.pathname.match(/^\/[^/]+\/status\/(\d+)/);
  if (identify(key) === 'x' && post) return 'https://x.com/i/status/' + post[1];
  return key.href;
}
