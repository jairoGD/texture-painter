import assert from 'node:assert/strict';
import test from 'node:test';
import { resizeSelectionAlpha } from '../src/editor/selection-morphology.js';

function bruteResize(source, width, height, radius, expand) {
  const output = new Uint8Array(source.length);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    let selected = !expand;
    for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) {
      if (dx * dx + dy * dy > radius * radius) continue;
      const xx = x + dx;
      const yy = y + dy;
      const hit = xx >= 0 && xx < width && yy >= 0 && yy < height &&
        source[yy * width + xx] > 0;
      if (expand && hit) selected = true;
      if (!expand && !hit) selected = false;
    }
    output[y * width + x] = selected ? 255 : 0;
  }
  return output;
}

test('selection expansion and contraction use a circular pixel radius', () => {
  const width = 7;
  const height = 6;
  const masks = [
    new Uint8Array(width * height),
    new Uint8Array(width * height).fill(255),
    Uint8Array.from({ length: width * height }, (_, index) =>
      index % 7 === 3 && Math.floor(index / width) % 3 === 1 ? 128 : 0),
    Uint8Array.from({ length: width * height }, (_, index) =>
      (index * 17 + Math.floor(index / width) * 11) % 5 < 2 ? 255 : 0)
  ];
  for (const source of masks) for (const expand of [true, false])
    for (const radius of [1, 2, 3])
      assert.deepEqual(resizeSelectionAlpha(source, width, height, radius, expand),
        bruteResize(source, width, height, radius, expand));
});
