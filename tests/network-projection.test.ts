import assert from 'node:assert/strict';
import test from 'node:test';
import { createProjection } from '../lib/network-projection';

const center = { x: 450, y: 320 };
const node = { x: 313.5, y: 278.25 };

function almostEqual(actual: number, expected: number) {
  assert.ok(Math.abs(actual - expected) < 1e-7, `expected ${expected}, received ${actual}`);
}

test('light mode preserves positions, glyph size, and pointer distance at every depth', () => {
  const projection = createProjection(1.7, 0, center, 900);
  for (const depth of [-1, 0, 1]) {
    const screen = projection.project(node, depth);
    almostEqual(screen.x, node.x);
    almostEqual(screen.y, node.y);
    almostEqual(screen.scale, 1);
    const delta = projection.worldDelta(40, -18, depth);
    almostEqual(delta.x, 40);
    almostEqual(delta.y, -18);
  }
});

test('a screen drag lands on the pointer across depth, orbit phase, and theme transitions', () => {
  for (const phase of [0, 1.2, Math.PI, 4.7]) {
    for (const blend of [0.3, 1]) {
      const projection = createProjection(phase, blend, center, 900);
      for (const depth of [-1, -0.4, 0, 0.75, 1]) {
        const before = projection.project(node, depth);
        const delta = projection.worldDelta(-31.5, 23.25, depth);
        const after = projection.project({ x: node.x + delta.x, y: node.y + delta.y }, depth);
        assert.ok(before.scale > 0 && Number.isFinite(before.scale));
        almostEqual(after.x - before.x, -31.5);
        almostEqual(after.y - before.y, 23.25);
      }
    }
  }
});
