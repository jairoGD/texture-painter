import assert from 'node:assert/strict';
import test from 'node:test';
import { combineWandMasks, wandSelectionMask } from '../src/editor/wand-selection.js';

function image(width, colors) {
  return { width, height: colors.length / width,
    data: Uint8ClampedArray.from(colors.flat()) };
}

test('wand selects only connected RGBA matches within its threshold', () => {
  const source = image(3, [
    [100, 20, 20, 255], [115, 20, 20, 255], [100, 20, 20, 0],
    [10, 10, 10, 255], [10, 10, 10, 255], [100, 20, 20, 255]
  ]);
  assert.deepEqual([...wandSelectionMask(source, 0, 0, 15)], [255, 255, 0, 0, 0, 0]);
  assert.deepEqual([...wandSelectionMask(source, 0, 0, 15, true)], [255, 255, 0, 0, 0, 255]);
});

test('wand selection can add and subtract from an existing lasso mask', () => {
  const existing = Uint8Array.of(255, 255, 0, 0);
  const added = Uint8Array.of(0, 255, 255, 0);
  assert.deepEqual([...combineWandMasks(existing, added, 'add')], [255, 255, 255, 0]);
  assert.deepEqual([...combineWandMasks(existing, added, 'subtract')], [255, 0, 0, 0]);
  assert.deepEqual([...combineWandMasks(existing, added)], [...added]);
});
