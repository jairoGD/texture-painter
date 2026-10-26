import test from 'node:test';
import assert from 'node:assert/strict';
import { BufferGeometry, Float32BufferAttribute } from 'three';
import { materialVertexIndices } from '../src/editor/vertex-paint.js';
import { invertVertexPoints, resizeVertexPoints } from '../src/editor/vertex-point-selection.js';

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

function positionsOf(geometry, ids) {
  const position = geometry.getAttribute('position');
  return [...new Set([...ids].map((id) =>
    `${position.getX(id)},${position.getY(id)}`))].sort();
}

test('Select More advances one vertex ring across duplicated seam vertices', () => {
  const geometry = grid(2, 1);
  const first = resizeVertexPoints(geometry, 0, new Set([0]), 1, true);
  assert.deepEqual(positionsOf(geometry, first), ['0,0', '0,1', '1,0']);
  const position = geometry.getAttribute('position');
  for (const id of materialVertexIndices(geometry, 0))
    if (position.getX(id) === 1 && position.getY(id) === 0)
      assert.ok(first.has(id));
  const second = resizeVertexPoints(geometry, 0, new Set([0]), 2, true);
  assert.deepEqual(positionsOf(geometry, second),
    ['0,0', '0,1', '1,0', '1,1', '2,0']);
});

test('vertex expansion and inversion stay within the selected material', () => {
  const geometry = grid(2, 1);
  geometry.addGroup(0, 6, 0);
  geometry.addGroup(6, 6, 1);
  const expanded = resizeVertexPoints(geometry, 0, new Set([0]), 3, true);
  assert.deepEqual(positionsOf(geometry, expanded), ['0,0', '0,1', '1,0', '1,1']);
  const inverted = invertVertexPoints(geometry, 0, new Set([1]));
  assert.deepEqual(positionsOf(geometry, inverted), ['0,0', '0,1', '1,1']);
  assert.deepEqual([...invertVertexPoints(geometry, 0,
    new Set(materialVertexIndices(geometry, 0)))], []);
  assert.equal(invertVertexPoints(geometry, 0, new Set()).size,
    materialVertexIndices(geometry, 0).length);
});

test('Select Less removes one outer vertex ring', () => {
  const geometry = grid(3, 3);
  const all = new Set(materialVertexIndices(geometry, 0));
  const contracted = resizeVertexPoints(geometry, 0, all, 1, false);
  assert.deepEqual(positionsOf(geometry, contracted), ['1,1', '1,2', '2,1', '2,2']);
});
