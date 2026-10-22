import assert from 'node:assert/strict';
import test from 'node:test';
import { moveSelectionInView, visibleSelectionSamples } from '../src/editor/lasso-selection.js';

const SIZE = 1024;

function setUv(buffer, width, height, screenX, screenY, uvX, uvY) {
  const offset = ((height - 1 - screenY) * width + screenX) * 4;
  const u = Math.round((uvX + 0.5) / SIZE * 65534);
  const v = Math.round((1 - (uvY + 0.5) / SIZE) * 65534);
  buffer.set([u >> 8, u & 255, v >> 8, v & 255], offset);
}

test('lasso moves across separated and differently oriented UV islands in screen space', () => {
  const width = 6;
  const height = 1;
  const buffer = new Uint8Array(width * height * 4).fill(255);
  setUv(buffer, width, height, 0, 0, 100, 100);
  setUv(buffer, width, height, 1, 0, 103, 100);
  setUv(buffer, width, height, 3, 0, 900, 100);
  setUv(buffer, width, height, 4, 0, 900, 103);
  const projection = { buffer, width, height };
  const alpha = new Uint8Array(SIZE * SIZE);
  const sourceA = 100 * SIZE + 100;
  const sourceB = 100 * SIZE + 900;
  alpha[sourceA] = alpha[sourceB] = 255;
  const selection = { alpha, indices: Uint32Array.from([sourceA, sourceB]),
    surface: { imageLayer: true } };
  const original = { data: new Uint8ClampedArray(SIZE * SIZE * 4) };
  original.data.set([255, 0, 0, 255], sourceA * 4);
  original.data.set([0, 0, 255, 255], sourceB * 4);
  const samples = visibleSelectionSamples(selection, projection);
  assert.equal(samples.screen.length, 2);
  const moved = moveSelectionInView(selection, original, projection, samples, 1, 0);
  const destinationA = 100 * SIZE + 103;
  const destinationB = 103 * SIZE + 900;
  assert.ok(moved.alpha[destinationA] > 0);
  assert.ok(moved.alpha[destinationB] > 0);
  assert.deepEqual([...moved.image.data.subarray(destinationA * 4, destinationA * 4 + 3)], [255, 0, 0]);
  assert.deepEqual([...moved.image.data.subarray(destinationB * 4, destinationB * 4 + 3)], [0, 0, 255]);
  assert.equal(moved.image.data[sourceA * 4 + 3], 0);
  assert.equal(moved.image.data[sourceB * 4 + 3], 0);
});
