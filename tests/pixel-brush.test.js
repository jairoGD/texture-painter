import assert from 'node:assert/strict';
import test from 'node:test';
import { rasterizePixelStroke } from '../src/editor/pixel-brush.js';

const pixel = (data, width, x, y) => [...data.slice((y * width + x) * 4,
  (y * width + x) * 4 + 4)];

test('hard pixel brush has no partially covered edge pixels', () => {
  const data = rasterizePixelStroke({ width: 8, height: 8, left: 0, top: 0,
    from: { x: 4, y: 4 }, to: { x: 4, y: 4 }, steps: 1, hasPrevious: false,
    size: 5, hardness: 100, color: '#336699' });
  assert.deepEqual(pixel(data, 8, 4, 4), [51, 102, 153, 255]);
  assert.deepEqual(pixel(data, 8, 6, 6), [0, 0, 0, 0]);
  for (let index = 3; index < data.length; index += 4)
    assert.ok(data[index] === 0 || data[index] === 255);
});

test('pixel stroke retains a connected line of solid texels', () => {
  const data = rasterizePixelStroke({ width: 12, height: 6, left: 0, top: 0,
    from: { x: 2.5, y: 2.5 }, to: { x: 9.5, y: 2.5 }, steps: 7,
    hasPrevious: true, size: 2, hardness: 100, color: '#ffffff' });
  for (let x = 2; x <= 9; x++) assert.equal(pixel(data, 12, x, 2)[3], 255);
  assert.equal(pixel(data, 12, 2, 4)[3], 0);
});

test('one-pixel hard brush marks exactly one texel at fractional coordinates', () => {
  const data = rasterizePixelStroke({ width: 6, height: 6, left: 0, top: 0,
    from: { x: 2.1, y: 3.8 }, to: { x: 2.1, y: 3.8 }, steps: 1,
    hasPrevious: false, size: 1, hardness: 100, color: '#336699' });
  assert.deepEqual(pixel(data, 6, 2, 3), [51, 102, 153, 255]);
  assert.equal(data.filter((value, index) => index % 4 === 3 && value).length, 1);
});

test('pixel brush thresholds the lasso edge instead of feathering it', () => {
  const alpha = new Uint8Array(6 * 6);
  alpha[2 * 6 + 2] = 127;
  alpha[2 * 6 + 3] = 128;
  const data = rasterizePixelStroke({ width: 6, height: 6, left: 0, top: 0,
    from: { x: 2.5, y: 2.5 }, to: { x: 2.5, y: 2.5 }, steps: 1,
    hasPrevious: false, size: 6, hardness: 100, color: '#ff0000',
    mask: { alpha }, surfaceWidth: 6, surfaceHeight: 6 });
  assert.equal(pixel(data, 6, 2, 2)[3], 0);
  assert.equal(pixel(data, 6, 3, 2)[3], 255);
});

test('square profile paints corners outside a circular dab', () => {
  const base = { width: 16, height: 16, left: 0, top: 0,
    from: { x: 8, y: 8 }, to: { x: 8, y: 8 }, steps: 1,
    hasPrevious: false, size: 8, hardness: 100, color: '#ffffff' };
  const circle = rasterizePixelStroke(base);
  const square = rasterizePixelStroke({ ...base, brushProfile: 'square' });
  assert.equal(pixel(circle, 16, 11, 11)[3], 0);
  assert.equal(pixel(square, 16, 11, 11)[3], 255);
});

test('tapered profile narrows both ends while retaining the middle width', () => {
  const data = rasterizePixelStroke({ width: 44, height: 22, left: 0, top: 0,
    from: { x: 6, y: 11 }, to: { x: 38, y: 11 }, steps: 32,
    hasPrevious: true, size: 12, hardness: 100, color: '#ffffff',
    brushProfile: 'tapered', taperAmount: 100 });
  assert.equal(pixel(data, 44, 6, 7)[3], 0);
  assert.equal(pixel(data, 44, 22, 7)[3], 255);
  assert.equal(pixel(data, 44, 38, 7)[3], 0);
});
