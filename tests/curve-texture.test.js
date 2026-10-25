import test from 'node:test';
import assert from 'node:assert/strict';
import { createCurveTextureSampler, sampleCurveTexturePixel } from '../src/editor/curve-texture.js';

const image = { width: 2, height: 2, data: new Uint8ClampedArray([
  255, 0, 0, 255, 0, 255, 0, 255,
  0, 0, 255, 255, 255, 255, 0, 255
]) };

test('image rows repeat by distance along the curve', () => {
  const sample = createCurveTextureSampler([{ x: 0, y: 0 }, { x: 100, y: 0 }],
    image, { size: 20, antialias: false });
  assert.deepEqual(sample(5, -5).slice(0, 3), sample(25, -5).slice(0, 3));
  assert.notDeepEqual(sample(5, -5).slice(0, 3), sample(15, -5).slice(0, 3));
  assert.equal(sample(5, 20), null);
});

test('Flip swaps the image edges across a dynamic curve', () => {
  const points = [{ x: 0, y: 0 }, { x: 100, y: 0 }];
  const normal = createCurveTextureSampler(points, image,
    { size: 20, antialias: false });
  const flipped = createCurveTextureSampler(points, image,
    { size: 20, antialias: false, flip: true });
  assert.deepEqual(flipped(5, -5), normal(5, 5));
  assert.deepEqual(flipped(5, 5), normal(5, -5));
});

test('strip bends across a turn rather than rotating separate stamps', () => {
  const sample = createCurveTextureSampler([
    { x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 40 }
  ], image, { size: 20, antialias: false });
  assert.deepEqual(sample(15, -5).slice(0, 3), sample(45, 15).slice(0, 3));
});

test('align ends fits an integer repeat count and joins source edges', () => {
  const sample = createCurveTextureSampler([{ x: 0, y: 0 }, { x: 45, y: 0 }],
    image, { size: 20, seamless: true, antialias: false });
  assert.deepEqual(sample(0, -5).slice(0, 3), sample(45, -5).slice(0, 3));
  assert.ok(sample(0.01, -5)[3] > 0);
});

test('antialias averages projected texel coverage without dark transparent edges', () => {
  const edge = (x) => x < 0 ? [240, 80, 40, 255] : null;
  assert.deepEqual(sampleCurveTexturePixel(edge, 0, 0), null);
  const blended = sampleCurveTexturePixel(edge, 0, 0, [4, 0, 0, 4]);
  assert.deepEqual(blended, [240, 80, 40, 127.5]);
});
