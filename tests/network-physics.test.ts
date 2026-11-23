import assert from 'node:assert/strict';
import test from 'node:test';
import { createNetworkPhysics } from '../lib/network-physics';

const input = () => [
  { id: 'a', x: 200, y: 200, radius: 20 },
  { id: 'b', x: 340, y: 200, radius: 20 },
  { id: 'c', x: 480, y: 200, radius: 20 },
];
const edges = [{ source: 'a', target: 'b' }, { source: 'b', target: 'c' }];

test('dragging a pinned node transmits force to connected nodes', () => {
  const rest = createNetworkPhysics(input(), edges);
  const dragged = createNetworkPhysics(input(), edges);
  const a = dragged.nodes[0];
  a.fx = 200; a.fy = 400;
  dragged.simulation.tick(25); rest.simulation.tick(25);
  assert.equal(a.y, 400);
  assert.ok(dragged.nodes[1].y > rest.nodes[1].y + 10);
  a.fx = null; a.fy = null;
  dragged.simulation.alpha(.5).tick(300);
  assert.ok(a.y < 350, 'release returns the node toward its layout');
  assert.ok(dragged.nodes.every(node => Number.isFinite(node.x) && Number.isFinite(node.y)));
});

test('D3 mutation is isolated from collection data and invalid links are discarded', () => {
  const nodes = input();
  const before = structuredClone(nodes);
  const model = createNetworkPhysics(nodes, [...edges, { source: 'a', target: 'missing' }]);
  model.simulation.tick(100);
  assert.deepEqual(nodes, before);
  assert.deepEqual(edges, [{ source: 'a', target: 'b' }, { source: 'b', target: 'c' }]);
  assert.equal(model.links.length, 2);
});
