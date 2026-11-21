import assert from 'node:assert/strict';
import test from 'node:test';
import { canonical, identify, pastedUrl } from '../lib/urls';
import { isPublicAddress } from '../lib/public-http';
import { extractHtml } from '../lib/extract';

test('identifies all supported sources and canonicalizes shared links', () => {
  for (const [host, platform] of [
    ['example.org', 'web'], ['x.com', 'x'], ['twitter.com', 'x'], ['github.com', 'github'],
    ['xhslink.com', 'xiaohongshu'], ['www.xiaohongshu.com', 'xiaohongshu'],
    ['v.douyin.com', 'douyin'], ['github.com.example.org', 'web'],
  ]) assert.equal(identify(new URL('https://' + host)), platform);
  assert.equal(pastedUrl('复制打开抖音 https://v.douyin.com/abcd/，看看这个').href, 'https://v.douyin.com/abcd/');
  assert.equal(canonical(new URL('https://twitter.com/someone/status/123?utm_medium=test')), 'https://x.com/i/status/123');
  assert.equal(canonical(new URL('https://example.org/?p=1&utm_source=x#top')), 'https://example.org/?p=1');
  assert.throws(() => pastedUrl('https://name:password@example.org'));
});

test('only routes outbound HTTP to public addresses', () => {
  for (const address of ['localhost', '127.0.0.1', '10.0.0.1', '169.254.169.254', '100.64.0.1',
    '0.0.0.0', '224.0.0.1', '::1', '::ffff:192.168.1.1', 'fe80::1', 'fc00::1', '2001:db8::1']) {
    assert.equal(isPublicAddress(address), false, address);
  }
  assert.equal(isPublicAddress('8.8.8.8'), true);
  assert.equal(isPublicAddress('2606:4700:4700::1111'), true);
});

test('extracts source metadata, a relative cover, and Chinese article body', () => {
  const text = '这是一篇讲解个人知识管理的文章。'.repeat(20);
  const result = extractHtml(`<html><head><title>网页名称</title>
    <meta property="og:title" content="知识管理"><meta name="description" content="中文摘要">
    <meta property="og:image" content="/cover.jpg"></head>
    <body><nav>导航</nav><article><p>${text}</p></article></body></html>`, new URL('https://example.org/article'));
  assert.equal(result.title, '知识管理');
  assert.equal(result.summary, '中文摘要');
  assert.equal(result.cover_url, 'https://example.org/cover.jpg');
  assert.ok(result.content.includes(text));
});
