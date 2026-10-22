import assert from 'node:assert/strict';
import test from 'node:test';
import { indexSelectionTiles, strokeTouchesSelection } from '../src/editor/selection-coverage.js';

function selection(width, height, pixels) {
  const alpha = new Uint8Array(width * height);
  for (const [x, y] of pixels) alpha[y * width + x] = 255;
  const indices = pixels.map(([x, y]) => y * width + x);
  return {
    alpha,
    bounds: {
      left: Math.min(...pixels.map(([x]) => x)),
      top: Math.min(...pixels.map(([, y]) => y)),
      right: Math.max(...pixels.map(([x]) => x)) + 1,
      bottom: Math.max(...pixels.map(([, y]) => y)) + 1,
    },
    occupiedTiles: indexSelectionTiles(indices, width, height),
  };
}

test('stroke coverage skips empty space inside the selection bounds', () => {
  const mask = selection(96, 96, [[2, 2], [80, 80]]);
  assert.equal(strokeTouchesSelection(mask, { x: 45, y: 45 }, { x: 55, y: 55 },
    12, 96, 96), false);
  assert.equal(strokeTouchesSelection(mask, { x: 0, y: 0 }, { x: 5, y: 5 },
    2, 96, 96), true);
});

test('stroke coverage checks the brush path, not only its bounding box', () => {
  const mask = selection(96, 96, [[19, 30], [70, 70]]);
  assert.equal(strokeTouchesSelection(mask, { x: 10, y: 10 }, { x: 40, y: 40 },
    2, 96, 96), false);
  assert.equal(strokeTouchesSelection(mask, { x: 10, y: 30 }, { x: 40, y: 30 },
    2, 96, 96), true);
});

test('stroke coverage finds selected pixels across tile boundaries', () => {
  const mask = selection(96, 96, [[32, 31]]);
  assert.equal(strokeTouchesSelection(mask, { x: 30, y: 31 }, { x: 31, y: 31 },
    2, 96, 96), true);
});
