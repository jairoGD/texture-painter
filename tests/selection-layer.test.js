import assert from 'node:assert/strict';
import test from 'node:test';
import { selectionOnPaintSurface } from '../src/editor/selection-layer.js';

test('lasso mask follows a new image layer within the same material', () => {
  const first = { id: 'material:0' };
  const second = { id: 'material:0' };
  const alpha = Uint8Array.of(0, 255);
  const part = { surface: first, alpha, indices: Uint32Array.of(1) };
  const selection = { surface: first, alpha, indices: Uint32Array.of(1), parts: [part],
    floatingBase: { oldLayer: true }, floatingSourceImage: { oldLayer: true } };
  const rebound = selectionOnPaintSurface(selection, second);
  assert.equal(rebound.surface, second);
  assert.equal(rebound.alpha, alpha);
  assert.equal(rebound.parts[0].surface, second);
  assert.equal(rebound.parts[0].alpha, alpha);
  assert.equal(rebound.floatingBase, null);
  assert.equal(rebound.floatingSourceImage, null);
  assert.equal(selection.surface, first, 'history keeps its original selection object');
});

test('selection binding does not jump between materials', () => {
  const first = { id: 'material:0' };
  const other = { id: 'material:1' };
  const selection = { surface: first };
  assert.equal(selectionOnPaintSurface(selection, other), selection);
  assert.equal(selectionOnPaintSurface(selection, null), selection);
});
