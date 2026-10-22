import assert from 'node:assert/strict';
import test from 'node:test';
import { applyPaintPatches, capturePaintPatches } from '../src/editor/paint-history.js';

test('paint history restores only the touched area on undo and redo', () => {
  const width = 128;
  const height = 128;
  const pixels = new Uint8ClampedArray(width * height * 4).fill(255);
  let refreshes = 0;
  const context = {
    createImageData: (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
    getImageData(x, y, w, h) {
      const image = this.createImageData(w, h);
      for (let row = 0; row < h; row++)
        image.data.set(pixels.subarray(((y + row) * width + x) * 4,
          ((y + row) * width + x + w) * 4), row * w * 4);
      return image;
    },
    putImageData(image, x, y) {
      for (let row = 0; row < image.height; row++)
        pixels.set(image.data.subarray(row * image.width * 4, (row + 1) * image.width * 4),
          ((y + row) * width + x) * 4);
    }
  };
  const surface = { canvas: { width, height }, context, requestComposite: () => refreshes++ };
  const before = context.getImageData(0, 0, width, height);
  pixels.set([0, 0, 0, 255], (8 * width + 8) * 4);
  const command = { kind: 'brush', surface, point: { x: 8, y: 8 },
    previous: null, options: { size: 2 } };
  const patches = capturePaintPatches([command], new Map([[surface, before]]));
  assert.equal(patches.length, 1);
  assert.ok(patches[0].before.data.length < before.data.length);
  applyPaintPatches(patches, 'before');
  assert.equal(pixels[(8 * width + 8) * 4], 255);
  applyPaintPatches(patches, 'after');
  assert.equal(pixels[(8 * width + 8) * 4], 0);
  assert.equal(refreshes, 2);
});
