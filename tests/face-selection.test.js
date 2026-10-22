import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { faceUvTriangle } from '../src/editor/face-uv-mask.js';
import { combineSelectionAlpha } from '../src/editor/lasso-selection.js';
import { visibleFaceIds } from '../src/editor/screen-face-selection.js';

test('reads face IDs while ignoring empty and occluded pixels', () => {
  const buffer = Uint8Array.from([
    0, 0, 0, 255,
    255, 255, 255, 255,
    0, 0, 1, 255,
    0, 0, 2, 255,
    0, 0, 1, 255
  ]);
  assert.deepEqual([...visibleFaceIds(buffer)], [0, 1]);
});

test('maps indexed face triangles to canvas-oriented UV coordinates', () => {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute([
    0, 0, 1, 0, 0, 1, 1, 1
  ], 2));
  geometry.setIndex([0, 1, 2, 1, 3, 2]);
  assert.deepEqual(faceUvTriangle(geometry, 1), [
    { x: 1, y: 1 }, { x: 1, y: 0 }, { x: 0, y: 0 }
  ]);
  assert.equal(faceUvTriangle(geometry, 2), null);
});

test('maps non-indexed face triangles', () => {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute([
    0.2, 0.3, 0.4, 0.3, 0.2, 0.7
  ], 2));
  const points = faceUvTriangle(geometry, 0);
  assert.ok(Math.abs(points[0].y - 0.7) < 1e-6);
  assert.ok(Math.abs(points[2].y - 0.3) < 1e-6);
});

test('Alt subtraction removes only the picked face mask', () => {
  const old = { alpha: Uint8Array.from([255, 255, 128, 0, 255]),
    indices: Uint32Array.from([0, 1, 2, 4]) };
  const picked = { alpha: Uint8Array.from([0, 255, 128, 255, 128]),
    indices: Uint32Array.from([1, 2, 3, 4]) };
  const result = combineSelectionAlpha(old, picked, 'subtract');
  assert.deepEqual([...result.alpha], [255, 0, 0, 0, 127]);
  assert.deepEqual(result.indices, [0, 4]);
  assert.equal(result.changed, true);
  assert.deepEqual([...old.alpha], [255, 255, 128, 0, 255]);
});

test('Shift addition preserves selected faces and adds new ones', () => {
  const old = { alpha: Uint8Array.from([255, 0, 64]),
    indices: Uint32Array.from([0, 2]) };
  const picked = { alpha: Uint8Array.from([0, 255, 128]),
    indices: Uint32Array.from([1, 2]) };
  const result = combineSelectionAlpha(old, picked, 'add');
  assert.deepEqual([...result.alpha], [255, 255, 128]);
  assert.deepEqual(result.indices, [0, 2, 1]);
});
