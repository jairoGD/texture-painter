import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { hideGeometryFaces } from '../src/editor/face-visibility.js';
import { pickFaceLoopEdge, selectFaceLoop } from '../src/editor/face-loop-selection.js';

function quadGrid(columns, rows) {
  const positions = [];
  for (let y = 0; y <= rows; y++) for (let x = 0; x <= columns; x++)
    positions.push(x, y, 0);
  const triangles = [];
  const sourceFaceVertices = [];
  const sourceFaceRanges = [];
  for (let y = 0; y < rows; y++) for (let x = 0; x < columns; x++) {
    const a = y * (columns + 1) + x;
    const b = a + 1, d = a + columns + 1, c = d + 1;
    sourceFaceVertices.push([a, b, c, d]);
    sourceFaceRanges.push([triangles.length / 9, 2]);
    for (const id of [a, b, c, a, c, d])
      triangles.push(...positions.slice(id * 3, id * 3 + 3));
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(triangles, 3));
  geometry.userData = { sourceFaceVertices, sourceFaceRanges,
    sourceVertexPositions: positions };
  return geometry;
}

test('Alt-click follows opposite edges through a row of quads', () => {
  const geometry = quadGrid(3, 3);
  const edge = pickFaceLoopEdge(geometry, 8, { x: 1.5, y: 1.02 },
    ([x, y]) => ({ x, y }), 0.1);
  assert.equal(edge, '5|6');
  assert.deepEqual([...selectFaceLoop(geometry, edge)].sort((a, b) => a - b),
    [2, 3, 8, 9, 14, 15]);
  geometry.dispose();
});

test('a hidden quad stops the face loop', () => {
  const geometry = quadGrid(3, 3);
  hideGeometryFaces(geometry, new Set([14, 15]));
  assert.deepEqual([...selectFaceLoop(geometry, '5|6')].sort((a, b) => a - b),
    [2, 3, 8, 9]);
  geometry.dispose();
});

test('Alt-click away from an edge does not start a loop', () => {
  const geometry = quadGrid(1, 1);
  assert.equal(pickFaceLoopEdge(geometry, 0, { x: 0.5, y: 0.5 },
    ([x, y]) => ({ x, y }), 0.1), null);
  geometry.dispose();
});
