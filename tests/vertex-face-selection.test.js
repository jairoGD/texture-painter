import test from 'node:test';
import assert from 'node:assert/strict';
import { BufferGeometry, Float32BufferAttribute } from 'three';
import { connectedVertexFaces, invertVertexFaces, resizeVertexFaces } from '../src/editor/vertex-face-selection.js';

function grid(columns, rows) {
  const positions = [];
  for (let y = 0; y < rows; y++) for (let x = 0; x < columns; x++) {
    positions.push(x, y, 0, x + 1, y, 0, x, y + 1, 0);
    positions.push(x + 1, y, 0, x + 1, y + 1, 0, x, y + 1, 0);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  return geometry;
}

test('Select More crosses duplicated vertex edges one face per step', () => {
  const geometry = grid(2, 1);
  assert.deepEqual([...resizeVertexFaces(geometry, 0, new Set([0]), 1, true)].sort(), [0, 1]);
  assert.deepEqual([...resizeVertexFaces(geometry, 0, new Set([0]), 2, true)].sort(), [0, 1, 2]);
});

test('face selection operations stay within the active material', () => {
  const geometry = grid(2, 1);
  geometry.addGroup(0, 6, 0);
  geometry.addGroup(6, 6, 1);
  assert.deepEqual([...resizeVertexFaces(geometry, 0, new Set([1]), 2, true)].sort(), [0, 1]);
  assert.deepEqual([...invertVertexFaces(geometry, 0, new Set([1]))], [0]);
  assert.deepEqual([...invertVertexFaces(geometry, 0, new Set([0, 1]))], []);
  assert.deepEqual([...invertVertexFaces(geometry, 0, new Set())], [0, 1]);
});

test('Select Less removes a layer of boundary faces', () => {
  const geometry = grid(3, 3);
  const all = new Set(Array.from({ length: 18 }, (_, face) => face));
  const contracted = resizeVertexFaces(geometry, 0, all, 1, false);
  assert.equal(contracted.has(0), false);
  assert.equal(contracted.has(8), true);
  assert.equal(contracted.has(9), true);
});

test('double click reaches faces across split vertices but not a point contact', () => {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute([
    0, 0, 0, 1, 0, 0, 0, 1, 0,
    1, 0, 0, 1, 1, 0, 0, 1, 0,
    1, 1, 0, 2, 1, 0, 1, 2, 0
  ], 3));
  assert.deepEqual([...connectedVertexFaces(geometry, 0, new Set([0]))].sort(), [0, 1]);
  assert.deepEqual([...connectedVertexFaces(geometry, 0, new Set([2]))], [2]);
});

test('connected selection can cross materials and stops at hidden faces', () => {
  const geometry = grid(2, 1);
  geometry.addGroup(0, 9, 0);
  geometry.addGroup(9, 3, 1);
  assert.deepEqual([...connectedVertexFaces(geometry, 0, new Set([0]))].sort(), [0, 1, 2]);
  assert.deepEqual([...connectedVertexFaces(geometry, 0, new Set([0]),
    new Set([0, 2]))], [0]);
  assert.deepEqual([...connectedVertexFaces(geometry, null, new Set([0]))].sort(),
    [0, 1, 2, 3]);
  assert.deepEqual([...resizeVertexFaces(geometry, null, new Set([2]), 1, true)].sort(),
    [1, 2, 3]);
});
