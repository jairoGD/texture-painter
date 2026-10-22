import assert from 'node:assert/strict';
import test from 'node:test';
import { moveSelectionInView, visibleSelectionSamples } from '../src/editor/lasso-selection.js';
import { moveSelectionInUv } from '../src/editor/uv-lasso-move.js';

const SIZE = 1024;

function setUv(buffer, width, height, x, y, uvX, uvY) {
  const offset = ((height - 1 - y) * width + x) * 4;
  const u = Math.round((uvX + 0.5) / SIZE * 65534);
  const v = Math.round((1 - (uvY + 0.5) / SIZE) * 65534);
  buffer.set([u >> 8, u & 255, v >> 8, v & 255], offset);
}

test('surface lasso preview reuse restores old destination pixels', () => {
  const width = 5;
  const buffer = new Uint8Array(width * 4).fill(255);
  for (let x = 0; x < width; x++) setUv(buffer, width, 1, x, 0, 100 + x * 3, 100);
  const projection = { buffer, width, height: 1 };
  const index = 100 * SIZE + 100;
  const alpha = new Uint8Array(SIZE * SIZE);
  alpha[index] = 255;
  const selection = { alpha, indices: Uint32Array.of(index), surface: { imageLayer: true } };
  const original = { data: new Uint8ClampedArray(SIZE * SIZE * 4) };
  original.data.set([255, 70, 20, 255], index * 4);
  const samples = visibleSelectionSamples(selection, projection);
  const scratch = { data: new Uint8ClampedArray(original.data.length) };
  const outputAlpha = new Uint8Array(alpha.length);
  const reuse = { initialized: false, previousIndices: [] };
  moveSelectionInView(selection, original, projection, samples, 1, 0,
    scratch, outputAlpha, null, null, reuse);
  const reused = moveSelectionInView(selection, original, projection, samples, 2, 0,
    scratch, outputAlpha, null, null, reuse);
  const fresh = moveSelectionInView(selection, original, projection, samples, 2, 0);
  assert.deepEqual(reused.image.data, fresh.image.data);
  assert.deepEqual(reused.alpha, fresh.alpha);
  assert.deepEqual(reused.indices, fresh.indices);
});

test('UV lasso preview reuse restores both mirrored destinations', () => {
  const width = 12;
  const height = 4;
  const surface = { canvas: { width, height }, imageLayer: true,
    context: { createImageData: () => ({ width, height,
      data: new Uint8ClampedArray(width * height * 4) }) } };
  const first = width + 2;
  const second = width + 9;
  const alpha = new Uint8Array(width * height);
  alpha[first] = alpha[second] = 255;
  const selection = { alpha, indices: [first, second], parts: [
    { alpha, indices: [first] }, { alpha, indices: [second] }
  ] };
  const original = surface.context.createImageData();
  original.data.set([255, 0, 0, 255], first * 4);
  original.data.set([0, 0, 255, 255], second * 4);
  const scratch = surface.context.createImageData();
  const reuse = { initialized: false, previousIndices: [] };
  moveSelectionInUv(surface, selection, original, 0, 0,
    [{ dx: 1, dy: 0 }, { dx: -1, dy: 0 }], null, scratch, reuse);
  const reused = moveSelectionInUv(surface, selection, original, 0, 0,
    [{ dx: 2, dy: 0 }, { dx: -2, dy: 0 }], null, scratch, reuse);
  const fresh = moveSelectionInUv(surface, selection, original, 0, 0,
    [{ dx: 2, dy: 0 }, { dx: -2, dy: 0 }]);
  assert.deepEqual(reused.data, fresh.data);
});
