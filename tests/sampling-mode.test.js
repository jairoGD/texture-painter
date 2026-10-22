import assert from 'node:assert/strict';
import test from 'node:test';
import { canConnectSurfaceHits, canConnectUvHits } from '../src/editor/surface-stroke.js';
import { moveSelectionInUv } from '../src/editor/uv-lasso-move.js';

test('UV mode joins neighboring texels across faces while surface mode separates them', () => {
  const mesh = {};
  const first = { object: mesh, faceIndex: 1 };
  const second = { object: mesh, faceIndex: 2 };
  const from = { x: 100, y: 200 };
  const to = { x: 105, y: 202 };
  assert.equal(canConnectSurfaceHits(first, second, from, to, 200), false);
  assert.equal(canConnectUvHits(first, second, from, to, 200), true);
});

test('UV mode moves disconnected selection parts by the same atlas offset', () => {
  const width = 1024;
  const data = new Uint8ClampedArray(width * width * 4);
  const first = 100 * width + 100;
  const second = 900 * width + 900;
  data.set([255, 0, 0, 255], first * 4);
  data.set([0, 0, 255, 255], second * 4);
  const alpha = new Uint8Array(width * width);
  alpha[first] = alpha[second] = 255;
  const selection = { alpha, indices: Uint32Array.from([first, second]) };
  const surface = { imageLayer: true, canvas: { width, height: width },
    context: { createImageData: (w, h) => ({ width: w, height: h,
      data: new Uint8ClampedArray(w * h * 4) }) } };
  const moved = moveSelectionInUv(surface, selection, { data }, 3, -2);
  assert.equal(moved.data[first * 4 + 3], 0);
  assert.equal(moved.data[second * 4 + 3], 0);
  assert.equal(moved.data[((100 - 2) * width + 103) * 4], 255);
  assert.equal(moved.data[((900 - 2) * width + 903) * 4 + 2], 255);
});
