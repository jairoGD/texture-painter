import assert from 'node:assert/strict';
import test from 'node:test';
import { executePaintCommand } from '../src/editor/paint-operations.js';

function surfaceWithPixels(width, height) {
  const pixels = new Uint8ClampedArray(width * height * 4);
  const dirty = [];
  const surface = { canvas: { width, height }, imageLayer: true,
    requestComposite(region) { dirty.push(region); },
    context: {
      getImageData(left, top, areaWidth, areaHeight) {
        const data = new Uint8ClampedArray(areaWidth * areaHeight * 4);
        for (let y = 0; y < areaHeight; y++) for (let x = 0; x < areaWidth; x++)
          data.set(pixels.subarray(((top + y) * width + left + x) * 4,
            ((top + y) * width + left + x) * 4 + 4), (y * areaWidth + x) * 4);
        return { width: areaWidth, height: areaHeight, data };
      },
      putImageData(image, left, top) {
        for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++)
          pixels.set(image.data.subarray((y * image.width + x) * 4,
            (y * image.width + x) * 4 + 4), ((top + y) * width + left + x) * 4);
      }
    } };
  const pixel = (x, y) => [...pixels.subarray((y * width + x) * 4,
    (y * width + x) * 4 + 4)];
  return { surface, pixels, pixel, dirty };
}

const options = { mode: 'smudge', size: 3, hardness: 100, strength: 100 };

test('smudge carries color and alpha in the cursor direction', () => {
  const { surface, pixels, pixel, dirty } = surfaceWithPixels(11, 5);
  pixels.set([255, 40, 20, 255], (2 * 11 + 2) * 4);
  const state = {};
  assert.equal(executePaintCommand({ kind: 'blur', surface,
    point: { x: 2.5, y: 2.5 }, previous: null, options,
    smudgeState: state }), false);
  assert.equal(executePaintCommand({ kind: 'blur', surface,
    point: { x: 5.5, y: 2.5 }, previous: { x: 2.5, y: 2.5 }, options,
    smudgeState: state }), true);
  assert.ok(pixel(5, 2)[3] > 0);
  assert.deepEqual(pixel(5, 2).slice(0, 3), [255, 40, 20]);
  assert.ok(pixel(2, 2)[3] < 255, 'paint is dragged away from its origin');
  assert.equal(dirty.length, 1);
});

test('smudge obeys a lasso and does not pull colors from outside it', () => {
  const width = 11, height = 5;
  const { surface, pixels, pixel } = surfaceWithPixels(width, height);
  const alpha = new Uint8Array(width * height);
  for (let x = 0; x < width; x++) {
    pixels.set(x < 5 ? [255, 0, 0, 255] : [0, 0, 255, 255],
      (2 * width + x) * 4);
    if (x < 5) alpha[2 * width + x] = 255;
  }
  const state = {};
  const mask = { alpha };
  executePaintCommand({ kind: 'blur', surface, point: { x: 3.5, y: 2.5 },
    previous: null, options, mask, isolateBlur: true, smudgeState: state });
  executePaintCommand({ kind: 'blur', surface, point: { x: 7.5, y: 2.5 },
    previous: { x: 3.5, y: 2.5 }, options, mask, isolateBlur: true,
    smudgeState: state });
  assert.deepEqual(pixel(6, 2), [0, 0, 255, 255]);
  assert.deepEqual(pixel(7, 2), [0, 0, 255, 255]);
  const outsideState = {};
  executePaintCommand({ kind: 'blur', surface, point: { x: 7.5, y: 2.5 },
    previous: null, options, mask, isolateBlur: true, smudgeState: outsideState });
  executePaintCommand({ kind: 'blur', surface, point: { x: 4.5, y: 2.5 },
    previous: { x: 7.5, y: 2.5 }, options, mask, isolateBlur: true,
    smudgeState: outsideState });
  assert.deepEqual(pixel(4, 2).slice(0, 3), [255, 0, 0]);
});

test('smudge carries its brush load across a UV discontinuity', () => {
  const { surface, pixels, pixel } = surfaceWithPixels(12, 5);
  for (let x = 1; x <= 4; x++) pixels.set([230, 60, 20, 255], (2 * 12 + x) * 4);
  const state = {};
  executePaintCommand({ kind: 'blur', surface, point: { x: 2.5, y: 2.5 },
    previous: null, options, smudgeState: state });
  executePaintCommand({ kind: 'blur', surface, point: { x: 3.5, y: 2.5 },
    previous: { x: 2.5, y: 2.5 }, options, smudgeState: state });
  executePaintCommand({ kind: 'blur', surface, point: { x: 9.5, y: 2.5 },
    previous: null, options, smudgeState: state });
  assert.ok(pixel(9, 2)[3] > 0);
  assert.deepEqual(pixel(9, 2).slice(0, 3), [230, 60, 20]);
});
