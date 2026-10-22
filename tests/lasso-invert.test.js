import assert from 'node:assert/strict';
import test from 'node:test';
import { invertSelectionAlpha } from '../src/editor/lasso-selection.js';

test('inverting a lasso complements solid and feathered coverage', () => {
  const source = Uint8Array.of(0, 64, 128, 255);
  const inverted = invertSelectionAlpha(source);
  assert.deepEqual([...inverted.alpha], [255, 191, 127, 0]);
  assert.deepEqual(inverted.indices, [0, 1, 2]);
  assert.deepEqual([...invertSelectionAlpha(inverted.alpha).alpha], [...source]);
});

test('inverting a full selection produces an empty selection mask', () => {
  const inverted = invertSelectionAlpha(Uint8Array.of(255, 255, 255));
  assert.deepEqual(inverted.indices, []);
  assert.deepEqual([...inverted.alpha], [0, 0, 0]);
});
