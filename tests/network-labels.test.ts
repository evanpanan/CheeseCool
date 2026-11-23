import assert from 'node:assert/strict';
import test from 'node:test';
import { LabelGrid } from '../lib/network-labels';

test('labels yield to earlier titles across cell boundaries and reappear after moving', () => {
  const grid = new LabelGrid(20);
  const title = { left: -42, right: 14, top: -22, bottom: 9 };
  const note = { left: 10, right: 28, top: 6, bottom: 18 };
  assert.equal(grid.reserve(title), true);
  assert.equal(grid.reserve(note), false);
  assert.equal(grid.reserve({ ...note, left: 14 }), true);
  grid.clear();
  assert.equal(grid.reserve(note), true);
  assert.equal(grid.reserve(title, true), true);
});
