import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { hideGeometryFaces } from '../src/editor/face-visibility.js';
import { shortestFacePath } from '../src/editor/face-shortest-path.js';

function quadRow(count) {
  const sourceVertexPositions = [];
  for (let y = 0; y <= 1; y++) for (let x = 0; x <= count; x++)
    sourceVertexPositions.push(x, y, 0);
  const triangles = [], sourceFaceVertices = [], sourceFaceRanges = [];
  for (let x = 0; x < count; x++) {
    const a = x, b = x + 1, d = count + 1 + x, c = d + 1;
    sourceFaceVertices.push([a, b, c, d]);
    sourceFaceRanges.push([triangles.length / 9, 2]);
    for (const vertex of [a, b, c, a, c, d])
      triangles.push(...sourceVertexPositions.slice(vertex * 3, vertex * 3 + 3));
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(triangles, 3));
  geometry.userData = { sourceVertexPositions, sourceFaceVertices, sourceFaceRanges };
  return geometry;
}

test('Ctrl path follows original FBX quads rather than their render triangles', () => {
  const geometry = quadRow(3);
  assert.deepEqual([...shortestFacePath(geometry, 1, 4)].sort((a, b) => a - b),
    [0, 1, 2, 3, 4, 5]);
  geometry.dispose();
});

test('hidden faces block the shortest path', () => {
  const geometry = quadRow(3);
  hideGeometryFaces(geometry, new Set([2, 3]));
  assert.equal(shortestFacePath(geometry, 0, 4), null);
  geometry.dispose();
});

test('bitmap shortest path stays within its material', () => {
  const geometry = quadRow(3);
  geometry.addGroup(0, 6, 0);
  geometry.addGroup(6, 12, 1);
  assert.equal(shortestFacePath(geometry, 0, 4, 0), null);
  assert.deepEqual([...shortestFacePath(geometry, 0, 4)].sort((a, b) => a - b),
    [0, 1, 2, 3, 4, 5]);
  geometry.dispose();
});

test('triangle-only meshes connect across edges but not point contacts', () => {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([
    0, 0, 0, 1, 0, 0, 0, 1, 0,
    1, 0, 0, 1, 1, 0, 0, 1, 0,
    0, 1, 0, -1, 1, 0, -1, 2, 0
  ], 3));
  assert.deepEqual([...shortestFacePath(geometry, 0, 1)].sort(), [0, 1]);
  assert.equal(shortestFacePath(geometry, 0, 2), null);
  geometry.dispose();
});
