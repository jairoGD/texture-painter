import assert from 'node:assert/strict';
import test from 'node:test';
import { adjustRgb, colorRampAt, renderFilterRegion } from '../src/editor/filter-effects.js';

function image(width, colors) {
  return { width, height: colors.length / width,
    data: Uint8ClampedArray.from(colors.flat()) };
}

function render(source, category, settings, mask = null) {
  const rect = { left: 0, top: 0, right: source.width, bottom: source.height };
  return renderFilterRegion({ source, sourceRect: rect, dirtyRect: rect,
    textureWidth: source.width, mask, category, settings });
}

test('color and tone controls adjust RGB while preserving alpha', () => {
  assert.deepEqual(adjustRgb(255, 0, 0, 'color',
    { hue: 180, saturation: 100, invert: false }), [0, 255, 255]);
  assert.deepEqual(adjustRgb(100, 150, 200, 'tone',
    { luminance: 0, brightness: 100, contrast: 100 }), [100, 150, 200]);
  const source = image(1, [[100, 150, 200, 90]]);
  const filtered = render(source, 'color', { hue: 0, saturation: 100, invert: true });
  assert.deepEqual([...filtered.data], [155, 105, 55, 90]);
});

test('filters change only selected pixels and blend feathered lasso edges', () => {
  const source = image(3, [[20, 40, 60, 255], [20, 40, 60, 255], [20, 40, 60, 255]]);
  const filtered = render(source, 'color', { hue: 0, saturation: 100, invert: true },
    Uint8Array.of(255, 128, 0));
  assert.deepEqual([...filtered.data.slice(0, 4)], [235, 215, 195, 255]);
  assert.deepEqual([...filtered.data.slice(8, 12)], [20, 40, 60, 255]);
  assert.ok(filtered.data[4] > 20 && filtered.data[4] < 235);
});

test('posterize and number of colors reduce the active image palette', () => {
  const source = image(4, [[230, 20, 20, 255], [20, 230, 20, 255],
    [20, 20, 230, 255], [220, 210, 20, 128]]);
  const result = render(source, 'palette', { posterize: 256, colorCount: 8 });
  const colors = new Set();
  for (let offset = 0; offset < result.data.length; offset += 4)
    colors.add([...result.data.slice(offset, offset + 3)].join(','));
  assert.ok(colors.size <= 2);
  assert.deepEqual([result.data[3], result.data[7], result.data[11], result.data[15]],
    [255, 255, 255, 128]);
  assert.deepEqual(adjustRgb(100, 150, 200, 'palette', { posterize: 2 }), [0, 255, 255]);
});

test('mosaic groups neighboring texture pixels into blocks', () => {
  const source = image(2, [[255, 0, 0, 255], [0, 0, 255, 255]]);
  const result = render(source, 'blur', { depth: 0, mosaic: 2 });
  assert.deepEqual([...result.data.slice(0, 4)], [...result.data.slice(4, 8)]);
  assert.deepEqual([...result.data.slice(0, 4)], [128, 0, 128, 255]);
});

test('color ramp maps luminance through linear and constant stops', () => {
  const stops = [
    { position: 0, color: '#0000ff' },
    { position: 0.5, color: '#ff0000' },
    { position: 1, color: '#ffffff' }
  ];
  assert.deepEqual(colorRampAt(0.25, stops), [128, 0, 128]);
  assert.deepEqual(colorRampAt(0.25, stops, 'constant'), [0, 0, 255]);
  assert.deepEqual(colorRampAt(1, stops, 'constant'), [255, 255, 255]);
});

test('color ramp respects lasso coverage and preserves alpha', () => {
  const source = image(3, [[0, 0, 0, 255], [255, 255, 255, 128], [255, 255, 255, 255]]);
  const settings = { stops: [
    { position: 0, color: '#ff0000' }, { position: 1, color: '#0000ff' }
  ], interpolation: 'linear' };
  const result = render(source, 'ramp', settings, Uint8Array.of(255, 128, 0));
  assert.deepEqual([...result.data.slice(0, 4)], [255, 0, 0, 255]);
  assert.deepEqual([...result.data.slice(8, 12)], [255, 255, 255, 255]);
  assert.equal(result.data[7], 128);
  assert.ok(result.data[4] < 255 && result.data[6] > 0);
});
