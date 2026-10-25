import test from 'node:test';
import assert from 'node:assert/strict';
import { BufferGeometry, Float32BufferAttribute, Vector3 } from 'three';
import { clearVertexPaintCache, fillVertexColors, materialVertexIndices,
  paintVertexColors } from '../src/editor/vertex-paint.js';

function square() {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute([
    -1, -1, 0, 1, -1, 0, -1, 1, 0,
    1, -1, 0, 1, 1, 0, -1, 1, 0
  ], 3));
  return geometry;
}

test('vertex brush changes only vertices inside its footprint', () => {
  const geometry = square();
  assert.equal(paintVertexColors(geometry, 0, new Vector3(-1, -1, 0),
    0.1, 'vertexBrush', { color: '#ff0000', opacity: 100, hardness: 100 }), true);
  const colors = geometry.getAttribute('color');
  assert.ok(colors.getY(0) < 1);
  assert.equal(colors.getY(1), 1);
  assert.equal(colors.getY(2), 1);
  assert.equal(colors.getX(4), 1);
});

test('touching the middle of a sparse face does not paint its corners', () => {
  const geometry = square();
  assert.equal(paintVertexColors(geometry, 0, new Vector3(-0.3, -0.3, 0),
    0.1, 'vertexBrush', { color: '#ff0000', opacity: 100, hardness: 100 }), false);
  assert.equal(geometry.getAttribute('color'), undefined);
});

test('vertex blur mixes neighboring vertex colors without changing alpha', () => {
  const geometry = square();
  geometry.setAttribute('color', new Float32BufferAttribute([
    1, 0, 0, 0.4, 0, 0, 1, 0.6, 0, 0, 1, 0.6,
    0, 0, 1, 0.6, 0, 0, 1, 0.6, 0, 0, 1, 0.6
  ], 4));
  assert.equal(paintVertexColors(geometry, 0, new Vector3(0, -1, 0),
    2.5, 'vertexBlur', { strength: 100, hardness: 100 }), true);
  const colors = geometry.getAttribute('color');
  assert.ok(colors.getZ(0) > 0);
  assert.ok(Math.abs(colors.getW(0) - 0.4) < 1e-6);
});

test('vertex brush colors coincident vertices on both sides of a seam', () => {
  const geometry = square();
  paintVertexColors(geometry, 0, new Vector3(1, -1, 0),
    0.1, 'vertexBrush', { color: '#000000', opacity: 100, hardness: 100 });
  const colors = geometry.getAttribute('color');
  assert.equal(colors.getX(1), colors.getX(3));
  assert.equal(colors.getX(1), 0);
});

test('selection limits vertex brush and bucket to chosen vertices', () => {
  const geometry = square();
  const selected = new Set([0]);
  paintVertexColors(geometry, 0, new Vector3(0, 0, 0), 5,
    'vertexBrush', { color: '#ff0000', opacity: 100, hardness: 100 }, selected);
  const colors = geometry.getAttribute('color');
  assert.ok(colors.getY(0) < 1);
  assert.equal(colors.getY(1), 1);
  fillVertexColors(geometry, 0, { color: '#0000ff', opacity: 100 }, selected);
  assert.equal(colors.getZ(0), 1);
  assert.equal(colors.getZ(1), 1);
  assert.equal(colors.getX(1), 1);
});

test('face filter prevents a coincident vertex on the next face from changing', () => {
  const geometry = square();
  paintVertexColors(geometry, 0, new Vector3(1, -1, 0), 0.1,
    'vertexBrush', { color: '#000000', opacity: 100, hardness: 100 },
    new Set([0, 1, 2]));
  const colors = geometry.getAttribute('color');
  assert.equal(colors.getX(1), 0);
  assert.equal(colors.getX(3), 1);
});

test('face splitting invalidates cached material vertex indices', () => {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute([
    -1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0
  ], 3));
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  assert.equal(materialVertexIndices(geometry, 0).length, 4);
  const expanded = geometry.toNonIndexed();
  geometry.copy(expanded);
  clearVertexPaintCache(geometry);
  assert.equal(materialVertexIndices(geometry, 0).length, 6);
});
