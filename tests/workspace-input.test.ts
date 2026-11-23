import assert from 'node:assert/strict';
import test from 'node:test';
import { workspaceIntent } from '../lib/workspace-input';

test('routes links and share text to saving while preserving natural language search', () => {
  for (const value of ['https://github.com/evanpanan/CheeseCool', '看这个 https://x.com/test/status/123 分享给你', 'https://']) {
    assert.equal(workspaceIntent(value).kind, 'save');
  }
  assert.deepEqual(workspaceIntent(' github.com/evanpanan/CheeseCool '), {
    kind: 'save', value: 'https://github.com/evanpanan/CheeseCool',
  });
  assert.equal(workspaceIntent('www.example.org/path?q=1').kind, 'save');
  for (const value of ['如何设计智能收藏产品', 'CheeseCool', 'example.com 的资料', '  ']) {
    assert.equal(workspaceIntent(value).kind, 'search');
  }
});
