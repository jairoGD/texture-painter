import test from 'node:test';
import assert from 'node:assert/strict';
import { BufferGeometry, Float32BufferAttribute } from 'three';
import { hideGeometryFaces, invertVisibleGeometryFaces, showAllGeometryFaces,
  visibleGeometryFaces, visibleVertexPaintScope } from
  '../src/editor/face-visibility.js';
import { fillVertexColors } from '../src/editor/vertex-paint.js';

test('hiding selected faces keeps face IDs and UV values intact', () => {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute([
    0, 0, 0, 1, 0, 0, 0, 1, 0,
    2, 0, 0, 3, 0, 0, 2, 1, 0
  ], 3));
  geometry.setAttribute('uv', new Float32BufferAttribute([
    0, 0, 1, 0, 0, 1,
    0, 0, 1, 0, 0, 1
  ], 2));
  const originalPositions = [...geometry.getAttribute('position').array];
  const originalUv = [...geometry.getAttribute('uv').array];
  assert.equal(hideGeometryFaces(geometry, new Set([0])), true);
  assert.deepEqual([...geometry.getAttribute('uv').array], originalUv);
  assert.deepEqual([...visibleGeometryFaces(geometry, new Set([0, 1]))], [1]);
  const paintScope = visibleVertexPaintScope(geometry, 0);
  assert.deepEqual([...paintScope.faces], [1]);
  assert.deepEqual([...paintScope.vertices], [3, 4, 5]);
  assert.equal(fillVertexColors(geometry, 0, { color: '#ff0000', opacity: 100 },
    paintScope.vertices), true);
  const colors = geometry.getAttribute('color');
  assert.deepEqual([colors.getX(0), colors.getY(0), colors.getZ(0)], [1, 1, 1]);
  assert.ok(colors.getY(3) < 0.001 && colors.getZ(3) < 0.001);
  assert.deepEqual([...invertVisibleGeometryFaces(geometry, new Set([0, 1]),
    new Set([1]))], []);
  assert.deepEqual([...invertVisibleGeometryFaces(geometry, new Set([0, 1]),
    new Set())], [1]);
  assert.deepEqual([...geometry.getAttribute('position').array.slice(0, 9)],
    [0, 0, 0, 0, 0, 0, 0, 0, 0]);
  assert.equal(hideGeometryFaces(geometry, new Set([0])), false);
  assert.equal(showAllGeometryFaces(geometry), true);
  assert.deepEqual([...geometry.getAttribute('position').array], originalPositions);
  assert.deepEqual([...geometry.getAttribute('uv').array], originalUv);
  assert.equal(showAllGeometryFaces(geometry), false);
  assert.equal(visibleVertexPaintScope(geometry, 0), null);
});
