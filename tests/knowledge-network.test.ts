import assert from 'node:assert/strict';
import test from 'node:test';
import { buildNetwork, type NetworkBookmark } from '../lib/knowledge-network';

function bookmark(id: string, tags: string[]): NetworkBookmark {
  return {
    id, title: id, tags, status: 'indexed', original_url: 'https://example.org/' + id,
    final_url: null, platform: 'web', summary: '', ai_summary: null,
  };
}

test('groups related tags, sizes nodes by actual connections, and preserves isolated bookmarks', () => {
  const bookmarks = [
    bookmark('hub', ['工具', 'AI']), bookmark('related', ['ai']),
    bookmark('article', ['工具']), bookmark('other', []),
  ];
  const edges = [
    { source_id: 'hub', target_id: 'related', score: .96 },
    { source_id: 'hub', target_id: 'article', score: .62 },
    { source_id: 'other', target_id: 'outside-current-view', score: .9 },
  ];
  const graph = buildNetwork(bookmarks, edges);
  assert.equal(graph.links.length, 2);
  assert.equal(graph.nodes.length, 4);
  assert.deepEqual(graph.groups.map(group => [group.label, group.size]), [['AI', 2], ['工具', 1], ['未分类', 1]]);
  const byId = new Map(graph.nodes.map(node => [node.id, node]));
  assert.deepEqual(byId.get('hub')?.connections.map(item => item.id), ['related', 'article']);
  assert.equal(byId.get('other')?.connections.length, 0);
  assert.ok(byId.get('hub')!.radius > byId.get('related')!.radius);
  assert.ok(graph.nodes.every(node => node.x >= 0 && node.x <= graph.width && node.y >= 0 && node.y <= graph.height));
  assert.deepEqual(buildNetwork(bookmarks, edges), graph);
});

test('uses bounded, distinguishable tag links when vectors are absent', () => {
  const bookmarks = Array.from({ length: 16 }, (_, n) => bookmark('id-' + n, ['同一主题']));
  const graph = buildNetwork(bookmarks, []);
  assert.ok(graph.links.length > 0);
  assert.ok(graph.links.every(link => link.kind === 'tag'));
  assert.ok(graph.nodes.every(node => node.connections.length <= 2));
  assert.equal(new Set(graph.links.map(edge => [edge.source_id, edge.target_id].sort().join(':'))).size, graph.links.length);
});
