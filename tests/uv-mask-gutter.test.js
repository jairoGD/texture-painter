import test from 'node:test';
import assert from 'node:assert/strict';
import { uvMaskWithGutter } from '../src/editor/uv-mask-gutter.js';
import { renderFilterRegion } from '../src/editor/filter-effects.js';

test('filter gutter covers UV borders and wrapped atlas edges', () => {
  const source = Uint8Array.from([0, 0, 255, 0, 0, 0, 0, 0]);
  const result = uvMaskWithGutter(source, new Uint8Array(8), 8, 1, 2);
  assert.deepEqual([...result], [255, 255, 255, 255, 255, 0, 0, 0]);
  assert.deepEqual([...source], [0, 0, 255, 0, 0, 0, 0, 0]);
});

test('hidden UV pixels remain protected even where the visible gutter expands', () => {
  const source = Uint8Array.from([0, 255, 255, 0, 0, 0, 0, 0]);
  const hidden = Uint8Array.from([0, 0, 0, 0, 255, 255, 0, 0]);
  assert.deepEqual([...uvMaskWithGutter(source, hidden, 8, 1, 3)],
    [255, 255, 255, 255, 0, 0, 255, 255]);
});

test('Tone changes UV edge pixels while preserving the hidden island', () => {
  const width = 8;
  const sourceMask = Uint8Array.from([0, 255, 255, 0, 0, 0, 0, 0]);
  const hiddenMask = Uint8Array.from([0, 0, 0, 0, 255, 255, 0, 0]);
  const mask = uvMaskWithGutter(sourceMask, hiddenMask, width, 1, 3);
  const data = new Uint8ClampedArray(width * 4);
  for (let index = 0; index < width; index++)
    data.set([180, 100, 60, 255], index * 4);
  const rect = { left: 0, top: 0, right: width, bottom: 1 };
  const result = renderFilterRegion({ source: { width, height: 1, data },
    sourceRect: rect, dirtyRect: rect, textureWidth: width, mask,
    category: 'tone', settings: { luminance: -28, brightness: 100, contrast: 100 } });
  assert.notEqual(result.data[3 * 4], 180);
  assert.deepEqual([...result.data.slice(4 * 4, 4 * 4 + 4)], [180, 100, 60, 255]);
});
